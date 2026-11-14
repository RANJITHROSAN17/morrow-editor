// Windows product benchmark: launches each installed desktop app with the same synthetic files and
// records launch-to-input-idle time plus memory for the process tree. Run on Windows only.
//
//   1. Copy products.example.json to products.local.json and set `machine` and each product's `exe`.
//   2. Close every instance of every listed app.
//   3. npm run benchmark:products        (add -- --dry-run to print the plan without launching anything)
//
// Typing latency, search, and Markdown preview are NOT automated here. They need a UI driver and
// a person to confirm the result, so they are listed in docs/BENCHMARK-COMPARISON.md as manual.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, sha256, SIZES } from '../shared/fixture.mjs';
import { summarize } from '../shared/stats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const configArg = args.indexOf('--config');
const configPath = configArg >= 0 ? args[configArg + 1] : join(here, 'products.local.json');
const fixtureDir = join(here, '.fixtures');
const resultsPath = join(here, '..', 'results', 'products.json');

if (!existsSync(configPath)) {
  console.error(`No config at ${configPath}. Copy products.example.json to products.local.json and fill it in.`);
  process.exit(2);
}
if (platform() !== 'win32' && !dryRun) {
  console.error('This harness launches Windows desktop apps and must run on Windows. Use --dry-run to check the plan here.');
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const trials = Number(config.trials ?? 5);
const sizes = SIZES;
const probe = join(here, 'win-probe.ps1');

// Scenario "startup" = the product's args with the {file} placeholder removed.
// Scenario "open-<size>" = the same args with the fixture path in place of {file}.
function argsFor(product, filePath) {
  const base = product.args ?? [];
  if (filePath === null) return base.filter((a) => a !== '{file}');
  return base.map((a) => (a === '{file}' ? filePath : a));
}

// Creates the synthetic inputs once. They are generated, not committed, and identified by SHA-256.
function prepareFixtures() {
  mkdirSync(fixtureDir, { recursive: true });
  return sizes.map(({ label, bytes }) => {
    const text = makeFixture(bytes);
    const file = join(fixtureDir, `synthetic-${label}.txt`);
    writeFileSync(file, text, 'utf8');
    return { label, file, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) };
  });
}

function runOnce(product, filePath) {
  const launchArgs = argsFor(product, filePath);
  const started = Date.now();
  const out = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probe, '-Exe', product.exe, '-ArgumentsJson', JSON.stringify(launchArgs)],
    { encoding: 'utf8', timeout: 180_000 },
  );
  if (out.status !== 0) throw new Error(`${product.name}: probe failed: ${out.stderr || out.stdout}`);
  const line = out.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  return { ...JSON.parse(line), harnessMs: Date.now() - started };
}

const fixtures = prepareFixtures();
const scenarios = [{ id: 'startup', file: null }, ...fixtures.map((f) => ({ id: `open-${f.label}`, file: f.file }))];
const report = {
  generatedAt: new Date().toISOString(),
  machine: config.machine,
  environment: { platform: `${platform()} ${release()}`, arch: arch(), cpu: cpus()[0]?.model?.trim() ?? 'unknown', logicalCpus: cpus().length, memoryGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10 },
  method: {
    measuredRuns: trials,
    warmupRuns: 1,
    readyDefinition: 'Milliseconds from Start-Process until the app reports WaitForInputIdle (includes process start and window creation). Memory is the working set and private bytes of the whole process tree, sampled 5 s after ready.',
  },
  fixtures: fixtures.map(({ label, bytes, sha256: digest }) => ({ label, bytes, sha256: digest })),
  products: {},
};

for (const product of config.products) {
  if (!product.exe) {
    console.log(`skip ${product.name}: no exe in config`);
    continue;
  }
  if (dryRun) {
    for (const s of scenarios) console.log(`plan ${product.name} ${s.id}: ${product.exe} ${argsFor(product, s.file).join(' ')} x${trials + 1} (first dropped)`);
    continue;
  }
  report.products[product.id] = { name: product.name, scenarios: {} };
  for (const scenario of scenarios) {
    const runs = [];
    for (let i = 0; i < trials + 1; i++) {
      const r = runOnce(product, scenario.file);
      if (i > 0) runs.push(r);
    }
    const valid = runs.filter((r) => !r.exitedEarly && r.inputIdle);
    report.products[product.id].scenarios[scenario.id] = {
      validRuns: valid.length,
      totalRuns: runs.length,
      summary: valid.length
        ? {
            readyMs: summarize(valid.map((r) => r.readyMs)),
            workingSetMB: summarize(valid.map((r) => r.workingSetMB)),
            privateMB: summarize(valid.map((r) => r.privateMB)),
          }
        : null,
      runs,
    };
    console.log(`${product.name} ${scenario.id}: ${valid.length}/${runs.length} valid runs${valid.length ? `, ready ${report.products[product.id].scenarios[scenario.id].summary.readyMs.median} ms median` : ''}`);
  }
}

if (!dryRun) {
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${resultsPath}`);
}
