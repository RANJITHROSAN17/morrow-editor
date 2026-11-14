/**
 * markdown-format — Markdown shortcuts and typographic transforms.
 *
 * Every entry-level notepad has Ctrl+B and Ctrl+I; most Markdown editors (Typora, iA Writer,
 * Obsidian) also toggle headings, links, quotes, lists and code, and "smart" punctuation that
 * turns quotes and dashes into typographic characters. Wrytrove does the same **without** an
 * extra dependency: these are pure functions over `{from, to, text}` so they are unit-tested
 * exactly like the rest of the editor core.
 *
 * Contract for every `toggle*` function:
 *  - It returns `null` when the transform does not apply (for example a selection spanning
 *    three lines for bold), and the caller leaves the document untouched.
 *  - `from`/`to` are UTF-16 offsets into `text`; the replacement is literal text, so CodeMirror
 *    records one ordinary undo step.
 */

export interface Span {
  from: number;
  to: number;
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  /** Selection after the change: either a caret (`from === to`) or a range. */
  selection: Span;
}

const WORD = /[\p{L}\p{N}\p{M}]/u;

/** Grow a bare caret to the word under it, which is what people expect from Ctrl+B. */
export function wordAt(text: string, span: Span): Span {
  if (span.from !== span.to) return span;
  let from = span.from;
  let to = span.to;
  while (from > 0 && WORD.test(text[from - 1])) from--;
  while (to < text.length && WORD.test(text[to])) to++;
  return { from, to };
}

// Kept for compatibility with callers that already expanded the caret themselves.
export function expandToWord(text: string, span: Span): Span {
  return wordAt(text, span);
}

/** `**` + selection + `**`, or remove both wrappers when the selection already has them. */
function toggleWrap(text: string, span: Span, marker: string): TextEdit | null {
  const selected = text.slice(span.from, span.to);
  const length = marker.length;
  const outerStart = span.from - length;
  const outerEnd = span.to + length;
  const wrappedOutside = outerStart >= 0 && outerEnd <= text.length
    && text.slice(outerStart, span.from) === marker && text.slice(span.to, outerEnd) === marker;
  if (wrappedOutside) {
    const insert = text.slice(span.from, span.to);
    return { from: outerStart, to: outerEnd, insert, selection: { from: outerStart, to: outerStart + insert.length } };
  }
  const padded = selected.length >= length * 2 && selected.startsWith(marker) && selected.endsWith(marker);
  if (padded) {
    const insert = selected.slice(length, selected.length - length);
    return { from: span.from, to: span.to, insert, selection: { from: span.from, to: span.from + insert.length } };
  }
  if (!selected.length) {
    // Empty selection: insert the pair and place the caret between them.
    return { from: span.from, to: span.to, insert: `${marker}${marker}`, selection: { from: span.from + length, to: span.from + length } };
  }
  return {
    from: span.from,
    to: span.to,
    insert: `${marker}${selected}${marker}`,
    selection: { from: span.from + length, to: span.from + length + selected.length },
  };
}

export function toggleBold(text: string, span: Span): TextEdit | null {
  return toggleWrap(text, wordAt(text, span), '**');
}

export function toggleItalic(text: string, span: Span): TextEdit | null {
  const word = wordAt(text, span);
  // `_` inside a word is not emphasis in most parsers (snake_case), so use `*` when the wrapped
  // text would sit next to a word character.
  // `_` inside a word is not emphasis in most parsers, so fall back to `*`.
  // `_` inside a word is not emphasis in most parsers (snake_case), so use `*` whenever the
  // wrapped text would sit next to a word character.
  const marker = word.from > 0 && WORD.test(text[word.from - 1]) ? '*' : '_';
  const asStar = toggleWrap(text, word, '*');
  if (marker === '*') return asStar;
  const asUnderscore = toggleWrap(text, word, '_');
  return asUnderscore ?? asStar;
}

export function toggleInlineCode(text: string, span: Span): TextEdit | null {
  return toggleWrap(text, wordAt(text, span), '`');
}

export function toggleStrikethrough(text: string, span: Span): TextEdit | null {
  return toggleWrap(text, wordAt(text, span), '~~');
}

export function toggleHighlight(text: string, span: Span): TextEdit | null {
  return toggleWrap(text, wordAt(text, span), '==');
}

/** Line-based helpers share this shape: they operate on the whole selected lines. */
interface LineRange { start: number; end: number; lines: string[]; }

export function selectedLines(text: string, span: Span): LineRange {
  const startOfLine = text.lastIndexOf('\n', Math.max(0, span.from - 1)) + 1;
  let endOfSelection = span.to;
  // A selection that ends exactly at a line start does not include that next line.
  if (span.to > span.from && text[span.to - 1] === '\n') endOfSelection = span.to - 1;
  const nextBreak = text.indexOf('\n', endOfSelection);
  const end = nextBreak < 0 ? text.length : nextBreak;
  // Keep a trailing newline in the replaced range so block edits never fuse two lines.
  const inclusiveEnd = nextBreak < 0 ? end : nextBreak;
  return { start: startOfLine, end: inclusiveEnd, lines: text.slice(startOfLine, end).split('\n') };
}

