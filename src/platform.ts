import { isTauri, invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { MAX_FILE_BYTES, sha256 } from './encoding';

export const desktop = isTauri();

// The File System Access API is present in current Chromium/WebView2, but not all TS DOM versions.
type BrowserPicker = { showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>; showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle> };
export type FileRef = { kind: 'native'; path: string } | { kind: 'browser'; handle: FileSystemFileHandle } | { kind: 'download' };
export interface OpenedFile { name: string; bytes: Uint8Array; ref: FileRef; }
export interface OpenFailure { name: string; message: string; }
export interface OpenFilesResult { files: OpenedFile[]; failures: OpenFailure[]; }

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function checkSize(size: number): void {
  if (size > MAX_FILE_BYTES) throw new Error('This file is larger than the 20 MiB safety limit.');
}

export async function readNative(path: string): Promise<OpenedFile> {
  const info = await stat(path);
  if (!info.isFile) throw new Error('Only individual text files can be opened.');
  checkSize(info.size);
  const bytes = await readFile(path);
  checkSize(bytes.length);
  return { name: fileName(path), bytes, ref: { kind: 'native', path } };
}

async function readBrowser(handle: FileSystemFileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  checkSize(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkSize(bytes.length);
  return { name: file.name, bytes, ref: { kind: 'browser', handle } };
}

async function readInputFile(file: File): Promise<OpenedFile> {
  checkSize(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkSize(bytes.length);
  return { name: file.name, bytes, ref: { kind: 'download' } };
}

/** Process each selected item independently and avoid simultaneous large-file reads. */
export async function collectOpenedFiles<T>(items: readonly T[], load: (item: T) => Promise<OpenedFile>, name: (item: T) => string): Promise<OpenFilesResult> {
  const result: OpenFilesResult = { files: [], failures: [] };
  for (const item of items) {
    try { result.files.push(await load(item)); }
    catch (error) { result.failures.push({ name: name(item), message: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}

function selectWithInput(): Promise<OpenFilesResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      collectOpenedFiles(files, readInputFile, (file) => file.name).then(resolve, reject);
    }, { once: true });
    // Modern browsers fire cancel; older ones simply leave this promise pending on cancel.
    input.addEventListener('cancel', () => { input.remove(); resolve({ files: [], failures: [] }); }, { once: true });
    input.click();
  });
}

export async function pickFiles(): Promise<OpenFilesResult> {
  if (desktop) {
    const result = await open({ multiple: true, directory: false, title: 'Open a text or code file' });
    if (!result) return { files: [], failures: [] };
    const paths = Array.isArray(result) ? result : [result];
    return collectOpenedFiles(paths, readNative, fileName);
  }
  const picker = (window as Window & BrowserPicker).showOpenFilePicker;
  if (picker) {
    let handles: FileSystemFileHandle[];
    try { handles = await picker.call(window, { multiple: true }); }
    catch (error) {
      if ((error as DOMException).name === 'AbortError') return { files: [], failures: [] };
      if ((error as DOMException).name !== 'SecurityError' && (error as DOMException).name !== 'NotAllowedError') throw error;
      return selectWithInput();
    }
    return collectOpenedFiles(handles, readBrowser, (handle) => handle.name);
  }
  return selectWithInput();
}

/** Returns null on cancellation. A native save dialog has already asked before replacing an existing file. */
export async function chooseSaveTarget(suggestedName: string): Promise<{ name: string; ref: FileRef } | null> {
  if (desktop) {
    const path = await save({ defaultPath: suggestedName, title: 'Save file as' });
    return path ? { name: fileName(path), ref: { kind: 'native', path } } : null;
  }
  const picker = (window as Window & BrowserPicker).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName });
      return { name: handle.name, ref: { kind: 'browser', handle } };
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return null;
      if ((error as DOMException).name !== 'SecurityError' && (error as DOMException).name !== 'NotAllowedError') throw error;
    }
  }
  return { name: suggestedName, ref: { kind: 'download' } };
}

export class ExternalChangeError extends Error {
  constructor() { super('The file has changed on disk since it was opened.'); this.name = 'ExternalChangeError'; }
}

/** Write to a user-selected destination. Native path uses a same-directory temporary file. */
export async function writeTo(ref: FileRef, bytes: Uint8Array, name: string, expectedHash: string | null, force = false): Promise<string> {
  const digest = await sha256(bytes);
  if (ref.kind === 'native') {
    try {
      // Raw IPC avoids serialising large files as JSON. Header values must be ASCII.
      await invoke('safe_write', bytes, { headers: {
        'x-morrow-path': encodeURIComponent(ref.path),
        'x-morrow-expected': expectedHash || '',
        'x-morrow-force': force ? '1' : '0',
      } });
    } catch (error) {
      const message = String(error);
      if (message.includes('MORROW_FILE_CHANGED')) throw new ExternalChangeError();
      throw new Error(message);
    }
  } else if (ref.kind === 'browser') {
    if (expectedHash && !force) {
      const current = await ref.handle.getFile();
      checkSize(current.size);
      if (await sha256(new Uint8Array(await current.arrayBuffer())) !== expectedHash) throw new ExternalChangeError();
    }
    const writable = await ref.handle.createWritable();
    try { await writable.write(new Uint8Array(bytes)); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
  } else {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return digest;
}

export function refPath(ref: FileRef | null): string | null {
  return ref?.kind === 'native' ? ref.path : null;
}
