import { buildMarkdownPreview } from './markdown-render';
import type { MarkdownResult } from './markdown-preview-contract';

interface PreviewRequest { id: number; source: string; }
interface PreviewResponse { id: number; result: MarkdownResult; }
// A worker keeps Markdown parsing off the editor's UI thread. Only the active
// document text supplied by the user is received; this worker makes no requests.
const scope = self as unknown as { onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null; postMessage: (message: PreviewResponse) => void };
scope.onmessage = (event) => {
  const { id, source } = event.data;
  scope.postMessage({ id, result: buildMarkdownPreview(source) });
};
