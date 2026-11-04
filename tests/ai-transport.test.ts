import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { complete, listModels, runAction, MAX_OLLAMA_RESPONSE_BYTES } from '../src/ai';

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

describe('reviewable AI actions over the Ollama transport', () => {
  it('posts one non-streaming action and cleans a wrapped answer', async () => {
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response(JSON.stringify({ response: '```text\nFixed sentence.\n```' })));
    await expect(runAction({ selection: 'wrote', action: 'grammar', model: 'coder' })).resolves.toBe('Fixed sentence.');
    const [url, init] = vi.mocked(nativeFetch).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/generate');
    expect(init).toMatchObject({ method: 'POST', maxRedirections: 0 });
    const body = JSON.parse(String(init?.body)) as { stream: boolean; prompt: string; model: string };
    expect(body.stream).toBe(false);
    expect(body.model).toBe('coder');
    expect(body.prompt).toContain('wrote');
  });
  it('rejects an oversized action response and limits error text', async () => {
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response('x', { headers: { 'content-length': String(MAX_OLLAMA_RESPONSE_BYTES + 1) } }));
    await expect(runAction({ selection: 'x', action: 'improve', model: 'coder' })).rejects.toThrow(/too large/);
    vi.mocked(nativeFetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad\n' + 'x'.repeat(400) }), { status: 400 }));
    try { await runAction({ selection: 'x', action: 'improve', model: 'coder' }); throw new Error('expected failure'); }
    catch (error) { expect((error as Error).message.length).toBeLessThanOrEqual(250); expect((error as Error).message).not.toContain('\n'); }
  });
});
