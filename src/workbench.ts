import { openUrl } from '@tauri-apps/plugin-opener';
import { desktop, fileName } from './platform';
import { MAX_REVIEW_CHARS, makeReviewTarget, normalizeReplacement, reviewDiff, type ReviewTarget } from './change-review';
import { ARENA_API_ENDPOINT, ARENA_KEYS_URL, ARENA_PRIVACY_URL, ARENA_WEBSITE, MAX_ARENA_CONTEXT, buildArenaRequest, requestArena } from './arena';
import { findPotentialSecrets } from './sensitive-text';
import { listWorkspaceDirectory, pickWorkspace, searchWorkspace, walkWorkspace, type DirectoryListing, type SearchResult, type WalkProgress, type WorkspaceDirectory, type WorkspaceFile } from './workspace';

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

export class Workbench {
  private folder: WorkspaceDirectory | null = null;
  private folderGeneration = 0;
  private folderListings = new Map<string, DirectoryListing>();
  private expanded = new Set<string>();
  private searchController: AbortController | null = null;
  private quickController: AbortController | null = null;
  private quickItems: QuickItem[] = [];
  private quickGeneration = 0;
  private reviewTarget: ReviewTarget | null = null;
  private reviewTimer = 0;
  private arenaTarget: ReviewTarget | null = null;
  private arenaController: AbortController | null = null;

  constructor(private readonly host: WorkbenchHost) { this.bind(); }

