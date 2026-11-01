import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { desktop } from './platform';
import { boundedJson } from './bounded-json';

export const DEFAULT_MODEL = 'qwen2.5-coder:1.5b';
const ENDPOINT = 'http://127.0.0.1:11434';
export const AI_CONTEXT_BEFORE = 3500;
export const AI_CONTEXT_AFTER = 1200;
export const MAX_OLLAMA_RESPONSE_BYTES = 262_144;
const MAX_OLLAMA_ERROR_BYTES = 8_192;

/** A boundary between the two code units of one non-BMP character. */
function splitsSurrogatePair(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Limit how much surrounding text leaves the editor; this sends no file path. */
export function buildCompletionRequest(text: string, cursor: number, model: string) {
  cursor = Math.max(0, Math.min(text.length, Math.trunc(cursor) || 0));
  let start = Math.max(0, cursor - AI_CONTEXT_BEFORE);
  let end = Math.min(text.length, cursor + AI_CONTEXT_AFTER);
  // Drop partial characters rather than exceeding the context/privacy limits.
  if (splitsSurrogatePair(text, start)) start++;
  if (splitsSurrogatePair(text, end)) end--;
  const promptEnd = splitsSurrogatePair(text, cursor) ? cursor - 1 : cursor;
  const suffixStart = splitsSurrogatePair(text, cursor) ? cursor + 1 : cursor;
  return {
    model,
    prompt: text.slice(start, promptEnd),
    // The FIM template needs a non-empty suffix even at the end of a document.
    suffix: text.slice(suffixStart, end) || '\n',
    stream: false,
    options: { temperature: 0.2, num_predict: 96, stop: ['<|endoftext|>', '<|file_separator|>'] },
  };
}

/** The prototype shows only an inline, single-line suggestion. */
export function firstSuggestion(value: unknown): string {
  if (typeof value !== 'string') return '';
  const first = value.replace(/\r/g, '').split('\n', 1)[0];
  if (!first.trim() || /^(?:```|<\||<fim_|\[INST\]|<\/s>)/iu.test(first.trimStart())) return '';
  return first.slice(0, 240);
}

export async function listModels(signal?: AbortSignal): Promise<string[]> {
  if (!desktop) throw new Error('AI is available in the Windows desktop app, not this browser preview.');
  const response = await nativeFetch(`${ENDPOINT}/api/tags`, { method: 'GET', signal, maxRedirections: 0 });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`Ollama responded with HTTP ${response.status}.`); }
  const body = await boundedJson(response, MAX_OLLAMA_RESPONSE_BYTES, 'Ollama response is too large.') as { models?: unknown };
  if (!Array.isArray(body?.models)) return [];
  return body.models.slice(0, 1_000)
    .map((item: unknown) => (item as { name?: unknown })?.name)
    .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0 && name.length <= 120);
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
    try {
      const body = await boundedJson(response, MAX_OLLAMA_ERROR_BYTES, 'Ollama error response is too large.') as { error?: unknown };
      if (typeof body?.error === 'string') detail = body.error.replace(/[\u0000-\u001f]/gu, ' ').slice(0, 250);
    } catch { /* Use a generic status if the error body is absent, malformed or too large. */ }
    throw new Error(detail || `Ollama responded with HTTP ${response.status}.`);
  }
  const result = await boundedJson(response, MAX_OLLAMA_RESPONSE_BYTES, 'Ollama response is too large.') as { response?: string };
  return firstSuggestion(result.response);
}
