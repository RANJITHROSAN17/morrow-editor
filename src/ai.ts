import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { desktop } from './platform';

export const DEFAULT_MODEL = 'qwen2.5-coder:1.5b';
const ENDPOINT = 'http://127.0.0.1:11434';
export const AI_CONTEXT_BEFORE = 3500;
export const AI_CONTEXT_AFTER = 1200;

/** Limit how much surrounding text leaves the editor; this sends no file path. */
export function buildCompletionRequest(text: string, cursor: number, model: string) {
  return {
    model,
    prompt: text.slice(Math.max(0, cursor - AI_CONTEXT_BEFORE), cursor),
    // The FIM template needs a non-empty suffix even at the end of a document.
    suffix: text.slice(cursor, cursor + AI_CONTEXT_AFTER) || '\n',
    stream: false,
    options: { temperature: 0.2, num_predict: 96, stop: ['<|endoftext|>', '<|file_separator|>'] },
  };
}

/** The prototype shows only an inline, single-line suggestion. */
export function firstSuggestion(value: unknown): string {
  if (typeof value !== 'string') return '';
  const first = value.replace(/\r/g, '').split('\n', 1)[0];
  if (!first.trim() || first.startsWith('```') || first.startsWith('<|')) return '';
  return first.slice(0, 240);
}

export async function listModels(signal?: AbortSignal): Promise<string[]> {
  if (!desktop) throw new Error('AI is available in the Windows desktop app, not this browser preview.');
  const response = await nativeFetch(`${ENDPOINT}/api/tags`, { method: 'GET', signal, maxRedirections: 0 });
  if (!response.ok) throw new Error(`Ollama responded with HTTP ${response.status}.`);
  const body = await response.json() as { models?: { name?: string }[] };
  return (body.models || []).map((item) => item.name).filter((name): name is string => !!name);
}

export async function complete(text: string, cursor: number, model: string, signal?: AbortSignal): Promise<string> {
  if (!desktop) throw new Error('AI is available in the Windows desktop app, not this browser preview.');
  const response = await nativeFetch(`${ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCompletionRequest(text, cursor, model)),
    signal,
    maxRedirections: 0,
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json() as { error?: string }).error || ''; } catch { /* no body */ }
    throw new Error(detail || `Ollama responded with HTTP ${response.status}.`);
  }
  const result = await response.json() as { response?: string };
  return firstSuggestion(result.response);
}
