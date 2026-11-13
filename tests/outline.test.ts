import { describe, expect, it } from 'vitest';
import { extractOutline, headingAt, isMarkdownName, rankHeadings } from '../src/outline';

describe('document outline', () => {
  it('extracts ATX headings with levels, text and line numbers', () => {
    const source = ['# Title', '', 'body', '## Section', '### Deep **bold**', 'body'].join('\n');
    const { headings, truncated, partial } = extractOutline(source);
    expect(headings.map((heading) => [heading.level, heading.text, heading.line])).toEqual([
      [1, 'Title', 0],
      [2, 'Section', 3],
      [3, 'Deep bold', 4],
    ]);
    expect(truncated).toBe(false);
    expect(partial).toBe(false);
  });

  it('ignores headings inside fenced code blocks, including tilde fences', () => {
    const source = ['# Real', '```', '# not a heading', '```', '~~~', '# also not', '~~~', '## Also real'].join('\n');
    expect(extractOutline(source).headings.map((heading) => heading.text)).toEqual(['Real', 'Also real']);
  });

  it('parses underline headings only when asked, and not for list or quote lines', () => {
    const source = ['Title', '=====', 'Section', '-------', '- item', '---', '> quoted', '---'].join('\n');
    expect(extractOutline(source).headings).toHaveLength(0);
    expect(extractOutline(source, { underline: true }).headings.map((heading) => [heading.level, heading.text]))
      .toEqual([[1, 'Title'], [2, 'Section']]);
  });

  it('strips link syntax and closing hashes from heading text', () => {
    const { headings } = extractOutline('# [Docs](https://example.com) ##');
    expect(headings[0].text).toBe('Docs');
  });

  it('bounds the number of headings and reports truncation', () => {
    const source = Array.from({ length: 500 }, (_, index) => `## Heading ${index}`).join('\n');
    const result = extractOutline(source);
    expect(result.headings).toHaveLength(400);
    expect(result.truncated).toBe(true);
  });

  it('does not retain the last heading when the limit is hit on the final line', () => {
    const source = Array.from({ length: 401 }, (_, index) => `# H${index}`).join('\n');
    const result = extractOutline(source);
    expect(result.headings.at(-1)!.text).toBe('H399');
    expect(result.truncated).toBe(true);
  });

  it('ranks prefix matches above inner matches and shallower headings first', () => {
    const source = ['# Setup', '## Project setup', '## Set up the editor', '# Later'].join('\n');
    const { headings } = extractOutline(source);
    expect(rankHeadings(headings, 'set').map((heading) => heading.text)).toEqual(['Setup', 'Set up the editor', 'Project setup']);
  });

  it('returns every heading when the query is empty', () => {
    const { headings } = extractOutline('# A\n# B');
    expect(rankHeadings(headings, '')).toHaveLength(2);
  });

  it('finds the heading containing a line', () => {
    const { headings } = extractOutline('# A\n\ntext\n## B\n\ntext');
    expect(headingAt(headings, 0)!.text).toBe('A');
    expect(headingAt(headings, 3)!.text).toBe('B');
    expect(headingAt(headings, 5)!.text).toBe('B');
  });

  it('recognises files that can carry an outline', () => {
    expect(isMarkdownName('notes.md')).toBe(true);
    expect(isMarkdownName('quick.notes.TXT')).toBe(true);
    expect(isMarkdownName('main.ts')).toBe(false);
  });
});
