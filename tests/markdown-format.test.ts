import { describe, expect, it } from 'vitest';
import { applySmartTypography, selectedLines, smartCharacter, toggleBold, toggleHeading, toggleItalic, toggleInlineCode, toggleNumberedList, toggleQuote, toggleStrikethrough, toggleTaskList, wordAt, wrapLink } from '../src/markdown-format';
import { applyLineOperation, deleteLines, duplicateLines, joinLines, moveLines, sortLines, trimTrailingWhitespace } from '../src/line-ops';

/** Apply an edit the way CodeMirror would, so assertions read like the resulting document. */
function apply(text: string, edit: { from: number; to: number; insert: string } | null): { text: string; start: number; end: number } {
  if (!edit) return { text, start: 0, end: 0 };
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return { text: next, start: edit.from, end: edit.from + edit.insert.length };
}

describe('inline Markdown toggles', () => {
  it('wraps a bare caret in the word it sits in', () => {
    expect(wordAt('hello world', { from: 7, to: 7 })).toEqual({ from: 6, to: 11 });
    expect(apply('hello world', toggleBold('hello world', { from: 2, to: 2 })).text).toBe('**hello** world');
  });

  it('removes an existing wrapper instead of nesting another one', () => {
    const result = toggleBold('**bold** text', { from: 2, to: 6 });
    expect(apply('**bold** text', result).text).toBe('bold text');
  });

  it('unwraps a selection that includes its own markers', () => {
    expect(apply('say **hi** now', toggleBold('say **hi** now', { from: 4, to: 10 })).text).toBe('say hi now');
  });

  it('inserts an empty pair and places the caret inside when nothing is selected', () => {
    const edit = toggleBold('', { from: 0, to: 0 })!;
    expect(edit.insert).toBe('****');
    expect(edit.selection).toEqual({ from: 2, to: 2 });
  });

  it('uses * when the wrapped text touches a word and _ otherwise', () => {
    expect(toggleItalic('a word', { from: 2, to: 6 })!.insert).toBe('_word_');
    // `pwordx` would otherwise become snake_case, which most parsers do not emphasise.
    expect(toggleItalic('pwordx', { from: 1, to: 5 })!.insert).toBe('*word*');
  });

  it('toggles code and strikethrough', () => {
    expect(apply('run it', toggleInlineCode('run it', { from: 4, to: 6 })).text).toBe('run `it`');
    expect(apply('gone', toggleStrikethrough('gone', { from: 0, to: 4 })).text).toBe('~~gone~~');
  });

  it('wraps a selection as a link and selects the URL placeholder', () => {
    const edit = wrapLink('see docs', { from: 4, to: 8 })!;
    expect(apply('see docs', edit).text).toBe('see [docs]()');
    expect(edit.selection).toEqual({ from: 11, to: 11 });
    expect(wrapLink('x', { from: 0, to: 0 })!.insert).toBe('[link text]()');
  });
});

describe('line-based Markdown toggles', () => {
  it('selects whole lines, and a selection ending at a line start excludes that line', () => {
    const text = 'one\ntwo\nthree';
    expect(selectedLines(text, { from: 5, to: 5 }).lines).toEqual(['two']);
    expect(selectedLines(text, { from: 0, to: 4 }).lines).toEqual(['one']);
  });

  it('prefixes every selected line with a quote marker and removes it again', () => {
    const text = 'a\nb';
    const quoted = apply(text, toggleQuote(text, { from: 0, to: 3 }));
    expect(quoted.text).toBe('> a\n> b');
    expect(apply(quoted.text, toggleQuote(quoted.text, { from: 0, to: 7 })).text).toBe('a\nb');
  });

  it('numbers a list sequentially and removes numbering on a second press', () => {
    const numbered = apply('a\nb\nc', toggleNumberedList('a\nb\nc', { from: 0, to: 5 }));
    expect(numbered.text).toBe('1. a\n2. b\n3. c');
    expect(apply(numbered.text, toggleNumberedList(numbered.text, { from: 0, to: 15 })).text).toBe('a\nb\nc');
  });

  it('adds task checkboxes and strips them on a second press', () => {
    const tasks = apply('todo\ndone', toggleTaskList('todo\ndone', { from: 0, to: 9 }));
    expect(tasks.text).toBe('- [ ] todo\n- [ ] done');
    expect(apply(tasks.text, toggleTaskList(tasks.text, { from: 0, to: 21 })).text).toBe('todo\ndone');
  });

  it('cycles heading level and treats a bullet line as unheadable text', () => {
    expect(apply('Title', toggleHeading('Title', { from: 0, to: 0 })).text).toBe('# Title');
    expect(apply('# Title', toggleHeading('# Title', { from: 0, to: 0 })).text).toBe('## Title');
    // Six is the deepest level, so the next press returns to plain text.
    expect(apply('###### Six', toggleHeading('###### Six', { from: 0, to: 0 })).text).toBe('Six');
    expect(apply('## Two', toggleHeading('## Two', { from: 0, to: 0 }, 0)).text).toBe('Two');
  });
});

