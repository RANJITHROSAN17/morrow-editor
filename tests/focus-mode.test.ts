import { describe, expect, it } from 'vitest';
import { defaultFocus, focusClassList, focusLabel, focusRange, isAnyFocusActive, paragraphAround, sanitizeFocus, sentenceAround, typewriterPadding } from '../src/focus-mode';

describe('focus mode state', () => {
  it('defaults to a free layout and sanitizes stored values', () => {
    expect(sanitizeFocus(null)).toEqual(defaultFocus);
    expect(sanitizeFocus({ focus: 'yes', scope: 'word', typewriter: 1, zen: true })).toEqual({ focus: false, scope: 'paragraph', typewriter: false, zen: true });
    expect(isAnyFocusActive(defaultFocus)).toBe(false);
    expect(focusLabel(defaultFocus)).toBe('Free layout');
  });

  it('maps settings to the classes CSS expects', () => {
    expect(focusClassList({ focus: true, scope: 'sentence', typewriter: true, zen: true }))
      .toEqual(['focus-mode', 'focus-sentence', 'typewriter-mode', 'zen-mode']);
    expect(focusClassList(defaultFocus)).toEqual([]);
    expect(focusLabel({ focus: true, scope: 'paragraph', typewriter: false, zen: true })).toBe('Focus + Zen');
  });

  it('reserves half a viewport of padding in typewriter mode only', () => {
    expect(typewriterPadding(800, 21, false)).toBe(0);
    expect(typewriterPadding(800, 21, true)).toBe(358);
    // Unmeasurable input must not produce NaN in a style attribute.
    expect(typewriterPadding(Number.NaN, 0, true)).toBe(0);
  });
});

describe('sentence and paragraph ranges', () => {
  const text = 'First sentence. Second one here! Third?';

  it('finds the sentence around the caret', () => {
    expect(sentenceAround(text, 0)).toEqual({ from: 0, to: 15 });
    expect(sentenceAround(text, 20)).toEqual({ from: 16, to: 32 });
    expect(sentenceAround(text, text.length - 3)).toEqual({ from: 33, to: 39 });
  });

  it('does not treat a decimal point or an abbreviation as a sentence end', () => {
    const value = 'Pi is 3.14 and e is 2.71. Done.';
    expect(sentenceAround(value, 8)).toEqual({ from: 0, to: 25 });
  });

  it('handles CJK sentence punctuation', () => {
    const cjk = '第一句。第二句！';
    expect(sentenceAround(cjk, 5)).toEqual({ from: 4, to: 8 });
  });

  it('tracks the paragraph, not the whole document', () => {
    const paragraphs = 'one\ntwo\n\nthree';
    expect(paragraphAround(paragraphs, 1)).toEqual({ from: 0, to: 3 });
    // Line 2 is empty; the caret at offset 5 is on the empty line between the two paragraphs.
    expect(paragraphAround(paragraphs, 5)).toEqual({ from: 4, to: 7 });
    expect(paragraphAround(paragraphs, 8)).toEqual({ from: 8, to: 8 });
  });

  it('returns an empty range on an empty line so the caller can skip the decoration', () => {
    expect(focusRange('a\n\nb', 2, 'paragraph')).toEqual({ from: 2, to: 2 });
    expect(focusRange('a\n\nb', 2, 'sentence')).toEqual({ from: 2, to: 2 });
  });

  it('clamps an out-of-range position instead of throwing', () => {
    expect(sentenceAround('abc', 99)).toEqual({ from: 0, to: 3 });
    expect(sentenceAround('abc', -5)).toEqual({ from: 0, to: 3 });
  });
});
