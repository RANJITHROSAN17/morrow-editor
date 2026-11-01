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
export const MAX_WORKSPACE_ROOTS = 12;
export const MAX_WORKSPACE_FILES = 5_000;
export const MAX_WORKSPACE_DIRECTORIES = 1_000;
export const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SEARCH_RESULTS = 500;
const EXCLUDED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules', 'target', 'dist', 'build', 'coverage', '.cache', '.next', '.venv']);

function safeName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[\\/\0]/u.test(name);
}

/** Restrict newly created entries to one portable, non-device Windows filename. */
export function validateNewEntryName(name: string): void {
  if (!safeName(name) || name.length > 180 || /[<>:"|?*\u0000-\u001f]/u.test(name) || /[ .]$/u.test(name)
    || /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/iu.test(name)) {
    throw new Error('Enter one valid filename: no slashes, reserved Windows names, trailing dots/spaces, or special characters.');
  }
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

/** Lower is better; undefined means the file does not match the (already lowercased) query. */
type QuickOpenPath = Pick<WorkspaceFile, 'name' | 'relative'>;
function quickScore(file: QuickOpenPath, query: string): number | undefined {
  if (!query) return 0;
  const basename = file.name.toLowerCase();
  if (basename === query) return 0;
  if (basename.startsWith(query)) return 1;
  const path = file.relative.toLowerCase();
  // A match that starts a path segment or a camelCase word, such as src/main.ts or myMain.ts.
  for (let index = path.indexOf(query); index >= 0; index = path.indexOf(query, index + 1)) {
    const before = file.relative[index - 1] ?? '/';
    if (/[\\/._\- ]/u.test(before) || (/[a-z]/u.test(before) && /[A-Z]/u.test(file.relative[index] ?? ''))) return 2;
  }
  let cursor = 0;
  for (const character of path) {
    if (character === query[cursor]) cursor++;
    if (cursor === query.length) return 3;
  }
  return undefined;
}

/** Rank Quick Open matches: basename exact > basename prefix > path boundary > subsequence, then shorter path, then locale. */
export function rankWorkspaceFiles<T extends QuickOpenPath>(files: readonly T[], query: string, limit = 50): T[] {
  const needle = query.trim().replace(/\\/gu, '/').toLowerCase();
  const scored: { file: T; score: number }[] = [];
  for (const file of files) {
    const score = quickScore(file, needle);
    if (score !== undefined) scored.push({ file, score });
  }
  scored.sort((a, b) => a.score - b.score
    || a.file.relative.length - b.file.relative.length
    || a.file.relative.localeCompare(b.file.relative, undefined, { sensitivity: 'base', numeric: true }));
  return scored.slice(0, Math.max(0, limit)).map((item) => item.file);
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

export type NewWorkspaceEntryKind = 'file' | 'directory';

/** Create one child only after an explicit action. Never truncate an existing item. */
export async function createWorkspaceEntry(root: WorkspaceDirectory, parent: WorkspaceDirectory, name: string, kind: NewWorkspaceEntryKind): Promise<WorkspaceEntry> {
  validateNewEntryName(name);
  if (root.relative !== '' || root.kind !== parent.kind || !['file', 'directory'].includes(kind)) throw new Error('Invalid folder or entry type.');
  const relative = childRelative(parent.relative, name);
  if (root.kind === 'native' && parent.kind === 'native') {
    // Rust revalidates the selected root, every parent component and the name,
    // and uses exclusive create on the final component.
    await invoke('workspace_create_entry', { root: root.path, parentRelative: parent.relative, name, kind });
    const checkedParent = parent.relative ? parent.relative.split('/').reduce(childPath, root.path) : root.path;
    const path = childPath(checkedParent, name);
    return kind === 'directory'
      ? { kind: 'native', type: 'directory', name, path, relative }
      : { kind: 'native', type: 'file', name, path, relative };
  }
  if (root.kind !== 'browser' || parent.kind !== 'browser') throw new Error('Invalid folder.');
  if (root.handle !== parent.handle) {
    if (typeof root.handle.resolve !== 'function') throw new Error('Cannot verify this folder in the browser preview.');
    const parts = await root.handle.resolve(parent.handle);
    if (!parts || parts.join('/') !== parent.relative) throw new Error('The destination is outside the chosen folder.');
  }
  // File System Access has no exclusive-create primitive. Check both kinds
  // first; getFileHandle({create:true}) itself does not truncate an existing
  // file if another process wins the race, but it could return that file.
  for (const lookup of [() => parent.handle.getFileHandle(name), () => parent.handle.getDirectoryHandle(name)]) {
    try { await lookup(); throw new Error('An item with that name already exists.'); }
    catch (error) {
      if ((error as DOMException).name === 'TypeMismatchError') throw new Error('An item with that name already exists.');
      if ((error as DOMException).name !== 'NotFoundError') throw error;
    }
  }
  if (kind === 'directory') {
    const handle = await parent.handle.getDirectoryHandle(name, { create: true }) as IterableDirectory;
    return { kind: 'browser', type: 'directory', name, rootName: root.rootName || root.name, handle, relative };
  }
  const handle = await parent.handle.getFileHandle(name, { create: true });
  return { kind: 'browser', type: 'file', name, rootName: root.rootName || root.name, handle, relative };
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

/** Walk only approved roots. Limits apply to the entire workspace, not each root. */
export async function walkWorkspace(
  selected: WorkspaceDirectory | readonly WorkspaceDirectory[],
  onFile: (entry: WorkspaceFile, progress: WalkProgress, root: WorkspaceDirectory) => Promise<boolean | void>,
  options: { signal?: AbortSignal; onProgress?: (progress: WalkProgress) => void } = {},
): Promise<WalkProgress> {
  const roots: readonly WorkspaceDirectory[] = Array.isArray(selected) ? selected : [selected as WorkspaceDirectory];
  if (roots.length > MAX_WORKSPACE_ROOTS) throw new Error(`A workspace can contain up to ${MAX_WORKSPACE_ROOTS} folders.`);
  const progress = makeProgress();
  const stack = roots.map((root) => ({ root, directory: root })).reverse();
  while (stack.length && !isAborted(options.signal)) {
    if (progress.directories >= MAX_WORKSPACE_DIRECTORIES) { progress.truncated = true; break; }
    const { root, directory } = stack.pop()!;
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
        const keepGoing = await onFile(entry, progress, root);
        if (keepGoing === false) { if (!isAborted(options.signal)) progress.truncated = true; stop = true; break; }
      }
      if ((progress.files + progress.directories) % 25 === 0) { options.onProgress?.(progress); await yieldToUi(); }
    }
    if (stop) break;
    for (let index = directories.length - 1; index >= 0; index--) stack.push({ root, directory: directories[index] });
    options.onProgress?.(progress);
    await yieldToUi();
  }
  options.onProgress?.(progress);
  return progress;
}

export interface SearchResult { root: WorkspaceDirectory; file: WorkspaceFile; line: number; column: number; preview: string; }
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

export async function searchWorkspace(root: WorkspaceDirectory | readonly WorkspaceDirectory[], options: SearchOptions): Promise<WalkProgress & { matches: number; cancelled: boolean }> {
  const query = options.query;
  if (!query || query.length > 256 || /[\r\n]/u.test(query)) throw new Error('Enter a single-line search of up to 256 characters.');
  const filters = parseFileFilters(options.extensions);
  const needle = options.caseSensitive ? query : query.toLowerCase();
  let matches = 0;
  const progress = await walkWorkspace(root, async (entry, state, sourceRoot) => {
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
        options.onResult({ root: sourceRoot, file: entry, line: index + 1, column: column + 1, preview });
        matches++;
        if (matches >= MAX_SEARCH_RESULTS) return false;
      }
    } catch (error) { issue(state, `${entry.relative}: ${error instanceof Error ? error.message : String(error)}`); }
  }, { signal: options.signal, onProgress: options.onProgress });
  return { ...progress, matches, cancelled: isAborted(options.signal) };
}
