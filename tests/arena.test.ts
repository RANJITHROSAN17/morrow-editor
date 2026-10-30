import { describe, expect, it, vi } from 'vitest';
import { ARENA_API_ENDPOINT, MAX_ARENA_CONTEXT, buildArenaRequest, requestArena, type ArenaRequest } from '../src/arena';

const request: ArenaRequest = { key: 'test-secret', model: 'coding-router-preview', instruction: 'Make it clearer', selection: 'const a = 1;' };
type Transport = NonNullable<Parameters<typeof requestArena>[2]>;
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('optional Arena API transport', () => {
  it('sends only the selected text, instruction and fixed system prompt to the exact endpoint', async () => {
    let observed: { url: string; init: Parameters<Transport>[1] } | null = null;
    const transport: Transport = async (url, init) => { observed = { url, init }; return ok('replacement'); };
    await expect(requestArena(request, undefined, transport)).resolves.toBe('replacement');
    const call = observed as unknown as { url: string; init: Parameters<Transport>[1] };
    expect(call.url).toBe(ARENA_API_ENDPOINT);
    expect(call.init.method).toBe('POST');
    expect(call.init.maxRedirections).toBe(0);
    expect(call.init.connectTimeout).toBe(10_000);
    expect(call.init.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
    const body = JSON.parse(String(call.init.body)) as { model: string; messages: { role: string; content: string }[]; stream: boolean };
    expect(body.model).toBe('coding-router-preview');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toBe('Instruction:\nMake it clearer\n\nSelected text:\nconst a = 1;');
    expect(JSON.stringify(body)).not.toContain('test-secret');
  });

  it('requires a valid key, model, instruction and bounded selection before transport', async () => {
    const transport = vi.fn<Transport>(async () => ok('x'));
    const invalid: Partial<ArenaRequest>[] = [
      { key: '' }, { key: 'has spaces' }, { model: '../model?' }, { instruction: ' ' },
      { selection: '' }, { selection: 'x'.repeat(MAX_ARENA_CONTEXT + 1) },
    ];
    for (const item of invalid) await expect(requestArena({ ...request, ...item }, undefined, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps provider responses literal and reports authorization, quota and generic HTTP errors', async () => {
    expect(await requestArena(request, undefined, async () => ok('```js\ncode\n```'))).toBe('```js\ncode\n```');
    for (const [status, message] of [[401, /rejected/], [403, /rejected/], [429, /quota/], [500, /HTTP 500/]] as const) {
      await expect(requestArena(request, undefined, async () => new Response('untrusted details test-secret', { status }))).rejects.toThrow(message);
    }
    expect(JSON.stringify(buildArenaRequest(request))).not.toContain('test-secret');
  });

  it('bounds declared and streamed response bodies and rejects malformed or missing content', async () => {
    const declared: Transport = async () => new Response('x', { headers: { 'content-length': '1000001' } });
    await expect(requestArena(request, undefined, declared)).rejects.toThrow(/too large/);
    const streamed: Transport = async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1_000_001)); controller.close(); } }));
    await expect(requestArena(request, undefined, streamed)).rejects.toThrow(/too large/);
    await expect(requestArena(request, undefined, async () => new Response('{broken'))).rejects.toThrow(/unreadable/);
    await expect(requestArena(request, undefined, async () => new Response('{"choices":[]}'))).rejects.toThrow(/no text/);
  });

  it('honors cancellation and provides a generic network error without leaking credentials', async () => {
    const controller = new AbortController();
    const transport: Transport = async (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('cancelled')));
    });
    const pending = requestArena(request, controller.signal, transport);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    await expect(requestArena(request, undefined, async () => { throw new Error('failed with test-secret'); })).rejects.toThrow('Could not reach the Arena API');
  });

  it('does not send to the API from the browser preview without an injected test transport', async () => {
    await expect(requestArena(request)).rejects.toThrow(/desktop app/);
  });
});