  async action(name: string): Promise<boolean> {
    switch (name) {
      case 'open-folder': await this.openFolder(); return true;
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

  private async openFolder(): Promise<void> {
    const choice = await this.host.confirm('Choose a folder?', 'Morrow can read files inside the folder you select, and may write there when you explicitly save. Searches stay on this device and do not change files. On desktop, selected folder access may remain in Morrow’s saved file-access scope even after the folder view is closed.', [
      { id: 'cancel', label: 'Cancel' }, { id: 'choose', label: 'Choose folder', style: 'primary' },
    ], 'FOLDER ACCESS');
    if (choice !== 'choose') return;
    try {
      const selected = await pickWorkspace();
      if (!selected) return;
      this.closeFolder(false);
      this.folder = selected;
      this.folderGeneration++;
      $('#workspace-section').hidden = false;
      $('#workspace-name').textContent = selected.name;
      $('#workspace-name').title = selected.kind === 'native' ? selected.path : selected.name;
      $('#workspace-tree-status').textContent = 'Loading folder…';
      await this.refreshFolder();
    } catch (error) { this.host.toast(`Could not open folder: ${this.error(error)}`); }
  }

  private closeFolder(showMessage = true): void {
    this.searchController?.abort(); this.searchController = null; this.quickController?.abort();
    $('#workspace-search-run').removeAttribute('disabled'); $('#workspace-search-cancel').hidden = true;
    this.folderGeneration++;
    this.folder = null;
    this.folderListings.clear(); this.expanded.clear();
    $('#workspace-search-results').replaceChildren();
    $('#workspace-search-issues').hidden = true;
    $('#workspace-search-status').textContent = '';
    $('#workspace-section').hidden = true;
    $('#workspace-tree').replaceChildren();
    $('#workspace-tree-status').textContent = '';
    if (showMessage) this.host.toast('Folder view closed. Previously granted desktop file access may still be stored.');
  }

  private async refreshFolder(): Promise<void> {
    const folder = this.folder;
    if (!folder) return;
    const generation = ++this.folderGeneration;
    this.folderListings.clear(); this.expanded.clear();
    $('#workspace-tree').replaceChildren();
    $('#workspace-tree-status').textContent = 'Loading folder…';
    try {
      const listing = await listWorkspaceDirectory(folder);
      if (generation !== this.folderGeneration) return;
      this.folderListings.set('', listing);
      this.renderTree();
    } catch (error) {
      if (generation === this.folderGeneration) $('#workspace-tree-status').textContent = `Could not read folder: ${this.error(error)}`;
    }
  }

  private renderTree(): void {
    const tree = $('#workspace-tree'); tree.replaceChildren();
    const folder = this.folder;
    if (!folder) return;
    let skipped = 0, truncated = false;
    const addEntries = (parent: WorkspaceDirectory, depth: number): void => {
      const listing = this.folderListings.get(parent.relative);
      if (!listing) return;
      skipped += listing.skippedLinks; truncated ||= listing.truncated;
      for (const entry of listing.entries) {
        const button = element('button', 'workspace-row'); button.type = 'button';
        button.style.setProperty('--tree-depth', String(Math.min(depth, 20)));
        button.title = entry.relative;
        const caret = element('span', 'tree-caret');
        caret.textContent = entry.type === 'directory' ? (this.expanded.has(entry.relative) ? '▾' : '▸') : '·';
        caret.setAttribute('aria-hidden', 'true');
        const label = element('span', 'tree-label'); label.textContent = entry.name;
        button.append(caret, label);
        if (entry.type === 'directory') {
          button.setAttribute('aria-expanded', String(this.expanded.has(entry.relative)));
          button.setAttribute('aria-label', `${this.expanded.has(entry.relative) ? 'Collapse' : 'Expand'} folder ${entry.relative}`);
          button.addEventListener('click', () => { void this.toggleDirectory(entry); });
        } else {
          button.setAttribute('aria-label', `Open ${entry.relative}`);
          button.addEventListener('click', () => { void this.host.openWorkspaceFile(entry); });
        }
        tree.append(button);
        if (entry.type === 'directory' && this.expanded.has(entry.relative)) addEntries(entry, depth + 1);
      }
    };
    addEntries(folder, 0);
    const messages: string[] = [];
    if (!tree.childElementCount) messages.push('This folder is empty.');
    if (skipped) messages.push(`${skipped} link or unsupported item(s) skipped.`);
    if (truncated) messages.push('Large folder listing truncated.');
    $('#workspace-tree-status').textContent = messages.join(' ');
  }

  private async toggleDirectory(directory: WorkspaceDirectory): Promise<void> {
    if (this.expanded.has(directory.relative)) { this.expanded.delete(directory.relative); this.renderTree(); return; }
    const generation = this.folderGeneration;
    if (!this.folderListings.has(directory.relative)) {
      $('#workspace-tree-status').textContent = `Loading ${directory.relative}…`;
      try {
        const listing = await listWorkspaceDirectory(directory);
        if (generation !== this.folderGeneration) return;
        this.folderListings.set(directory.relative, listing);
      } catch (error) { $('#workspace-tree-status').textContent = `Could not read ${directory.relative}: ${this.error(error)}`; return; }
    }
    this.expanded.add(directory.relative); this.renderTree();
  }

  private showSearch(): void {
    if (!this.folder) { this.host.toast('Open a folder before searching its files.'); return; }
    this.show('workspace-search-dialog');
    $('#workspace-search-status').textContent = `Search saved files in ${this.folder.name}.`;
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
    const heading = element('strong'); heading.textContent = `${result.file.relative}:${result.line}:${result.column}`;
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
    const folder = this.folder;
    if (!folder) { this.host.toast('Open a folder before searching its files.'); return; }
    this.searchController?.abort();
    const controller = new AbortController(); this.searchController = controller;
    const generation = this.folderGeneration;
    $('#workspace-search-results').replaceChildren(); $('#workspace-search-issues').hidden = true;
    $('#workspace-search-run').setAttribute('disabled', ''); $('#workspace-search-cancel').hidden = false;
    $('#workspace-search-status').textContent = 'Searching saved files locally…';
    try {
      const result = await searchWorkspace(folder, {
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
    if (!this.folder) { $('#quick-status').textContent = 'Open files and opted-in recent files.'; return; }
    const folder = this.folder;
    $('#quick-status').textContent = 'Indexing filenames in the selected folder…';
    void walkWorkspace(folder, async (file) => {
      if (file.kind === 'native' && knownPaths.has(file.path.toLowerCase())) return;
      this.quickItems.push({ kind: 'workspace', name: file.name, detail: file.relative, file });
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
    this.updateSensitiveWarning();
    $('#arena-status').textContent = desktop ? 'No data is sent until you explicitly confirm a request.' : 'Arena API requests require the desktop app. Browser use and pasted-change review remain available.';
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
    this.updateSensitiveWarning();
  }
  private updateSensitiveWarning(): string[] {
    const findings = findPotentialSecrets(this.arenaTarget?.original || '', $<HTMLTextAreaElement>('#arena-instruction').value);
    const warning = $('#arena-sensitive-warning');
    warning.hidden = findings.length === 0;
    warning.textContent = findings.length ? `Possible sensitive content: ${findings.join(', ')}. This check can miss secrets or flag harmless text. Remove sensitive content before sending, or cancel.` : '';
    return findings;
  }
  private async sendArena(): Promise<void> {
    if (this.arenaController) return;
    if (!desktop) { $('#arena-status').textContent = 'Arena API requests require the desktop app.'; return; }
    const target = this.arenaTarget;
    if (!target || !this.host.targetIsCurrent(target)) { $('#arena-status').textContent = 'Capture a current selection before sending.'; return; }
    const request = {
      key: $<HTMLInputElement>('#arena-key').value,
      model: $<HTMLInputElement>('#arena-model').value,
      instruction: $<HTMLTextAreaElement>('#arena-instruction').value,
      selection: target.original,
    };
    try { buildArenaRequest(request); } catch (error) { $('#arena-status').textContent = this.error(error); return; }
    const findings = this.updateSensitiveWarning();
    const safetyNotice = findings.length ? ` Possible sensitive content detected: ${findings.join(', ')}. The check can be mistaken or incomplete; review the exact text before sending.` : ' The automatic credential check is incomplete; review the exact text for sensitive data before sending.';
    const choice = await this.host.confirm('Send selected text to Arena?', `Send ${target.original.length.toLocaleString()} selected characters and your instruction to ${ARENA_API_ENDPOINT} using model “${request.model.trim()}”. This is a cloud service; API charges, provider sharing and retention depend on your Arena account and terms. Morrow does not add file paths or other files, but your selection or instruction may contain them.${safetyNotice}`, [
      { id: 'cancel', label: 'Cancel' }, { id: 'send', label: 'Send to Arena', style: 'primary' },
    ], 'EXPLICIT CLOUD CONSENT');
    if (choice !== 'send' || this.arenaTarget !== target || !$<HTMLDialogElement>('#arena-dialog').open || !this.host.targetIsCurrent(target)) return;
    const controller = new AbortController(); this.arenaController = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    $<HTMLButtonElement>('#arena-send').disabled = true; $('#arena-cancel').hidden = false;
    $('#arena-status').textContent = 'Waiting for Arena…';
    try {
      const response = await requestArena(request, controller.signal);
      if (controller.signal.aborted || this.arenaController !== controller) return;
      this.arenaController = null;
      $<HTMLDialogElement>('#arena-dialog').close();
      this.openReview(target, response);
    } catch (error) {
      if (this.arenaController === controller) $('#arena-status').textContent = timedOut ? 'Arena request timed out.' : this.error(error);
    } finally {
      window.clearTimeout(timer);
      if (this.arenaController === controller) this.arenaController = null;
      $<HTMLButtonElement>('#arena-send').disabled = false; $('#arena-cancel').hidden = true;
    }
  }

  private bind(): void {
    $('#workspace-close').addEventListener('click', () => this.closeFolder());
    $('#workspace-refresh').addEventListener('click', () => { void this.refreshFolder(); });
    $('#workspace-search-run').addEventListener('click', () => { void this.runSearch(); });
    $('#workspace-search-cancel').addEventListener('click', () => this.searchController?.abort());
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
    $('#arena-instruction').addEventListener('input', () => { this.updateSensitiveWarning(); });
    $('#arena-send').addEventListener('click', () => { void this.sendArena(); });
    $('#arena-cancel').addEventListener('click', () => this.arenaController?.abort());
    $('#arena-dialog').addEventListener('close', () => {
      this.arenaController?.abort(); this.arenaController = null; this.arenaTarget = null;
      $<HTMLInputElement>('#arena-key').value = '';
      $<HTMLTextAreaElement>('#arena-selection').value = '';
      $<HTMLTextAreaElement>('#arena-instruction').value = '';
      this.updateSensitiveWarning();
    });
  }
}

// Re-exported for UI and regression tests so the size constraint has one source of truth.
export { MAX_REVIEW_CHARS };
