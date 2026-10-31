/** Read a JSON response with an enforced byte limit even when Content-Length is absent or wrong. */
export async function boundedJson(response: Response, maxBytes: number, tooLargeMessage: string): Promise<unknown> {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(tooLargeMessage);
  }
  if (!response.body) throw new Error('The response body is empty.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(tooLargeMessage);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    reader.releaseLock();
  }
}
