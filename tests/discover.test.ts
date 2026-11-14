import { describe, expect, it } from 'vitest';
import { findDrift, renderSequence, REQUIRED_BODY_MARKERS, scoreItem, sequenceWork, summarizeHealth, type Roadmap, type RoadmapItem } from '../src/discover';

const fullBody = REQUIRED_BODY_MARKERS.map((marker) => `${marker}\ntext`).join('\n');

const item = (over: Partial<RoadmapItem> = {}): RoadmapItem => ({
  id: 'wrytrove-x',
  title: 'A task',
  status: 'ready',
  difficulty: 'easy',
  labels: ['good first issue'],
  files: ['src/editor.ts'],
  verify: 'npx vitest run tests/editor.test.ts',
  time_estimate: '~2 hours',
  body: fullBody,
  ...over,
});

const roadmap = (items: RoadmapItem[]): Roadmap => ({ meta: { open_easy_cap: 3 }, items });

const tree = (paths: string[]) => ({
  exists: (path: string) => paths.includes(path),
  readFile: () => null,
});

describe('issue quality scoring', () => {
  it('gives a fully specified, Windows-free task a high score', () => {
    const score = scoreItem(item());
    expect(score.score).toBeGreaterThanOrEqual(95);
    expect(score.problems).toEqual([]);
    expect(score.windowsFree).toBe(true);
  });

  it('names every problem that makes a task hard to start', () => {
    const score = scoreItem(item({ files: ['src-tauri/src/lib.rs'], verify: undefined, body: 'want this', time_estimate: undefined, labels: [] }));
    expect(score.problems).toEqual(expect.arrayContaining([
      'no verification command', 'requires Windows or Rust to verify', 'body is missing one of the four required sections',
      'no time estimate', 'no contributor-facing label',
    ]));
    expect(score.windowsFree).toBe(false);
    expect(score.score).toBeLessThan(40);
  });

  it('ranks easy tasks above hard ones when everything else is equal', () => {
    expect(scoreItem(item({ difficulty: 'easy' })).score).toBeGreaterThan(scoreItem(item({ difficulty: 'hard' })).score);
  });

  it('penalises a task that depends on unfinished work', () => {
    const plain = item({ difficulty: 'medium' });
    expect(scoreItem({ ...plain, depends_on: ['wrytrove-y'] }).score).toBeLessThan(scoreItem(plain).score);
  });
});

describe('drift detection', () => {
  it('reports a named path that does not exist', () => {
    const findings = findDrift(roadmap([item({ files: ['src/gone.ts'] })]), tree(['src/editor.ts']));
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'missing-file', id: 'wrytrove-x' }));
  });

  it('never files a Windows-only task as a first issue', () => {
    const findings = findDrift(roadmap([item({ files: ['src-tauri/src/lib.rs'] })]), tree(['src-tauri/src/lib.rs']));
    expect(findings.some((finding) => finding.kind === 'windows-only')).toBe(true);
  });

  it('flags a shipped item with no release tag, because the bot cannot close it', () => {
    const findings = findDrift(roadmap([item({ status: 'shipped' })]), tree(['src/editor.ts']));
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'shipped-without-release' }));
  });

  it('flags two open items competing for the same file', () => {
    const findings = findDrift(roadmap([
      item({ id: 'a', files: ['src/editor.ts'] }),
      item({ id: 'b', files: ['src/editor.ts'] }),
    ]), tree(['src/editor.ts']));
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'duplicate-scope' }));
  });

  it('does not flag a shipped item as duplicate scope', () => {
    const findings = findDrift(roadmap([
      item({ id: 'a', files: ['src/editor.ts'] }),
      item({ id: 'b', status: 'shipped', release: 'v1.0.0', files: ['src/editor.ts'] }),
    ]), tree(['src/editor.ts']));
    expect(findings.some((finding) => finding.kind === 'duplicate-scope')).toBe(false);
  });

  it('reports an unknown or unfinished dependency', () => {
    expect(findDrift(roadmap([item({ depends_on: ['nope'] })]), tree([])).some((finding) => finding.kind === 'dependency-unmet')).toBe(true);
    expect(findDrift(roadmap([
      item({ id: 'base', status: 'backlog' }),
      item({ id: 'next', depends_on: ['base'] }),
    ]), tree([])).some((finding) => finding.kind === 'dependency-unmet')).toBe(true);
  });

  it('finds no drift in a clean manifest', () => {
    expect(findDrift(roadmap([item()]), tree(['src/editor.ts']))).toEqual([]);
  });
});

describe('work sequencing', () => {
  const subject = roadmap([
    item({ id: 'notes-tags', theme: 'notes', difficulty: 'medium' }),
    item({ id: 'trust-autosave', theme: 'trust', difficulty: 'medium' }),
    item({ id: 'editor-bold', theme: 'daily-driver', difficulty: 'easy' }),
    item({ id: 'depends-on-editor', theme: 'daily-driver', depends_on: ['editor-bold'] }),
    item({ id: 'already-shipped', theme: 'trust', status: 'shipped', release: 'v1.0.0' }),
  ]);

  it('puts dependencies before dependants and finished items nowhere', () => {
    const order = sequenceWork(subject).map((step) => step.id);
    expect(order).not.toContain('already-shipped');
    expect(order.indexOf('editor-bold')).toBeLessThan(order.indexOf('depends-on-editor'));
  });

  it('works through trust and daily-driver themes before notes', () => {
    const order = sequenceWork(subject).map((step) => step.id);
    expect(order.indexOf('trust-autosave')).toBeLessThan(order.indexOf('notes-tags'));
  });

  it('numbers every step and renders a markdown table', () => {
    const steps = sequenceWork(subject);
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3, 4]);
    const table = renderSequence(subject);
    expect(table).toContain('| # | Theme | Task | Size | Verify |');
    expect(table).toContain('trust');
  });

  it('renders an empty state instead of a broken table', () => {
    expect(renderSequence(roadmap([]))).toContain('No pending roadmap items');
  });

  it('summarizes health for CI output', () => {
    const health = summarizeHealth(subject, []);
    expect(health).toMatch(/4\/5 shipped|1\/5 shipped/);
    expect(health).toContain('filing candidate');
  });
});
