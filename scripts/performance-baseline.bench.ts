import { test } from 'vitest';
import { decodeFile, encodeFile } from '../src/encoding';
import { rankWorkspaceFiles } from '../src/workspace';
import { reviewDiff } from '../src/change-review';

const MIB = 1024 * 1024;

function asciiBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.fill(0x61);
  return bytes;
}

const decodeFixtures = [
  ['1 MiB', asciiBytes(1 * MIB)],
  ['5 MiB', asciiBytes(5 * MIB)],
  ['20 MiB', asciiBytes(20 * MIB)],
] as const;

const encodeFixtures = [
  ['1 MiB', 'a'.repeat(1 * MIB)],
  ['5 MiB', 'a'.repeat(5 * MIB)],
] as const;

const quickOpenFiles = Array.from({ length: 5_000 }, (_, index) => ({
  name: index % 10 === 0 ? `main-${index}.ts` : `file-${index}.md`,
  relative: index % 10 === 0 ? `src/main-${index}.ts` : `notes/file-${index}.md`,
}));

const reviewBefore = `${'line before\n'.repeat(2_500)}shared\n${'line after\n'.repeat(2_500)}`;
const reviewAfter = `${'line before\n'.repeat(2_500)}changed\n${'line after\n'.repeat(2_500)}`;

/**
 * Local-only baselines for the bounded pure paths. These are intentionally not
 * pass/fail thresholds yet: machine and WebView2 differences must be collected
 * before a regression budget is enforced in CI. Run with `npm run benchmark`.
 */
test('Wrytrove pure workload baselines', async ({ bench }) => {
  const runs: Promise<unknown>[] = [];
  const register = (registration: { run: () => Promise<unknown> }) => runs.push(registration.run());

  for (const [label, bytes] of decodeFixtures) {
    register(bench(`decode ${label} UTF-8`, { iterations: 3 }, () => {
      decodeFile(bytes);
    }));
  }

  for (const [label, text] of encodeFixtures) {
    register(bench(`encode ${label} UTF-8`, { iterations: 3 }, () => {
      encodeFile(text, 'UTF-8', 'LF');
    }));
  }

  register(bench('rank 5,000 files for Quick Open', { iterations: 20 }, () => {
    rankWorkspaceFiles(quickOpenFiles, 'main', 50);
  }));

  register(bench('compute bounded 5,000-line review diff', { iterations: 10 }, () => {
    reviewDiff(reviewBefore, reviewAfter);
  }));

  await Promise.all(runs);
});
