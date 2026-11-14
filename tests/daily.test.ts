import { describe, expect, it } from 'vitest';
import { dailyNotePath, expandDailyTemplate, isSafeRelativePath, isoDate } from '../src/daily';

const date = new Date(2026, 10, 13, 9, 5);

describe('daily note paths', () => {
  it('builds dated paths inside a relative workspace folder', () => {
    expect(dailyNotePath('yyyy-mm-dd', date)).toBe('2026-11-13');
    expect(dailyNotePath('yyyy-mm-dd', date, 'Daily')).toBe('Daily/2026-11-13');
    expect(dailyNotePath('yyyy/MM/dd', date, 'journal')).toBe('journal/2026/11/13');
    expect(dailyNotePath('dd-MM-yyyy', date)).toBe('13-11-2026');
    expect(dailyNotePath('yyyy-mm', date)).toBe('2026-11');
    // A Windows-relative spelling is normalized without changing its containment.
    expect(dailyNotePath('yyyy-mm-dd', date, 'notes\\journal')).toBe('notes/journal/2026-11-13');
    expect(dailyNotePath('yyyy-mm-dd', date, 'Daily/')).toBe('Daily/2026-11-13');
  });

  it('rejects traversal and absolute paths before normalization', () => {
    for (const path of ['..', '.', '../escape', 'notes/../escape', '/tmp', '\\tmp', '\\\\server\\share', 'C:/notes', 'C:\\notes']) {
      expect(isSafeRelativePath(path), path).toBe(false);
      expect(() => dailyNotePath('yyyy-mm-dd', date, path), path).toThrow();
    }
  });

  it('rejects Windows device names, including names with extensions', () => {
    for (const path of ['CON', 'CON.txt', 'prn.md', 'AUX.log', 'NUL', 'COM1', 'COM1.md', 'LPT9.txt', 'CLOCK$.md', 'CONIN$.txt', 'CONOUT$.bin']) {
      expect(isSafeRelativePath(path), path).toBe(false);
      expect(() => dailyNotePath('yyyy-mm-dd', date, path), path).toThrow();
    }
    expect(isSafeRelativePath('Daily/2026')).toBe(true);
    expect(isSafeRelativePath('notes/2026-11-13.md')).toBe(true);
    expect(isSafeRelativePath('notes\\2026')).toBe(true);
  });
});

describe('daily templates', () => {
  it('expands only note content and never changes the relative note path', () => {
    const expanded = expandDailyTemplate('{{title}} {{date}} {{time}} {{weekday}}', date, '../../outside');
    expect(expanded).toMatch(/^\.\.\/\.\.\/outside 2026-11-13 09:05 \w+$/);
    expect(dailyNotePath('yyyy-mm-dd', date, 'Daily')).toBe('Daily/2026-11-13');
    expect(dailyNotePath('yyyy-mm-dd', date, 'Daily')).not.toContain('outside');
    expect(isoDate(date)).toBe('2026-11-13');
  });
});
