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
    expect(countTextStats('')).toEqual({
      words: 0, characters: 0, charactersNoSpaces: 0, lines: 1,
      paragraphs: 0, readingMinutes: 0, complete: true,
    });
  });

  it.each([
    { shape: 'spaces and tabs', text: ' \t  ', lines: 1 },
    { shape: 'LF line breaks', text: '\n\n', lines: 3 },
    { shape: 'CRLF line breaks', text: '\r\n\r\n', lines: 3 },
    { shape: 'mixed whitespace', text: ' \t\r\n  ', lines: 2 },
  ])('handles whitespace-only text: $shape', ({ text, lines }) => {
    expect(countTextStats(text)).toMatchObject({
      words: 0, characters: text.length, charactersNoSpaces: 0,
      lines, readingMinutes: 0, complete: true,
    });
  });

  it.each(['hello', "don't", '42', 'வணக்கம்'])('handles the single word %j', (word) => {
    expect(countTextStats(word)).toEqual({
      words: 1, characters: word.length, charactersNoSpaces: word.length,
      lines: 1, paragraphs: 1, readingMinutes: 1, complete: true,
    });
  });

  it('keeps contractions and numbers as single words but ignores punctuation runs', () => {
    expect(countTextStats("don't -- 42 **").words).toBe(2);
    expect(countTextStats('don’t stop').words).toBe(2);
    expect(countTextStats("it's a 'quoted' word").words).toBe(4);
    expect(countTextStats('**bold** __x__').words).toBe(2);
  });

  it.each([
    { script: 'Han', text: '你好世界', words: 4, characters: 4 },
    { script: 'Hiragana', text: 'こんにちは', words: 5, characters: 5 },
    { script: 'Katakana', text: 'カタカナ', words: 4, characters: 4 },
    { script: 'Hangul', text: '안녕하세요', words: 5, characters: 5 },
    { script: 'CJK mixed with prose', text: '你好 hello 世界', words: 5, characters: 11 },
    { script: 'Extension B ideographs', text: '𠀀𠀁', words: 2, characters: 4 },
    { script: 'Extension G ideographs', text: '𰀀𰀁', words: 2, characters: 4 },
  ])('counts $script once per code point, not per surrogate', ({ text, words, characters }) => {
    expect(countTextStats(text)).toMatchObject({ words, characters, complete: true });
  });

  it('uses the ordinary word rule for space-separated Tamil', () => {
    expect(countTextStats('நன்றி வணக்கம்').words).toBe(2);
  });

  it('never splits a surrogate pair or counts emoji as words', () => {
    // An emoji must not merge adjacent words either. Character counts remain UTF-16 units.
    expect(countTextStats('🦋 butterfly').words).toBe(1);
    expect(countTextStats('a🦋b')).toMatchObject({ words: 2, characters: 4 });
    expect(countTextStats('🦋🦋')).toMatchObject({ words: 0, characters: 4 });
    expect(countTextStats('🦋').characters).toBe(2);
    expect(countTextStats('\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}')).toMatchObject({ words: 0, characters: 11 });
    // Astral CJK is a word; the neighboring astral emoji is not.
    expect(countTextStats('𠀀🦋𰀀')).toMatchObject({ words: 2, characters: 6 });
  });

  it.each([
    [1, 1], [199, 1], [200, 1], [201, 2],
    [399, 2], [400, 2], [401, 3], [1200, 6],
  ])('rounds %i words up to %i minutes at 200 words per minute', (words, minutes) => {
    const stats = countTextStats('word '.repeat(words));
    expect(stats.words).toBe(words);
    expect(stats.readingMinutes).toBe(minutes);
    expect(stats.complete).toBe(true);
  });

  it('keeps reading time finite and exact for a million-word note', () => {
    const text = 'word '.repeat(1_000_000);
    // Opt into a full scan so this exercises the arithmetic beyond the default safety cap.
    const stats = countTextStats(text, text.length);
    expect(stats.words).toBe(1_000_000);
    expect(stats.readingMinutes).toBe(5_000);
    expect(Number.isSafeInteger(stats.readingMinutes)).toBe(true);
    expect(stats.complete).toBe(true);
  });

  it('reports incomplete statistics without scanning an enormous buffer', () => {
    const huge = 'word '.repeat(MAX_STATS_CHARS / 5 + 1000);
    const stats = countTextStats(huge);
    expect(stats.complete).toBe(false);
    expect(stats.words).toBe(MAX_STATS_CHARS / 5);
    expect(stats.characters).toBe(huge.length);
    expect(stats.lines).toBe(1);
    // The bounded word count also bounds reading time; neither counter overflows.
    expect(stats.readingMinutes).toBe(4_000);
    expect(Number.isSafeInteger(stats.readingMinutes)).toBe(true);
  });

  it.each([
    { shape: 'empty', text: '', expected: '0 words · 0 characters' },
    { shape: 'whitespace-only', text: ' \t\r\n', expected: '0 words · 4 characters' },
    { shape: 'a single word', text: 'hello', expected: '1 word · 5 characters · 1 min read' },
    { shape: 'short prose', text: 'hello world', expected: '2 words · 11 characters · 1 min read' },
    {
      shape: 'long prose', text: 'word '.repeat(1200),
      // Respect the host locale's grouping separator while pinning the rest of the line.
      expected: `${(1200).toLocaleString()} words · ${(6000).toLocaleString()} characters · 6 min read`,
    },
  ])('describes $shape as one human-readable line', ({ text, expected }) => {
    const summary = describeStats(countTextStats(text));
    expect(summary).toBe(expected);
    expect(summary).not.toMatch(/undefined|NaN|[\r\n]/u);
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
