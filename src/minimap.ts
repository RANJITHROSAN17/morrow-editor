/**
 * minimap — a small document map beside the scrollbar.
 *
 * The point of a minimap is orientation, not detail: it shows where the dense and sparse parts
 * of a long note are and where the caret sits. Morrow draws density bars on a canvas instead of
 * a second rendered editor, which keeps it cheap and impossible to get out of sync with the
 * text. Above `MAX_MINIMAP_CHARS` it turns itself off and says so, rather than silently costing
 * typing latency.
 */

export const MAX_MINIMAP_CHARS = 400_000;
export const MINIMAP_BARS = 140;

export interface MinimapBar {
  /** 0–1 fraction of the bar's maximum width. */
  width: number;
  /** 0–1 vertical position, always increasing. */
  y: number;
}

/**
 * Build evenly spaced density bars for the document. Pure: the caller passes the text, and the
 * same text always yields the same bars, which is what makes this testable.
 */
export function buildMinimapBars(text: string, bars = MINIMAP_BARS): MinimapBar[] {
  const count = Math.max(1, Math.min(bars, Math.floor(bars)));
  if (!text.length) return [];
  const slice = Math.max(1, text.length / count);
  const out: MinimapBar[] = [];
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * slice);
    if (start >= text.length) break;
    // Bars tile the document exactly; the last one absorbs the rounding remainder.
    const end = Math.min(text.length, Math.max(start + 1, Math.floor((index + 1) * slice)));
    const chunk = text.slice(start, end);
    // Measure non-whitespace density so blank lines read as gaps, like a real minimap.
    let visible = 0;
    for (let position = 0; position < chunk.length; position++) {
      const code = chunk.charCodeAt(position);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) visible++;
    }
    out.push({ width: Math.min(1, visible / Math.max(1, chunk.length)), y: index / count });
  }
  return out;
}

/** Vertical fraction of the caret position, used to draw the viewport marker. */
export function caretFraction(length: number, position: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(1, position / length));
}

/** Whether the minimap should be drawn for a document of this size. */
export function minimapAvailable(length: number, enabled: boolean): boolean {
  return enabled && length <= MAX_MINIMAP_CHARS;
}

/** Fraction of the document currently visible, as a height for the viewport marker. */
export function viewportFraction(totalLines: number, visibleLines: number): number {
  if (totalLines <= 0) return 1;
  return Math.max(0.02, Math.min(1, visibleLines / totalLines));
}
