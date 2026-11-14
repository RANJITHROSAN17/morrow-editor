#!/usr/bin/env node
// Turns the Vitest JSON report from `npm run benchmark:json` into a Markdown comparison table.
// Usage: npm run benchmark:json && npm run benchmark:table
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';

const reportPath = process.argv[2] ?? 'benchmark-results.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const tasks = new Map();
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    for (const group of assertion.benchmarks ?? []) {
      for (const task of group.tasks ?? []) {
        tasks.set(task.name, {
          meanMs: task.latency.mean,
          rme: task.latency.rme,
          samples: task.latency.samplesCount,
        });
      }
    }
  }
}

// Each row compares a Wrytrove function with a reference doing the same job on the same input.
const rows = [
  ['Decode 1 MiB UTF-8', 'decode 1 MiB UTF-8', 'reference decode 1 MiB UTF-8 (TextDecoder, fatal)'],
  ['Decode 5 MiB UTF-8', 'decode 5 MiB UTF-8', 'reference decode 5 MiB UTF-8 (TextDecoder, fatal)'],
  ['Decode 20 MiB UTF-8', 'decode 20 MiB UTF-8', 'reference decode 20 MiB UTF-8 (TextDecoder, fatal)'],
  ['Encode 1 MiB UTF-8', 'encode 1 MiB UTF-8', 'reference encode 1 MiB UTF-8 (TextEncoder)'],
  ['Encode 5 MiB UTF-8', 'encode 5 MiB UTF-8', 'reference encode 5 MiB UTF-8 (TextEncoder)'],
  ['Quick Open, 5,000 files', 'rank 5,000 files for Quick Open', 'reference rank 5,000 files for Quick Open (substring filter)'],
  ['Review diff, 5,000 lines', 'compute bounded 5,000-line review diff', 'reference unbounded 5,000-line review diff (diffLines)'],
];

const fmt = (value, digits = 2) => value.toFixed(digits);
const missing = [];
const lines = [
  '| Workload | Wrytrove (mean) | Reference (mean) | Wrytrove ÷ reference | Wrytrove throughput |',
  '| --- | ---: | ---: | ---: | ---: |',
];

for (const [label, ours, reference] of rows) {
  const a = tasks.get(ours);
  const b = tasks.get(reference);
  if (!a || !b) {
    missing.push(label);
    continue;
  }
  const mib = Number(/(\d+) MiB/.exec(label)?.[1]);
  const throughput = mib ? `${fmt(mib / (a.meanMs / 1000), 0)} MiB/s` : '—';
  lines.push(
    `| ${label} | ${fmt(a.meanMs)} ms ± ${fmt(a.rme, 1)}% | ${fmt(b.meanMs)} ms ± ${fmt(b.rme, 1)}% | ${fmt(a.meanMs / b.meanMs)}× | ${throughput} |`,
  );
}

const env = [
  `- Platform: ${platform()} ${release()} (${arch()})`,
  `- CPU: ${cpus()[0]?.model ?? 'unknown'} × ${cpus().length} logical`,
  `- Node: ${process.version}`,
  `- Harness: Vitest bench (\`npm run benchmark\`), synthetic inputs, mean of sampled iterations`,
];

console.log(env.join('\n'));
console.log('');
console.log(lines.join('\n'));
if (missing.length) {
  console.error(`benchmark-table: missing results for: ${missing.join(', ')}`);
  process.exitCode = 1;
}