function linePrefixEdit(text: string, span: Span, prefix: (index: number) => string | null, toggle: (line: string) => boolean): TextEdit | null {
  const range = selectedLines(text, span);
  if (!range.lines.length) return null;
  if (range.lines.every(toggle)) {
    const removed = range.lines.map((line) => line.replace(/^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/u, '$1'));
    const insert = removed.join('\n');
    return { from: range.start, to: range.end, insert, selection: { from: range.start, to: range.start + insert.length } };
  }
  const added = range.lines.map((line, index) => (prefix(index) ?? '') + line);
  const insert = added.join('\n');
  return { from: range.start, to: range.end, insert, selection: { from: range.start, to: range.start + insert.length } };
}

/** Cycle `#` → `##` → `###` → plain on the selected lines. */
export function toggleHeading(text: string, span: Span, level?: number): TextEdit | null {
  const range = selectedLines(text, span);
  if (!range.lines.length) return null;
  const currentLevels = range.lines.map((line) => /^\s{0,3}(#{1,6})\s/u.exec(line)?.[1].length ?? 0);
  const uniform = currentLevels.every((value) => value === currentLevels[0]);
  // Cycle # → ## → … → ###### → plain. A document only has six levels, so the last step clears.
  const next = level !== undefined ? level
    : uniform && currentLevels[0] >= 1 && currentLevels[0] < 6 ? currentLevels[0] + 1
    : uniform && currentLevels[0] === 6 ? 0
    : 1;
  const lines = range.lines.map((line) => {
    const bare = line.replace(/^\s{0,3}#{1,6}\s+/u, '');
    return next === 0 ? bare : `${'#'.repeat(next)} ${bare}`;
  });
  const insert = lines.join('\n');
  return { from: range.start, to: range.end, insert, selection: { from: range.start, to: range.start + insert.length } };
}

export function toggleQuote(text: string, span: Span): TextEdit | null {
  return linePrefixEdit(text, span, () => '> ', (line) => /^\s{0,3}>/u.test(line));
}

export function toggleBulletList(text: string, span: Span): TextEdit | null {
  return linePrefixEdit(text, span, () => '- ', (line) => /^\s*[-*+]\s+(?!\[[ xX]\]\s)/u.test(line));
}

export function toggleNumberedList(text: string, span: Span): TextEdit | null {
  return linePrefixEdit(text, span, (index) => `${index + 1}. `, (line) => /^\s*\d+[.)]\s/u.test(line));
}

export function toggleTaskList(text: string, span: Span): TextEdit | null {
  return linePrefixEdit(text, span, () => '- [ ] ', (line) => /^\s*[-*+]\s+\[[ xX]\]\s/u.test(line));
}

/** Turn the selection into a Markdown link; with no selection, insert `[text](url)`. */
export function wrapLink(text: string, span: Span, url = ''): TextEdit {
  const selected = text.slice(span.from, span.to) || 'link text';
  const insert = `[${selected}](${url})`;
  const urlStart = span.from + 1 + selected.length + 2;
  return {
    from: span.from,
    to: span.to,
    insert,
    selection: url ? { from: urlStart, to: urlStart + url.length } : { from: urlStart, to: urlStart },
  };
}

/** Insert a fenced code block around the selection, preserving an obvious language guess. */
export function wrapCodeBlock(text: string, span: Span, language = ''): TextEdit {
  const range = selectedLines(text, span);
  const body = text.slice(range.start, range.end);
  const fence = '```';
  const insert = `${fence}${language}\n${body}\n${fence}`;
  return { from: range.start, to: range.end, insert, selection: { from: range.start, to: range.start + insert.length } };
}

/* ---------------------------------------------------------------------------------------- *
 * Smart typography
 * ---------------------------------------------------------------------------------------- */

const OPENERS = new Set(['(', '[', '{', '<', '\u2018', '\u201c', '\u00ab', '-']);

/**
 * Convert straight quotes, ellipses and dashes. Applied only to newly typed characters, so
 * existing text is never rewritten behind the user's back.
 */
export function smartCharacter(text: string, at: number, typed: string): string | null {
  const previous = at > 0 ? text[at - 1] : '';
  switch (typed) {
    case '"': {
      const atStart = !previous || /\s/u.test(previous) || OPENERS.has(previous);
      return atStart ? '\u201c' : '\u201d';
    }
    case "'":
      // Apostrophes inside a word become a curly apostrophe: "don't" → "don’t".
      if (previous && WORD.test(previous)) return '\u2019';
      return at === 0 || /\s/u.test(previous) || OPENERS.has(previous) ? '\u2018' : '\u2019';
    case '.':
      // A second dot turns into an ellipsis; the first one is left alone.
      return previous === '.' ? '\u2026' : null;
    case '-':
      // The second dash of a `--` becomes an em dash.
      return previous === '-' ? '\u2014' : null;
    case ' ':
      return null;
    default:
      return null;
  }
}

/** Replace `--` / `...` / straight quotes in an existing selection (a command, not a surprise). */
export function applySmartTypography(input: string): string {
  let result = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"' || char === "'") {
      const replacement = smartCharacter(input, index, char);
      result += replacement ?? char;
    } else if (char === '.' && input[index + 1] === '.') {
      // "..." or "...." collapse to a single ellipsis.
      while (input[index + 1] === '.') index++;
      result += '\u2026';
    } else if (char === '-' && input[index + 1] === '-') {
      while (input[index + 1] === '-') index++;
      result += '\u2014';
    } else result += char;
  }
  return result;
}

/* Line operations live in `line-ops.ts`; re-exported here so callers have one import site. */
export { LINE_OPERATIONS, applyLineOperation, type LineOperation } from './line-ops';
