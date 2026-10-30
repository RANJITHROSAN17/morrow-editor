import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { lstat } from '@tauri-apps/plugin-fs';
import { MAX_FILE_BYTES, decodeFile } from './encoding';
import { desktop, fileName, type OpenedFile } from './platform';

// Folder access is explicitly chosen and is not restored as an active folder on launch.
// Tauri's persisted-scope plugin may separately retain permission for previously selected paths.
type IterableDirectory = FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> };
type BrowserPicker = { showDirectoryPicker?: () => Promise<IterableDirectory> };
export type WorkspaceDirectory =
  | { kind: 'native'; type: 'directory'; name: string; path: string; relative: string }
  | { kind: 'browser'; type: 'directory'; name: string; rootName: string; handle: IterableDirectory; relative: string };
export type WorkspaceFile =
  | { kind: 'native'; type: 'file'; name: string; path: string; relative: string }
  | { kind: 'browser'; type: 'file'; name: string; rootName: string; handle: FileSystemFileHandle; relative: string };
export type WorkspaceEntry = WorkspaceDirectory | WorkspaceFile;

export const MAX_DIRECTORY_ENTRIES = 2_000;
export const MAX_WORKSPACE_FILES = 5_000;
export const MAX_WORKSPACE_DIRECTORIES = 1_000;
export const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SEARCH_RESULTS = 500;
const EXCLUDED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules', 'target', 'dist', 'build', 'coverage', '.cache', '.next', '.venv']);

