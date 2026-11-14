import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Pins the contributor-queue validator. The bot's whole safety argument is "a human reviews
 * .github/roadmap.json in a pull request" — that only holds if a half-specified entry fails
 * here, before it can become an issue a stranger cannot start.
 */

const SCRIPT = resolve('scripts/validate-roadmap.js');
const MANIFEST = resolve('.github/roadmap.json');

const complete = (over: Record<string, unknown> = {}) => ({
  id: 'x-1',
  title: 't',
  theme: 't-1',
  status: 'ready',
  difficulty: 'easy',
  labels: ['good first issue'],
  files: ['README.md'],
  verify: 'npm test',
  body: [
    '## Context',
    'c',
    '## Acceptance criteria',
    '- [ ] a',
    '## How to verify',
    '```bash',
    'npm test',
    '```',
    '## Time estimate',
    '~1h',
  ].join('\n'),
  ...over,
});

function run(path: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function fixture(doc: unknown): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-'));
  const path = join(dir, 'roadmap.json');
  writeFileSync(path, JSON.stringify(doc));
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('contributor queue manifest', () => {
  it('accepts the committed manifest', () => {
    const { code, out } = run(MANIFEST);
    expect(code, out).toBe(0);
  });

  it('refuses a filing candidate with no acceptance criteria', () => {
    const { path, cleanup } = fixture({
      meta: { open_easy_cap: 3 },
      items: [complete({ body: '## Context\nonly context' })],
    });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/acceptance criteria/i);
    } finally {
      cleanup();
    }
  });

  it('refuses a filing candidate with no verification command', () => {
    const { path, cleanup } = fixture({
      meta: { open_easy_cap: 3 },
      items: [complete({ verify: undefined })],
    });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/verify/i);
    } finally {
      cleanup();
    }
  });

  it('refuses more easy candidates than the cap allows', () => {
    const items = Array.from({ length: 4 }, (_, i) => complete({ id: `e-${i}` }));
    const { path, cleanup } = fixture({ meta: { open_easy_cap: 3 }, items });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/cap 3/);
    } finally {
      cleanup();
    }
  });

  it('refuses a filing candidate with no theme, because the queue serialises work by theme', () => {
    const { path, cleanup } = fixture({
      meta: { open_easy_cap: 3 },
      items: [complete({ theme: undefined })],
    });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/must name a 'theme'/);
    } finally {
      cleanup();
    }
  });

  it('refuses two filing candidates in the same theme, which would stall one indefinitely', () => {
    const items = [complete({ id: 'a-1' }), complete({ id: 'a-2' })];
    const { path, cleanup } = fixture({ meta: { open_easy_cap: 3, open_curated_cap: 4 }, items });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/theme 't-1' has 2 filing candidates/);
    } finally {
      cleanup();
    }
  });

  it('enforces the curated cap separately from the easy cap', () => {
    // Three mediums are fine for newcomers to ignore but still flood the tracker if unfiled.
    const items = ['m-1', 'm-2', 'm-3'].map((id, i) => complete({ id, theme: `t-${i}`, difficulty: 'medium' }));
    const { path, cleanup } = fixture({ meta: { open_easy_cap: 3, open_curated_cap: 2 }, items });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/too many filing candidates: 3 > cap 2/);
    } finally {
      cleanup();
    }
  });

  it('refuses a release that is not a version tag, because the close comment quotes it', () => {
    const { path, cleanup } = fixture({
      meta: { open_easy_cap: 3 },
      items: [complete({ status: 'shipped', release: 'soon' })],
    });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/not a version tag/);
    } finally {
      cleanup();
    }
  });

  it('refuses a shipped entry that does not name its release', () => {
    // The workflow only closes an issue it opened when the manifest names the tag, so a
    // shipped entry without one is a silent stall rather than a cosmetic omission.
    const { path, cleanup } = fixture({
      meta: { open_easy_cap: 3 },
      items: [complete({ status: 'shipped' })],
    });
    try {
      const { code, out } = run(path);
      expect(code).toBe(1);
      expect(out).toMatch(/needs a 'release'/);
    } finally {
      cleanup();
    }
  });

  it('accepts a shipped entry that names its release', () => {
    const { path, cleanup } = fixture({
      meta: { open_easy_cap: 3 },
      items: [complete({ status: 'shipped', release: 'v0.2.0' })],
    });
    try {
      const { code, out } = run(path);
      expect(code, out).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('exempts backlog entries from the completeness gate', () => {
    const { path, cleanup } = fixture({
      meta: { open_easy_cap: 3 },
      items: [complete({ status: 'backlog', body: 'rough idea', files: undefined, verify: undefined })],
    });
    try {
      const { code, out } = run(path);
      expect(code, out).toBe(0);
    } finally {
      cleanup();
    }
  });
});


describe('roadmap automation helpers', () => {
  it('detects zero source/version drift on the committed repository', async () => {
    // @ts-expect-error plain ESM helper script
    const bots = await import('../scripts/roadmap-bots.js');
    const rm = bots.loadRoadmap();
    expect(bots.detectDrift(rm)).toEqual([]);
    const status = bots.renderStatusMarkdown(rm, [
      { number: 15, state: 'open', body: 'task\n<!-- roadmap:wrytrove-003-encoding-edge-cases -->' },
    ]);
    expect(status.startsWith(bots.STATUS_MARKER)).toBe(true);
    expect(status).toContain('#15');
  });

  it('normalizes pre-rename roadmap markers without touching unrelated namespaces', async () => {
    // @ts-expect-error plain ESM helper script
    const bots = await import('../scripts/roadmap-bots.js');
    expect(bots.extractMarkerId('<!-- roadmap:morrow-003-encoding-edge-cases -->')).toBe('wrytrove-003-encoding-edge-cases');
    expect(bots.extractMarkerId('<!-- roadmap:wrytrove-003-encoding-edge-cases -->')).toBe('wrytrove-003-encoding-edge-cases');
    expect(bots.extractMarkerId('<!-- roadmap:other-003 -->')).toBe('other-003');
    const status = bots.renderStatusMarkdown(bots.loadRoadmap(), [
      { number: 14, state: 'closed', body: '<!-- roadmap:morrow-003-encoding-edge-cases -->' },
    ]);
    expect(status).toContain('`wrytrove-003-encoding-edge-cases` issue is closed');
    expect(status).not.toContain('| `wrytrove-003-encoding-edge-cases` |');
  });

  it('classifies Wrytrove issues and PR paths by editor/AI/Windows area', async () => {
    // @ts-expect-error plain ESM helper script
    const bots = await import('../scripts/roadmap-bots.js');
    const labels = bots.classifyIssue('Ollama FIM completion hangs on Windows', 'WebView2 error');
    expect(labels).toContain('area/ai');
    expect(labels).toContain('area/windows');
    expect(labels).toContain('type/bug');

    const ctx = bots.renderPrContext(bots.loadRoadmap(), ['src/ai.ts'], 'Fixes surrogate boundary');
    expect(ctx).toContain('wrytrove-007-ai-fim-context-and-sanitization');
  });

  it('checks --state all and triggers on issue close so solved tasks replenish without duplicates', async () => {
    const { readFileSync } = await import('node:fs');
    const yml = readFileSync(resolve('.github/workflows/contributor-queue.yml'), 'utf8');
    expect(yml).toMatch(/gh issue list --state all/);
    expect(yml).toMatch(/issues:\s*\n\s*types:\s*\[closed\]/);
    expect(yml).toContain('LEGACY_MARKER');
    expect(yml).toContain('sub("^wrytrove-"; "morrow-")');
  });
});
