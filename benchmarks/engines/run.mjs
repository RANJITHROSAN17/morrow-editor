// Runs the same synthetic workload on CodeMirror 6, Monaco and Ace in headless Chromium.
// Usage: npm run build && node run.mjs            (env: RUNS=5, SIZES=1MiB,5MiB,20MiB, CHROMIUM_PATH=...)
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeFixture, sha256, SIZES, NEEDLE, REPLACEMENT } from '../shared/fixture.mjs';
import { summarize } from '../shared/stats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const runs = Number(process.env.RUNS ?? 5);
const wanted = process.env.SIZES ? process.env.SIZES.split(',') : SIZES.map((s) => s.label);
const ENGINES = ['codemirror', 'monaco', 'ace'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
      try {
        const body = await readFile(join(dist, rel));
        res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const METRICS = { mountMs: 'mount', findMs: 'find_all', replaceMs: 'replace_all', editMs: 'edit_per_op' };

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = {};
const fixtures = [];

for (const size of SIZES.filter((s) => wanted.includes(s.label))) {
  const text = makeFixture(size.bytes);
  fixtures.push({ label: size.label, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) });
  results[size.label] = {};
  for (const engine of ENGINES) {
    // A crashed or stalled page is retried once; a second failure stops the run with a clear message.
    let raw = null;
    for (let attempt = 1; attempt <= 2 && !raw; attempt++) {
      const page = await browser.newPage();
      page.setDefaultTimeout(120_000);
      page.on('pageerror', (err) => console.error(`[${engine} ${size.label}] page error: ${err.message}`));
      try {
        await page.goto(url);
        await page.waitForFunction(() => window.benchReady === true);
        // First run is a warm-up (JIT, module init) and is dropped.
        raw = await page.evaluate(
          ([name, body, n, needle, replacement]) => window.runEngine(name, body, n, needle, replacement),
          [engine, text, runs + 1, NEEDLE, REPLACEMENT],
        );
      } catch (err) {
        console.error(`[${engine} ${size.label}] attempt ${attempt} failed: ${err.message.split('\n')[0]}`);
        if (attempt === 2) throw err;
      } finally {
        await page.close().catch(() => {});
      }
    }
    const measured = raw.slice(1);
    const allCorrect = measured.every((r) => r.correct);
    const metrics = {};
    for (const [key, label] of Object.entries(METRICS)) metrics[label] = summarize(measured.map((r) => r[key]));
    results[size.label][engine] = {
      needleMatches: measured[0]?.found ?? null,
      replacedCorrectly: allCorrect,
      metrics,
      runs: measured.map(({ mountMs, findMs, replaceMs, editMs }) => ({ mountMs, findMs, replaceMs, editMs })),
    };
    console.log(`${size.label} ${engine}: mount ${metrics.mount.median.toFixed(1)} ms, find ${metrics.find_all.median.toFixed(1)} ms, replace ${metrics.replace_all.median.toFixed(1)} ms, edit ${metrics.edit_per_op.median.toFixed(3)} ms/op (median, n=${runs})${allCorrect ? '' : '  ** replace check failed **'}`);
  }
}

const cpu = cpus();
const output = {
  generatedAt: new Date().toISOString(),
  environment: {
    platform: `${platform()} ${release()}`,
    arch: arch(),
    cpu: cpu[0]?.model?.trim() ?? 'unknown',
    logicalCpus: cpu.length,
    memoryGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    node: process.version,
    browser: `Chromium ${browser.version()}`,
  },
  method: {
    measuredRuns: runs,
    warmupRuns: 1,
    needle: NEEDLE,
    replacement: REPLACEMENT,
    correctness: 'a run is correct when matches found > 0, replace-all returns the same count, and no needle remains afterwards',
    editsPerRun: 200,
    notes: 'Same machine, same synthetic input, plain-text mode, line numbers on, no syntax highlighting, no minimap. Each engine is measured on a fresh editor per run. Edits are programmatic inserts in the middle of the document, flushed with one frame.',
  },
  fixtures,
  results,
};
await browser.close();
server.close();

const outDir = join(here, '..', 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'engines.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`wrote ${join(outDir, 'engines.json')}`);
