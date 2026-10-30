import { describe, expect, it } from 'vitest';
import { MAX_REVIEW_CHARS, makeReviewTarget, normalizeReplacement, reviewDiff, reviewTargetIsCurrent } from '../src/change-review';

describe('reviewed change safety', () => {
  it('requires a real selection and captures the document, revision, range and original text', () => {
    expect(() => makeReviewTarget('a', 1, 'x.txt', 1, 1, '')).toThrow(/select/i);
    expect(() => makeReviewTarget('a', 1, 'x.txt', 1, 5, 'abc')).toThrow(/select/i);
    expect(() => makeReviewTarget('a', 1, 'x', 0, MAX_REVIEW_CHARS + 1, 'a'.repeat(MAX_REVIEW_CHARS + 1))).toThrow(/at most/i);
    expect(makeReviewTarget('a', 7, 'x.txt', 2, 5, 'abc')).toEqual({ docId: 'a', revision: 7, name: 'x.txt', from: 2, to: 5, original: 'abc' });
  });

  it('rejects stale, closed/replaced or modified targets, even when text still matches', () => {
    const target = makeReviewTarget('a', 5, 'x.txt', 0, 3, 'one');
    expect(reviewTargetIsCurrent(target, 'a', 5, 'one')).toBe(true);
    expect(reviewTargetIsCurrent(target, 'b', 5, 'one')).toBe(false);
    expect(reviewTargetIsCurrent(target, 'a', 6, 'one')).toBe(false);
    expect(reviewTargetIsCurrent(target, 'a', 5, 'two')).toBe(false);
  });

  it('normalizes line endings but never strips Markdown, prose or fences', () => {
    expect(normalizeReplacement('```js\r\nhello\r```')).toBe('```js\nhello\n```');
    for (const bad of ['', '\0', 'x'.repeat(MAX_REVIEW_CHARS + 1)]) expect(() => normalizeReplacement(bad)).toThrow();
  });

  it('produces a bounded line diff and declines an oversized comparison', () => {
    const parts = reviewDiff('before\nshared\n', 'after\nshared\n');
    expect(parts?.some((part) => part.removed && part.value.includes('before'))).toBe(true);
    expect(parts?.some((part) => part.added && part.value.includes('after'))).toBe(true);
    expect(reviewDiff('a'.repeat(70_000), 'b'.repeat(70_000))).toBeNull();
  });
});
