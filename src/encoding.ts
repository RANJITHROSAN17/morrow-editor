/** Lossless text decoding for the encodings Morrow can safely write back. */
export type TextEncoding = 'UTF-8' | 'UTF-8 BOM' | 'UTF-16 LE' | 'UTF-16 BE';
export type LineEnding = 'LF' | 'CRLF' | 'CR';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface DecodedFile {
  text: string; // normalized for the editor; lineEnding records how to write it
  encoding: TextEncoding;
  lineEnding: LineEnding;
  mixedLineEndings: boolean;
}

export function inspectLineEndings(input: string): { lineEnding: LineEnding; mixed: boolean } {
  const counts: Record<LineEnding, number> = { LF: 0, CRLF: 0, CR: 0 };
  let first: LineEnding | undefined;
  for (const match of input.matchAll(/\r\n|\r|\n/g)) {
    const value: LineEnding = match[0] === '\r\n' ? 'CRLF' : match[0] === '\r' ? 'CR' : 'LF';
    first ??= value;
    counts[value]++;
  }
  const types = (Object.keys(counts) as LineEnding[]).filter((key) => counts[key] > 0);
  if (!types.length) return { lineEnding: 'LF', mixed: false };
  const max = Math.max(...types.map((key) => counts[key]));
  return { lineEnding: first && counts[first] === max ? first : types.find((key) => counts[key] === max)!, mixed: types.length > 1 };
}

export function decodeFile(bytes: Uint8Array): DecodedFile {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('This file is larger than the 20 MiB safety limit.');
  let encoding: TextEncoding = 'UTF-8';
  let label = 'utf-8';
  let skip = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'UTF-8 BOM'; skip = 3;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    // UTF-32 LE starts with the UTF-16 LE marker but is not supported.
    if (bytes.length >= 4 && bytes[2] === 0 && bytes[3] === 0) throw new Error('UTF-32 is not supported. The file was not opened.');
    encoding = 'UTF-16 LE'; label = 'utf-16le'; skip = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'UTF-16 BE'; label = 'utf-16be'; skip = 2;
  } else if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) {
    throw new Error('UTF-32 is not supported. The file was not opened.');
  }
  let text: string;
  try {
    // ignoreBOM=true keeps a literal U+FEFF after the file's actual BOM.
    text = new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(skip));
  } catch {
    throw new Error('This is not valid UTF-8 or BOM-marked UTF-16. No changes were made.');
  }
  if (text.includes('\0')) throw new Error('This file contains NUL bytes and may be binary. It was not opened.');
  const endings = inspectLineEndings(text);
  return {
    text: text.replace(/\r\n|\r/g, '\n'),
    encoding,
    lineEnding: endings.lineEnding,
    mixedLineEndings: endings.mixed,
  };
}

function ensureWellFormed(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch >= 0xd800 && ch <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Text contains an unpaired Unicode surrogate and cannot be safely saved.');
    } else if (ch >= 0xdc00 && ch <= 0xdfff) {
      throw new Error('Text contains an unpaired Unicode surrogate and cannot be safely saved.');
    }
  }
}

export function encodeFile(text: string, encoding: TextEncoding, lineEnding: LineEnding): Uint8Array {
  ensureWellFormed(text);
  if (text.includes('\0')) throw new Error('Text contains a NUL character and cannot be safely saved.');
  const newline = lineEnding === 'CRLF' ? '\r\n' : lineEnding === 'CR' ? '\r' : '\n';
  const source = text.replace(/\r\n|\r|\n/g, newline);
  let result: Uint8Array;
  if (encoding === 'UTF-8' || encoding === 'UTF-8 BOM') {
    const body = new TextEncoder().encode(source);
    result = new Uint8Array(body.length + (encoding === 'UTF-8 BOM' ? 3 : 0));
    const offset = encoding === 'UTF-8 BOM' ? 3 : 0;
    if (offset) result.set([0xef, 0xbb, 0xbf]);
    result.set(body, offset);
  } else {
    result = new Uint8Array(2 + source.length * 2);
    const little = encoding === 'UTF-16 LE';
    result.set(little ? [0xff, 0xfe] : [0xfe, 0xff]);
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      result[2 + 2 * i] = little ? code & 255 : code >>> 8;
      result[3 + 2 * i] = little ? code >>> 8 : code & 255;
    }
  }
  if (result.length > MAX_FILE_BYTES) throw new Error('Saving is limited to files up to 20 MiB in this preview.');
  return result;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
