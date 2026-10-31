import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { complete, listModels, MAX_OLLAMA_RESPONSE_BYTES } from '../src/ai';

beforeEach(() => vi.resetAllMocks());

describe('bounded Ollama responses', () => {
  it('reads bounded model names and completions without redirects', async () => {
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'coder' }, { name: 'x'.repeat(121) }, { name: null }] })));
    await expect(listModels()).resolves.toEqual(['coder']);
    expect(nativeFetch).toHaveBeenLastCalledWith('http://127.0.0.1:11434/api/tags', expect.objectContaining({ maxRedirections: 0 }));
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response(JSON.stringify({ response: 'suggestion\nignored' })));
    await expect(complete('hello', 5, 'coder')).resolves.toBe('suggestion');
    expect(nativeFetch).toHaveBeenLastCalledWith('http://127.0.0.1:11434/api/generate', expect.objectContaining({ maxRedirections: 0 }));
  });
  it('rejects oversized declared and streamed bodies before parsing', async () => {
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response('x', { headers: { 'content-length': String(MAX_OLLAMA_RESPONSE_BYTES + 1) } }));
    await expect(listModels()).rejects.toThrow(/too large/);
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_OLLAMA_RESPONSE_BYTES + 1)); c.close(); } })));
    await expect(complete('x', 1, 'coder')).rejects.toThrow(/too large/);
  });
  it('limits untrusted error messages and handles oversized error bodies', async () => {
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad\n' + 'x'.repeat(500) }), { status: 400 }));
    try { await complete('x', 1, 'coder'); throw new Error('expected failure'); }
    catch (error) { expect((error as Error).message.length).toBeLessThanOrEqual(250); expect((error as Error).message).not.toContain('\n'); }
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response('x', { status: 500, headers: { 'content-length': '9000' } }));
    await expect(complete('x', 1, 'coder')).rejects.toThrow('Ollama responded with HTTP 500.');
  });
});
