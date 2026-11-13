import { describe, expect, it } from 'vitest';
import { countTextStats, dayKey, describeStats, goalProgress, isLargeDocument, MAX_STATS_CHARS, sanitizeGoal } from '../src/word-stats';

/**
 * The status bar is the only place Morrow states numbers about your writing. These tests pin
 * the definitions so the numbers cannot drift silently between releases.
 */
describe('word and character statistics', () => {
  it('counts words, characters, lines and paragraphs', () => {
    const stats = countTextStats('Hello world.\n\nSecond paragraph here!');
    expect(stats.words).toBe(5);
    expect(stats.lines).toBe(3);
    expect(stats.paragraphs).toBe(2);
    expect(stats.characters).toBe(36);
    expect(stats.charactersNoSpaces).toBe(31);
    expect(stats.complete).toBe(true);
  });

  it('counts a lone empty document as zero words and one line', () => {
    expect(countTextStats('')).toMatchObject({ words: 0, lines: 1, paragraphs: 0, readingMinutes: 0 });
  });

  it('keeps contractions and numbers as single words but ignores punctuation runs', () => {
    expect(countTextStats("don't -- 42 **").words).toBe(2);
    expect(countTextStats("it's a 'quoted' word").words).toBe(4);
    expect(countTextStats('**bold** __x__').words).toBe(2);
  });

  it('treats CJK text without spaces as one word per character', () => {
    expect(countTextStats('你好世界').words).toBe(4);
    // Tamil is space-separated, so it uses the ordinary word rule rather than per-character.
    expect(countTextStats('நன்றி வணக்கம்').words).toBe(2);
  });

  it('never splits a surrogate pair', () => {
    // An emoji is not a word, and it must not merge with the next word either.
    expect(countTextStats('🦋 butterfly').words).toBe(1);
    expect(countTextStats('a🦋b').words).toBe(2);
    expect(countTextStats('🦋🦋').words).toBe(0);
    expect(countTextStats('🦋').characters).toBe(2);
  });

  it('rounds reading time up and never reports zero for real text', () => {
    expect(countTextStats('one word').readingMinutes).toBe(1);
    expect(countTextStats('word '.repeat(200)).readingMinutes).toBe(1);
    expect(countTextStats('word '.repeat(201)).readingMinutes).toBe(2);
  });

  it('reports incomplete statistics without scanning an enormous buffer', () => {
    const huge = 'word '.repeat(MAX_STATS_CHARS / 5 + 1000);
    const stats = countTextStats(huge);
    expect(stats.complete).toBe(false);
    expect(stats.words).toBe(MAX_STATS_CHARS / 5);
    expect(stats.characters).toBe(huge.length);
    expect(stats.lines).toBe(1);
  });

  it('describes itself in one line for a tooltip', () => {
    expect(describeStats(countTextStats(''))).toContain('0 words');
    expect(describeStats(countTextStats('hello world'))).toMatch(/2 words · 11 characters · 1 min read/);
  });

  it('flags the threshold where full stats become expensive', () => {
    expect(isLargeDocument(10_000)).toBe(false);
    expect(isLargeDocument(1_000_001)).toBe(true);
  });
});

describe('daily writing goal', () => {
  it('sanitizes an out-of-range goal instead of trusting storage', () => {
    expect(sanitizeGoal({ target: -5, date: 'not-a-date' }, '')).toEqual({ target: 0, date: '' });
    expect(sanitizeGoal({ target: 9e9, date: '2026-11-13' }, '')).toEqual({ target: 100_000, date: '2026-11-13' });
    expect(sanitizeGoal(null, '')).toEqual({ target: 0, date: '' });
  });

  it('measures words written since the session baseline, not words in the file', () => {
    expect(goalProgress(500, 1_000, 1_250)).toMatchObject({ words: 250, percent: 50, remaining: 250, met: false });
    expect(goalProgress(500, 1_000, 1_500)).toMatchObject({ percent: 100, remaining: 0, met: true });
    // Deleting text never reports negative progress.
    expect(goalProgress(500, 1_000, 900).words).toBe(0);
    expect(goalProgress(0, 0, 10)).toMatchObject({ percent: 0, met: false });
  });

  it('caps reported progress at 100 percent', () => {
    expect(goalProgress(100, 0, 999).percent).toBe(100);
  });

  it('produces a local day key that sorts and compares reliably', () => {
    expect(dayKey(new Date(2026, 10, 3))).toBe('2026-11-03');
    expect(dayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});
