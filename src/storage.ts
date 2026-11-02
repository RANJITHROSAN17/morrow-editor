import type { LineEnding, TextEncoding } from './encoding';
import { DEFAULT_MODEL } from './ai';

export interface Settings {
  theme: 'dark' | 'light';
  wrap: boolean;
  recovery: boolean;
  fontSize: number;
  tabSize: 2 | 4 | 8;
  // Session-only consent. Never restore an old persisted true value.
  aiEnabled: boolean;
  model: string;
  sidebar: boolean;
  // Recent paths are optional and unencrypted, and are remembered only after opt-in.
  rememberRecent: boolean;
  recentFiles: string[];
}
export const defaults: Settings = { theme: 'dark', wrap: false, recovery: true, fontSize: 14, tabSize: 4, aiEnabled: false, model: DEFAULT_MODEL, sidebar: true, rememberRecent: false, recentFiles: [] };
export const SETTINGS_KEY = 'morrow.settings.v1';
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
export interface LoadedSettings { settings: Settings; readFailed: boolean; }

/** On a read error, pause recovery rather than guessing an old privacy preference. */
export function loadSettings(): LoadedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid settings');
    const saved = parsed as Partial<Settings>;
    // A malformed stored privacy preference is not the same as a missing first-run setting.
    if ('recovery' in saved && typeof saved.recovery !== 'boolean') throw new Error('Invalid recovery preference');
    return {
      readFailed: false,
      settings: {
        theme: saved.theme === 'light' ? 'light' : 'dark',
        wrap: typeof saved.wrap === 'boolean' ? saved.wrap : defaults.wrap,
        recovery: typeof saved.recovery === 'boolean' ? saved.recovery : defaults.recovery,
        fontSize: typeof saved.fontSize === 'number' && Number.isFinite(saved.fontSize) ? Math.min(22, Math.max(11, saved.fontSize)) : defaults.fontSize,
        tabSize: saved.tabSize === 2 || saved.tabSize === 8 ? saved.tabSize : 4,
        // Old versions wrote this flag. Ignore it even if a failed write left true behind.
        aiEnabled: false,
        model: typeof saved.model === 'string' && saved.model.trim() ? saved.model.trim().slice(0, 120) : DEFAULT_MODEL,
        sidebar: typeof saved.sidebar === 'boolean' ? saved.sidebar : defaults.sidebar,
        rememberRecent: saved.rememberRecent === true,
        recentFiles: saved.rememberRecent === true && Array.isArray(saved.recentFiles)
          ? [...new Set(saved.recentFiles.filter((path): path is string => typeof path === 'string' && path.length > 0 && path.length <= 4096))].slice(0, 20)
          : [],
      },
    };
  } catch {
    // A saved recovery snapshot may contain unsaved work. The caller must not delete or overwrite it.
    return { settings: { ...defaults, recovery: false, aiEnabled: false }, readFailed: true };
  }
}

/** Return failure to the UI. AI consent is deliberately not persisted across launches. */
export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, aiEnabled: false, recentFiles: settings.rememberRecent ? settings.recentFiles.slice(0, 20) : [] }));
    return true;
  } catch { return false; }
}

/** Reject an unreadable/incompatible snapshot rather than silently overwriting a partial restore. */
export function isValidSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<Session>;
  if (session.version !== 1 || typeof session.activeId !== 'string' || !Array.isArray(session.documents)) return false;
  const ids = new Set<string>();
  const encodings = new Set(['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE']);
  const endings = new Set(['LF', 'CRLF', 'CR']);
  for (const value of session.documents as unknown[]) {
    if (!value || typeof value !== 'object') return false;
    const doc = value as Partial<SavedDocument>;
    if (typeof doc.id !== 'string' || !doc.id || ids.has(doc.id) || typeof doc.name !== 'string' || typeof doc.text !== 'string') return false;
    if (doc.path != null && typeof doc.path !== 'string') return false;
    if (doc.savedText != null && typeof doc.savedText !== 'string') return false;
    if (doc.hash != null && typeof doc.hash !== 'string') return false;
    if (doc.languageOverride != null && typeof doc.languageOverride !== 'string') return false;
    if (doc.encoding != null && !encodings.has(doc.encoding)) return false;
    if (doc.savedEncoding != null && !encodings.has(doc.savedEncoding)) return false;
    if (doc.lineEnding != null && !endings.has(doc.lineEnding)) return false;
    if (doc.savedLineEnding != null && !endings.has(doc.savedLineEnding)) return false;
    if (doc.mixedLineEndings != null && typeof doc.mixedLineEndings !== 'boolean') return false;
    if (doc.sample != null && typeof doc.sample !== 'boolean') return false;
    if (doc.wasBrowserFile != null && typeof doc.wasBrowserFile !== 'boolean') return false;
    if (doc.selection != null && (!Number.isInteger(doc.selection) || doc.selection < 0 || doc.selection > doc.text.length)) return false;
    ids.add(doc.id);
  }
  return !session.documents.length || ids.has(session.activeId);
}

