import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults, isValidSession, loadSettings, saveSettings, SETTINGS_KEY } from '../src/storage';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('settings persistence and session-only AI consent', () => {
  it('uses recovery on and AI off on a new installation', () => {
    expect(loadSettings()).toEqual({ settings: defaults, readFailed: false });
  });

  it('never restores a legacy AI-on preference, while preserving the other preferences', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ aiEnabled: true, recovery: false, theme: 'light', model: 'example:latest' }));
    const result = loadSettings();
    expect(result.readFailed).toBe(false);
    expect(result.settings).toMatchObject({ aiEnabled: false, recovery: false, theme: 'light', model: 'example:latest' });
  });

  it('never persists active AI consent even when the current session has AI enabled', () => {
    expect(saveSettings({ ...defaults, aiEnabled: true, wrap: true })).toBe(true);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({ aiEnabled: false, wrap: true });
    expect(loadSettings().settings.aiEnabled).toBe(false);
  });

  it('reports a failed settings write and still ignores an older AI-on value on reload', () => {
    const backing = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ aiEnabled: true, recovery: true }) });
    vi.stubGlobal('localStorage', { ...backing, setItem: () => { throw new DOMException('Storage full', 'QuotaExceededError'); } });
    expect(saveSettings({ ...defaults, aiEnabled: false, recovery: false })).toBe(false);
    expect(loadSettings().settings).toMatchObject({ aiEnabled: false, recovery: true });
  });

  it('keeps recent paths opt-in, limited and removable', () => {
    expect(loadSettings().settings).toMatchObject({ rememberRecent: false, recentFiles: [] });
    const paths = Array.from({ length: 25 }, (_, i) => `C:\\notes\\${i}.txt`);
    expect(saveSettings({ ...defaults, rememberRecent: true, recentFiles: paths })).toBe(true);
    expect(loadSettings().settings.recentFiles).toEqual(paths.slice(0, 20));
    expect(saveSettings({ ...defaults, rememberRecent: false, recentFiles: paths })).toBe(true);
    expect(loadSettings().settings).toMatchObject({ rememberRecent: false, recentFiles: [] });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).recentFiles).toEqual([]);
  });

  it('sanitizes malformed recent-path values without enabling the feature by accident', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ rememberRecent: false, recentFiles: ['C:\\secret.txt'] }));
    expect(loadSettings().settings.recentFiles).toEqual([]);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ rememberRecent: true, recentFiles: ['', 5, 'a', 'a', 'x'.repeat(4097)] }));
    expect(loadSettings().settings.recentFiles).toEqual(['a']);
  });

  it('pauses recovery and leaves persistence to the caller if settings cannot be read', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new DOMException('Blocked', 'SecurityError'); } });
    expect(loadSettings()).toMatchObject({ readFailed: true, settings: { recovery: false, aiEnabled: false } });
  });

  it('treats corrupt or non-object settings as a read failure', () => {
    for (const value of ['{broken', 'null', '[]', '{"recovery":"false"}', '{"recovery":null}']) {
      localStorage.setItem(SETTINGS_KEY, value);
      expect(loadSettings()).toMatchObject({ readFailed: true, settings: { recovery: false, aiEnabled: false } });
    }
  });
});

describe('recovery snapshot validation', () => {
  const document = (id: string) => ({ id, name: `${id}.txt`, text: 'unsaved text', path: null, savedText: null, selection: 1 });

  it('accepts every valid document, including sessions with more than 100 tabs', () => {
    const documents = Array.from({ length: 125 }, (_, index) => document(String(index)));
    expect(isValidSession({ version: 1, activeId: '124', documents })).toBe(true);
  });

  it('rejects unknown versions, duplicate IDs and partially corrupt snapshots', () => {
    expect(isValidSession({ version: 2, activeId: '1', documents: [document('1')] })).toBe(false);
    expect(isValidSession({ version: 1, activeId: '1', documents: [document('1'), document('1')] })).toBe(false);
    expect(isValidSession({ version: 1, activeId: '1', documents: [document('1'), { id: '2', name: 'bad', text: 42 }] })).toBe(false);
    expect(isValidSession({ version: 1, activeId: 'missing', documents: [document('1')] })).toBe(false);
    expect(isValidSession({ version: 1, activeId: '1', documents: [{ ...document('1'), encoding: 'unknown-format' }] })).toBe(false);
    expect(isValidSession({ version: 1, activeId: '1', documents: [{ ...document('1'), selection: 999 }] })).toBe(false);
    expect(isValidSession({ version: 1, activeId: '1', documents: [{ ...document('1'), hash: 12 }] })).toBe(false);
  });
});
