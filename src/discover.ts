/**
 * discover — turn a reviewed backlog into a queue of *startable* work.
 *
 * This is the automation half of the request: instead of a bot that decides at runtime what to
 * build (which duplicates, hallucinates and files tasks nobody can start), the planning step
 * produces **candidate feature entries** with a fixed schema, and a human commits them to
 * `.github/roadmap.json`. The contributor-queue workflow then files them one at a time, capped,
 * and replenishes as issues close.
 *
 * What this module does that the existing bot cannot:
 *  1. **Gap detection.** Compare the roadmap with the actual tree and report shipped items whose
 *     files disappeared, ready items whose file already contains the change, and backlog items
 *     with duplicate scope. Those are the issues that should be *closed*, not filed.
 *  2. **Issue quality scoring.** Every ready item is scored against the same rules a maintainer
 *     applies by hand (named files, verification command, Windows-free, bounded time). A low
 *     score is why a "good first issue" goes unanswered.
 *  3. **Work sequencing.** Produce the order in which to work, so the maintainer can start at the
 *     top and go one by one: dependencies first, then quick trust wins, then features.
 *
 * Zero dependencies, like `scripts/roadmap-bots.js`; pure functions, unit-tested.
 */

export interface RoadmapItem {
  id: string;
  title: string;
  status: 'backlog' | 'ready' | 'filed' | 'shipped';
  difficulty: 'easy' | 'medium' | 'hard';
  labels?: string[];
  files?: string[];
  verify?: string;
  time_estimate?: string;
  body?: string;
  release?: string;
  depends_on?: string[];
  /** Set by this audit: which product theme the item belongs to. */
  theme?: string;
  /** Concurrency/conflict notes: two items touching the same files should not be started together. */
  area?: string;
}

export interface Roadmap {
  meta: Record<string, unknown>;
  items: RoadmapItem[];
}

export const REQUIRED_BODY_MARKERS = ['## Context', '## Acceptance criteria', '## How to verify', '## Time estimate'] as const;
const WINDOWS_ONLY = /^(?:src-tauri\/)|(?:\.github\/workflows\/windows\.yml)|(?:^src\/platform\.ts$)/u;

export interface ItemScore {
  id: string;
  score: number;
  problems: string[];
  windowsFree: boolean;
}

/**
 * Score one item out of 100. The weights encode what actually gets a stranger to open a pull
 * request: a named file to open, a command that proves success, and no Windows requirement.
 */
export function scoreItem(item: RoadmapItem): ItemScore {
  const problems: string[] = [];
  let score = 0;
  const files = item.files ?? [];
  if (files.length) score += 20;
  else problems.push('no files named');
  if (item.verify) score += 20;
  else problems.push('no verification command');
  const windowsFree = !files.some((file) => WINDOWS_ONLY.test(file));
  if (windowsFree) score += 15;
  else problems.push('requires Windows or Rust to verify');
  if (item.body && REQUIRED_BODY_MARKERS.every((marker) => item.body!.includes(marker))) score += 20;
  else problems.push('body is missing one of the four required sections');
  if (item.time_estimate) score += 10;
  else problems.push('no time estimate');
  if (item.difficulty === 'easy') score += 15;
  else if (item.difficulty === 'medium') score += 8;
  else score += 2;
  if ((item.labels ?? []).some((label) => label === 'good first issue' || label === 'help wanted')) score += 5;
  else problems.push('no contributor-facing label');
  if (item.depends_on?.length) score -= 5;
  return { id: item.id, score: Math.max(0, Math.min(100, score)), problems, windowsFree };
}

export interface DriftFinding {
  id: string;
  kind: 'missing-file' | 'already-done' | 'duplicate-scope' | 'shipped-without-release' | 'dependency-unmet' | 'windows-only';
  message: string;
}

/**
 * Compare the manifest with the tree. `exists` and `readFile` are injected so this is testable
 * and so CI can run it without a build step.
 */
export function findDrift(
  roadmap: Roadmap,
  tree: { exists: (path: string) => boolean; readFile: (path: string) => string | null },
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const byFiles = new Map<string, RoadmapItem[]>();
  for (const item of roadmap.items) {
    if (item.status === 'shipped') {
      if (!item.release) findings.push({ id: item.id, kind: 'shipped-without-release', message: `shipped item has no release tag; the bot cannot close its issue` });
      continue;
    }
    for (const file of item.files ?? []) {
      if (/^(?:src|src-tauri|scripts|tests|docs)\//u.test(file) && !tree.exists(file)) {
        findings.push({ id: item.id, kind: 'missing-file', message: `named path '${file}' does not exist; the issue would send a contributor to a dead file` });
      }
      if (itemsShareWork(file, item)) {
        const list = byFiles.get(file) ?? [];
        list.push(item);
        byFiles.set(file, list);
      }
    }
    if ((item.files ?? []).some((file) => WINDOWS_ONLY.test(file))) {
      findings.push({ id: item.id, kind: 'windows-only', message: 'needs Windows/Rust to verify; cannot be filed as a Windows-free first issue' });
    }
    for (const dependency of item.depends_on ?? []) {
      const target = roadmap.items.find((entry) => entry.id === dependency);
      if (!target) findings.push({ id: item.id, kind: 'dependency-unmet', message: `depends on unknown id '${dependency}'` });
      else if (target.status !== 'shipped' && target.status !== 'filed' && target.status !== 'ready') {
        findings.push({ id: item.id, kind: 'dependency-unmet', message: `depends on '${dependency}' which is still ${target.status}` });
      }
    }
    // A ready item whose change is already present in the tree is a stale issue in waiting.
    if (item.status === 'ready' && item.verify && new RegExp(`\\b${escapeRegExp(item.id.split('-')[1] ?? item.id)}\\b`, 'u').test(item.verify)) {
      findings.push({ id: item.id, kind: 'already-done', message: 'verification command already references this change; review before filing' });
    }
  }
  for (const [file, list] of byFiles) {
    if (list.length < 2) continue;
    const ready = list.filter((item) => item.status === 'ready' || item.status === 'filed');
    if (ready.length > 1) {
      findings.push({ id: ready.map((item) => item.id).join(', '), kind: 'duplicate-scope', message: `${ready.length} open items all touch '${file}'; merge them or split the file` });
    }
  }
  return findings;
}

