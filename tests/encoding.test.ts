import { describe, expect, it } from 'vitest';
import { decodeFile, encodeFile, inspectLineEndings, MAX_FILE_BYTES, type TextEncoding, type LineEnding } from '../src/encoding';

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
  it('accepts the read limit and rejects one byte more', () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES + 1).fill(65);
    expect(decodeFile(bytes.subarray(0, MAX_FILE_BYTES)).text).toHaveLength(MAX_FILE_BYTES);
    expect(() => decodeFile(bytes)).toThrow(/20 MiB/);
  });
  it('accepts the write limit and rejects one encoded byte more', () => {
    const text = 'a'.repeat(MAX_FILE_BYTES);
    expect(encodeFile(text, 'UTF-8', 'LF')).toHaveLength(MAX_FILE_BYTES);
    expect(() => encodeFile(text + 'a', 'UTF-8', 'LF')).toThrow(/20 MiB/);
    // The BOM counts towards the limit too.
    expect(() => encodeFile(text, 'UTF-8 BOM', 'LF')).toThrow(/20 MiB/);
  });
  it('rejects a UTF-32 LE BOM instead of treating it as UTF-16 LE', () => {
    expect(() => decodeFile(new Uint8Array([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]))).toThrow(/UTF-32 is not supported/);
  });

});
