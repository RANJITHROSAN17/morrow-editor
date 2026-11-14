// Deterministic synthetic UTF-8 fixtures shared by every benchmark in this folder.
// The same seed and size produce byte-identical files on every machine, so products
// and engines are measured on identical inputs. Contains no personal or real data.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NEEDLE = 'WRYTROVE_NEEDLE';
export const REPLACEMENT = 'WRYTROVE_REPLACED_TEXT';
// Every NEEDLE_EVERY-th line contains the needle, so match counts scale with size.
const NEEDLE_EVERY = 1000;
const WORDS = ['note', 'draft', 'code', 'trove', 'function', 'value', 'café', 'naïve', '日本語', 'alpha', 'beta', 'return', 'index', 'block', 'λ', 'stream'];

export const SIZES = [
  { label: '1MiB', bytes: 1 << 20 },
  { label: '5MiB', bytes: 5 << 20 },
  { label: '20MiB', bytes: 20 << 20 },
];

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Returns a string whose UTF-8 encoding is at least `bytes` bytes (may overshoot by one line).
export function makeFixture(bytes, seed = 1) {
  const rand = lcg(seed);
  const parts = [];
  let size = 0;
  let line = 0;
  while (size < bytes) {
    line++;
    const words = [];
    const count = 6 + Math.floor(rand() * 10);
    for (let i = 0; i < count; i++) words.push(WORDS[Math.floor(rand() * WORDS.length)]);
    if (line % NEEDLE_EVERY === 0) words.splice(3, 0, NEEDLE);
    const text = `${line.toString().padStart(7, '0')}  ${words.join(' ')}\n`;
    parts.push(text);
    size += Buffer.byteLength(text, 'utf8');
  }
  return parts.join('');
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// CLI: node benchmarks/shared/fixture.mjs <outDir>
// Writes synthetic-<size>.txt for each size and prints a checksum manifest.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('usage: node benchmarks/shared/fixture.mjs <outDir>');
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  for (const { label, bytes } of SIZES) {
    const text = makeFixture(bytes);
    const file = join(outDir, `synthetic-${label}.txt`);
    writeFileSync(file, text, 'utf8');
    console.log(`${sha256(text)}  ${Buffer.byteLength(text, 'utf8')}  ${file}`);
  }
}
