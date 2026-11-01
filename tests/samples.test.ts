import { describe, expect, it } from 'vitest';
import { PYTHON_SAMPLE, MARKDOWN_SAMPLE } from '../src/samples';
import { buildMarkdownPreview } from '../src/markdown-render';
import { findPotentialSecrets } from '../src/sensitive-text';

describe('first-launch samples', () => {
  it('provides distinct non-empty documents with consistent trailing newlines', () => {
    expect(PYTHON_SAMPLE).not.toBe(MARKDOWN_SAMPLE);
    for (const sample of [PYTHON_SAMPLE, MARKDOWN_SAMPLE]) {
      expect(sample.length).toBeGreaterThan(1);
      expect(sample.endsWith('\n')).toBe(true);
      expect(sample).not.toContain('\r');
    }
  });
  it('uses spaces for Python indentation', () => {
    expect(PYTHON_SAMPLE).not.toContain('\t');
  });
  it('starts with a top-level heading and builds a Markdown preview', () => {
    expect(MARKDOWN_SAMPLE).toMatch(/^# \S/);
    const result = buildMarkdownPreview(MARKDOWN_SAMPLE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nodes[0]).toEqual(expect.objectContaining({ type: 'element', tag: 'h1' }));
  });
  it('does not trigger the sensitive-text heuristic', () => {
    expect(findPotentialSecrets(PYTHON_SAMPLE, MARKDOWN_SAMPLE)).toEqual([]);
  });
});
