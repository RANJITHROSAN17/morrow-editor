import { describe, expect, it, vi } from 'vitest';
import { boundedJson } from '../src/bounded-json';

describe('bounded JSON responses', () => {
  it('parses complete Unicode JSON within the byte limit', async () => {
    const response = new Response(JSON.stringify({ text: 'hello 📝' }));
    await expect(boundedJson(response, 128, 'too large')).resolves.toEqual({ text: 'hello 📝' });
  });
  it('rejects oversized advertised and streamed bodies, and cancels each', async () => {
    const advertisedCancel = vi.fn();
    const oversized = new Response(new ReadableStream({ cancel: advertisedCancel }), { headers: { 'content-length': '20' } });
    await expect(boundedJson(oversized, 10, 'too large')).rejects.toThrow('too large');
    expect(advertisedCancel).toHaveBeenCalled();
    const streamCancel = vi.fn();
    const streaming = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(11)); },
      cancel: streamCancel,
    }));
    await expect(boundedJson(streaming, 10, 'too large')).rejects.toThrow('too large');
    expect(streamCancel).toHaveBeenCalled();
  });
  it('rejects a missing or malformed response', async () => {
    await expect(boundedJson(new Response(null), 10, 'too large')).rejects.toThrow(/empty/);
    await expect(boundedJson(new Response('{oops'), 10, 'too large')).rejects.toThrow();
  });
});