const DB = 'morrow-local-session-v1';
let dbPromise: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      let rejected = false;
      request.onupgradeneeded = () => request.result.createObjectStore('session');
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) { db.close(); return; }
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { rejected = true; reject(request.error || new Error('Unable to open local recovery storage.')); };
      request.onblocked = () => { rejected = true; reject(new Error('Local recovery storage is blocked by another window.')); };
    });
    // A transient open failure should not make every later retry fail forever.
    dbPromise = pending.catch((error: unknown) => { dbPromise = null; throw error; });
  }
  return dbPromise;
}

export async function loadSession(): Promise<Session | null> {
  const db = await database();
  const stored = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction('session', 'readonly').objectStore('session').get('current');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('Unable to read recovery data.'));
  });
  if (stored === null) return null;
  if (!isValidSession(stored)) throw new Error('The saved recovery session is invalid or from an unsupported version.');
  return stored;
}

/** A metadata-only record means a newer snapshot could not preserve its text. */
export async function hasPartialSessionMetadata(): Promise<boolean> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('session', 'readonly').objectStore('session').get('metadata-only');
    request.onsuccess = () => resolve(request.result != null);
    request.onerror = () => reject(request.error || new Error('Unable to read recovery metadata.'));
  });
}

// A quota fallback keeps metadata separately; it is not a complete recovery copy.
// Never replace the last complete snapshot with omitted text.
export interface SessionSaveResult { saved: boolean; quotaExceeded: boolean; metadataSaved: boolean; }
export interface SessionMetadata {
  version: 1;
  activeId: string;
  documents: Omit<SavedDocument, 'text' | 'savedText'>[];
}

function sessionMetadata(session: Session): SessionMetadata {
  return { version: 1, activeId: session.activeId, documents: session.documents.map(({ text: _text, savedText: _savedText, ...metadata }) => metadata) };
}

function writeSession(db: IDBDatabase, session: Session | null, metadataOnly = false): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction('session', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Unable to save recovery data.'));
      tx.onabort = () => reject(tx.error || new Error('Recovery transaction was interrupted.'));
      try {
        const store = tx.objectStore('session');
        if (metadataOnly && session) store.put(sessionMetadata(session), 'metadata-only');
        else {
          if (session) store.put(session, 'current');
          else store.delete('current');
          store.delete('metadata-only');
        }
      } catch (error) {
        // A synchronous failure after another request must not commit a partial transaction.
        try { tx.abort(); } catch { /* already aborted */ }
        reject(error);
      }
    } catch (error) { reject(error); }
  });
}

// Serialise writes so an older, slower snapshot cannot overwrite a newer one.
let queue: Promise<SessionSaveResult> = Promise.resolve({ saved: true, quotaExceeded: false, metadataSaved: false });
export function saveSession(session: Session | null): Promise<SessionSaveResult> {
  const operation = async (): Promise<SessionSaveResult> => {
    let db: IDBDatabase;
    try { db = await database(); }
    catch (error) { return { saved: false, quotaExceeded: (error as { name?: string })?.name === 'QuotaExceededError', metadataSaved: false }; }
    try {
      await writeSession(db, session);
      return { saved: true, quotaExceeded: false, metadataSaved: false };
    } catch (error) {
      const quotaExceeded = (error as { name?: string })?.name === 'QuotaExceededError';
      let metadataSaved = false;
      if (quotaExceeded && session) {
        try { await writeSession(db, session, true); metadataSaved = true; } catch { /* Keep the old complete snapshot. */ }
      }
      return { saved: false, quotaExceeded, metadataSaved };
    }
  };
  const next = queue.then(operation, operation);
  queue = next;
  return next;
}
