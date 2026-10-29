import { describe, expect, it } from 'vitest';
import { AI_CONTEXT_AFTER, AI_CONTEXT_BEFORE, buildCompletionRequest, firstSuggestion } from '../src/ai';

describe('AI privacy boundaries', () => {
  it('sends bounded nearby text but no filename', () => {
    const text = 'x'.repeat(5000) + 'cursor' + 'y'.repeat(2000);
    const request = buildCompletionRequest(text, 5000, 'local-model');
    expect(request.prompt.length).toBe(AI_CONTEXT_BEFORE);
    expect(request.suffix.length).toBe(AI_CONTEXT_AFTER);
    expect(JSON.stringify(request)).not.toContain('filename');
    expect(request.stream).toBe(false);
  });
  it('provides a FIM suffix at end of file', () => {
    expect(buildCompletionRequest('abc', 3, 'm').suffix).toBe('\n');
  });
  it('keeps just one line and rejects markup or empty suggestions', () => {
    expect(firstSuggestion('world\nrest')).toBe('world');
    expect(firstSuggestion('```python\nprint(1)')).toBe('');
    expect(firstSuggestion('\nhello')).toBe('');
    expect(firstSuggestion('  ')).toBe('');
  });
});
