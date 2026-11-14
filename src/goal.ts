/**
 * goal — a daily writing target that survives a restart and never nags.
 *
 * Counting rules, stated so the number can be trusted:
 *  - Only *additions* count. Deleting text never reduces the day's total, and rewriting the same
 *    sentence twice does not count twice unless the word count actually rose.
 *  - The total is per document delta, summed across every tab, measured from the word count the
 *    first time the tracker saw that tab today.
 *  - It resets when the local calendar day changes, not on a 24-hour timer.
 *
 * The tracker is pure except for the injected day source, which is what makes it testable.
 */

import { dayKey, goalProgress, type GoalProgress } from './word-stats';

export interface GoalState {
  version: 1;
  date: string;
  words: number;
  target: number;
  /** Word count per document when it was first seen today. */
  baselines: Record<string, number>;
}

export const GOAL_KEY = 'wrytrove.goal.v1';
/** Read-only compatibility for goals saved before the Wrytrove rename. */
export const LEGACY_GOAL_KEY = 'morrow.goal.v1';
export const MAX_TRACKED_DOCS = 200;

export function emptyGoalState(today: string, target = 0): GoalState {
  return { version: 1, date: today, words: 0, target, baselines: {} };
}

export function sanitizeGoalState(value: unknown, today: string): GoalState {
  if (!value || typeof value !== 'object') return emptyGoalState(today);
  const raw = value as Partial<GoalState>;
  const target = typeof raw.target === 'number' && Number.isFinite(raw.target)
    ? Math.max(0, Math.min(100_000, Math.trunc(raw.target))) : 0;
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(raw.date) ? raw.date : today;
  if (date !== today) return emptyGoalState(today, target);
  const words = typeof raw.words === 'number' && Number.isFinite(raw.words) ? Math.max(0, Math.trunc(raw.words)) : 0;
  const baselines: Record<string, number> = {};
  if (raw.baselines && typeof raw.baselines === 'object') {
    for (const [id, count] of Object.entries(raw.baselines).slice(0, MAX_TRACKED_DOCS)) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0 && /^[A-Za-z0-9_-]{1,80}$/u.test(id)) {
        baselines[id] = Math.trunc(count);
      }
    }
  }
  return { version: 1, date, words, target, baselines };
}

/** Load the current goal, falling back to the pre-rename key without writing during read. */
export function loadGoalState(): unknown {
  try {
    const raw = localStorage.getItem(GOAL_KEY) ?? localStorage.getItem(LEGACY_GOAL_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch { return null; }
}

/** Persist under the current brand. A goal is optional, so storage failure must not block editing. */
export function saveGoalState(state: GoalState): boolean {
  try { localStorage.setItem(GOAL_KEY, JSON.stringify(state)); return true; }
  catch { return false; }
}

export class DailyGoalTracker {
  private state: GoalState;

  constructor(value: unknown, private readonly today: () => string = () => dayKey(new Date())) {
    this.state = sanitizeGoalState(value, this.today());
  }

  get target(): number { return this.state.target; }
  get words(): number { return this.state.words; }
  get date(): string { return this.state.date; }
  get enabled(): boolean { return this.state.target > 0; }

  toJSON(): GoalState { return { ...this.state, baselines: { ...this.state.baselines } }; }

  private rollOver(): void {
    const today = this.today();
    if (this.state.date === today) return;
    // A new day starts with the same target and no progress.
    this.state = emptyGoalState(today, this.state.target);
  }

  /**
   * Record the current word count of a document. The first report for a document sets its
   * baseline; later reports add only the increase.
   */
  record(documentId: string, words: number): void {
    this.rollOver();
    const current = Math.max(0, Math.trunc(words));
    const baseline = this.state.baselines[documentId];
    if (baseline === undefined) {
      if (Object.keys(this.state.baselines).length >= MAX_TRACKED_DOCS) return;
      this.state.baselines[documentId] = current;
      return;
    }
    if (current <= baseline) return;
    this.state.words += current - baseline;
    this.state.baselines[documentId] = current;
  }

  setTarget(target: number): void {
    this.rollOver();
    this.state.target = Math.max(0, Math.min(100_000, Math.trunc(target)));
  }

  /** Re-read the day, so a long-running session rolls over even without new input. */
  refresh(): void {
    this.rollOver();
  }

  /** Forget a closed document so reopening it later counts from its current length. */
  forget(documentId: string): void {
    delete this.state.baselines[documentId];
  }

  status(): GoalProgress {
    this.rollOver();
    return goalProgress(this.state.target, 0, this.state.words);
  }
}
