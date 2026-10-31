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
