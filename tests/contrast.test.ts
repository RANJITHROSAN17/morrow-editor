import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const dark = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
const light = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

function variable(theme: string, name: string): string {
  const value = theme.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1];
  if (!value) throw new Error(`Missing color --${name}`);
  return value;
}
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string): number {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

describe('critical text color contrast', () => {
  for (const [name, theme] of [['dark', dark], ['light', light]] as const) {
    it(`${name} comments, line numbers, sidebar labels and syntax colors meet 4.5:1 against their base backgrounds`, () => {
      for (const [foreground, background] of [
        ['dim', 'editor'], ['subtle', 'editor'], ['dim', 'sidebar'], ['muted', 'sidebar'],
        ['syntax-purple', 'editor'], ['syntax-blue', 'editor'], ['syntax-green', 'editor'],
        ['syntax-orange', 'editor'], ['syntax-red', 'editor'],
        ['primary-fg', 'primary-bg'], ['primary-muted', 'primary-bg'], ['accent', 'accent-dark'],
        ['text', 'selected'], ['muted', 'selected'], ['status-text', 'status-bg'],
        ['text', 'surface'], ['muted', 'surface'], ['dim', 'app'],
      ]) {
        expect(contrast(variable(theme, foreground), variable(theme, background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('keeps a visible editor focus indicator and does not fade inline suggestions', () => {
    expect(css).toMatch(/\.editor\s+\.cm-editor\.cm-focused\s+\.cm-gutters\s*\{[^}]*border-left:/);
    const ghost = css.match(/\.cm-ghost\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(ghost).not.toMatch(/opacity\s*:/);
  });
});
