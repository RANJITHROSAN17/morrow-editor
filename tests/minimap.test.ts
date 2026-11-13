import { describe, expect, it } from 'vitest';
import { buildMinimapBars, caretFraction, MAX_MINIMAP_CHARS, minimapAvailable, MINIMAP_BARS, viewportFraction } from '../src/minimap';

describe('minimap', () => {
  it('produces a stable number of ordered bars', () => {
    const bars = buildMinimapBars('a'.repeat(1_000));
    expect(bars).toHaveLength(MINIMAP_BARS);
    expect(bars[0].y).toBe(0);
    expect(bars.at(-1)!.width).toBeGreaterThan(0);
    for (let index = 1; index < bars.length; index++) expect(bars[index].y).toBeGreaterThan(bars[index - 1].y);
  });

  it('reads blank space as gaps, not as text', () => {
    const bars = buildMinimapBars(`${'x'.repeat(140)}\n${'\n'.repeat(140)}`, 2);
    expect(bars[0].width).toBeGreaterThan(0.5);
    expect(bars[1].width).toBe(0);
  });

  it('handles an empty document and a tiny one', () => {
    expect(buildMinimapBars('')).toEqual([]);
    // Bars tile the document, so a two-character note fills at most two of the ten slots.
    expect(buildMinimapBars('hi', 10)).toHaveLength(2);
  });

  it('keeps every width inside 0–1', () => {
    const bars = buildMinimapBars('word '.repeat(500));
    expect(bars.every((bar) => bar.width >= 0 && bar.width <= 1)).toBe(true);
  });

  it('maps the caret to a fraction of the document', () => {
    expect(caretFraction(100, 50)).toBe(0.5);
    expect(caretFraction(0, 10)).toBe(0);
    expect(caretFraction(100, 500)).toBe(1);
    expect(caretFraction(100, -5)).toBe(0);
  });

  it('turns itself off above the size budget and when disabled', () => {
    expect(minimapAvailable(1_000, true)).toBe(true);
    expect(minimapAvailable(1_000, false)).toBe(false);
    expect(minimapAvailable(MAX_MINIMAP_CHARS + 1, true)).toBe(false);
  });

  it('never draws a viewport marker smaller than a sliver or larger than the map', () => {
    expect(viewportFraction(1_000, 40)).toBe(0.04);
    expect(viewportFraction(1_000_000, 40)).toBe(0.02);
    expect(viewportFraction(10, 40)).toBe(1);
    expect(viewportFraction(0, 40)).toBe(1);
  });
});