describe('smart typography', () => {
  it('picks curly quotes from context', () => {
    expect(smartCharacter('', 0, '"')).toBe('\u201c');
    expect(smartCharacter('She said ', 10, '"')).toBe('\u201c');
    expect(smartCharacter('Hello', 5, '"')).toBe('\u201d');
    expect(smartCharacter('don', 3, "'")).toBe('\u2019');
    expect(smartCharacter('', 0, "'")).toBe('\u2018');
  });

  it('converts the second dash or dot of a pair only', () => {
    expect(smartCharacter('a', 1, '-')).toBeNull();
    expect(smartCharacter('a-', 2, '-')).toBe('\u2014');
    expect(smartCharacter('a.', 2, '.')).toBe('\u2026');
    expect(smartCharacter('a', 1, 'x')).toBeNull();
  });

  it('rewrites a whole string deterministically', () => {
    expect(applySmartTypography('"Hello" -- it\'s fine...')).toBe('\u201cHello\u201d \u2014 it\u2019s fine\u2026');
  });
});

describe('line operations', () => {
  it('duplicates the current line and keeps the caret on the copy', () => {
    const edit = duplicateLines('one\ntwo\nthree', { from: 5, to: 5 })!;
    const result = apply('one\ntwo\nthree', edit);
    expect(result.text).toBe('one\ntwo\ntwo\nthree');
    expect(edit.selection.from).toBe(9);
  });

  it('moves lines up and down, and refuses to move past the ends', () => {
    const up = apply('a\nb\nc', moveLines('a\nb\nc', { from: 2, to: 2 }, 'up'));
    expect(up.text).toBe('b\na\nc');
    const down = apply('a\nb\nc', moveLines('a\nb\nc', { from: 0, to: 0 }, 'down'));
    expect(down.text).toBe('b\na\nc');
    expect(moveLines('a\nb', { from: 0, to: 0 }, 'up')).toBeNull();
    expect(moveLines('a\nb', { from: 3, to: 3 }, 'down')).toBeNull();
  });

  it('deletes a whole line including its newline', () => {
    expect(apply('a\nb\nc', deleteLines('a\nb\nc', { from: 2, to: 2 })).text).toBe('a\nc');
    expect(apply('a\nb', deleteLines('a\nb', { from: 2, to: 2 })).text).toBe('a');
  });

  it('sorts selected lines with natural numeric ordering', () => {
    const text = 'item10\nitem2\nitem1';
    expect(apply(text, sortLines(text, { from: 0, to: text.length })).text).toBe('item1\nitem2\nitem10');
    expect(sortLines('a\nb', { from: 0, to: 3 }, 'asc')).toBeNull();
  });

  it('trims trailing whitespace only when there is something to trim', () => {
    expect(apply('a  \nb\t', trimTrailingWhitespace('a  \nb\t', { from: 0, to: 5 })).text).toBe('a\nb');
    expect(trimTrailingWhitespace('clean', { from: 0, to: 5 })).toBeNull();
  });

  it('joins lines into one space-separated sentence', () => {
    expect(apply('one\ntwo\nthree', joinLines('one\ntwo\nthree', { from: 0, to: 13 })).text).toBe('one two three');
    expect(joinLines('single', { from: 0, to: 6 })).toBeNull();
  });

  it('dispatches every operation through one entry point', () => {
    expect(applyLineOperation('a\nb', { from: 0, to: 0 }, 'duplicate')!.insert).toBe('a\na');
    expect(applyLineOperation('a\nb', { from: 0, to: 3 }, 'sort-desc')!.insert).toBe('b\na');
    expect(applyLineOperation('a', { from: 0, to: 0 }, 'join')).toBeNull();
  });
});
