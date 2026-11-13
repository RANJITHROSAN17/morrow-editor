/**
 * word-stats — bounded, allocation-light text metrics for the status bar.
 *
 * Every other editor shows a word count; almost none explain *how* they count. Morrow's
 * answers are written down here, unit-tested, and identical for a 2-word note and a 200 MB
 * log, because the counters stream over the string instead of splitting it.
 *
 * Definitions:
 *  - A **word** is a run of at least one letter, digit, or apostrophe-joined letter
 *    (so "don't" and "42" count, "--" and "**" do not).
 *  - **CJK** scripts are written without spaces, so each Han/Hiragana/Katakana/Hangul
 *    character counts as one word, matching the convention most editors use.
 *  - **Reading time** uses 200 words per minute, rounded up, minimum 1 minute for any
 *    non-empty text.
 */

export interface TextStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  lines: number;
  paragraphs: number;
  readingMinutes: number;
  /** False when the scan stopped early at the bounded limit. */
  complete: boolean;
}

/** Beyond this many UTF-16 units the full stat pass is skipped to keep typing responsive. */
export const MAX_STATS_CHARS = 4_000_000;
export const WORDS_PER_MINUTE = 200;

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
/** Combining marks continue a word but never start one (Tamil, Devanagari, Thai). */
const WORD_START = /[\p{L}\p{N}]/u;
/**
 * Characters that are counted individually because the script does not use spaces.
 * Astral-plane CJK ideographs are handled through code-point iteration below.
 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;

export function countTextStats(text: string, limit = MAX_STATS_CHARS): TextStats {
  const complete = text.length <= limit;
  const view = complete ? text : text.slice(0, limit);
  let words = 0;
  let characters = 0;
  let charactersNoSpaces = 0;
  let lines = 1;
  let paragraphs = 0;
  let inParagraph = false;
  let inWord = false;

  // Iterate code points so surrogate pairs are never split and astral CJK is seen whole.
  for (const char of view) {
    // `characters` counts UTF-16 code units, the same unit Word and most editors report, so the
    // number matches what a user's file-size expectations and CodeMirror offsets imply.
    characters += char.length;
    if (char === '\n') {
      lines++;
      if (inParagraph) { paragraphs++; inParagraph = false; }
      inWord = false;
      continue;
    }
    if (char === '\r') { inWord = false; continue; }
    if (char === ' ' || char === '\t') { inWord = false; inParagraph = true; continue; }
    charactersNoSpaces++;
    inParagraph = true;
    const code = char.codePointAt(0) ?? 0;
    // Astral CJK extensions B–F start at U+20000; emoji live below that and are not words.
    if (CJK.test(char) || (code >= 0x20000 && code <= 0x2ebef) || (code >= 0x30000 && code <= 0x323af)) {
      words++;
      inWord = false;
      continue;
    }
    if (WORD_CHAR.test(char)) {
      if (!inWord && WORD_START.test(char)) { words++; inWord = true; }
      continue;
    }
    // An apostrophe between letters continues the word: "don't" is one word, not two.
    if (inWord && (char === "'" || char === '\u2019') && WORD_START.test(view[characters] ?? '')) continue;
    inWord = false;
  }
  if (inParagraph) paragraphs++;
  if (!complete) {
    // Report the true character and line counts, which come from cheap built-ins.
    characters = text.length;
    lines = countLines(text);
  }
  return {
    words,
    characters,
    charactersNoSpaces,
    lines,
    paragraphs,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
    complete,
  };
}

function countLines(text: string): number {
  let lines = 1;
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) lines++;
  return lines;
}

/** One-line summary for `aria-label` / tooltips. Deliberately short. */
export function describeStats(stats: TextStats): string {
  const words = `${stats.words.toLocaleString()} ${stats.words === 1 ? 'word' : 'words'}`;
  if (stats.words === 0) return `${words} · ${stats.characters.toLocaleString()} characters`;
  const read = stats.readingMinutes === 1 ? '1 min read' : `${stats.readingMinutes} min read`;
  return `${words} · ${stats.characters.toLocaleString()} characters · ${read}`;
}

/** True when a document is large enough that full statistics would cost typing latency. */
export function isLargeDocument(length: number): boolean {
  return length > 1_000_000;
}

export interface WritingGoal {
  /** 0 means no goal is set. */
  target: number;
  /** ISO date (yyyy-mm-dd) the goal applies to. Reset daily. */
  date: string;
}

export const MAX_GOAL_WORDS = 100_000;

export function sanitizeGoal(value: unknown, today: string): WritingGoal {
  const raw = (value ?? {}) as Partial<WritingGoal>;
  const target = typeof raw.target === 'number' && Number.isFinite(raw.target)
    ? Math.max(0, Math.min(MAX_GOAL_WORDS, Math.trunc(raw.target)))
    : 0;
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(raw.date) ? raw.date : today;
  // A goal from a previous day still counts as "set"; progress is what resets.
  return { target, date };
}

export interface GoalProgress {
  target: number;
  words: number;
  percent: number;
  remaining: number;
  met: boolean;
}

/**
 * Progress is measured against the session's starting count, so a goal means "words I wrote
 * today" rather than "words in this file". Counting from zero is what makes the number
 * honest for someone appending to a long note.
 */
export function goalProgress(target: number, baseline: number, current: number): GoalProgress {
  if (target <= 0) return { target: 0, words: 0, percent: 0, remaining: 0, met: false };
  const words = Math.max(0, current - Math.max(0, baseline));
  const percent = Math.min(100, Math.round((words / target) * 100));
  return { target, words, percent, remaining: Math.max(0, target - words), met: words >= target };
}

/** Local calendar day key, used to decide whether the goal should reset. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
