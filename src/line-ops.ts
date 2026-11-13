/**
 * line-ops — line operations that every serious text editor has.
 *
 * Notepad++ users reach for duplicate/move/sort/join without thinking; their absence is one of
 * the first things that makes a small editor feel like a toy. These are pure functions over the
 * document string and selection, so each one is a single undo step and a unit test.
 */

import type { Span, TextEdit } from './markdown-format';

export type LineOperation = 'move-up' | 'move-down' | 'duplicate' | 'delete' | 'sort' | 'trim-trailing' | 'join' | 'sort-desc';

export const LINE_OPERATIONS: { id: LineOperation; label: string; shortcut?: string }[] = [
  { id: 'duplicate', label: 'Duplicate line', shortcut: 'Ctrl+Shift+D' },
  { id: 'move-up', label: 'Move line up', shortcut: 'Alt+Up' },
  { id: 'move-down', label: 'Move line down', shortcut: 'Alt+Down' },
  { id: 'delete', label: 'Delete line', shortcut: 'Ctrl+Shift+K' },
  { id: 'sort', label: 'Sort selected lines A→Z' },
  { id: 'sort-desc', label: 'Sort selected lines Z→A' },
  { id: 'trim-trailing', label: 'Trim trailing whitespace' },
  { id: 'join', label: 'Join selected lines' },
];

interface Block {
  start: number;
  /** Exclusive end offset of the full lines, including the final newline when present. */
  end: number;
  lines: string[];
  /** True when the block is the last thing in the document and has no trailing newline. */
  lastLineWithoutBreak: boolean;
}

function blockAt(text: string, span: Span): Block {
  const start = text.lastIndexOf('\n', Math.max(0, span.from - 1)) + 1;
  // Selecting to the very start of the next line should not pull that line in.
  const selectionEnd = span.to > span.from && text[span.to - 1] === '\n' ? span.to - 1 : span.to;
  const breakIndex = text.indexOf('\n', selectionEnd);
  const end = breakIndex < 0 ? text.length : breakIndex;
  return {
    start,
    end,
    lines: text.slice(start, end).split('\n'),
    lastLineWithoutBreak: breakIndex < 0,
  };
}

function replace(block: Block, lines: string[], selection?: Span): TextEdit {
  const insert = lines.join('\n');
  return {
    from: block.start,
    to: block.end,
    insert,
    selection: selection ?? { from: block.start, to: block.start + insert.length },
  };
}

export function duplicateLines(text: string, span: Span): TextEdit | null {
  const block = blockAt(text, span);
  if (!block.lines.length) return null;
  const originalOffset = Math.max(0, Math.min(span.from - block.start, text.slice(block.start, block.end).length));
  const insert = [...block.lines, ...block.lines].join('\n');
  // Keep the caret in the duplicated copy, which is what people mean by "duplicate".
  const caret = block.start + text.slice(block.start, block.end).length + 1 + originalOffset;
  return { from: block.start, to: block.end, insert, selection: { from: caret, to: caret } };
}

/**
 * Move the selected block one line up or down. Moving up at the first line, or down at the last,
 * is a no-op (returns null) rather than an error.
 */
export function moveLines(text: string, span: Span, direction: 'up' | 'down'): TextEdit | null {
  const block = blockAt(text, span);
  if (direction === 'up') {
    if (block.start === 0) return null;
    const previousStart = text.lastIndexOf('\n', block.start - 2) + 1;
    const previousLine = text.slice(previousStart, block.start - 1);
    const moved = [...block.lines, previousLine];
    const from = previousStart;
    const insert = moved.join('\n');
    const selection = {
      from: span.from - (previousLine.length + 1),
      to: span.to - (previousLine.length + 1),
    };
    return { from, to: block.end, insert, selection };
  }
  if (block.lastLineWithoutBreak) return null;
  const nextBreak = text.indexOf('\n', block.end + 1);
  const nextEnd = nextBreak < 0 ? text.length : nextBreak;
  const nextLine = text.slice(block.end + 1, nextEnd);
  const moved = [nextLine, ...block.lines];
  const insert = moved.join('\n');
  const shift = nextLine.length + 1;
  return {
    from: block.start,
    to: nextEnd,
    insert,
    selection: { from: span.from + shift, to: span.to + shift },
  };
}

export function deleteLines(text: string, span: Span): TextEdit | null {
  const block = blockAt(text, span);
  if (!block.lines.length) return null;
  if (block.lastLineWithoutBreak && block.start > 0) {
    // Remove the preceding newline too so the document does not keep an empty last line.
    return { from: block.start - 1, to: block.end, insert: '', selection: { from: block.start - 1, to: block.start - 1 } };
  }
  const to = block.end < text.length ? block.end + 1 : block.end;
  return { from: block.start, to, insert: '', selection: { from: block.start, to: block.start } };
}

export function sortLines(text: string, span: Span, direction: 'asc' | 'desc' = 'asc'): TextEdit | null {
  const block = blockAt(text, span);
  if (block.lines.length < 2) return null;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorted = [...block.lines].sort(direction === 'asc' ? collator.compare : (a, b) => collator.compare(b, a));
  if (sorted.every((line, index) => line === block.lines[index])) return null;
  return replace(block, sorted);
}

export function trimTrailingWhitespace(text: string, span: Span): TextEdit | null {
  const block = blockAt(text, span);
  const trimmed = block.lines.map((line) => line.replace(/[ \t]+$/u, ''));
  if (trimmed.every((line, index) => line === block.lines[index])) return null;
  return replace(block, trimmed);
}

export function joinLines(text: string, span: Span): TextEdit | null {
  const block = blockAt(text, span);
  if (block.lines.length < 2) return null;
  const joined = block.lines.map((line) => line.trim()).filter(Boolean).join(' ');
  return { from: block.start, to: block.end, insert: joined, selection: { from: block.start, to: block.start + joined.length } };
}

export function applyLineOperation(text: string, span: Span, op: LineOperation): TextEdit | null {
  switch (op) {
    case 'duplicate': return duplicateLines(text, span);
    case 'move-up': return moveLines(text, span, 'up');
    case 'move-down': return moveLines(text, span, 'down');
    case 'delete': return deleteLines(text, span);
    case 'sort': return sortLines(text, span, 'asc');
    case 'sort-desc': return sortLines(text, span, 'desc');
    case 'trim-trailing': return trimTrailingWhitespace(text, span);
    case 'join': return joinLines(text, span);
    default: return null;
  }
}
