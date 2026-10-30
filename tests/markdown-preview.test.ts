import { describe, expect, it } from 'vitest';
import { buildMarkdownPreview } from '../src/markdown-render';
import { MAX_MARKDOWN_CHARS, MAX_MARKDOWN_NODES, type PreviewNode } from '../src/markdown-preview-contract';

function walk(nodes: PreviewNode[]): PreviewNode[] {
  return nodes.flatMap((node) => node.type === 'element' ? [node, ...walk(node.children)] : [node]);
}

describe('bounded Markdown preview', () => {
  it('turns ordinary notes, code, tables and lists into allowlisted nodes', () => {
    const result = buildMarkdownPreview('# Hello தமிழ்\n\nA **bold** and `code` note.\n\n7. First\n8. Second\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconsole.log(1)\n```');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = walk(result.nodes);
    expect(all).toContainEqual(expect.objectContaining({ type: 'element', tag: 'h1' }));
    expect(all).toContainEqual(expect.objectContaining({ type: 'element', tag: 'strong' }));
    expect(all).toContainEqual(expect.objectContaining({ type: 'element', tag: 'ol', start: 7 }));
    expect(all).toContainEqual(expect.objectContaining({ type: 'element', tag: 'table' }));
    expect(all).toContainEqual(expect.objectContaining({ type: 'element', tag: 'pre' }));
    expect(all).toContainEqual({ type: 'text', text: 'Hello தமிழ்' });
  });

  it('retains untrusted HTML as text and discards image and link destinations', () => {
    const source = '<script>window.pwned=true</script>\n\n![alt](https://images.invalid/track) [click](https://links.invalid/x)';
    const result = buildMarkdownPreview(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = walk(result.nodes);
    expect(all.some((node) => node.type === 'text' && node.text.includes('<script>'))).toBe(true);
    expect(all.some((node) => node.type === 'element' && (node.tag as string) === 'script')).toBe(false);
    expect(all).toContainEqual(expect.objectContaining({ type: 'element', tag: 'span', kind: 'image' }));
    expect(all).toContainEqual(expect.objectContaining({ type: 'element', tag: 'span', kind: 'link' }));
    expect(JSON.stringify(result)).not.toContain('images.invalid');
    expect(JSON.stringify(result)).not.toContain('links.invalid');
  });

  it('refuses excessive input and excessive preview elements without changing the source', () => {
    const long = 'x'.repeat(MAX_MARKDOWN_CHARS + 1);
    const lengthResult = buildMarkdownPreview(long);
    expect(lengthResult.ok).toBe(false);
    if (!lengthResult.ok) expect(lengthResult.error).toContain(MAX_MARKDOWN_CHARS.toLocaleString());
    const complex = '*x* '.repeat(MAX_MARKDOWN_NODES);
    const complexResult = buildMarkdownPreview(complex);
    expect(complexResult.ok).toBe(false);
    if (!complexResult.ok) expect(complexResult.error).toContain(MAX_MARKDOWN_NODES.toLocaleString());
    expect(long).toHaveLength(MAX_MARKDOWN_CHARS + 1);
  });
});
