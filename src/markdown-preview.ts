import { MAX_MARKDOWN_CHARS, MAX_MARKDOWN_NODES, type MarkdownResult, type PreviewNode } from './markdown-preview-contract';

const ALLOWED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'em', 'strong', 's', 'span', 'code', 'pre', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const get = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing preview element ${selector}`);
  return found;
};

/** Displays only inert, allowlisted DOM nodes; never inserts parser-generated HTML. */
function appendPreview(container: HTMLElement, nodes: PreviewNode[]): void {
  let count = 0;
  const make = (node: PreviewNode): Node => {
    if (++count > MAX_MARKDOWN_NODES) throw new Error('Preview is too complex.');
    if (node.type === 'text') return document.createTextNode(node.text);
    if (!ALLOWED_TAGS.has(node.tag) || !Array.isArray(node.children)) throw new Error('Invalid preview node.');
    const result = document.createElement(node.tag);
    if (node.kind === 'link' && node.tag === 'span') { result.className = 'markdown-link'; result.title = 'Links are inactive in preview'; }
    if (node.kind === 'image' && node.tag === 'span') result.className = 'markdown-image';
    if (node.tag === 'ol' && Number.isInteger(node.start) && (node.start as number) >= 0 && (node.start as number) <= 999_999_999) result.setAttribute('start', String(node.start));
    for (const child of node.children) result.append(make(child));
    return result;
  };
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.append(make(node));
  container.replaceChildren(fragment);
}

export class MarkdownPreview {
  private open = false;
  private timer = 0;
  private serial = 0;
  private lastKey = '';
  private worker: Worker | null = null;

  isOpen(): boolean { return this.open; }

  setOpen(open: boolean): void {
    this.open = open;
    get<HTMLElement>('#markdown-panel').hidden = !open;
    get<HTMLElement>('#editor-columns').classList.toggle('preview-open', open);
    get<HTMLButtonElement>('#preview-button').setAttribute('aria-pressed', String(open));
    if (!open) this.clear();
  }

  private clear(): void {
    this.serial++;
    window.clearTimeout(this.timer);
    this.worker?.terminate(); this.worker = null;
    this.lastKey = '';
    get<HTMLElement>('#markdown-content').replaceChildren();
    get<HTMLElement>('#markdown-status').textContent = '';
  }

  update(key: string, length: number, getSource: () => string): void {
    if (!this.open || key === this.lastKey) return;
    this.lastKey = key;
    const id = ++this.serial;
    window.clearTimeout(this.timer);
    this.worker?.terminate(); this.worker = null;
    const output = get<HTMLElement>('#markdown-content');
    const status = get<HTMLElement>('#markdown-status');
    output.replaceChildren();
    if (length > MAX_MARKDOWN_CHARS) {
      status.textContent = `Preview is limited to ${MAX_MARKDOWN_CHARS.toLocaleString()} characters. Your file is unchanged.`;
      return;
    }
    status.textContent = 'Updating preview…';
    this.timer = window.setTimeout(() => {
      try {
        const worker = new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<{ id: number; result: MarkdownResult }>) => {
          if (!this.open || id !== this.serial || event.data.id !== id) return;
          window.clearTimeout(this.timer);
          worker.terminate(); if (this.worker === worker) this.worker = null;
          const result = event.data.result;
          if (!result.ok) { status.textContent = result.error; return; }
          try {
            appendPreview(output, result.nodes);
            status.textContent = result.nodes.length ? 'Preview updated.' : 'Nothing to preview yet.';
          } catch { output.replaceChildren(); status.textContent = 'Could not display this preview. Your file is unchanged.'; }
        };
        worker.onerror = (event) => {
          event.preventDefault(); window.clearTimeout(this.timer); worker.terminate(); if (this.worker === worker) this.worker = null;
          if (this.open && id === this.serial) status.textContent = 'Preview is unavailable in this environment. Your file is unchanged.';
        };
        worker.postMessage({ id, source: getSource() });
        this.timer = window.setTimeout(() => {
          worker.terminate(); if (this.worker === worker) this.worker = null;
          if (this.open && id === this.serial) status.textContent = 'Preview timed out. Your file is unchanged.';
        }, 8_000);
      } catch {
        this.worker?.terminate(); this.worker = null;
        if (this.open && id === this.serial) status.textContent = 'Preview is unavailable in this environment. Your file is unchanged.';
      }
    }, 180);
  }
}
