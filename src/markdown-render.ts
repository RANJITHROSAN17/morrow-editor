import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { MAX_MARKDOWN_CHARS, MAX_MARKDOWN_NODES, type MarkdownResult, type PreviewNode, type PreviewTag } from './markdown-preview-contract';

const TAG_BY_TOKEN: Record<string, PreviewTag> = {
  paragraph_open: 'p', blockquote_open: 'blockquote', bullet_list_open: 'ul', ordered_list_open: 'ol', list_item_open: 'li',
  em_open: 'em', strong_open: 'strong', s_open: 's', link_open: 'span',
  table_open: 'table', thead_open: 'thead', tbody_open: 'tbody', tr_open: 'tr', th_open: 'th', td_open: 'td',
};

// Parse into a small, closed set of inert nodes. No HTML output, URL, source
// attribute, style, class, or tag name supplied by the document is passed to the
// DOM. Images become text placeholders and links become non-interactive spans.
export function buildMarkdownPreview(source: string): MarkdownResult {
  if (source.length > MAX_MARKDOWN_CHARS) return { ok: false, error: `Preview is limited to ${MAX_MARKDOWN_CHARS.toLocaleString()} characters. Your file is unchanged.` };
  try {
    // maxNesting is supported by markdown-it but absent from its published
    // TypeScript Options declaration, so pass it through a structural variable.
    const options = { html: false, linkify: false, typographer: false, maxNesting: 20 };
    const parser = new MarkdownIt(options);
    const tokens = parser.parse(source, {});
    const root: PreviewNode[] = [];
    const stack: PreviewNode[][] = [root];
    let count = 0;
    const add = (node: PreviewNode) => {
      if (++count > MAX_MARKDOWN_NODES) throw new Error('complex');
      stack[stack.length - 1].push(node);
    };
    const addElement = (tag: PreviewTag, kind?: 'link' | 'image', start?: number): Extract<PreviewNode, { type: 'element' }> => {
      const node: Extract<PreviewNode, { type: 'element' }> = { type: 'element', tag, children: [] };
      if (kind) node.kind = kind;
      if (start !== undefined) node.start = start;
      add(node);
      return node;
    };
    const addText = (text: string) => { if (text) add({ type: 'text', text }); };
    const visit = (list: Token[]) => {
      for (const token of list) {
        if (token.type === 'inline') { if (token.children) visit(token.children); continue; }
        if (token.nesting === 1) {
          let tag: PreviewTag | undefined = TAG_BY_TOKEN[token.type];
          if (token.type === 'heading_open' && /^h[1-6]$/u.test(token.tag)) tag = token.tag as PreviewTag;
          if (!tag) { stack.push(stack[stack.length - 1]); continue; }
          const rawStart = token.type === 'ordered_list_open' ? token.attrGet('start') : null;
          const start = rawStart !== null && /^\d{1,9}$/u.test(rawStart) ? Number(rawStart) : undefined;
          const node = addElement(tag, token.type === 'link_open' ? 'link' : undefined, start);
          stack.push(node.children);
          continue;
        }
        if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
        switch (token.type) {
          case 'text': case 'html_inline': case 'html_block': addText(token.content); break;
          case 'softbreak': addText('\n'); break;
          case 'hardbreak': addElement('br'); break;
          case 'hr': addElement('hr'); break;
          case 'code_inline': {
            const node = addElement('code'); stack.push(node.children); addText(token.content); stack.pop(); break;
          }
          case 'fence': case 'code_block': {
            const pre = addElement('pre'); stack.push(pre.children);
            const code = addElement('code'); stack.push(code.children); addText(token.content); stack.pop(); stack.pop(); break;
          }
          case 'image': {
            const image = addElement('span', 'image'); stack.push(image.children);
            addText(`Image not loaded${token.content ? `: ${token.content}` : ''}`); stack.pop(); break;
          }
          default: if (token.content) addText(token.content);
        }
      }
    };
    visit(tokens);
    return { ok: true, nodes: root };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message === 'complex'
      ? `Preview is limited to ${MAX_MARKDOWN_NODES.toLocaleString()} elements. Your file is unchanged.`
      : 'Could not build this preview. Your file is unchanged.' };
  }
}
