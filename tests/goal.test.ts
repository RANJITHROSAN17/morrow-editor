import { describe, expect, it } from 'vitest';
import { DailyGoalTracker, emptyGoalState, sanitizeGoalState } from '../src/goal';

const fixedDay = (day = '2026-11-13') => () => day;

describe('daily goal state', () => {
  it('starts empty and stores the day it belongs to', () => {
    expect(sanitizeGoalState(null, '2026-11-13')).toEqual(emptyGoalState('2026-11-13'));
    expect(sanitizeGoalState({ version: 1, date: 'not-a-date', words: -4, target: 5, baselines: {} }, '2026-11-13'))
      .toEqual({ version: 1, date: '2026-11-13', words: 0, target: 5, baselines: {} });
  });

  it('resets progress — but keeps the target — when the stored day is not today', () => {
    const stale = { version: 1, date: '2026-11-12', words: 900, target: 500, baselines: { a: 10 } };
    expect(sanitizeGoalState(stale, '2026-11-13')).toEqual({ version: 1, date: '2026-11-13', words: 0, target: 500, baselines: {} });
  });

  it('drops malformed baselines and keeps valid ones', () => {
    const state = sanitizeGoalState({ version: 1, date: '2026-11-13', words: 3, target: 10, baselines: { good: 5, 'bad id!': 2, neg: -1 } }, '2026-11-13');
    expect(state.baselines).toEqual({ good: 5 });
  });
});

describe('daily goal tracking', () => {
  it('counts words added after the first sighting of a document', () => {
    const tracker = new DailyGoalTracker(null, fixedDay());
    tracker.setTarget(100);
    tracker.record('doc-1', 40);
    expect(tracker.words).toBe(0);
    tracker.record('doc-1', 70);
    expect(tracker.words).toBe(30);
    tracker.record('doc-1', 90);
    expect(tracker.words).toBe(50);
    expect(tracker.status()).toMatchObject({ target: 100, words: 50, percent: 50, met: false });
  });

  it('never counts deletions as negative progress', () => {
    const tracker = new DailyGoalTracker(null, fixedDay());
    tracker.setTarget(10);
    tracker.record('doc', 100);
    tracker.record('doc', 130);
    tracker.record('doc', 80);
    expect(tracker.words).toBe(30);
    // Rewriting back up to the previous high-water mark does not double count.
    tracker.record('doc', 120);
    expect(tracker.words).toBe(30);
  });

  it('sums across documents', () => {
    const tracker = new DailyGoalTracker(null, fixedDay());
    tracker.record('a', 0); tracker.record('b', 0);
    tracker.record('a', 10); tracker.record('b', 15);
    expect(tracker.words).toBe(25);
  });

  it('starts a new document from its current length, so opening a long note adds nothing', () => {
    const tracker = new DailyGoalTracker(null, fixedDay());
    tracker.record('long', 5_000);
    expect(tracker.words).toBe(0);
    tracker.record('long', 5_010);
    expect(tracker.words).toBe(10);
  });

  it('resets when the day rolls over mid-session', () => {
    let day = '2026-11-13';
    const tracker = new DailyGoalTracker(null, () => day);
    tracker.setTarget(100);
    tracker.record('doc', 0); tracker.record('doc', 120);
    expect(tracker.words).toBe(120);
    day = '2026-11-14';
    tracker.refresh();
    expect(tracker.words).toBe(0);
    expect(tracker.target).toBe(100);
    tracker.record('doc', 120);
    expect(tracker.words).toBe(0);
  });

  it('forgets a closed document so reopening it starts from its current length', () => {
    const tracker = new DailyGoalTracker(null, fixedDay());
    tracker.record('doc', 10); tracker.record('doc', 20);
    expect(tracker.words).toBe(10);
    tracker.forget('doc');
    tracker.record('doc', 25);
    expect(tracker.words).toBe(10);
  });

  it('serializes to a plain, storage-safe object', () => {
    const tracker = new DailyGoalTracker(null, fixedDay());
    tracker.setTarget(50);
    tracker.record('a', 1);
    expect(JSON.parse(JSON.stringify(tracker))).toEqual({ version: 1, date: '2026-11-13', words: 0, target: 50, baselines: { a: 1 } });
  });

  it('reports disabled when the target is zero', () => {
    const tracker = new DailyGoalTracker(null, fixedDay());
    expect(tracker.enabled).toBe(false);
    expect(tracker.status()).toMatchObject({ percent: 0, met: false });
  });
});
