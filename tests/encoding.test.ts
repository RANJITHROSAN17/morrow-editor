import { describe, expect, it } from 'vitest';
import { decodeFile, encodeFile, inspectLineEndings, type TextEncoding, type LineEnding } from '../src/encoding';

describe('safe text encoding', () => {
  for (const encoding of ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE'] as TextEncoding[]) {
    for (const eol of ['LF', 'CRLF', 'CR'] as LineEnding[]) {
      it(`round-trips ${encoding} and ${eol}`, () => {
        const text = 'hello 🦋\nதமிழ்\n最後';
        const bytes = encodeFile(text, encoding, eol);
        expect(decodeFile(bytes)).toEqual({ text, encoding, lineEnding: eol, mixedLineEndings: false });
        expect(encodeFile(decodeFile(bytes).text, encoding, eol)).toEqual(bytes);
      });
    }
  }
  it('keeps a literal BOM character after a real BOM', () => {
    const bytes = encodeFile('\ufeffhello\nworld', 'UTF-8 BOM', 'LF');
    expect(decodeFile(bytes).text).toBe('\ufeffhello\nworld');
  });
  it('flags mixed endings and chooses the predominant one', () => {
    expect(inspectLineEndings('a\r\nb\r\nc\nd')).toEqual({ lineEnding: 'CRLF', mixed: true });
    expect(decodeFile(new TextEncoder().encode('a\r\nb\nc')).mixedLineEndings).toBe(true);
  });
  it('rejects invalid bytes, binary text and unpaired surrogates rather than corrupting them', () => {
    expect(() => decodeFile(new Uint8Array([0xff, 0x41]))).toThrow(/not valid/);
    expect(() => decodeFile(new Uint8Array([65, 0, 66]))).toThrow(/NUL/);
    expect(() => encodeFile('\ud800', 'UTF-8', 'LF')).toThrow(/surrogate/);
  });
});
