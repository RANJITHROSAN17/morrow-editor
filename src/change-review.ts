import { diffLines, type Change } from 'diff';

export const MAX_REVIEW_CHARS = 100_000;
export interface ReviewTarget {
  docId: string;
  revision: number;
  name: string;
  from: number;
  to: number;
  original: string;
}

/** The replacement is literal. Markdown fences and prose are never silently stripped. */
export function normalizeReplacement(value: string, original?: string): string {
  const text = value.replace(/\r\n?/g, '\n');
  if (!text) throw new Error('Enter replacement text. To delete a selection, use the editor directly.');
  if (text.length > MAX_REVIEW_CHARS) throw new Error(`Replacement exceeds ${MAX_REVIEW_CHARS.toLocaleString()} characters.`);
  if (text.includes('\0')) throw new Error('NUL characters cannot be applied as text.');
  if (original !== undefined && text === original.replace(/\r\n?/g, '\n')) throw new Error('There is no change to apply. Edit the replacement or reject the preview.');
  return text;
}

export function makeReviewTarget(docId: string, revision: number, name: string, from: number, to: number, original: string): ReviewTarget {
  if (from < 0 || to <= from || original.length !== to - from) throw new Error('Select the text you want to replace in the editor first.');
  if (original.length > MAX_REVIEW_CHARS) throw new Error(`Select at most ${MAX_REVIEW_CHARS.toLocaleString()} characters for review.`);
  return { docId, revision, name, from, to, original };
}

/** A changed document is never patched, even if the selected substring happens to match. */
export function reviewTargetIsCurrent(target: ReviewTarget, docId: string, revision: number, selectedText: string): boolean {
  return target.docId === docId && target.revision === revision && selectedText === target.original;
}

/** Bound diff computation; callers may fall back to displaying both complete texts. */
export function reviewDiff(original: string, replacement: string): Change[] | null {
  if (original.length + replacement.length > 120_000) return null;
  return diffLines(original, replacement, { timeout: 120, maxEditLength: 2_000 }) ?? null;
}

/** Line counts are unavailable if the bounded diff could not be computed. */
export function summarizeReviewDiff(changes: Change[] | null): { addedLines: number | null; removedLines: number | null; unchangedLines: number | null } {
  if (!changes) return { addedLines: null, removedLines: null, unchangedLines: null };
  const summary = { addedLines: 0, removedLines: 0, unchangedLines: 0 };
  for (const change of changes) {
    if (change.added) summary.addedLines += change.count;
    else if (change.removed) summary.removedLines += change.count;
    else summary.unchangedLines += change.count;
  }
  return summary;
}
