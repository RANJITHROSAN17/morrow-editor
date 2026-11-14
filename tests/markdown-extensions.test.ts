import { describe, expect, it } from 'vitest';
import { hasExtensions, preprocessMarkdown, renderCallouts, renderInlineTags, renderMath, renderTaskLists, renderWikiLinks } from '../src/markdown-extensions';
import { buildMarkdownPreview } from '../src/markdown-render';

const flatten = (nodes: ReturnType<typeof buildMarkdownPreview>): string => {
  if (!nodes.ok) return nodes.error;
  const walk = (list: typeof nodes.nodes): string => list.map((node) => node.type === 'text' ? node.text : walk(node.children)).join('');
  return walk(nodes.nodes);
};

describe('wiki links', () => {
  it('rewrites targets, aliases and heading links into inert Markdown links', () => {
    expect(renderWikiLinks('See [[Roadmap]].')).toBe('See [Roadmap](note:Roadmap).');
    expect(renderWikiLinks('[[Plan|the plan]]')).toBe('[the plan](note:Plan)');
    expect(renderWikiLinks('[[Notes#Ideas]]')).toBe('[Notes › Ideas](note:Notes#Ideas)');
  });

  it('escapes parentheses so a target cannot break the link syntax', () => {
    expect(renderWikiLinks('[[a (b)]]')).toBe('[a (b)](note:a \\(b\\))');
  });

  it('leaves empty or oversized brackets alone', () => {
    expect(renderWikiLinks('[[]]')).toBe('[[]]');
    expect(renderWikiLinks('[[unclosed')).toBe('[[unclosed');
  });
});

describe('tags, tasks, callouts and math', () => {
  it('turns body tags into inert tag links and skips headings and code', () => {
    expect(renderInlineTags('a #work item')).toBe('a [#work](tag:work) item');
    expect(renderInlineTags('# Heading')).toBe('# Heading');
    expect(renderInlineTags('```\n#code\n```')).toBe('```\n#code\n```');
    expect(renderInlineTags('see #project/wrytrove.')).toBe('see [#project/wrytrove](tag:project/wrytrove).');
  });

  it('renders task checkboxes as text glyphs', () => {
    expect(renderTaskLists('- [ ] todo')).toContain('☐');
    expect(renderTaskLists('- [x] done')).toContain('☑');
    expect(renderTaskLists('- [ ] todo')).not.toContain('[');
  });

  it('labels callouts without introducing HTML', () => {
    const rendered = renderCallouts('> [!warning] Careful\n> body');
    expect(rendered).toContain('**⚠ Warning** — Careful');
    expect(renderCallouts('> [!bogus] nope')).toBe('> [!bogus] nope');
  });

  it('shows math as a labelled literal rather than pretending to render it', () => {
    expect(renderMath('inline $a^2 + b^2$ here')).toContain('`∑ a^2 + b^2`');
    expect(renderMath('$$\nE = mc^2\n$$')).toContain('`∑ E = mc^2`');
    // Ordinary prices must not be mistaken for math.
    expect(renderMath('it costs $5 today')).toBe('it costs $5 today');
  });

  it('only preprocesses documents that use extension syntax', () => {
    expect(hasExtensions('# plain markdown')).toBe(false);
    expect(hasExtensions('a [[link]]')).toBe(true);
    expect(hasExtensions('- [x] task')).toBe(true);
    expect(hasExtensions('> [!note]')).toBe(true);
    expect(hasExtensions('price $4')).toBe(true);
    expect(preprocessMarkdown('price $4')).toBe('price $4');
  });
});

describe('preview integration', () => {
  it('renders wiki links, tags, tasks and callouts inside the inert node contract', () => {
    const source = ['# Notes', '', 'See [[Roadmap]] and #work.', '', '- [x] shipped', '', '> [!tip] Try this'].join('\n');
    const tree = buildMarkdownPreview(source);
    expect(tree.ok).toBe(true);
    const text = flatten(tree);
    expect(text).toContain('Roadmap');
    expect(text).toContain('#work');
    expect(text).toContain('☑');
    expect(text).toContain('Tip');
    expect(text).not.toContain('[[');
  });

  it('keeps raw HTML inert after preprocessing', () => {
    const tree = buildMarkdownPreview('<img src=x onerror=alert(1)> [[Note]]');
    expect(tree.ok).toBe(true);
    expect(flatten(tree)).toContain('<img src=x onerror=alert(1)>');
  });

  it('still refuses a document over the preview limit', () => {
    const tree = buildMarkdownPreview('a'.repeat(150_001));
    expect(tree.ok).toBe(false);
  });

  it('preprocesses only when needed, so plain Markdown is byte-identical', () => {
    expect(preprocessMarkdown('# Title\n\ntext')).toBe('# Title\n\ntext');
  });
});