function safeName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[\\/\0]/u.test(name);
}
function childPath(parent: string, name: string): string {
  if (!safeName(name)) throw new Error('Invalid folder entry name.');
  const separator = /^(?:[a-z]:\\|\\\\)/iu.test(parent) ? '\\' : '/';
  const prefix = parent.replace(/[\\/]+$/u, '');
  return `${prefix}${separator}${name}`;
}
function childRelative(parent: string, name: string): string { return parent ? `${parent}/${name}` : name; }
function compareEntries(a: WorkspaceEntry, b: WorkspaceEntry): number {
  return Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

export async function pickWorkspace(): Promise<WorkspaceDirectory | null> {
  if (desktop) {
    const selected = await open({ directory: true, recursive: true, multiple: false, title: 'Open a folder in Morrow' });
    if (!selected || Array.isArray(selected)) return null;
    const info = await lstat(selected);
    if (info.isSymlink || !info.isDirectory) throw new Error('Select a real folder rather than a symbolic link or junction.');
    return { kind: 'native', type: 'directory', name: fileName(selected.replace(/[\\/]+$/u, '')) || selected, path: selected, relative: '' };
  }
  const picker = (window as Window & BrowserPicker).showDirectoryPicker;
  if (!picker) throw new Error('Folder browsing needs the Windows app or a browser with the File System Access API.');
  try {
    const handle = await picker.call(window);
    return { kind: 'browser', type: 'directory', name: handle.name, rootName: handle.name, handle, relative: '' };
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') return null;
    throw error;
  }
}

export interface DirectoryListing { entries: WorkspaceEntry[]; skippedLinks: number; truncated: boolean; }
/** Lazily list one selected directory, never intentionally following symbolic links. */
export async function listWorkspaceDirectory(directory: WorkspaceDirectory): Promise<DirectoryListing> {
  const entries: WorkspaceEntry[] = [];
  let skippedLinks = 0;
  let truncated = false;
  if (directory.kind === 'native') {
    // The native command enforces the filesystem scope and bounds enumeration before
    // data crosses IPC. It skips links and Windows reparse points where detected.
    const listing = await invoke<{ entries: { name: string; isFile: boolean; isDirectory: boolean }[]; skippedLinks: number; truncated: boolean }>('workspace_list_directory', { path: directory.path });
    skippedLinks += listing.skippedLinks;
    truncated = listing.truncated;
    for (const entry of listing.entries) {
      if ((!entry.isFile && !entry.isDirectory) || !safeName(entry.name)) { skippedLinks++; continue; }
      const relative = childRelative(directory.relative, entry.name);
      const path = childPath(directory.path, entry.name);
      if (entry.isDirectory) entries.push({ kind: 'native', type: 'directory', name: entry.name, path, relative });
      else entries.push({ kind: 'native', type: 'file', name: entry.name, path, relative });
    }
  } else {
    let scanned = 0;
    for await (const entry of directory.handle.values()) {
      if (scanned++ >= MAX_DIRECTORY_ENTRIES) { truncated = true; break; }
      if (!safeName(entry.name)) { skippedLinks++; continue; }
      const relative = childRelative(directory.relative, entry.name);
      if (entry.kind === 'directory') entries.push({ kind: 'browser', type: 'directory', name: entry.name, rootName: directory.rootName || directory.name, handle: entry as IterableDirectory, relative });
      else if (entry.kind === 'file') entries.push({ kind: 'browser', type: 'file', name: entry.name, rootName: directory.rootName || directory.name, handle: entry as FileSystemFileHandle, relative });
      else skippedLinks++;
    }
  }
  entries.sort(compareEntries);
  return { entries, skippedLinks, truncated };
}

export async function readWorkspaceFile(entry: WorkspaceFile, maxBytes = MAX_FILE_BYTES): Promise<OpenedFile> {
  if (entry.kind === 'native') {
    const raw = await invoke<ArrayBuffer>('workspace_read_file', { path: entry.path, maxBytes });
    const bytes = new Uint8Array(raw);
    if (bytes.length > maxBytes) throw new Error('File grew beyond the size limit while reading.');
    return { name: entry.name, bytes, ref: { kind: 'native', path: entry.path }, displayPath: entry.relative };
  }
  const file = await entry.handle.getFile();
  if (file.size > maxBytes) throw new Error(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB limit for this operation.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('File grew beyond the size limit while reading.');
  return { name: entry.name, bytes, ref: { kind: 'browser', handle: entry.handle }, displayPath: `${entry.rootName}/${entry.relative}` };
}

export interface WalkProgress { files: number; directories: number; skipped: number; truncated: boolean; issues: string[]; }
function makeProgress(): WalkProgress { return { files: 0, directories: 0, skipped: 0, truncated: false, issues: [] }; }
function issue(progress: WalkProgress, description: string): void {
  progress.skipped++;
  if (progress.issues.length < 8) progress.issues.push(description);
}
function isAborted(signal?: AbortSignal): boolean { return !!signal?.aborted; }
const yieldToUi = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

/** Walk only the approved root, with bounded counts and cooperative cancellation. */
export async function walkWorkspace(
  root: WorkspaceDirectory,
  onFile: (entry: WorkspaceFile, progress: WalkProgress) => Promise<boolean | void>,
  options: { signal?: AbortSignal; onProgress?: (progress: WalkProgress) => void } = {},
): Promise<WalkProgress> {
  const progress = makeProgress();
  const stack = [root];
  while (stack.length && !isAborted(options.signal)) {
    if (progress.directories >= MAX_WORKSPACE_DIRECTORIES) { progress.truncated = true; break; }
    const directory = stack.pop()!;
    progress.directories++;
    let listing: DirectoryListing;
    try { listing = await listWorkspaceDirectory(directory); }
    catch (error) { issue(progress, `${directory.relative || root.name}: ${error instanceof Error ? error.message : String(error)}`); continue; }
    progress.skipped += listing.skippedLinks;
    if (listing.truncated) { progress.truncated = true; issue(progress, `${directory.relative || root.name}: too many entries; only the first ${MAX_DIRECTORY_ENTRIES} were listed.`); }
    const directories: WorkspaceDirectory[] = [];
    let stop = false;
    for (const entry of listing.entries) {
      if (isAborted(options.signal)) break;
      if (entry.type === 'directory') {
        if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) { progress.skipped++; continue; }
        directories.push(entry);
      } else {
        if (progress.files >= MAX_WORKSPACE_FILES) { progress.truncated = true; stop = true; break; }
        progress.files++;
        const keepGoing = await onFile(entry, progress);
        if (keepGoing === false) { if (!isAborted(options.signal)) progress.truncated = true; stop = true; break; }
      }
      if ((progress.files + progress.directories) % 25 === 0) { options.onProgress?.(progress); await yieldToUi(); }
    }
    if (stop) break;
    for (let index = directories.length - 1; index >= 0; index--) stack.push(directories[index]);
    options.onProgress?.(progress);
    await yieldToUi();
  }
  options.onProgress?.(progress);
  return progress;
}

export interface SearchResult { file: WorkspaceFile; line: number; column: number; preview: string; }
export interface SearchOptions { query: string; caseSensitive: boolean; extensions: string; signal?: AbortSignal; onResult: (result: SearchResult) => void; onProgress?: (progress: WalkProgress) => void; }

/** Comma-separated extensions or literal filenames, not arbitrary regular expressions. */
export function parseFileFilters(input: string): string[] {
  const filters = input.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (filters.some((value) => !/^(?:\*?\.[a-z0-9_+-]+|[a-z0-9_.+-]+)$/iu.test(value))) {
    throw new Error('Use comma-separated extensions such as .ts, *.md, or literal file names.');
  }
  return filters.map((value) => value.startsWith('*.') ? value.slice(1) : value);
}
export function matchesFileFilters(name: string, filters: string[]): boolean {
  const lower = name.toLowerCase();
  return !filters.length || filters.some((filter) => filter.startsWith('.') ? lower.endsWith(filter) : lower === filter);
}

function literalColumn(line: string, needle: string, caseSensitive: boolean): number {
  if (caseSensitive) return line.indexOf(needle);
  const folded = line.toLowerCase();
  const index = folded.indexOf(needle);
  if (index < 0 || folded.length === line.length) return index;
  // Unicode lowercasing can expand a character (for example İ → i + combining dot).
  // Map the folded UTF-16 offset back to the original editor's UTF-16 offset.
  let foldedOffset = 0, originalOffset = 0;
  for (const character of line) {
    const next = foldedOffset + character.toLowerCase().length;
    if (index < next) return originalOffset;
    foldedOffset = next;
    originalOffset += character.length;
  }
  return Math.min(index, line.length);
}

export async function searchWorkspace(root: WorkspaceDirectory, options: SearchOptions): Promise<WalkProgress & { matches: number; cancelled: boolean }> {
  const query = options.query;
  if (!query || query.length > 256 || /[\r\n]/u.test(query)) throw new Error('Enter a single-line search of up to 256 characters.');
  const filters = parseFileFilters(options.extensions);
  const needle = options.caseSensitive ? query : query.toLowerCase();
  let matches = 0;
  const progress = await walkWorkspace(root, async (entry, state) => {
    if (!matchesFileFilters(entry.name, filters)) return;
    try {
      const opened = await readWorkspaceFile(entry, MAX_SEARCH_FILE_BYTES);
      if (isAborted(options.signal)) return false;
      const text = decodeFile(opened.bytes).text;
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index++) {
        if (isAborted(options.signal)) return false;
        const line = lines[index];
        const column = literalColumn(line, needle, options.caseSensitive);
        if (column < 0) continue;
        const start = Math.max(0, column - 100);
        const preview = `${start ? '…' : ''}${line.slice(start, start + 260)}${line.length > start + 260 ? '…' : ''}`;
        options.onResult({ file: entry, line: index + 1, column: column + 1, preview });
        matches++;
        if (matches >= MAX_SEARCH_RESULTS) return false;
      }
    } catch (error) { issue(state, `${entry.relative}: ${error instanceof Error ? error.message : String(error)}`); }
  }, { signal: options.signal, onProgress: options.onProgress });
  return { ...progress, matches, cancelled: isAborted(options.signal) };
}
