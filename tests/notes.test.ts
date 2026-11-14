import { describe, expect, it } from 'vitest';
import {
  collectTags, expandTemplate, extractWikiLinks, frontmatterValue, noteKey,
  normalizeTag, parseFrontmatter, resolveWikiTarget, tagCounts,
} from '../src/notes';

describe('front matter', () => {
  it('reads scalars, inline lists and dash lists', () => {
    const source = ['---', 'title: Roadmap', 'tags: [work, planning]', 'author: Ranjith', 'aliases:', '  - plan', '  - schedule', '---', '# Body', 'text'].join('\n');
    const front = parseFrontmatter(source);
    expect(front.present).toBe(true);
    expect(front.data.title).toBe('Roadmap');
    expect(front.data.tags).toEqual(['work', 'planning']);
    expect(front.data.aliases).toEqual(['plan', 'schedule']);
    expect(front.body.startsWith('# Body')).toBe(true);
    expect(source.slice(front.bodyOffset).startsWith('# Body')).toBe(true);
  });

  it('strips surrounding quotes but does not interpret values', () => {
    const front = parseFrontmatter('---\ntitle: "Quoted: with colon"\nscript: <b>hi</b>\n---\nbody');
    expect(front.data.title).toBe('Quoted: with colon');
    expect(front.data.script).toBe('<b>hi</b>');
  });

  it('treats unterminated front matter as ordinary text', () => {
    const source = '---\ntitle: never closed\n\nbody';
    const front = parseFrontmatter(source);
    expect(front.present).toBe(false);
    expect(front.body).toBe(source);
  });

  it('ignores a leading horizontal rule that is not front matter', () => {
    expect(parseFrontmatter('---\njust a rule\n---\ntext').present).toBe(false);
    // Dashes with nothing between them are two horizontal rules, not an empty metadata block.
    expect(parseFrontmatter('---\n---\n').present).toBe(false);
  });

  it('returns a list for a repeated key style and a scalar for a single value', () => {
    const front = parseFrontmatter('---\ntags: one\n---\nx');
    expect(frontmatterValue(front, 'tags')).toEqual(['one']);
    expect(frontmatterValue(front, 'missing')).toEqual([]);
  });
});

describe('tags', () => {
  it('normalises case, hashes and trailing punctuation', () => {
    expect(normalizeTag('#Work')).toBe('work');
    expect(normalizeTag('  #project/wrytrove!  ')).toBe('project/wrytrove');
    expect(normalizeTag('##double')).toBe('double');
    expect(normalizeTag('#')).toBeNull();
    expect(normalizeTag('#has space')).toBeNull();
    expect(normalizeTag(`#${'a'.repeat(60)}`)).toBeNull();
  });

  it('collects body tags plus the front-matter tags key once', () => {
    const source = ['---', 'tags: [Work, ideas]', '---', '# Heading is not a tag', 'Body with #work and #Project/Wrytrove.', '```ts', '# code is not a tag', '```', 'Inline `#nope` code too.'].join('\n');
    expect(collectTags(source).sort()).toEqual(['ideas', 'project/wrytrove', 'work']);
  });

  it('skips heading lines so "# Title" never becomes a tag', () => {
    expect(collectTags('# A heading\nplain #real')).toEqual(['real']);
  });

  it('counts tags across notes, most used first', () => {
    expect(tagCounts([['a', 'b'], ['a'], ['c', 'a']])).toEqual([
      { tag: 'a', count: 3 }, { tag: 'b', count: 1 }, { tag: 'c', count: 1 },
    ]);
  });
});

describe('wiki links', () => {
  it('parses targets, aliases and headings', () => {
    const links = extractWikiLinks('See [[Roadmap]] and [[Plan|the plan]] and [[Notes#Ideas]].');
    expect(links.map((link) => [link.target, link.alias, link.heading])).toEqual([
      ['Roadmap', null, null],
      ['Plan', 'the plan', null],
      ['Notes', null, 'Ideas'],
    ]);
  });

  it('ignores links inside code fences and inline code', () => {
    const source = ['`[[inline]]`', '```', '[[fenced]]', '```', '[[real]]'].join('\n');
    expect(extractWikiLinks(source).map((link) => link.target)).toEqual(['real']);
  });

  it('normalises note keys for matching', () => {
    expect(noteKey('Some Note.md')).toBe('some note');
    expect(noteKey('C:\\notes\\Deep\\File.markdown')).toBe('file');
    expect(noteKey('TXT.txt')).toBe('txt');
  });

  it('resolves to exactly one note, reporting ambiguity instead of guessing', () => {
    const candidates = [{ name: 'roadmap.md' }, { name: 'plan.md', relative: 'projects/plan.md' }, { name: 'x.md' }];
    expect(resolveWikiTarget('Roadmap', candidates)).toMatchObject({ status: 'linked', matches: 1 });
    expect(resolveWikiTarget('projects/plan', candidates)).toMatchObject({ status: 'linked' });
    expect(resolveWikiTarget('Missing', candidates)).toMatchObject({ status: 'missing', match: null });
    expect(resolveWikiTarget('', candidates)).toMatchObject({ status: 'missing' });
  });

  it('flags two notes with the same name as ambiguous', () => {
    const result = resolveWikiTarget('notes', [{ name: 'notes.md', relative: 'a/notes.md' }, { name: 'Notes.md', relative: 'b/Notes.md' }]);
    expect(result.status).toBe('ambiguous');
    expect(result.matches).toBe(2);
  });
});

describe('templates', () => {
  it('expands the documented placeholders and leaves unknown ones alone', () => {
    const out = expandTemplate('{{title}} on {{date}} at {{time}} {{unknown}}', { date: '2026-11-13', time: '09:30', title: 'Daily' });
    expect(out).toBe('Daily on 2026-11-13 at 09:30 {{unknown}}');
  });
});
