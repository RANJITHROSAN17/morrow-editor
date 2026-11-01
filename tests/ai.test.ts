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
  it('keeps context limits without splitting surrogate pairs at either outer boundary', () => {
    const before = '😀' + 'a'.repeat(AI_CONTEXT_BEFORE - 1);
    const after = 'b'.repeat(AI_CONTEXT_AFTER - 1) + '🦋';
    const request = buildCompletionRequest(before + after, before.length, 'm');
    expect(request.prompt).toBe('a'.repeat(AI_CONTEXT_BEFORE - 1));
    expect(request.suffix).toBe('b'.repeat(AI_CONTEXT_AFTER - 1));
    expect(request.prompt).not.toMatch(/[\ud800-\udfff]/u);
    expect(request.suffix).not.toMatch(/[\ud800-\udfff]/u);
  });
  it('does not send either half of a character when the cursor splits it', () => {
    const request = buildCompletionRequest('ab😀cd', 3, 'm');
    expect(request.prompt).toBe('ab');
    expect(request.suffix).toBe('cd');
    const atEnd = buildCompletionRequest('😀', 1, 'm');
    expect(atEnd.prompt).toBe('');
    expect(atEnd.suffix).toBe('\n');
  });
  it('rejects control markers including indented artifacts but preserves code indentation', () => {
    for (const prefix of ['<fim_middle>', '<fim_prefix>', '</s>', '[INST]', '<|endoftext|>', '```python']) {
      expect(firstSuggestion(prefix)).toBe('');
      expect(firstSuggestion(`  ${prefix}`)).toBe('');
    }
    expect(firstSuggestion('    return value')).toBe('    return value');
    expect(firstSuggestion('  [INSTRUCTION] = 1')).toBe('  [INSTRUCTION] = 1');
  });

});
