import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults, isValidSession, loadSettings, saveSettings, SETTINGS_KEY } from '../src/storage';
import { DEFAULT_DAILY_TEMPLATE } from '../src/daily';

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

describe('writing-surface settings', () => {
  it('defaults to a quiet page: no minimap, no smart punctuation, no goal, Daily folder', () => {
    expect(defaults.minimap).toBe(false);
    expect(defaults.smart).toBe(false);
    expect(defaults.spellcheck).toBe(false);
    expect(defaults.maxLineLength).toBe(0);
    expect(defaults.fontFamily).toBe('editor');
    expect(defaults.focus).toMatchObject({ focus: false, typewriter: false, zen: false });
    expect(defaults.daily).toMatchObject({ format: 'yyyy-mm-dd', folder: 'Daily' });
    expect(defaults.goal.target).toBe(0);
  });

  it('clamps a hand-edited ruler and rejects unknown typefaces', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxLineLength: 9000, fontFamily: 'comic' }));
    const { settings } = loadSettings();
    expect(settings.maxLineLength).toBe(200);
    expect(settings.fontFamily).toBe('editor');
  });

  it('keeps only relative daily-note folders so a note cannot be written outside the workspace', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ daily: { folder: '../../etc' } }));
    expect(loadSettings().settings.daily.folder).toBe('Daily');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ daily: { folder: 'Journal/2026' } }));
    expect(loadSettings().settings.daily.folder).toBe('Journal/2026');
  });

  it('falls back to the default template when a stored one is unusably long', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ daily: { template: 'x'.repeat(60_000) } }));
    const { settings } = loadSettings();
    expect(settings.daily.template.length).toBeLessThan(60_000);
    expect(settings.daily.template).toBe(DEFAULT_DAILY_TEMPLATE);
  });
});

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

describe('quota-safe session persistence', () => {
  it('preserves the last full snapshot, reports quota, and stores metadata separately when possible', async () => {
    const values = new Map<string, unknown>();
    let failure: 'none' | 'quota' | 'async-quota' | 'all' | 'other' = 'none';
    const db = {
      onversionchange: null,
      close() {},
      transaction() {
        let aborted = false;
        let asyncError: DOMException | null = null;
        const pending = new Map(values);
        const tx = {
          error: null as DOMException | null,
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
          abort() { aborted = true; },
          objectStore() {
            return {
              put(value: unknown, key: string) {
                if (failure === 'all' || (failure === 'quota' && key === 'current')) throw new DOMException('Full', 'QuotaExceededError');
                if (failure === 'other' && key === 'current') throw new DOMException('Blocked', 'SecurityError');
                if (failure === 'async-quota' && key === 'current') asyncError = new DOMException('Full', 'QuotaExceededError');
                pending.set(key, structuredClone(value));
              },
              delete(key: string) { pending.delete(key); },
            };
          },
        };
        queueMicrotask(() => {
          if (asyncError) { tx.error = asyncError; tx.onerror?.(); return; }
          if (aborted) { tx.onabort?.(); return; }
          values.clear(); for (const [key, value] of pending) values.set(key, value);
          tx.oncomplete?.();
        });
        return tx;
      },
    };
    vi.stubGlobal('indexedDB', { open: () => {
      const request = { result: db, onsuccess: null as (() => void) | null, onerror: null, onblocked: null, onupgradeneeded: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });
    const { saveSession } = await import('../src/storage');
    const doc = {
      id: 'tab', name: 'draft.txt', path: 'C:\\draft.txt', text: 'old draft', savedText: 'previous file',
      encoding: 'UTF-8' as const, savedEncoding: 'UTF-8' as const, lineEnding: 'LF' as const, savedLineEnding: 'LF' as const,
      mixedLineEndings: false, hash: null, selection: 0, languageOverride: null, sample: false, wasBrowserFile: false,
    };
    const original = { version: 1 as const, activeId: 'tab', documents: [doc] };
    const newer = { ...original, documents: [{ ...doc, text: 'new unsaved draft' }] };
    expect(await saveSession(original)).toEqual({ saved: true, quotaExceeded: false, metadataSaved: false });
    failure = 'quota';
    expect(await saveSession(newer)).toEqual({ saved: false, quotaExceeded: true, metadataSaved: true });
    expect(values.get('current')).toEqual(original);
    expect(values.get('metadata-only')).toMatchObject({ activeId: 'tab', documents: [{ name: 'draft.txt' }] });
    expect(JSON.stringify(values.get('metadata-only'))).not.toContain('draft"');
    expect(values.get('metadata-only')).not.toHaveProperty('documents.0.text');
    expect(values.get('metadata-only')).not.toHaveProperty('documents.0.savedText');
    failure = 'async-quota';
    expect(await saveSession(newer)).toEqual({ saved: false, quotaExceeded: true, metadataSaved: true });
    expect(values.get('current')).toEqual(original);
    failure = 'all';
    expect(await saveSession(newer)).toEqual({ saved: false, quotaExceeded: true, metadataSaved: false });
    expect(values.get('current')).toEqual(original);
    failure = 'other';
    expect(await saveSession(newer)).toEqual({ saved: false, quotaExceeded: false, metadataSaved: false });
    failure = 'none';
    expect(await saveSession(newer)).toEqual({ saved: true, quotaExceeded: false, metadataSaved: false });
    expect(values.get('current')).toEqual(newer);
    expect(values.has('metadata-only')).toBe(false);
    expect((await saveSession(null)).saved).toBe(true);
    expect(values.size).toBe(0);
  });
});