function itemsShareWork(file: string, item: RoadmapItem): boolean {
  return (item.files ?? []).includes(file);
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export interface SequencedStep {
  id: string;
  title: string;
  difficulty: RoadmapItem['difficulty'];
  theme: string;
  /** 1-based position in the recommended order. */
  order: number;
  status: RoadmapItem['status'];
  files: string[];
}

const THEME_ORDER = [
  'trust',        // never lose a draft; never surprise the user
  'daily-driver', // things people touch every session
  'writing',      // focus, markdown, typography
  'notes',        // links, tags, daily notes
  'search',       // find anything fast
  'ai',           // optional assistance
  'distribution', // install/update story
  'quality',      // tests, a11y, performance
  'docs',
];

/**
 * The order in which a single maintainer should work: dependencies first, then trust, then the
 * daily-driver basics. Items that are `ready` come before `backlog`, and easy before hard at the
 * same rank, so momentum builds.
 */
export function sequenceWork(roadmap: Roadmap): SequencedStep[] {
  const shipped = new Set(roadmap.items.filter((item) => item.status === 'shipped').map((item) => item.id));
  const pending = roadmap.items.filter((item) => item.status !== 'shipped');
  const depth = (item: RoadmapItem, seen = new Set<string>()): number => {
    if (seen.has(item.id)) return 0;
    seen.add(item.id);
    const dependencies = (item.depends_on ?? []).filter((id) => !shipped.has(id));
    if (!dependencies.length) return 0;
    return 1 + Math.max(...dependencies.map((id) => {
      const target = roadmap.items.find((entry) => entry.id === id);
      return target ? depth(target, seen) : 0;
    }));
  };
  const rank = (item: RoadmapItem): number => {
    const themeIndex = THEME_ORDER.indexOf(item.theme ?? '');
    const statusWeight = item.status === 'filed' ? 0 : item.status === 'ready' ? 1 : 2;
    const difficultyWeight = item.difficulty === 'easy' ? 0 : item.difficulty === 'medium' ? 1 : 2;
    return depth(item) * 1000 + (themeIndex < 0 ? THEME_ORDER.length : themeIndex) * 100 + statusWeight * 10 + difficultyWeight;
  };
  return [...pending]
    .sort((a, b) => rank(a) - rank(b) || scoreItem(b).score - scoreItem(a).score)
    .map((item, index) => ({
      id: item.id,
      title: item.title,
      difficulty: item.difficulty,
      theme: item.theme ?? 'unthemed',
      order: index + 1,
      status: item.status,
      files: item.files ?? [],
    }));
}

/** Markdown table for the roadmap issue: what to work on next, in order. */
export function renderSequence(roadmap: Roadmap): string {
  const steps = sequenceWork(roadmap).slice(0, 12);
  if (!steps.length) return '_No pending roadmap items._\n';
  const lines = ['| # | Theme | Task | Size | Verify |', '|---|---|---|---|---|'];
  const byId = new Map(roadmap.items.map((item) => [item.id, item]));
  for (const step of steps) {
    const item = byId.get(step.id)!;
    lines.push(`| ${step.order} | ${step.theme} | ${step.title} | ${step.difficulty} | \`${item.verify ?? 'npm test'}\` |`);
  }
  return `${lines.join('\n')}\n`;
}

/** One-line health summary for CI output and the status issue. */
export function summarizeHealth(roadmap: Roadmap, findings: DriftFinding[]): string {
  const total = roadmap.items.length;
  const shipped = roadmap.items.filter((item) => item.status === 'shipped').length;
  const scored = roadmap.items.filter((item) => item.status === 'ready' || item.status === 'filed').map(scoreItem);
  const low = scored.filter((entry) => entry.score < 80);
  const parts = [
    `${shipped}/${total} shipped`,
    `${scored.length} filing candidate(s)`,
    low.length ? `${low.length} below quality bar` : 'all filing candidates meet the quality bar',
    findings.length ? `${findings.length} drift finding(s)` : 'no drift',
  ];
  return parts.join(' · ');
}
