import { openUrl } from '@tauri-apps/plugin-opener';
import { desktop, fileName } from './platform';
import { MAX_REVIEW_CHARS, makeReviewTarget, normalizeReplacement, reviewDiff, type ReviewTarget } from './change-review';
import { ARENA_API_ENDPOINT, ARENA_KEYS_URL, ARENA_PRIVACY_URL, ARENA_WEBSITE, MAX_ARENA_CONTEXT, buildArenaRequest, requestArenaBatch, type ArenaMode, type ArenaRequest } from './arena';
import { findPotentialSecrets } from './sensitive-text';
import { MAX_WORKSPACE_ROOTS, createWorkspaceEntry, listWorkspaceDirectory, pickWorkspace, searchWorkspace, walkWorkspace, type DirectoryListing, type NewWorkspaceEntryKind, type SearchResult, type WalkProgress, type WorkspaceDirectory, type WorkspaceFile } from './workspace';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing element ${selector}`);
  return value;
};
const element = <T extends keyof HTMLElementTagNameMap>(tag: T, className = ''): HTMLElementTagNameMap[T] => {
  const result = document.createElement(tag); result.className = className; return result;
};
interface ConfirmButton { id: string; label: string; style?: 'primary' | 'danger'; }
export interface OpenDocument { id: string; name: string; detail: string; path: string | null; }
export interface WorkbenchHost {
  toast(message: string): void;
  confirm(title: string, message: string, buttons: ConfirmButton[], eyebrow?: string): Promise<string>;
  action(name: string): Promise<void>;
  captureSelection(): ReviewTarget;
  targetIsCurrent(target: ReviewTarget): boolean;
  applyReview(target: ReviewTarget, replacement: string): void;
  focusEditor(): void;
  lineCount(): number;
  goToLine(line: number, column?: number): void;
  openWorkspaceFile(entry: WorkspaceFile, line?: number, column?: number): Promise<void>;
  openRecent(path: string): Promise<void>;
  listOpenDocuments(): OpenDocument[];
  recentPaths(): string[];
  switchDocument(id: string): void;
}

type QuickItem =
  | { kind: 'open'; name: string; detail: string; id: string }
  | { kind: 'recent'; name: string; detail: string; path: string }
  | { kind: 'workspace'; name: string; detail: string; file: WorkspaceFile };

const COMMANDS: { label: string; action: string; shortcut?: string }[] = [
  { label: 'New file', action: 'new', shortcut: 'Ctrl+N' },
  { label: 'Open files', action: 'open', shortcut: 'Ctrl+O' },
  { label: 'Open folder', action: 'open-folder' },
  { label: 'Add folder to workspace', action: 'add-folder' },
  { label: 'Quick open', action: 'quick-open', shortcut: 'Ctrl+P' },
  { label: 'Find in folder', action: 'find-files', shortcut: 'Ctrl+Shift+F' },
  { label: 'Go to line', action: 'goto-line', shortcut: 'Ctrl+G' },
  { label: 'Find in current file', action: 'find', shortcut: 'Ctrl+F' },
  { label: 'Replace in current file', action: 'replace', shortcut: 'Ctrl+H' },
  { label: 'Save file', action: 'save', shortcut: 'Ctrl+S' },
  { label: 'Save as', action: 'save-as', shortcut: 'Ctrl+Shift+S' },
  { label: 'Review pasted change', action: 'review-change' },
  { label: 'Arena and change review', action: 'arena' },
  { label: 'Toggle sidebar', action: 'sidebar', shortcut: 'Ctrl+B' },
  { label: 'Toggle word wrap', action: 'wrap', shortcut: 'Alt+Z' },
  { label: 'Toggle Markdown preview', action: 'preview-markdown' },
  { label: 'Switch theme', action: 'theme' },
  { label: 'Settings', action: 'settings', shortcut: 'Ctrl+,' },
];

interface WorkspaceRootState {
  id: number;
  folder: WorkspaceDirectory;
  listings: Map<string, DirectoryListing>;
  expanded: Set<string>;
  rootExpanded: boolean;
}

export class Workbench {
  private roots: WorkspaceRootState[] = [];
  private rootSequence = 0;
  private folderGeneration = 0;
  private createTarget: { root: WorkspaceRootState; parent: WorkspaceDirectory } | null = null;
  private creating = false;
  private searchController: AbortController | null = null;
  private quickController: AbortController | null = null;
  private quickItems: QuickItem[] = [];
  private quickGeneration = 0;
  private reviewTarget: ReviewTarget | null = null;
  private reviewTimer = 0;
  private arenaTarget: ReviewTarget | null = null;
  private arenaController: AbortController | null = null;
  private arenaResults: ({ target: ReviewTarget | null; text: string; mode: ArenaMode } | null)[] = [];

  constructor(private readonly host: WorkbenchHost) { this.bind(); }

  async action(name: string): Promise<boolean> {
    switch (name) {
      case 'open-folder': await this.openFolder(false); return true;
      case 'add-folder': await this.openFolder(true); return true;
      case 'find-files': this.showSearch(); return true;
      case 'quick-open': this.showQuickOpen(); return true;
      case 'goto-line': this.showGoto(); return true;
      case 'command-palette': this.showCommands(); return true;
      case 'review-change': this.openReview(); return true;
      case 'arena': this.showArena(); return true;
      default: return false;
    }
  }

  private show(id: string): void {
    const dialog = $<HTMLDialogElement>(`#${id}`);
    if (!dialog.open) dialog.showModal();
  }
  private error(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  private rootLabel(root: WorkspaceRootState): string {
    const same = this.roots.filter((item) => item.folder.name.toLocaleLowerCase() === root.folder.name.toLocaleLowerCase());
    return same.length > 1 ? `${root.folder.name} (${same.indexOf(root) + 1})` : root.folder.name;
  }

  private async sameFolder(a: WorkspaceDirectory, b: WorkspaceDirectory): Promise<boolean> {
    if (a.kind === 'native' && b.kind === 'native') {
      const key = (path: string): string => {
        const value = path.replace(/[\\/]+$/u, '');
        // Windows paths are case-insensitive in the usual configuration; do not
        // accidentally conflate distinct case-sensitive Unix paths in tests.
        return /^(?:[a-z]:[\\/]|\\\\)/iu.test(path) ? value.replace(/\//gu, '\\').toLowerCase() : value;
      };
      return key(a.path) === key(b.path);
    }
    if (a.kind !== 'browser' || b.kind !== 'browser') return false;
    if (a.handle === b.handle) return true;
    try { return typeof a.handle.isSameEntry === 'function' && await a.handle.isSameEntry(b.handle); }
    catch { return false; }
  }

  private invalidateWorkspaceSearch(message: string): void {
    this.searchController?.abort(); this.searchController = null;
    $('#workspace-search-run').removeAttribute('disabled'); $('#workspace-search-cancel').hidden = true;
    $('#workspace-search-results').replaceChildren(); $('#workspace-search-issues').hidden = true;
    $('#workspace-search-status').textContent = message;
  }

  private async openFolder(add: boolean): Promise<void> {
    if (add && this.roots.length >= MAX_WORKSPACE_ROOTS) { this.host.toast(`A workspace can contain up to ${MAX_WORKSPACE_ROOTS} folders.`); return; }
    const choice = await this.host.confirm(add ? 'Add a folder?' : 'Choose a folder?', add
      ? 'Choose another folder to add. Morrow can read its files and may write there when you explicitly save or create an item. It does not run folder contents. Open files remain open. Desktop access to selected paths may remain in Morrow’s saved file-access scope after removal.'
      : 'Morrow can read files inside the folder you select, and may write there when you explicitly save or create an item. Searches stay on this device and do not change files. Opening a folder replaces the current folder view but leaves open files alone. On desktop, selected folder access may remain in Morrow’s saved file-access scope after the folder view is closed.', [
      { id: 'cancel', label: 'Cancel' }, { id: 'choose', label: 'Choose folder', style: 'primary' },
    ], 'FOLDER ACCESS');
    if (choice !== 'choose') return;
    try {
      const selected = await pickWorkspace();
      if (!selected) return;
      if (add) {
        for (const existing of this.roots) {
          if (await this.sameFolder(existing.folder, selected)) { this.host.toast('That folder is already in the workspace.'); return; }
        }
      } else this.closeFolder(false);
      this.invalidateWorkspaceSearch('Workspace changed; run the search again.');
      this.quickController?.abort(); this.quickGeneration++;
      const root: WorkspaceRootState = { id: ++this.rootSequence, folder: selected, listings: new Map(), expanded: new Set(), rootExpanded: true };
      this.roots.push(root);
      const generation = ++this.folderGeneration;
      this.updateWorkspaceHeading();
      $('#workspace-tree-status').textContent = `Loading ${selected.name}…`;
      const listing = await listWorkspaceDirectory(selected);
      if (generation !== this.folderGeneration || !this.roots.includes(root)) return;
      root.listings.set('', listing); this.renderTree();
    } catch (error) { $('#workspace-tree-status').textContent = `Could not read folder: ${this.error(error)}`; this.host.toast(`Could not open folder: ${this.error(error)}`); }
  }

  private updateWorkspaceHeading(): void {
    $('#workspace-section').hidden = this.roots.length === 0;
    if (!this.roots.length) return;
    $('#workspace-name').textContent = this.roots.length === 1 ? this.roots[0].folder.name : `WORKSPACE · ${this.roots.length} FOLDERS`;
    $('#workspace-name').title = this.roots.map((root) => root.folder.kind === 'native' ? root.folder.path : root.folder.name).join('\n');
  }

  private closeFolder(showMessage = true): void {
    this.invalidateWorkspaceSearch(''); this.quickController?.abort(); this.quickGeneration++;
    this.folderGeneration++; this.roots = [];
    this.updateWorkspaceHeading();
    $('#workspace-tree').replaceChildren(); $('#workspace-tree-status').textContent = '';
    if (showMessage) this.host.toast('Workspace closed. Open files remain open. Previously granted desktop access may still be stored.');
  }

  private removeRoot(root: WorkspaceRootState): void {
    if (!this.roots.includes(root)) return;
    this.folderGeneration++; this.roots = this.roots.filter((item) => item !== root);
    this.invalidateWorkspaceSearch('Workspace changed; run the search again.');
    this.quickController?.abort(); this.quickGeneration++;
    this.updateWorkspaceHeading(); this.renderTree();
    this.host.toast('Folder removed from the workspace, not deleted. Open files remain open; desktop access may still be stored.');
  }

  private async refreshFolder(): Promise<void> {
    if (!this.roots.length) return;
    const generation = ++this.folderGeneration;
    this.invalidateWorkspaceSearch('Folder view refreshed; run the search again.');
    this.quickController?.abort(); this.quickGeneration++;
    for (const root of this.roots) { root.listings.clear(); root.expanded.clear(); root.rootExpanded = true; }
    $('#workspace-tree').replaceChildren(); $('#workspace-tree-status').textContent = 'Loading folders…';
    for (const root of this.roots) {
      try {
        const listing = await listWorkspaceDirectory(root.folder);
        if (generation !== this.folderGeneration) return;
        root.listings.set('', listing);
      } catch (error) {
        if (generation !== this.folderGeneration) return;
        this.host.toast(`Could not refresh ${root.folder.name}: ${this.error(error)}`);
      }
    }
    if (generation === this.folderGeneration) this.renderTree();
  }

  private renderTree(): void {
    const tree = $('#workspace-tree'); tree.replaceChildren();
    let skipped = 0, truncated = false, listed = 0;
    const addEntries = (root: WorkspaceRootState, parent: WorkspaceDirectory, depth: number): void => {
      const listing = root.listings.get(parent.relative);
      if (!listing) return;
      skipped += listing.skippedLinks; truncated ||= listing.truncated; listed += listing.entries.length;
      for (const entry of listing.entries) {
        const button = element('button', 'workspace-row'); button.type = 'button';
        button.dataset.rootId = String(root.id); button.dataset.relative = entry.relative;
        button.style.setProperty('--tree-depth', String(Math.min(depth, 20)));
        button.title = `${this.rootLabel(root)}/${entry.relative}`;
        const caret = element('span', 'tree-caret');
        caret.textContent = entry.type === 'directory' ? (root.expanded.has(entry.relative) ? '▾' : '▸') : '·';
        caret.setAttribute('aria-hidden', 'true');
        const label = element('span', 'tree-label'); label.textContent = entry.name;
        button.append(caret, label);
        const detail = this.roots.length > 1 ? `${this.rootLabel(root)}/${entry.relative}` : entry.relative;
        if (entry.type === 'directory') {
          button.setAttribute('aria-expanded', String(root.expanded.has(entry.relative)));
          button.setAttribute('aria-label', `${root.expanded.has(entry.relative) ? 'Collapse' : 'Expand'} folder ${detail}`);
          button.addEventListener('click', () => { void this.toggleDirectory(root, entry); });
        } else {
          button.setAttribute('aria-label', `Open ${detail}`);
          button.addEventListener('click', () => { void this.host.openWorkspaceFile(entry); });
        }
        if (entry.type === 'directory') {
          const line = element('div', 'workspace-directory-line');
          line.append(button, this.createInButton(root, entry, detail)); tree.append(line);
        } else tree.append(button);
        if (entry.type === 'directory' && root.expanded.has(entry.relative)) addEntries(root, entry, depth + 1);
      }
    };
    for (const root of this.roots) {
      const line = element('div', 'workspace-root-line');
      const button = element('button', 'workspace-row workspace-root'); button.type = 'button';
      button.dataset.rootId = String(root.id); button.dataset.relative = '';
      button.setAttribute('aria-expanded', String(root.rootExpanded));
      button.setAttribute('aria-label', `${root.rootExpanded ? 'Collapse' : 'Expand'} project folder ${this.rootLabel(root)}`);
      button.title = root.folder.kind === 'native' ? root.folder.path : root.folder.name;
      const caret = element('span', 'tree-caret'); caret.textContent = root.rootExpanded ? '▾' : '▸'; caret.setAttribute('aria-hidden', 'true');
      const name = element('span', 'tree-label'); name.textContent = this.rootLabel(root);
      button.append(caret, name);
      button.addEventListener('click', () => { root.rootExpanded = !root.rootExpanded; this.renderTree(); this.focusTreeEntry(root, ''); });
      const remove = element('button', 'workspace-root-remove'); remove.type = 'button'; remove.textContent = '×';
      remove.title = `Remove ${this.rootLabel(root)} from workspace (does not delete files)`;
      remove.setAttribute('aria-label', `Remove folder ${this.rootLabel(root)} from workspace`);
      remove.addEventListener('click', () => this.removeRoot(root));
      line.append(button, this.createInButton(root, root.folder, this.rootLabel(root)), remove); tree.append(line);
      if (root.rootExpanded) addEntries(root, root.folder, 1);
    }
    const messages: string[] = [];
    if (this.roots.length && !listed && this.roots.every((root) => root.listings.has(''))) messages.push('No items in the expanded folders.');
    if (skipped) messages.push(`${skipped} link or unsupported item(s) skipped.`);
    if (truncated) messages.push('Large folder listing truncated.');
    $('#workspace-tree-status').textContent = messages.join(' ');
  }

  private async toggleDirectory(root: WorkspaceRootState, directory: WorkspaceDirectory): Promise<void> {
    if (root.expanded.has(directory.relative)) { root.expanded.delete(directory.relative); this.renderTree(); this.focusTreeEntry(root, directory.relative); return; }
    const generation = this.folderGeneration;
    if (!root.listings.has(directory.relative)) {
      $('#workspace-tree-status').textContent = `Loading ${directory.relative}…`;
      try {
        const listing = await listWorkspaceDirectory(directory);
        if (generation !== this.folderGeneration || !this.roots.includes(root)) return;
        root.listings.set(directory.relative, listing);
      } catch (error) { $('#workspace-tree-status').textContent = `Could not read ${directory.relative}: ${this.error(error)}`; return; }
    }
    root.expanded.add(directory.relative); this.renderTree(); this.focusTreeEntry(root, directory.relative);
  }

  private focusTreeEntry(root: WorkspaceRootState, relative: string): void {
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('#workspace-tree .workspace-row'));
    rows.find((row) => row.dataset.rootId === String(root.id) && row.dataset.relative === relative)?.focus();
  }

  private createInButton(root: WorkspaceRootState, parent: WorkspaceDirectory, detail: string): HTMLButtonElement {
    const button = element('button', 'workspace-create'); button.type = 'button'; button.textContent = '+';
    button.title = `Create a file or folder in ${detail}`;
    button.setAttribute('aria-label', `Create a file or folder in ${detail}`);
    button.addEventListener('click', () => this.showCreate(root, parent));
    return button;
  }

  private showCreate(root: WorkspaceRootState, parent: WorkspaceDirectory): void {
    if (!this.roots.includes(root)) return;
    this.createTarget = { root, parent };
    $('#workspace-create-location').textContent = `Create inside ${this.rootLabel(root)}${parent.relative ? `/${parent.relative}` : ''}. Existing items are never intentionally overwritten.`;
    $<HTMLInputElement>('#workspace-create-name').value = '';
    $<HTMLSelectElement>('#workspace-create-kind').value = 'file';
    $('#workspace-create-status').textContent = 'Creating a file writes an empty file immediately; save edits separately.';
    this.show('workspace-create-dialog'); $<HTMLInputElement>('#workspace-create-name').focus();
  }

  private async submitCreate(): Promise<void> {
    const target = this.createTarget;
    if (this.creating || !target || !this.roots.includes(target.root)) return;
    const name = $<HTMLInputElement>('#workspace-create-name').value;
    const kind = $<HTMLSelectElement>('#workspace-create-kind').value as NewWorkspaceEntryKind;
    this.creating = true; $<HTMLButtonElement>('#workspace-create-submit').disabled = true; $<HTMLButtonElement>('#workspace-create-cancel').disabled = true;
    $('#workspace-create-status').textContent = 'Creating…';
    try {
      const entry = await createWorkspaceEntry(target.root.folder, target.parent, name, kind);
      if (!this.roots.includes(target.root)) { this.host.toast(`Created ${entry.name}; refresh the folder view to see it.`); return; }
      let refreshed = false;
      try {
        const listing = await listWorkspaceDirectory(target.parent);
        if (this.roots.includes(target.root)) {
          target.root.listings.set(target.parent.relative, listing);
          target.root.rootExpanded = true;
          if (target.parent.relative) target.root.expanded.add(target.parent.relative);
          this.renderTree(); refreshed = true;
        }
      } catch { /* The item already exists; do not imply that creation failed. */ }
      $<HTMLDialogElement>('#workspace-create-dialog').close();
      this.host.toast(refreshed ? `Created ${entry.name}.` : `Created ${entry.name}, but the folder view could not refresh.`);
      if (entry.type === 'file') await this.host.openWorkspaceFile(entry);
    } catch (error) { $('#workspace-create-status').textContent = this.error(error); }
    finally { this.creating = false; $<HTMLButtonElement>('#workspace-create-submit').disabled = false; $<HTMLButtonElement>('#workspace-create-cancel').disabled = false; }
  }

  private showSearch(): void {
    if (!this.roots.length) { this.host.toast('Open a folder before searching its files.'); return; }
    this.show('workspace-search-dialog');
    $('#workspace-search-status').textContent = this.roots.length === 1
      ? `Search saved files in ${this.roots[0].folder.name}.` : `Search saved files in ${this.roots.length} selected folders.`;
    $<HTMLInputElement>('#workspace-query').focus();
  }

  private showSearchIssueList(progress: WalkProgress): void {
    const details = $<HTMLDetailsElement>('#workspace-search-issues');
    const list = $('#workspace-search-issues-list'); list.replaceChildren();
    details.hidden = progress.issues.length === 0;
    for (const issue of progress.issues) { const item = element('li'); item.textContent = issue; list.append(item); }
  }

  private addSearchResult(result: SearchResult): void {
    const button = element('button', 'result-row'); button.type = 'button';
    const root = this.roots.find((item) => item.folder === result.root);
    const prefix = root && this.roots.length > 1 ? `${this.rootLabel(root)}/` : '';
    const heading = element('strong'); heading.textContent = `${prefix}${result.file.relative}:${result.line}:${result.column}`;
    const preview = element('small'); preview.textContent = result.preview;
    button.append(heading, preview);
    button.addEventListener('click', () => {
      this.searchController?.abort();
      $<HTMLDialogElement>('#workspace-search-dialog').close();
      void this.host.openWorkspaceFile(result.file, result.line, result.column);
    });
    $('#workspace-search-results').append(button);
  }

  private async runSearch(): Promise<void> {
    const folders = this.roots.map((root) => root.folder);
    if (!folders.length) { this.host.toast('Open a folder before searching its files.'); return; }
    this.searchController?.abort();
    const controller = new AbortController(); this.searchController = controller;
    const generation = this.folderGeneration;
    $('#workspace-search-results').replaceChildren(); $('#workspace-search-issues').hidden = true;
    $('#workspace-search-run').setAttribute('disabled', ''); $('#workspace-search-cancel').hidden = false;
    $('#workspace-search-status').textContent = 'Searching saved files locally…';
    try {
      const result = await searchWorkspace(folders, {
        query: $<HTMLInputElement>('#workspace-query').value,
        extensions: $<HTMLInputElement>('#workspace-filter').value,
        caseSensitive: $<HTMLInputElement>('#workspace-case').checked,
        signal: controller.signal,
        onResult: (item) => { if (generation === this.folderGeneration && !controller.signal.aborted) this.addSearchResult(item); },
        onProgress: (progress) => {
          if (this.searchController === controller && !controller.signal.aborted) $('#workspace-search-status').textContent = `Searching… ${progress.files} file(s) considered, ${progress.skipped} skipped.`;
        },
      });
      if (this.searchController !== controller) return;
      const state = result.cancelled ? 'Cancelled' : result.truncated ? 'Stopped at a safety limit' : 'Finished';
      $('#workspace-search-status').textContent = `${state}: ${result.matches} matching line(s), ${result.files} file(s) considered, ${result.skipped} item(s) skipped. Search covers saved files only.`;
      this.showSearchIssueList(result);
    } catch (error) {
      if (this.searchController === controller) $('#workspace-search-status').textContent = this.error(error);
    } finally {
      if (this.searchController === controller) {
        this.searchController = null;
        $('#workspace-search-run').removeAttribute('disabled'); $('#workspace-search-cancel').hidden = true;
      }
    }
  }

  private showQuickOpen(): void {
    this.quickController?.abort();
    const controller = new AbortController(); this.quickController = controller;
    const generation = ++this.quickGeneration;
    this.quickItems = this.host.listOpenDocuments().map((doc) => ({ kind: 'open', name: doc.name, detail: doc.detail, id: doc.id }));
    const knownPaths = new Set(this.host.listOpenDocuments().map((doc) => doc.path?.toLowerCase()).filter(Boolean));
    for (const path of this.host.recentPaths()) {
      if (knownPaths.has(path.toLowerCase())) continue;
      this.quickItems.push({ kind: 'recent', name: fileName(path), detail: path, path });
      knownPaths.add(path.toLowerCase());
    }
    $<HTMLInputElement>('#quick-input').value = '';
    this.show('quick-dialog'); this.renderQuick();
    $<HTMLInputElement>('#quick-input').focus();
    if (!this.roots.length) { $('#quick-status').textContent = 'Open files and opted-in recent files.'; return; }
    const folders = this.roots.map((root) => root.folder);
    $('#quick-status').textContent = 'Indexing filenames in the selected folders…';
    void walkWorkspace(folders, async (file, _progress, sourceRoot) => {
      if (file.kind === 'native' && knownPaths.has(file.path.toLowerCase())) return;
      if (file.kind === 'native') knownPaths.add(file.path.toLowerCase());
      const root = this.roots.find((item) => item.folder === sourceRoot);
      const detail = root && this.roots.length > 1 ? `${this.rootLabel(root)}/${file.relative}` : file.relative;
      this.quickItems.push({ kind: 'workspace', name: file.name, detail, file });
      if (this.quickItems.length % 50 === 0 && generation === this.quickGeneration) this.renderQuick();
    }, { signal: controller.signal }).then((progress) => {
      if (generation !== this.quickGeneration || controller.signal.aborted) return;
      this.renderQuick();
      $('#quick-status').textContent = `${progress.files} folder file(s) indexed${progress.truncated ? ' (safety limit reached)' : ''}. ${progress.skipped} item(s) skipped.`;
    }).catch(() => { if (generation === this.quickGeneration) $('#quick-status').textContent = 'Could not finish indexing this folder.'; });
  }

  private renderQuick(): void {
    const query = $<HTMLInputElement>('#quick-input').value.trim().toLowerCase();
    const list = $('#quick-results'); list.replaceChildren();
    const matching = this.quickItems.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(query));
    const items = matching.slice(0, 100);
    for (const item of items) {
      const button = element('button', 'picker-row'); button.type = 'button';
      const name = element('strong'); name.textContent = item.name;
      const detail = element('small'); detail.textContent = `${item.kind === 'open' ? 'Open tab' : item.kind === 'recent' ? 'Recent' : 'Folder'} · ${item.detail}`;
      button.append(name, detail);
      button.addEventListener('click', () => {
        this.quickController?.abort(); $<HTMLDialogElement>('#quick-dialog').close();
        if (item.kind === 'open') this.host.switchDocument(item.id);
        else if (item.kind === 'recent') void this.host.openRecent(item.path);
        else void this.host.openWorkspaceFile(item.file);
      });
      list.append(button);
    }
    if (!items.length) { const empty = element('p', 'dialog-status'); empty.textContent = 'No matching files.'; list.append(empty); }
    else if (matching.length > items.length) { const note = element('p', 'dialog-status'); note.textContent = `Showing the first ${items.length} matches. Refine your search to see others.`; list.append(note); }
  }

  private showGoto(): void {
    const input = $<HTMLInputElement>('#goto-input');
    input.value = ''; input.max = String(this.host.lineCount());
    $('#goto-status').textContent = `Enter a line from 1 to ${this.host.lineCount()}.`;
    this.show('goto-dialog'); input.focus();
  }
  private submitGoto(): void {
    const line = Number($<HTMLInputElement>('#goto-input').value);
    if (!Number.isInteger(line) || line < 1 || line > this.host.lineCount()) { $('#goto-status').textContent = `Enter a line from 1 to ${this.host.lineCount()}.`; return; }
    $<HTMLDialogElement>('#goto-dialog').close(); this.host.goToLine(line);
  }

  private showCommands(): void {
    $<HTMLInputElement>('#command-input').value = '';
    this.show('command-dialog'); this.renderCommands(); $<HTMLInputElement>('#command-input').focus();
  }
  private renderCommands(): void {
    const query = $<HTMLInputElement>('#command-input').value.trim().toLowerCase();
    const list = $('#command-results'); list.replaceChildren();
    for (const command of COMMANDS.filter((item) => item.label.toLowerCase().includes(query))) {
      const button = element('button', 'picker-row'); button.type = 'button';
      const name = element('strong'); name.textContent = command.label; button.append(name);
      if (command.shortcut) { const detail = element('small'); detail.textContent = command.shortcut; button.append(detail); }
      button.addEventListener('click', () => { $<HTMLDialogElement>('#command-dialog').close(); void this.host.action(command.action); });
      list.append(button);
    }
  }

  private openReview(target?: ReviewTarget, initial = ''): void {
    try {
      const selected = target ?? this.host.captureSelection();
      // Check structure even for an API result, then keep its captured revision and range.
      this.reviewTarget = makeReviewTarget(selected.docId, selected.revision, selected.name, selected.from, selected.to, selected.original);
      $('#review-target').textContent = `Target: ${selected.name} · selected characters ${selected.from + 1}–${selected.to}. Changes are not saved automatically.`;
      $<HTMLTextAreaElement>('#review-before').value = selected.original;
      $<HTMLTextAreaElement>('#review-after').value = initial;
      this.show('review-dialog'); this.renderReview();
      $<HTMLTextAreaElement>('#review-after').focus();
    } catch (error) { this.host.toast(this.error(error)); }
  }

  private renderReview(): void {
    const diff = $('#review-diff'); diff.replaceChildren();
    const button = $<HTMLButtonElement>('#review-apply');
    const target = this.reviewTarget;
    if (!target) { button.disabled = true; return; }
    let replacement: string;
    try { replacement = normalizeReplacement($<HTMLTextAreaElement>('#review-after').value); }
    catch (error) { button.disabled = true; $('#review-status').textContent = this.error(error); return; }
    if (!this.host.targetIsCurrent(target)) { button.disabled = true; $('#review-status').textContent = 'The target document changed or was closed. Reject this preview and select the text again.'; return; }
    if (replacement === target.original) { button.disabled = true; $('#review-status').textContent = 'There is no change to apply.'; return; }
    const changes = reviewDiff(target.original, replacement);
    if (!changes) {
      diff.textContent = 'Diff is too large or complex to display. Compare the complete selected text and replacement above.';
    } else {
      let lines = 0;
      for (const change of changes) {
        const chunks = change.value.split(/(?<=\n)/u);
        for (const line of chunks) {
          if (!line) continue;
          if (lines++ >= 500) break;
          const span = element('span', change.added ? 'diff-added' : change.removed ? 'diff-removed' : 'diff-same');
          span.textContent = `${change.added ? '+' : change.removed ? '−' : ' '} ${line.replace(/\n$/u, '')}`;
          diff.append(span);
        }
        if (lines >= 500) break;
      }
      if (lines >= 500) { const message = element('span'); message.textContent = '… diff preview truncated; inspect both full text boxes above.'; diff.append(message); }
    }
    const fenced = /^\s*```/u.test(replacement);
    $('#review-status').textContent = fenced ? 'This replacement contains a Markdown fence. It will be applied literally.' : 'The replacement is applied literally; line breaks follow the document settings when saved.';
    button.disabled = false;
  }

  private applyReview(): void {
    if (!this.reviewTarget) return;
    try {
      const replacement = normalizeReplacement($<HTMLTextAreaElement>('#review-after').value);
      if (!this.host.targetIsCurrent(this.reviewTarget)) throw new Error('The target document changed or was closed. Select it again before applying.');
      this.host.applyReview(this.reviewTarget, replacement);
      $<HTMLDialogElement>('#review-dialog').close();
      this.host.focusEditor();
      this.host.toast('Change applied to the editor. Review it and save when ready.');
    } catch (error) { $('#review-status').textContent = this.error(error); $<HTMLButtonElement>('#review-apply').disabled = true; }
  }

  private showArena(): void {
    this.arenaTarget = null;
    $<HTMLTextAreaElement>('#arena-selection').value = '';
    this.clearArenaResults(); this.updateSensitiveWarning(); this.updateArenaControls();
    $('#arena-status').textContent = desktop ? 'Nothing is sent until you confirm each request.' : 'Arena API requests require the desktop app. Browser use and pasted-change review remain available.';
    this.show('arena-dialog');
  }
  private async external(url: string): Promise<void> {
    try {
      if (desktop) await openUrl(url);
      else if (!window.open(url, '_blank', 'noopener,noreferrer')) this.host.toast(`Open this address in your browser: ${url}`);
    } catch { this.host.toast(`Could not open a browser. Open this address manually: ${url}`); }
  }
  private captureArena(): void {
    try {
      const target = this.host.captureSelection();
      if (target.original.length > MAX_ARENA_CONTEXT) throw new Error(`Select at most ${MAX_ARENA_CONTEXT.toLocaleString()} characters for Arena.`);
      this.arenaTarget = target;
      $<HTMLTextAreaElement>('#arena-selection').value = target.original;
      $('#arena-status').textContent = `${target.original.length.toLocaleString()} selected characters ready to review. Nothing has been sent.`;
    } catch (error) { this.arenaTarget = null; $<HTMLTextAreaElement>('#arena-selection').value = ''; $('#arena-status').textContent = this.error(error); }
    this.clearArenaResults(); this.updateSensitiveWarning();
  }
  private updateSensitiveWarning(): string[] {
    const findings = findPotentialSecrets(this.arenaTarget?.original || '', $<HTMLTextAreaElement>('#arena-instruction').value);
    const warning = $('#arena-sensitive-warning');
    warning.hidden = findings.length === 0;
    warning.textContent = findings.length ? `Possible sensitive content: ${findings.join(', ')}. This check can miss secrets or flag harmless text. Remove sensitive content before sending, or cancel.` : '';
    return findings;
  }
  private clearArenaResults(): void {
    this.arenaResults = []; $('#arena-results').hidden = true;
    for (const number of [1, 2]) {
      $<HTMLTextAreaElement>(`#arena-response-${number}`).value = '';
      $(`#arena-review-${number}`).hidden = true;
    }
    $('#arena-result-card-2').hidden = true;
  }
  private updateArenaControls(): void {
    const compare = $<HTMLInputElement>('#arena-compare').checked;
    $('#arena-model-second-field').hidden = !compare;
    $('#arena-send').textContent = compare ? 'Compare two models' : 'Send to Arena';
  }
  private setArenaBusy(busy: boolean): void {
    for (const selector of ['#arena-key', '#arena-mode', '#arena-model', '#arena-model-second', '#arena-compare', '#arena-instruction', '#arena-capture', '#arena-send'] as const) {
      $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(selector).disabled = busy;
    }
    $('#arena-cancel').hidden = !busy;
  }
  private async sendArena(): Promise<void> {
    if (this.arenaController) return;
    if (!desktop) { $('#arena-status').textContent = 'Arena API requests require the desktop app.'; return; }
    const target = this.arenaTarget;
    const mode = $<HTMLSelectElement>('#arena-mode').value as ArenaMode;
    if (target && !this.host.targetIsCurrent(target)) { $('#arena-status').textContent = 'The captured selection changed. Capture it again before sending.'; return; }
    if (mode === 'edit' && !target) { $('#arena-status').textContent = 'Capture a current selection before requesting an edit.'; return; }
    const request: ArenaRequest = {
      key: $<HTMLInputElement>('#arena-key').value,
      model: $<HTMLInputElement>('#arena-model').value,
      instruction: $<HTMLTextAreaElement>('#arena-instruction').value,
      selection: target?.original || '', mode,
    };
    const compare = $<HTMLInputElement>('#arena-compare').checked;
    const requests = compare ? [request, { ...request, model: $<HTMLInputElement>('#arena-model-second').value }] : [request];
    try {
      requests.forEach(buildArenaRequest);
      if (requests.length === 2 && requests[0].model.trim() === requests[1].model.trim()) throw new Error('Choose two different model IDs to compare.');
    } catch (error) { $('#arena-status').textContent = this.error(error); return; }
    const findings = this.updateSensitiveWarning();
    const safetyNotice = findings.length ? ` Possible sensitive content detected: ${findings.join(', ')}. The check can be mistaken or incomplete; review the exact text before sending.` : ' The automatic credential check is incomplete; review the exact text for sensitive data before sending.';
    const modelNames = requests.map((item) => `“${item.model.trim()}”`).join(' and ');
    const choice = await this.host.confirm(compare ? 'Send two requests to Arena?' : 'Send request to Arena?',
      `Send your ${mode === 'edit' ? 'edit instruction' : 'question'} and ${request.selection.length.toLocaleString()} captured characters to ${ARENA_API_ENDPOINT} using ${modelNames}. ${compare ? 'This makes two separate requests, and both may incur charges. ' : ''}This is a cloud service; API charges, provider sharing and retention depend on your Arena account and terms. Morrow does not add file paths or other files, but your text may contain them.${safetyNotice}`,
      [{ id: 'cancel', label: 'Cancel' }, { id: 'send', label: compare ? 'Send both requests' : 'Send to Arena', style: 'primary' }], 'EXPLICIT CLOUD CONSENT');
    if (choice !== 'send' || this.arenaTarget !== target || !$<HTMLDialogElement>('#arena-dialog').open || (target && !this.host.targetIsCurrent(target))) return;
    // If anything changed while consent was open, require a fresh review.
    if ($<HTMLInputElement>('#arena-key').value !== request.key || $<HTMLInputElement>('#arena-model').value !== request.model
      || $<HTMLTextAreaElement>('#arena-instruction').value !== request.instruction || $<HTMLSelectElement>('#arena-mode').value !== mode
      || $<HTMLInputElement>('#arena-compare').checked !== compare
      || (compare && $<HTMLInputElement>('#arena-model-second').value !== requests[1].model)) {
      $('#arena-status').textContent = 'The request changed. Review it and send again.'; return;
    }
    const controller = new AbortController(); this.arenaController = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    this.clearArenaResults(); this.setArenaBusy(true);
    $('#arena-status').textContent = compare ? 'Waiting for two Arena responses…' : 'Waiting for Arena…';
    try {
      const responses = await requestArenaBatch(requests, controller.signal);
      if (this.arenaController !== controller) return;
      if (controller.signal.aborted) { $('#arena-status').textContent = timedOut ? 'Arena request timed out.' : 'Arena request cancelled.'; return; }
      $('#arena-results').hidden = false; $('#arena-result-card-2').hidden = requests.length < 2;
      let successful = 0;
      responses.forEach((result, index) => {
        const number = index + 1;
        $(`#arena-result-model-${number}`).textContent = requests[index].model.trim();
        const response = $<HTMLTextAreaElement>(`#arena-response-${number}`);
        if (result.status === 'fulfilled') {
          successful++;
          // Textarea value is inert text, not HTML or an executable command.
          response.value = result.value;
          this.arenaResults[index] = { target, text: result.value, mode };
          $(`#arena-review-${number}`).hidden = mode !== 'edit' || !target;
        } else {
          this.arenaResults[index] = null;
          response.value = result.reason instanceof Error ? result.reason.message : 'This Arena request failed.';
          $(`#arena-review-${number}`).hidden = true;
        }
      });
      $('#arena-status').textContent = `${successful} of ${requests.length} response(s) received. AI can be wrong; inspect results before using them.`;
    } catch (error) {
      if (this.arenaController === controller) $('#arena-status').textContent = timedOut ? 'Arena request timed out.' : this.error(error);
    } finally {
      window.clearTimeout(timer);
      if (this.arenaController === controller) { this.arenaController = null; this.setArenaBusy(false); }
    }
  }
  private reviewArenaResult(index: number): void {
    const result = this.arenaResults[index];
    if (!result || result.mode !== 'edit' || !result.target) return;
    if (!this.host.targetIsCurrent(result.target)) { $('#arena-status').textContent = 'The target changed or closed. Capture it again before requesting a new edit.'; return; }
    $<HTMLDialogElement>('#arena-dialog').close();
    this.openReview(result.target, result.text);
  }

  private bind(): void {
    $('#workspace-close').addEventListener('click', () => this.closeFolder());
    $('#workspace-refresh').addEventListener('click', () => { void this.refreshFolder(); });
    $('#workspace-create-submit').addEventListener('click', () => { void this.submitCreate(); });
    $('#workspace-create-name').addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void this.submitCreate(); } });
    $('#workspace-create-dialog').addEventListener('cancel', (event) => { if (this.creating) event.preventDefault(); });
    $('#workspace-create-dialog').addEventListener('close', () => { this.createTarget = null; });
    $('#workspace-search-run').addEventListener('click', () => { void this.runSearch(); });
    $('#workspace-search-cancel').addEventListener('click', () => this.searchController?.abort());
    for (const id of ['#workspace-query', '#workspace-filter', '#workspace-case']) {
      $(id).addEventListener(id === '#workspace-case' ? 'change' : 'input', () => {
        this.invalidateWorkspaceSearch('Search changed. Run the search again for current results.');
      });
    }
    $('#workspace-query').addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void this.runSearch(); } });
    $('#workspace-search-dialog').addEventListener('close', () => this.searchController?.abort());
    $('#quick-input').addEventListener('input', () => this.renderQuick());
    $('#quick-dialog').addEventListener('close', () => { this.quickController?.abort(); this.quickGeneration++; });
    $('#goto-submit').addEventListener('click', () => this.submitGoto());
    $('#goto-input').addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); this.submitGoto(); } });
    $('#command-input').addEventListener('input', () => this.renderCommands());
    for (const [input, list] of [['#quick-input', '#quick-results'], ['#command-input', '#command-results']] as const) {
      $(input).addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === 'ArrowDown') { const first = document.querySelector<HTMLButtonElement>(`${list} button`); if (first) { event.preventDefault(); key === 'Enter' ? first.click() : first.focus(); } }
      });
      $(list).addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`${list} button`));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0) return;
        event.preventDefault();
        if (key === 'ArrowUp' && current === 0) $(input).focus();
        else buttons[Math.max(0, Math.min(buttons.length - 1, current + (key === 'ArrowDown' ? 1 : -1)))]?.focus();
      });
    }
    $('#review-after').addEventListener('input', () => {
      $<HTMLButtonElement>('#review-apply').disabled = true;
      $('#review-status').textContent = 'Updating change preview…';
      window.clearTimeout(this.reviewTimer); this.reviewTimer = window.setTimeout(() => this.renderReview(), 100);
    });
    $('#review-apply').addEventListener('click', () => this.applyReview());
    $('#review-dialog').addEventListener('close', () => { this.reviewTarget = null; window.clearTimeout(this.reviewTimer); });
    $('#arena-open-browser').addEventListener('click', () => { void this.external(ARENA_WEBSITE); });
    $('#arena-open-keys').addEventListener('click', () => { void this.external(ARENA_KEYS_URL); });
    $('#arena-open-privacy').addEventListener('click', () => { void this.external(ARENA_PRIVACY_URL); });
    $('#arena-review-paste').addEventListener('click', () => { $<HTMLDialogElement>('#arena-dialog').close(); this.openReview(); });
    $('#arena-capture').addEventListener('click', () => this.captureArena());
    for (const selector of ['#arena-key', '#arena-model', '#arena-model-second', '#arena-instruction']) {
      $(selector).addEventListener('input', () => { this.clearArenaResults(); this.updateSensitiveWarning(); });
    }
    for (const selector of ['#arena-mode', '#arena-compare']) {
      $(selector).addEventListener('change', () => { this.clearArenaResults(); this.updateArenaControls(); });
    }
    $('#arena-send').addEventListener('click', () => { void this.sendArena(); });
    $('#arena-cancel').addEventListener('click', () => this.arenaController?.abort());
    $('#arena-review-1').addEventListener('click', () => this.reviewArenaResult(0));
    $('#arena-review-2').addEventListener('click', () => this.reviewArenaResult(1));
    $('#arena-dialog').addEventListener('close', () => {
      this.arenaController?.abort(); this.arenaController = null; this.arenaTarget = null;
      this.setArenaBusy(false); this.clearArenaResults();
      $<HTMLInputElement>('#arena-key').value = '';
      $<HTMLTextAreaElement>('#arena-selection').value = '';
      $<HTMLTextAreaElement>('#arena-instruction').value = '';
      $<HTMLSelectElement>('#arena-mode').value = 'ask';
      $<HTMLInputElement>('#arena-compare').checked = false;
      this.updateArenaControls(); this.updateSensitiveWarning();
    });
  }
}

// Re-exported for UI and regression tests so the size constraint has one source of truth.
export { MAX_REVIEW_CHARS };
