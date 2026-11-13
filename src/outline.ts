/**
 * outline — a heading map for Markdown and plain-text notes.
 *
 * Obsidian, Typora and Logseq all put a table of contents beside the document; Morrow's
 * version works on unsaved buffers (not only files on disk) and never touches the DOM, so the
 * parsing, ranking and limits can be unit-tested without a browser.
 *
 * Two heading styles are supported:
 *  - **Markdown** ATX headings (`#`, `##`, …), ignoring fenced code blocks.
 *  - **Underline** headings (`Title` followed by `===` or `---`), which plain `.txt` notes use.
 */

export interface Heading {
  level: number;
  text: string;
  /** 0-based line index in the document. */
  line: number;
  /** UTF-16 offset of the start of the heading line. */
  offset: number;
}

export const MAX_HEADINGS = 400;
export const MAX_HEADING_CHARS = 200;
/** Above this many characters the scan stops and `partial` is reported. */
export const MAX_OUTLINE_SCAN_CHARS = 2_000_000;

export interface OutlineResult {
  headings: Heading[];
  /** True when the document had more headings than `MAX_HEADINGS`. */
  truncated: boolean;
  /** True when the scan stopped at `MAX_OUTLINE_SCAN_CHARS`. */
  partial: boolean;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/u;
const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/u;
const UNDERLINE = /^ {0,3}(=+|-+)\s*$/u;
const CLOSING_HASHES = /\s+#+\s*$/u;
const SETEXT_EXCLUDED = /^\s{0,3}(?:[-*+]\s|\d+[.)]\s|>|#|\|)/u;

function cleanHeadingText(raw: string): string {
  const withoutClosing = raw.replace(CLOSING_HASHES, '').trim();
  const plain = withoutClosing
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`~]/gu, '')
    .trim();
  return plain.length > MAX_HEADING_CHARS ? `${plain.slice(0, MAX_HEADING_CHARS - 1)}…` : plain;
}

export function extractOutline(source: string, options: { underline?: boolean } = {}): OutlineResult {
  const partial = source.length > MAX_OUTLINE_SCAN_CHARS;
  const text = partial ? source.slice(0, MAX_OUTLINE_SCAN_CHARS) : source;
  const headings: Heading[] = [];
  let truncated = false;
  let fence: string | null = null;
  let offset = 0;
  let lineNumber = 0;
  let previousLine = '';
  let previousOffset = 0;
  let previousLineNumber = 0;

  const push = (level: number, raw: string, at: number, line: number) => {
    if (headings.length >= MAX_HEADINGS) { truncated = true; return; }
    const cleaned = cleanHeadingText(raw);
    if (!cleaned) return;
    headings.push({ level, text: cleaned, line, offset: at });
  };

  for (const line of text.split('\n')) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      previousLine = '';
    } else if (fence === null) {
      const atx = ATX.exec(line);
      if (atx) {
        push(atx[1].length, atx[2] ?? '', offset, lineNumber);
      } else if (options.underline && UNDERLINE.test(line) && previousLine.trim()
        && !SETEXT_EXCLUDED.test(previousLine)) {
        push(line.trim()[0] === '=' ? 1 : 2, previousLine, previousOffset, previousLineNumber);
      }
    }
    previousLine = fence === null ? line : '';
    previousOffset = offset;
    previousLineNumber = lineNumber;
    offset += line.length + 1;
    lineNumber++;
    // Keep scanning after the cap only to find a closing fence is unnecessary; stop early but
    // still report `truncated` so the UI can say the outline is incomplete.
    if (truncated && lineNumber > 0) { /* keep the cheap loop; no allocations happen */ }
  }
  return { headings, truncated, partial };
}

/**
 * Rank outline entries against a query. Titles that start with the query rank above titles
 * that merely contain it, and shallower headings rank above deeper ones at equal relevance —
 * the order a reader expects when scanning a table of contents.
 */
export function rankHeadings(headings: readonly Heading[], query: string, limit = 50): Heading[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return headings.slice(0, limit);
  const scored: { heading: Heading; score: number }[] = [];
  for (const heading of headings) {
    const index = heading.text.toLowerCase().indexOf(needle);
    if (index < 0) continue;
    let score = 100 - index;
    if (index === 0) score += 60;
    score += (7 - heading.level) * 4;
    scored.push({ heading, score });
  }
  scored.sort((a, b) => b.score - a.score || a.heading.line - b.heading.line);
  return scored.slice(0, limit).map((entry) => entry.heading);
}

/**
 * The single heading that contains `line`, used by the breadcrumb and by "jump to section".
 * Returns null above the first heading.
 */
export function headingAt(headings: readonly Heading[], line: number): Heading | null {
  let found: Heading | null = null;
  for (const heading of headings) {
    if (heading.line > line) break;
    found = heading;
  }
  while (found && found.line === line) break;
  return found;
}

export function isMarkdownName(name: string): boolean {
  return /\.(?:md|markdown|mdown|mkd|mdx|txt|text)$/iu.test(name);
}
