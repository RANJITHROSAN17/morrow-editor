import type { LineEnding, TextEncoding } from './encoding';
import { DEFAULT_MODEL } from './ai';

export interface Settings {
  theme: 'dark' | 'light';
  wrap: boolean;
  recovery: boolean;
  fontSize: number;
  tabSize: 2 | 4 | 8;
  aiEnabled: boolean;
  model: string;
  sidebar: boolean;
}
export const defaults: Settings = { theme: 'dark', wrap: false, recovery: true, fontSize: 14, tabSize: 4, aiEnabled: false, model: DEFAULT_MODEL, sidebar: true };
export interface SavedDocument {
  id: string;
  name: string;
  path: string | null;
  text: string;
  savedText: string | null;
  encoding: TextEncoding;
  savedEncoding: TextEncoding;
  lineEnding: LineEnding;
  savedLineEnding: LineEnding;
  mixedLineEndings: boolean;
  hash: string | null;
  selection: number;
  languageOverride: string | null;
  sample: boolean;
  wasBrowserFile: boolean;
}
export interface Session { version: 1; activeId: string; documents: SavedDocument[]; }

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('morrow.settings.v1') || '{}') as Partial<Settings>;
    return {
      theme: saved.theme === 'light' ? 'light' : 'dark',
      wrap: typeof saved.wrap === 'boolean' ? saved.wrap : defaults.wrap,
      recovery: typeof saved.recovery === 'boolean' ? saved.recovery : defaults.recovery,
      fontSize: typeof saved.fontSize === 'number' ? Math.min(22, Math.max(11, saved.fontSize)) : defaults.fontSize,
      tabSize: saved.tabSize === 2 || saved.tabSize === 8 ? saved.tabSize : 4,
      aiEnabled: saved.aiEnabled === true,
      model: typeof saved.model === 'string' && saved.model.trim() ? saved.model.trim().slice(0, 120) : DEFAULT_MODEL,
      sidebar: typeof saved.sidebar === 'boolean' ? saved.sidebar : defaults.sidebar,
    };
  } catch { return { ...defaults }; }
}
export function saveSettings(settings: Settings): void {
  try { localStorage.setItem('morrow.settings.v1', JSON.stringify(settings)); } catch { /* session UI will warn if recovery fails */ }
}

const DB = 'morrow-local-session-v1';
let dbPromise: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('session');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local recovery storage.'));
    request.onblocked = () => reject(new Error('Local recovery storage is blocked by another window.'));
  });
  return dbPromise;
}

export async function loadSession(): Promise<Session | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('session', 'readonly').objectStore('session').get('current');
    request.onsuccess = () => resolve((request.result as Session | undefined) ?? null);
    request.onerror = () => reject(request.error || new Error('Unable to read recovery data.'));
  });
}

// Serialise writes so an older, slower snapshot cannot overwrite a newer one.
let queue: Promise<void> = Promise.resolve();
export function saveSession(session: Session | null): Promise<void> {
  const operation = async () => {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('session', 'readwrite');
      if (session) tx.objectStore('session').put(session, 'current');
      else tx.objectStore('session').delete('current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Unable to save recovery data.'));
      tx.onabort = () => reject(tx.error || new Error('Recovery transaction was interrupted.'));
    });
  };
  const next = queue.catch(() => {}).then(operation);
  queue = next;
  return next;
}
