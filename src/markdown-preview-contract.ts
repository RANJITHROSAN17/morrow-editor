// Limits are in UTF-16 code units and count actual preview nodes.
export const MAX_MARKDOWN_CHARS = 150_000;
export const MAX_MARKDOWN_NODES = 5_000;
export type PreviewTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'blockquote' | 'ul' | 'ol' | 'li' | 'em' | 'strong' | 's' | 'span' | 'code' | 'pre' | 'hr' | 'br' | 'table' | 'thead' | 'tbody' | 'tr' | 'th' | 'td';
export type PreviewNode = { type: 'text'; text: string } | { type: 'element'; tag: PreviewTag; children: PreviewNode[]; kind?: 'link' | 'image'; start?: number };
export type MarkdownResult = { ok: true; nodes: PreviewNode[] } | { ok: false; error: string };
