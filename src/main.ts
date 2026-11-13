import './style.css';
import { EditorState, Text } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { isolateHistory, redo, selectAll, undo } from '@codemirror/commands';
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { allLanguages, applyEditorExtensions, applyFocus, clearGhost, createEditorState, findLanguage, hasGhost, languageCompartment, languageLabel, showGhost } from './editor';
import { decodeFile, encodeFile, sha256, type LineEnding, type TextEncoding } from './encoding';
import { checkNativeFileChange, chooseSaveTarget, desktop, ExternalChangeError, pickFiles, readNative, refPath, writeTo, type FileRef, type OpenedFile, type OpenFailure } from './platform';
import { complete, listModels, runAction, DEFAULT_MODEL } from './ai';
import { MAX_ACTION_SELECTION, buildActionRequest, getAiAction, type AiActionId } from './ai-actions';
import { hasPartialSessionMetadata, loadSession, loadSettings, saveSession, saveSettings, type SavedDocument, type Session, type Settings } from './storage';
import { MARKDOWN_SAMPLE, PYTHON_SAMPLE } from './samples';
import { icon } from './icons';
import { makeReviewTarget, reviewTargetIsCurrent, type ReviewTarget } from './change-review';
import { readWorkspaceFile, type WorkspaceFile } from './workspace';
import { Workbench } from './workbench';
import { MarkdownPreview } from './markdown-preview';
import { applyLineOperation, type LineOperation } from './line-ops';
import { applySmartTypography, toggleBold, toggleBulletList, toggleHeading, toggleItalic, toggleInlineCode, toggleNumberedList, toggleQuote, toggleStrikethrough, toggleTaskList, wrapCodeBlock, wrapLink, type TextEdit } from './markdown-format';
import { countTextStats, describeStats, isLargeDocument, type TextStats } from './word-stats';
import { DailyGoalTracker } from './goal';
import { extractOutline, headingAt, isMarkdownName, rankHeadings, type Heading } from './outline';
import { collectTags, extractWikiLinks, resolveWikiTarget } from './notes';
import { NoteIndex } from './note-index';
import { buildMinimapBars, minimapAvailable, viewportFraction } from './minimap';
import { focusClassList, focusLabel, isAnyFocusActive, FOCUS_CLASSES, type FocusSettings } from './focus-mode';
import { DEFAULT_CAPTURE_SNIPPET, DEFAULT_DAILY_TEMPLATE, expandDailyTemplate, humanDate, isoTime, dailyNotePath, isSafeRelativePath } from './daily';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing element ${selector}`);
  return value;
};
const el = <T extends keyof HTMLElementTagNameMap>(tag: T, className = ''): HTMLElementTagNameMap[T] => {
  const element = document.createElement(tag); if (className) element.className = className; return element;
};
const uuid = () => crypto.randomUUID();

interface Doc {
  id: string;
  name: string;
  ref: FileRef | null;
  displayPath: string | null;
  state: EditorState;
  savedDoc: Text;
  encoding: TextEncoding;
  savedEncoding: TextEncoding;
  lineEnding: LineEnding;
  savedLineEnding: LineEnding;
  mixedLineEndings: boolean;
  hash: string | null;
  override: string | null;
  sample: boolean;
  saving: boolean;
  revision: number;
}
interface ConfirmButton { id: string; label: string; style?: 'primary' | 'danger'; }

class MorrowApp {
  private settings: Settings;
  private settingsReadFailed: boolean;
  private settingsSaveFailed = false;
  private recentClearFailed = false;
  private workbench: Workbench;
  private markdownPreview = new MarkdownPreview();
  private recoveryBlocked = false;
  private recoveryCleanupFailed = false;
  private recoveryOperationBusy = false;
  private docs: Doc[] = [];
  private activeId = '';
  private view!: EditorView;
  private languageSerial = 0;
  private recoveryTimer = 0;
  private recoveryFailed = false;
  private recoveryQuotaExceeded = false;
  private recoveryMetadataSaved = false;
  private partialRecovery = false;
  private diskChecks = new Map<string, 'changed' | 'unavailable'>();
  private diskCheckSerial = 0;
  private toastTimer = 0;
  private aiTimer = 0;
  private aiGeneration = 0;
  private aiController: AbortController | null = null;
  private aiCooldownUntil = 0;
  private aiPanelOpen = false;
  private aiActionId: AiActionId = 'improve';
  private aiActionConsent = false;
  private aiActionConsentModel = '';
  private aiActionBusy = false;
  private aiActionController: AbortController | null = null;
  private lastTitle = '';
  private findOpen = false;
  private findRegex = false;
  private findCase = false;
  private closing = false;
  private noteIndex = new NoteIndex();
  private indexToken = 0;
  private indexStale = true;
  private indexBusy = false;
  private goalTracker = new DailyGoalTracker(null);
  private statsTimer = 0;
  private stats: TextStats = countTextStats('');
  private outline: Heading[] = [];
  private outlineKey = '';
  private notesOpen = false;
  private notesTab: 'outline' | 'tags' | 'links' = 'outline';
  private minimapCanvas: HTMLCanvasElement | null = null;
  private typewriterRaf = 0;

  constructor() {
    const loaded = loadSettings();
    this.settings = loaded.settings;
    this.settingsReadFailed = loaded.readFailed;
    this.workbench = new Workbench({
      toast: (message) => this.toast(message),
      confirm: (title, message, buttons, eyebrow) => this.confirm(title, message, buttons, eyebrow),
      action: (name) => this.handleAction(name),
      captureSelection: () => this.captureReviewSelection(),
      targetIsCurrent: (target) => this.reviewIsCurrent(target),
      applyReview: (target, replacement) => this.applyReviewedChange(target, replacement),
      focusEditor: () => this.view.focus(),
      showAiActions: () => this.showAiActions(),
      lineCount: () => this.view.state.doc.lines,
      goToLine: (line, column) => this.goToLine(line, column),
      openWorkspaceFile: async (entry, line, column) => { await this.openWorkspaceFile(entry, line, column); },
      openRecent: (path) => this.openRecent(path),
      listOpenDocuments: () => this.docs.map((doc) => ({ id: doc.id, name: doc.name, detail: refPath(doc.ref) || doc.displayPath || (doc.sample ? 'Example' : 'Unsaved'), path: refPath(doc.ref) })),
      recentPaths: () => this.settings.rememberRecent ? [...this.settings.recentFiles] : [],
      switchDocument: (id) => this.switchDoc(id),
      openFolderNote: (rootName, relative, template) => this.openFolderNote(rootName, relative, template),
      appendToFolderNote: (rootName, relative, text) => this.appendToFolderNote(rootName, relative, text),
      indexableFiles: () => this.workbench.indexableFiles(),
      onIndexChanged: () => this.invalidateNoteIndex(),
    });
  }

  private get active(): Doc { return this.docs.find((doc) => doc.id === this.activeId) || this.docs[0]; }

  async start(): Promise<void> {
    document.querySelectorAll<HTMLElement>('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon || 'info'); });
    this.populateLanguages();
    this.applySettings();
    let restored = false;
    if (this.settings.recovery) {
      try {
        const session = await loadSession();
        // A later quota-limited snapshot may have metadata but no current text.
        // Do not overwrite either record with the older restored session.
        this.partialRecovery = await hasPartialSessionMetadata();
        if (this.partialRecovery) { this.recoveryBlocked = true; this.recoveryFailed = true; }
        if (session?.documents.length) {
          // Do not silently drop tabs from large saved sessions.
          for (const saved of session.documents) this.docs.push(this.restoreDoc(saved));
          if (this.docs.length) { this.activeId = this.docs.some((doc) => doc.id === session.activeId) ? session.activeId : this.docs[0].id; restored = true; }
        }
      } catch {
        // Never overwrite an unreadable or incompatible snapshot with the example session.
        this.recoveryFailed = true;
        this.recoveryBlocked = true;
      }
    } else if (!this.settingsReadFailed) {
      // A previous deletion could have failed. Retry only when an explicit off setting was readable.
      const result = await saveSession(null);
      if (!result.saved) this.recoveryCleanupFailed = true;
    }
    if (!restored) {
      // Examples are real editable buffers, clearly labelled and never silently saved to disk.
      this.docs.push(this.makeDoc('welcome.py', PYTHON_SAMPLE, { sample: true }));
      this.docs.push(this.makeDoc('quick-notes.md', MARKDOWN_SAMPLE, { sample: true }));
      this.activeId = this.docs[0].id;
    } else if (desktop) {
      await this.refreshCleanRestoredFiles();
    }
    this.view = new EditorView({ state: this.active.state, parent: $('#editor') });
    this.renderAll();
    this.refreshStats();
    await this.applyLanguage();
    // Recovery and editor initialization must finish before actions can mutate tabs.
    this.bindUi();
    this.bindMinimap();
    $('#startup-status').hidden = true;
    $('#app').removeAttribute('inert');
    $('#app').setAttribute('aria-busy', 'false');
    this.view.focus();
    if (this.recoveryFailed) this.toast('Session recovery is unavailable. Save your work to a file.');
    this.scheduleRecovery();
    if (desktop) { await this.bindDesktop(); void this.checkActiveDisk(); }
    else this.bindBrowserDrop();
  }

  private makeDoc(name: string, text = '', options: { ref?: FileRef | null; displayPath?: string | null; encoding?: TextEncoding; lineEnding?: LineEnding; mixed?: boolean; hash?: string | null; sample?: boolean; id?: string; savedText?: string | null; savedEncoding?: TextEncoding; savedLineEnding?: LineEnding; cursor?: number; override?: string | null } = {}): Doc {
    const state = createEditorState(text, this.settings, (update) => this.onEditorUpdate(update), options.cursor || 0);
    const encoding = options.encoding || 'UTF-8';
    const lineEnding = options.lineEnding || 'LF';
    return {
      id: options.id || uuid(), name, ref: options.ref || null, displayPath: options.displayPath || null, state,
      savedDoc: typeof options.savedText === 'string' ? Text.of(options.savedText.split('\n')) : state.doc,
      encoding, savedEncoding: options.savedEncoding || encoding,
      lineEnding, savedLineEnding: options.savedLineEnding || lineEnding,
      mixedLineEndings: !!options.mixed, hash: options.hash || null,
      override: options.override || null, sample: !!options.sample, saving: false, revision: 0,
    };
  }

  private restoreDoc(saved: SavedDocument): Doc {
    const allowedEncoding: TextEncoding[] = ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE'];
    const allowedEnding: LineEnding[] = ['LF', 'CRLF', 'CR'];
    return this.makeDoc(saved.name, saved.text, {
      id: saved.id, ref: desktop && saved.path ? { kind: 'native', path: saved.path } : null,
      encoding: allowedEncoding.includes(saved.encoding) ? saved.encoding : 'UTF-8',
      savedEncoding: allowedEncoding.includes(saved.savedEncoding) ? saved.savedEncoding : saved.encoding,
      lineEnding: allowedEnding.includes(saved.lineEnding) ? saved.lineEnding : 'LF',
      savedLineEnding: allowedEnding.includes(saved.savedLineEnding) ? saved.savedLineEnding : saved.lineEnding,
      mixed: saved.mixedLineEndings, hash: saved.hash, sample: saved.sample, savedText: saved.savedText,
      cursor: saved.selection, override: saved.languageOverride,
    });
  }

  private dirty(doc: Doc): boolean {
    return !doc.state.doc.eq(doc.savedDoc) || doc.encoding !== doc.savedEncoding || doc.lineEnding !== doc.savedLineEnding;
  }

  private async refreshCleanRestoredFiles(): Promise<void> {
    // A clean restored tab should show current disk contents, not a stale recovery copy.
    // Dirty tabs retain their drafts and their old hash for the save-time conflict check.
    for (const doc of this.docs) {
      if (doc.ref?.kind !== 'native' || this.dirty(doc)) continue;
      try {
        const file = await readNative(doc.ref.path);
        const hash = await sha256(file.bytes);
        if (hash === doc.hash) continue;
        const decoded = decodeFile(file.bytes);
        const cursor = Math.min(doc.state.selection.main.head, decoded.text.length);
        doc.state = createEditorState(decoded.text, this.settings, (update) => this.onEditorUpdate(update), cursor);
        doc.savedDoc = doc.state.doc;
        doc.encoding = doc.savedEncoding = decoded.encoding;
        doc.lineEnding = doc.savedLineEnding = decoded.lineEnding;
        doc.mixedLineEndings = decoded.mixedLineEndings;
        doc.hash = hash;
      } catch {
        // Keep the local snapshot. A later save checks for external changes or a missing file.
        this.toast(`Could not refresh ${doc.name} from disk. Showing the local recovery copy.`);
      }
    }
  }

  private onEditorUpdate(update: ViewUpdate): void {
    if (!this.docs.length || !this.activeId) return;
    const doc = this.active;
    doc.state = update.state;
    if (update.docChanged) {
      doc.revision++;
      this.renderFiles();
      this.renderDiskChange();
      this.updateStatus();
      this.updateMarkdownPreview();
      this.scheduleRecovery();
      this.scheduleStats();
      this.cancelAi();
      this.renderAiStatus();
      if (this.settings.aiEnabled) this.scheduleAi();
      if (this.findOpen) this.updateFindCount();
    } else if (update.selectionSet) {
      this.updateStatus();
      this.scheduleStats();
      this.scheduleTypewriterScroll();
      this.scheduleRecovery();
      this.cancelAi();
      this.renderAiStatus();
    }
  }

  private snapshot(): Session {
    return {
      version: 1, activeId: this.activeId,
      documents: this.docs.map((doc) => ({
        id: doc.id, name: doc.name, path: refPath(doc.ref), text: doc.state.doc.toString(),
        savedText: doc.state.doc.eq(doc.savedDoc) ? null : doc.savedDoc.toString(),
        encoding: doc.encoding, savedEncoding: doc.savedEncoding,
        lineEnding: doc.lineEnding, savedLineEnding: doc.savedLineEnding,
        mixedLineEndings: doc.mixedLineEndings, hash: doc.hash,
        selection: doc.state.selection.main.head, languageOverride: doc.override,
        sample: doc.sample, wasBrowserFile: doc.ref?.kind === 'browser',
      })),
    };
  }

  private scheduleRecovery(): void {
    if (!this.settings.recovery || this.recoveryBlocked || !this.view) return;
    window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = window.setTimeout(() => { void this.flushRecovery(); }, 1200);
  }
  private async flushRecovery(): Promise<boolean> {
    if (!this.settings.recovery || !this.view) return true;
    if (this.recoveryBlocked) return false;
    window.clearTimeout(this.recoveryTimer);
    try {
      const result = await saveSession(this.snapshot());
      if (!result.saved && !this.recoveryFailed) this.toast('Could not save a local recovery copy. Save your work to a file.');
      this.recoveryFailed = !result.saved;
      this.recoveryQuotaExceeded = result.quotaExceeded;
      this.recoveryMetadataSaved = result.metadataSaved;
      this.renderRecoveryStatus(); this.renderStorageWarning();
      return result.saved;
    } catch {
      if (!this.recoveryFailed) this.toast('Could not save a local recovery copy. Save your work to a file.');
      this.recoveryFailed = true; this.recoveryQuotaExceeded = false; this.recoveryMetadataSaved = false;
      this.renderRecoveryStatus(); this.renderStorageWarning();
      return false;
    }
  }

  private async checkActiveDisk(): Promise<void> {
    const serial = ++this.diskCheckSerial;
    if (!desktop || !this.view || !this.activeId) return;
    const doc = this.active;
    if (doc.ref?.kind !== 'native' || doc.saving) { this.renderDiskChange(); return; }
    const path = doc.ref.path, hash = doc.hash;
    const result = await checkNativeFileChange(path, hash);
    if (serial !== this.diskCheckSerial || this.activeId !== doc.id || doc.ref?.kind !== 'native' || doc.ref.path !== path || doc.hash !== hash || doc.saving) return;
    if (result === 'unchanged') this.diskChecks.delete(doc.id);
    else this.diskChecks.set(doc.id, result);
    this.renderDiskChange();
  }

  private renderDiskChange(): void {
    const banner = $('#disk-change-warning');
    const doc = this.activeId ? this.active : undefined;
    const status = doc && this.diskChecks.get(doc.id);
    const reload = $<HTMLButtonElement>('#disk-change-reload');
    banner.hidden = !status;
    reload.hidden = status !== 'changed' || !doc || this.dirty(doc);
    if (!doc || !status) return;
    $('#disk-change-message').textContent = status === 'unavailable'
      ? `Cannot check “${doc.name}” on disk. Your editor text is unchanged; save will still check for conflicts.`
      : this.dirty(doc)
        ? `“${doc.name}” changed on disk. Your unsaved edits are preserved; save a copy or review the conflict when saving.`
        : `“${doc.name}” changed on disk. Reload to see the latest contents.`;
  }

  private async reloadActiveFromDisk(): Promise<void> {
    const doc = this.active;
    if (doc.ref?.kind !== 'native' || this.dirty(doc) || doc.saving || this.diskChecks.get(doc.id) !== 'changed') return;
    const path = doc.ref.path, revision = doc.revision, oldHash = doc.hash;
    ++this.diskCheckSerial;
    try {
      // Read again on click; the disk may have changed since the notification.
      const file = await readNative(path);
      const hash = await sha256(file.bytes);
      const decoded = decodeFile(file.bytes);
      if (this.activeId !== doc.id || doc.ref?.kind !== 'native' || doc.ref.path !== path || doc.revision !== revision || doc.hash !== oldHash || doc.saving || this.dirty(doc)) {
        this.toast('The document changed while reloading. Your edits were kept.');
        return;
      }
      const cursor = Math.min(doc.state.selection.main.head, decoded.text.length);
      doc.state = createEditorState(decoded.text, this.settings, (update) => this.onEditorUpdate(update), cursor);
      doc.savedDoc = doc.state.doc;
      doc.encoding = doc.savedEncoding = decoded.encoding;
      doc.lineEnding = doc.savedLineEnding = decoded.lineEnding;
      doc.mixedLineEndings = decoded.mixedLineEndings;
      doc.hash = hash; doc.revision++;
      this.diskChecks.delete(doc.id);
      this.cancelAi(); this.view.setState(doc.state); this.applyEditorPreferences();
      if (this.findOpen) { openSearchPanel(this.view); this.updateSearchQuery(); }
      this.renderAll(); void this.applyLanguage(); this.scheduleRecovery(); this.view.focus();
      this.toast(`Reloaded ${doc.name} from disk.`);
    } catch (error) {
      this.diskChecks.set(doc.id, 'unavailable'); this.renderDiskChange();
      this.toast(`Could not reload ${doc.name}: ${this.errorText(error)}`);
    }
  }

  private populateLanguages(): void {
    const select = $<HTMLSelectElement>('#language');
    const auto = el('option'); auto.value = '__auto__'; auto.textContent = 'Auto · Plain text'; select.append(auto);
    const plain = el('option'); plain.value = 'Plain text'; plain.textContent = 'Plain text'; select.append(plain);
    for (const language of [...allLanguages()].sort((a, b) => a.name.localeCompare(b.name))) {
      const option = el('option'); option.value = language.name; option.textContent = language.name; select.append(option);
    }
  }

  private async applyLanguage(): Promise<void> {
    if (!this.view) return;
    const doc = this.active;
    const serial = ++this.languageSerial;
    const description = findLanguage(doc.name, doc.override);
    try {
      const support = description ? await description.load() : [];
      if (serial !== this.languageSerial || doc.id !== this.activeId) return;
      this.view.dispatch({ effects: languageCompartment.reconfigure(support) });
    } catch { if (serial === this.languageSerial) this.toast(`Could not load highlighting for ${description?.name || 'this file'}.`); }
    this.updateStatus();
  }

  private switchDoc(id: string): void {
    if (id === this.activeId) { this.view.focus(); return; }
    const next = this.docs.find((doc) => doc.id === id); if (!next) return;
    this.cancelAi(); clearGhost(this.view);
    this.activeId = id;
    this.view.setState(next.state);
    this.applyEditorPreferences();
    if (this.findOpen) { openSearchPanel(this.view); this.updateSearchQuery(); }
    this.renderAll();
    void this.applyLanguage();
    this.scheduleRecovery();
    this.view.focus();
    void this.checkActiveDisk();
  }

  private newFile(): void {
    const names = new Set(this.docs.map((doc) => doc.name));
    let name = 'Untitled', n = 2;
    while (names.has(name)) name = `Untitled ${n++}`;
    const doc = this.makeDoc(name);
    this.docs.push(doc); this.switchDoc(doc.id);
    this.toast('A fresh page, just for you.');
  }

  private async openFiles(): Promise<void> {
    try {
      const result = await pickFiles();
      const failures = [...result.failures];
      for (const file of result.files) {
        try { await this.addOpened(file); }
        catch (error) { failures.push({ name: file.name, message: this.errorText(error) }); }
      }
      this.reportOpenFailures(failures);
    } catch (error) { this.toast(`Could not open file picker: ${this.errorText(error)}`); }
  }

  private reportOpenFailures(failures: OpenFailure[]): void {
    if (!failures.length) return;
    const dialog = $<HTMLDialogElement>('#open-errors-dialog');
    const list = $('#open-errors-list');
    if (!dialog.open) list.replaceChildren();
    $('#open-errors-summary').textContent = 'Files that could be opened are available in tabs. The files below were not opened or changed.';
    for (const failure of failures) {
      const item = el('li');
      const name = el('strong'); name.textContent = failure.name;
      const reason = el('span'); reason.textContent = failure.message;
      item.append(name, reason); list.append(item);
    }
    if (!dialog.open) {
      dialog.showModal();
      $<HTMLButtonElement>('#open-errors-dialog .modal-actions button').focus();
    }
  }

  private async addOpened(file: OpenedFile): Promise<void> {
    if (file.ref.kind === 'native') {
      const path = file.ref.path;
      const same = this.docs.find((doc) => doc.ref?.kind === 'native' && doc.ref.path.toLowerCase() === path.toLowerCase());
      if (same) { this.switchDoc(same.id); this.recordRecent(path); return; }
    } else if (file.ref.kind === 'browser') {
      for (const current of this.docs) {
        if (current.ref?.kind !== 'browser') continue;
        let same = current.ref.handle === file.ref.handle;
        if (!same && typeof current.ref.handle.isSameEntry === 'function') {
          try { same = await current.ref.handle.isSameEntry(file.ref.handle); } catch { /* treat unavailable identity as distinct */ }
        }
        if (same) { this.switchDoc(current.id); return; }
      }
    }
    const decoded = decodeFile(file.bytes);
    const hash = await sha256(file.bytes);
    const doc = this.makeDoc(file.name, decoded.text, { ref: file.ref, displayPath: file.displayPath, encoding: decoded.encoding, lineEnding: decoded.lineEnding, mixed: decoded.mixedLineEndings, hash });
    // Replace an unused empty untitled buffer, without throwing away anything typed.
    const empty = this.docs.find((item) => !item.ref && !item.sample && !this.dirty(item) && item.state.doc.length === 0);
    this.docs.push(doc);
    // Switch while the old document still exists: update listeners must never target a different tab.
    this.switchDoc(doc.id);
    if (empty) { this.docs.splice(this.docs.indexOf(empty), 1); this.renderAll(); this.scheduleRecovery(); }
    if (file.ref.kind === 'native') this.recordRecent(file.ref.path);
    if (decoded.mixedLineEndings) this.toast(`Mixed line endings detected in ${file.name}. Saving will normalize them to ${decoded.lineEnding}.`);
  }

  private recordRecent(path: string): void {
    if (!this.settings.rememberRecent || this.settingsReadFailed) return;
    this.settings.recentFiles = [path, ...this.settings.recentFiles.filter((item) => item.toLowerCase() !== path.toLowerCase())].slice(0, 20);
    this.persistSettings();
  }

  private async openRecent(path: string): Promise<void> {
    try { await this.addOpened(await readNative(path)); }
    catch (error) { this.reportOpenFailures([{ name: path, message: this.errorText(error) }]); }
  }

  private async openWorkspaceFile(entry: WorkspaceFile, line?: number, column?: number): Promise<Doc | null> {
    try {
      const opened = await readWorkspaceFile(entry);
      await this.addOpened(opened);
      const openedDoc = this.docs.find((doc) => this.sameRefPath(doc, entry)) ?? this.active;
      if (line) {
        const doc = this.active;
        if (this.dirty(doc)) this.toast('Search results refer to the saved file; unsaved changes may shift the line.');
        else if (doc.hash && await sha256(opened.bytes) !== doc.hash) this.toast('The file changed on disk since it was opened; this saved-file result may not match the editor.');
        if (!this.docs.includes(doc)) return openedDoc;
        if (this.activeId !== doc.id) this.switchDoc(doc.id);
        this.goToLine(line, column);
      }
      return openedDoc;
    } catch (error) { this.reportOpenFailures([{ name: entry.relative, message: this.errorText(error) }]); return null; }
  }

  private goToLine(line: number, column = 1): void {
    const number = Math.max(1, Math.min(this.view.state.doc.lines, Math.trunc(line)));
    const target = this.view.state.doc.line(number);
    const position = Math.min(target.to, target.from + Math.max(0, Math.trunc(column) - 1));
    this.view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
    this.view.focus();
  }

  private captureReviewSelection(): ReviewTarget {
    const selection = this.view.state.selection;
    if (selection.ranges.length !== 1) throw new Error('Select one continuous range of text to review.');
    const range = selection.main;
    const doc = this.active;
    return makeReviewTarget(doc.id, doc.revision, refPath(doc.ref) || doc.displayPath || doc.name, range.from, range.to, this.view.state.sliceDoc(range.from, range.to));
  }

  private reviewIsCurrent(target: ReviewTarget): boolean {
    const doc = this.docs.find((item) => item.id === target.docId);
    if (!doc || target.to > doc.state.doc.length) return false;
    return reviewTargetIsCurrent(target, doc.id, doc.revision, doc.state.sliceDoc(target.from, target.to));
  }

  private applyReviewedChange(target: ReviewTarget, replacement: string): void {
    if (!this.reviewIsCurrent(target)) throw new Error('The target document changed or was closed. Select it again before applying.');
    if (target.docId !== this.activeId) this.switchDoc(target.docId);
    this.view.dispatch({
      changes: { from: target.from, to: target.to, insert: replacement },
      selection: { anchor: target.from + replacement.length },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.morrow-review',
    });
    this.view.focus();
  }

  private async saveDoc(doc: Doc, saveAs = false): Promise<boolean> {
    if (doc.saving) { this.toast('This file is already being saved.'); return false; }
    doc.saving = true;
    try {
      if (doc.mixedLineEndings) {
        const choice = await this.confirm('Mixed line endings', `This file contains more than one line-ending style. Saving will normalize every line to ${doc.lineEnding}. The original mix cannot be preserved. Continue?`, [
          { id: 'cancel', label: 'Cancel' }, { id: 'continue', label: 'Save anyway', style: 'primary' },
        ], 'CHECK BEFORE SAVING');
        if (choice !== 'continue') return false;
      }
      let target = !saveAs && doc.ref && doc.ref.kind !== 'download' ? { name: doc.name, ref: doc.ref } : await chooseSaveTarget(doc.name.startsWith('Untitled') ? 'Untitled.txt' : doc.name);
      if (!target) return false;
      const textAtSave = doc.state.doc;
      const encodingAtSave = doc.encoding, endingAtSave = doc.lineEnding;
      const bytes = encodeFile(textAtSave.toString(), encodingAtSave, endingAtSave);
      let sameTarget = await this.sameRef(doc.ref, target.ref);
      let expected = sameTarget ? doc.hash : null;
      let digest: string;
      for (;;) {
        try { digest = await writeTo(target.ref, bytes, target.name, expected); break; }
        catch (error) {
          if (!(error instanceof ExternalChangeError)) throw error;
          const choice = await this.confirm('File changed on disk', `“${target.name}” already exists, changed outside Morrow, or was removed since it was opened. Overwriting may lose changes.`, [
            { id: 'cancel', label: 'Cancel' }, { id: 'save-as', label: 'Save a copy' }, { id: 'overwrite', label: 'Overwrite', style: 'danger' },
          ], 'CHECK BEFORE SAVING');
          if (choice === 'cancel') return false;
          if (choice === 'save-as') {
            const newTarget = await chooseSaveTarget(doc.name); if (!newTarget) return false;
            target = newTarget; sameTarget = await this.sameRef(doc.ref, target.ref); expected = sameTarget ? doc.hash : null;
            // Even choosing the same file or an existing copy must be checked again.
            continue;
          }
          if (choice !== 'overwrite') return false;
          digest = await writeTo(target.ref, bytes, target.name, expected, true); break;
        }
      }
      if (!sameTarget) doc.displayPath = null;
      doc.ref = target.ref; doc.name = target.name; doc.hash = digest; doc.sample = false;
      this.diskChecks.delete(doc.id); ++this.diskCheckSerial;
      if (target.ref.kind === 'native') this.recordRecent(target.ref.path);
      doc.savedDoc = textAtSave; doc.savedEncoding = encodingAtSave; doc.savedLineEnding = endingAtSave; doc.mixedLineEndings = false;
      this.renderAll(); if (doc.id === this.activeId) void this.applyLanguage();
      this.scheduleRecovery();
      this.toast(target.ref.kind === 'download' ? 'A copy was downloaded. Browser preview cannot overwrite the original file.' : `Saved ${doc.name}.`);
      return true;
    } catch (error) { this.toast(`Could not save ${doc.name}: ${this.errorText(error)}`); return false; }
    finally { doc.saving = false; }
  }

  private async sameRef(a: FileRef | null, b: FileRef): Promise<boolean> {
    if (!a || a.kind !== b.kind) return false;
    if (a.kind === 'native' && b.kind === 'native') {
      const key = (path: string) => /^(?:[a-z]:[\\/]|\\\\)/iu.test(path) ? path.replace(/\//gu, '\\').toLowerCase() : path;
      return key(a.path) === key(b.path);
    }
    if (a.kind === 'browser' && b.kind === 'browser') {
      if (a.handle === b.handle) return true;
      try {
        if (typeof a.handle.isSameEntry === 'function') return await a.handle.isSameEntry(b.handle);
      } catch { /* Never silently skip a conflict check when identity is unknown. */ }
      throw new Error('Cannot verify whether this is the same file. Save to a different destination or reopen the file.');
    }
    return false;
  }

  private async confirmClose(doc: Doc): Promise<boolean> {
    if (doc.saving) { this.toast('Wait for the file to finish saving.'); return false; }
    if (!this.dirty(doc)) return true;
    const choice = await this.confirm('Save your changes?', `“${doc.name}” has unsaved changes. Save them before closing this tab?`, [
      { id: 'cancel', label: 'Cancel' }, { id: 'discard', label: 'Don’t save', style: 'danger' }, { id: 'save', label: 'Save changes', style: 'primary' },
    ]);
    if (choice === 'discard') return true;
    if (choice === 'save') {
      if (!(await this.saveDoc(doc))) return false;
      // An asynchronous save writes a snapshot. Never close if the user edited
      // the document again while the dialog or file write was in progress.
      if (this.dirty(doc)) { this.toast('The document changed while saving. Save again before closing.'); return false; }
      return true;
    }
    return false;
  }
  private async closeDoc(id: string): Promise<void> {
    const doc = this.docs.find((item) => item.id === id); if (!doc || !(await this.confirmClose(doc))) return;
    const index = this.docs.indexOf(doc); const wasActive = doc.id === this.activeId;
    this.docs.splice(index, 1); this.diskChecks.delete(doc.id); ++this.diskCheckSerial;
    if (!this.docs.length) this.docs.push(this.makeDoc('Untitled'));
    if (wasActive) {
      // switchDoc needs a valid old active document while clearing ghost.
      this.activeId = this.docs[Math.min(index, this.docs.length - 1)].id;
      this.cancelAi(); this.view.setState(this.active.state); this.applyEditorPreferences();
      if (this.findOpen) { openSearchPanel(this.view); this.updateSearchQuery(); }
      void this.applyLanguage(); this.view.focus();
    }
    this.renderAll(); this.scheduleRecovery(); void this.checkActiveDisk();
  }

  private fileBadge(name: string): HTMLElement {
    const lower = name.toLowerCase();
    let label = 'TXT', kind = 'other';
    if (/\.pyw?$/.test(lower)) { label = 'PY'; kind = ''; }
    else if (/\.(md|markdown|mdx)$/.test(lower)) { label = 'MD'; kind = 'md'; }
    else if (/\.(js|jsx|mjs|cjs)$/.test(lower)) { label = 'JS'; kind = 'js'; }
    else if (/\.(ts|tsx)$/.test(lower)) { label = 'TS'; kind = 'md'; }
    else if (/\.(json|ya?ml|toml|xml)$/.test(lower)) { label = '{}'; kind = 'data'; }
    else if (/\.(html|htm)$/.test(lower)) { label = '<>'; kind = 'js'; }
    else if (/\.css$/.test(lower)) { label = '#'; kind = 'md'; }
    else if (/\.rs$/.test(lower)) { label = 'RS'; kind = 'js'; }
    else if (/\.go$/.test(lower)) { label = 'GO'; kind = 'md'; }
    else if (/\.java$/.test(lower)) { label = 'JV'; kind = 'js'; }
    else if (/\.(c|cpp|h|hpp|cs)$/.test(lower)) { label = 'C'; kind = 'data'; }
    const badge = el('span', `file-icon ${kind}`); badge.textContent = label; badge.setAttribute('aria-hidden', 'true'); return badge;
  }

  private renderFiles(): void {
    const tabs = $('#tabs'), list = $('#file-list');
    tabs.replaceChildren(); list.replaceChildren();
    const nameCounts = new Map<string, number>(), labelCounts = new Map<string, number>();
    for (const doc of this.docs) nameCounts.set(doc.name.toLowerCase(), (nameCounts.get(doc.name.toLowerCase()) || 0) + 1);
    for (const doc of this.docs) {
      const fullPath = refPath(doc.ref) || doc.displayPath;
      const parent = fullPath?.match(/^(.*)[\\/][^\\/]+$/u)?.[1] || (doc.sample ? 'example' : 'unsaved');
      let displayName = (nameCounts.get(doc.name.toLowerCase()) || 0) > 1 ? `${doc.name} · ${parent}` : doc.name;
      const labelKey = displayName.toLowerCase();
      const labelCount = (labelCounts.get(labelKey) || 0) + 1; labelCounts.set(labelKey, labelCount);
      if (labelCount > 1) displayName += ` (${labelCount})`;
      const active = doc.id === this.activeId, dirty = this.dirty(doc);
      const tab = el('div', `tab${active ? ' active' : ''}`);
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      tab.title = fullPath || `${doc.name}${doc.sample ? ' (example)' : ''}`;
      tab.append(this.fileBadge(doc.name));
      const tabName = el('span', 'tab-name'); tabName.textContent = displayName; tab.append(tabName);
      if (dirty) { const dot = el('span', 'dirty-dot'); dot.title = 'Unsaved changes'; tab.append(dot); }
      const close = el('button', 'tab-close'); close.type = 'button'; close.innerHTML = icon('close', 13); close.setAttribute('aria-label', `Close ${doc.name}`); close.title = `Close ${doc.name}`;
      close.addEventListener('click', (event) => { event.stopPropagation(); void this.closeDoc(doc.id); });
      tab.append(close); tab.addEventListener('click', () => this.switchDoc(doc.id));
      tab.addEventListener('keydown', (event) => {
        // A close button is nested inside the tab: never intercept its Enter/Space.
        if (event.target !== tab) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.switchDoc(doc.id); return; }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = this.docs.findIndex((item) => item.id === doc.id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.docs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.docs.length) % this.docs.length;
        this.switchDoc(this.docs[next].id);
        tabs.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
      });
      tabs.append(tab);

      const item = el('button', `file-list-item${active ? ' active' : ''}`); item.type = 'button'; item.setAttribute('role', 'listitem');
      item.title = fullPath || doc.name; item.append(this.fileBadge(doc.name));
      const itemName = el('span', 'file-list-name'); itemName.textContent = displayName; item.append(itemName);
      if (dirty) { const dot = el('span', 'dirty-dot'); dot.title = 'Unsaved changes'; item.append(dot); }
      else if (doc.sample) { const tag = el('span', 'file-list-state'); tag.textContent = 'SAMPLE'; item.append(tag); }
      item.addEventListener('click', () => this.switchDoc(doc.id)); list.append(item);
    }
    $('#file-count').textContent = String(this.docs.length);
    const doc = this.active;
    $('#breadcrumb-file').textContent = doc.name;
    $('#breadcrumb-root').textContent = doc.sample ? 'EXAMPLES' : 'YOUR FILES';
    $('#toolbar-dirty').hidden = !this.dirty(doc);
    $('#example-banner').hidden = !doc.sample;
    const title = `${this.dirty(doc) ? '● ' : ''}${doc.name} — Morrow`;
    if (title !== this.lastTitle) {
      this.lastTitle = title; document.title = title;
      if (desktop) void getCurrentWindow().setTitle(title).catch(() => {});
    }
  }


  /* -------------------------------------------------------------------------------------- *
   * Writing surface: word statistics, goals, outline, focus modes and the minimap.
   * -------------------------------------------------------------------------------------- */

  /** Debounced statistics so typing stays responsive on a long note. */
  private scheduleStats(): void {
    window.clearTimeout(this.statsTimer);
    // Counting is O(n); on a huge buffer a longer debounce keeps typing smooth while the numbers
    // still catch up within a couple of seconds.
    const slow = (this.view?.state.doc.length ?? 0) > 400_000;
    this.statsTimer = window.setTimeout(() => this.refreshStats(), slow ? 1_400 : 220);
  }

  private refreshStats(): void {
    if (!this.view || !this.activeId) return;
    const doc = this.active;
    const text = doc.state.doc.toString();
    this.stats = countTextStats(text);
    $('#word-count').textContent = `${this.stats.words.toLocaleString()} ${this.stats.words === 1 ? 'word' : 'words'}`;
    const read = this.stats.readingMinutes ? ` · ${this.stats.readingMinutes} min read` : '';
    $('#read-stats').textContent = isLargeDocument(text.length)
      ? `${this.stats.characters.toLocaleString()} characters`
      : `${this.stats.characters.toLocaleString()} characters${read}`;
    $('#word-count').title = describeStats(this.stats);
    $('#read-stats').title = `${this.stats.paragraphs.toLocaleString()} paragraph(s) · ${this.stats.lines.toLocaleString()} line(s)`;
    this.goalTracker.record(doc.id, this.stats.words);
    this.renderGoal();
    this.refreshOutline(text);
    this.renderNotesPanel();
    this.drawMinimap();
  }

  private renderGoal(): void {
    const chip = $('#goal-chip');
    const status = this.goalTracker.status();
    if (!status.target) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.classList.toggle('met', status.met);
    $('#goal-text').textContent = status.met
      ? `${status.words.toLocaleString()}/${status.target.toLocaleString()} · goal met`
      : `${status.words.toLocaleString()}/${status.target.toLocaleString()} words today`;
    chip.title = status.met
      ? `Daily goal met — ${status.words.toLocaleString()} words written today.`
      : `${status.remaining.toLocaleString()} words to today's goal of ${status.target.toLocaleString()}.`;
    const value = $('#setting-goal-value');
    if (value) value.textContent = status.met ? `Met (${status.words.toLocaleString()})` : `${status.words.toLocaleString()} of ${status.target.toLocaleString()}`;
    this.persistGoal();
  }

  private persistGoal(): void {
    try { localStorage.setItem('morrow.goal.v1', JSON.stringify(this.goalTracker.toJSON())); }
    catch { /* A goal is optional; losing it must never block editing. */ }
  }

  private setGoal(target: number): void {
    this.goalTracker.setTarget(target);
    this.goalTracker.record(this.activeId, this.stats.words);
    this.persistGoal();
    this.renderGoal();
    $('#setting-goal-value').textContent = target ? `${this.goalTracker.words.toLocaleString()} of ${target.toLocaleString()}` : 'Off';
    this.toast(target ? `Daily goal set to ${target.toLocaleString()} words.` : 'Daily goal turned off.');
  }

  private refreshOutline(text: string): void {
    const doc = this.active;
    if (!isMarkdownName(doc.name)) { this.outline = []; this.outlineKey = ''; this.renderOutline(); return; }
    // Recompute only when the heading-bearing text changed, not on every keystroke.
    const key = `${doc.id}:${doc.revision}:${text.length}`;
    if (key === this.outlineKey) return;
    this.outlineKey = key;
    this.outline = extractOutline(text, { underline: /\.txt$/iu.test(doc.name) }).headings;
    this.renderOutline();
  }

  private renderOutline(): void {
    const list = $('#outline-list');
    if (!list) return;
    list.replaceChildren();
    $('#outline-empty').hidden = this.outline.length > 0;
    const doc = this.active;
    const current = this.view ? headingAt(this.outline, doc.state.doc.lineAt(doc.state.selection.main.head).number - 1) : null;
    for (const heading of this.outline) {
      const item = el('li', `level-${heading.level}`);
      const button = el('button'); button.type = 'button';
      button.textContent = heading.text || '(untitled heading)';
      button.title = `Line ${heading.line + 1}`;
      if (current && current.line === heading.line) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => this.goToLine(heading.line + 1));
      item.append(button);
      list.append(item);
    }
  }

  private renderNotesPanel(): void {
    const panel = $('#notes-panel');
    panel.hidden = !this.notesOpen;
    $('#notes-chip').setAttribute('aria-pressed', String(this.notesOpen));
    if (!this.notesOpen) return;
    for (const tab of ['outline', 'tags', 'links'] as const) {
      $(`#notes-tab-${tab}`).setAttribute('aria-selected', String(this.notesTab === tab));
      $(`#notes-view-${tab}`).hidden = this.notesTab !== tab;
    }
    // Only the visible tab is rebuilt; the other views refresh when they are selected.
    if (this.notesTab === 'tags') this.renderTags();
    if (this.notesTab === 'links') this.renderLinks();
  }

  private renderTags(): void {
    const doc = this.active;
    const tags = collectTags(doc.state.doc.toString());
    const list = $('#note-tags');
    list.replaceChildren();
    if (!tags.length) {
      const empty = el('li', 'notes-hint'); empty.textContent = 'No tags in this note yet.'; list.append(empty);
    }
    for (const tag of tags) {
      const item = el('li');
      const button = el('button'); button.type = 'button';
      button.append(document.createTextNode(`#${tag}`));
      button.title = `Show notes tagged #${tag}`;
      button.addEventListener('click', () => void this.showNotesWithTag(tag));
      item.append(button); list.append(item);
    }
    const all = this.noteIndex.tagIndex();
    const allList = $('#all-tags');
    allList.replaceChildren();
    $('#index-status').textContent = this.indexStatusText();
    $('#all-tags-heading').hidden = all.length === 0;
    for (const entry of all.slice(0, 40)) {
      const item = el('li');
      const button = el('button'); button.type = 'button';
      button.append(document.createTextNode(`#${entry.tag}`));
      const count = el('span', 'tag-count'); count.textContent = String(entry.count);
      button.append(count);
      button.title = entry.notes.slice(0, 8).map((note) => note.relative).join('\n');
      button.addEventListener('click', () => void this.showNotesWithTag(entry.tag));
      item.append(button); allList.append(item);
    }
  }

  private indexStatusText(): string {
    if (this.indexBusy) return 'Indexing folder notes…';
    if (!this.noteIndex.size) return this.workbench.workspaceNames().length
      ? 'No folder notes indexed yet. Choose “Index this folder’s notes” to enable backlinks and the tag cloud.'
      : 'Open a folder first. The index reads only folders you chose, stays on this machine and can be cleared.';
    if (this.indexStale) return `${this.noteIndex.size.toLocaleString()} notes indexed · out of date — reopen this panel to refresh.`;
    return `${this.noteIndex.size.toLocaleString()} notes indexed locally. Nothing is uploaded.`;
  }

  private renderLinks(): void {
    const doc = this.active;
    const text = doc.state.doc.toString();
    const links = extractWikiLinks(text);
    const outbound = $('#outbound-links'); outbound.replaceChildren();
    const candidates = this.noteIndex.candidates();
    if (!links.length) {
      const empty = el('li', 'notes-hint'); empty.textContent = 'No [[wiki links]] in this note yet.'; outbound.append(empty);
    }
    for (const link of links.slice(0, 60)) {
      const resolved = resolveWikiTarget(link.target, candidates);
      const item = el('li');
      const button = el('button'); button.type = 'button';
      if (resolved.status !== 'linked') button.classList.add(resolved.status === 'ambiguous' ? 'ambiguous' : 'broken');
      const label = el('span', 'link-target');
      label.textContent = link.alias || link.target || '(this note)';
      button.append(label);
      const line = el('span', 'link-line'); line.textContent = `L${link.line + 1}`;
      button.append(line);
      button.title = resolved.status === 'linked' ? `Open ${resolved.match!.relative ?? resolved.match!.name}`
        : resolved.status === 'ambiguous' ? `${resolved.matches} notes share this name; open one from Quick Open`
        : 'No note in the index matches this link yet';
      if (resolved.status === 'linked') button.addEventListener('click', () => void this.openIndexedNote(resolved.match!.name, resolved.match!.relative ?? resolved.match!.name));
      item.append(button); outbound.append(item);
    }

    const backlinks = $('#backlink-list'); backlinks.replaceChildren();
    const target = isMarkdownName(doc.name) ? doc.name : null;
    const found = target ? this.noteIndex.backlinksTo(target) : { backlinks: [], ambiguous: [] };
    if (!this.noteIndex.size) {
      const empty = el('li', 'notes-hint'); empty.textContent = 'Index your folder to see which notes link here.'; backlinks.append(empty);
    } else if (!found.backlinks.length && !found.ambiguous.length) {
      const empty = el('li', 'notes-hint'); empty.textContent = 'No indexed note links here yet.'; backlinks.append(empty);
    }
    for (const entry of found.backlinks.slice(0, 60)) {
      const item = el('li');
      const button = el('button'); button.type = 'button';
      const label = el('span', 'link-target'); label.textContent = entry.record.relative;
      button.append(label);
      const line = el('span', 'link-line'); line.textContent = `L${entry.link.line + 1}`;
      button.append(line);
      button.addEventListener('click', () => { void this.openIndexedNote(entry.record.name, entry.record.relative, entry.link.line + 1); });
      item.append(button); backlinks.append(item);
    }
    for (const entry of found.ambiguous.slice(0, 10)) {
      const item = el('li');
      const button = el('button', 'ambiguous'); button.type = 'button';
      const label = el('span', 'link-target'); label.textContent = `${entry.record.relative} (ambiguous link)`;
      button.append(label);
      button.title = 'More than one note shares this name, so Morrow does not pick one for you.';
      item.append(button); backlinks.append(item);
    }

    const orphans = $('#orphan-list'); orphans.replaceChildren();
    const orphanHeading = $('#orphan-heading');
    const orphanNotes = this.noteIndex.size ? this.noteIndex.orphans() : [];
    orphanHeading.hidden = orphanNotes.length === 0;
    for (const note of orphanNotes.slice(0, 40)) {
      const item = el('li');
      const button = el('button'); button.type = 'button';
      const label = el('span', 'link-target'); label.textContent = note.relative;
      button.append(label);
      button.addEventListener('click', () => { void this.openIndexedNote(note.name, note.relative); });
      item.append(button); orphans.append(item);
    }
  }

  private async showNotesWithTag(tag: string): Promise<void> {
    if (!this.noteIndex.size) { this.toast('Index a folder first to search notes by tag.'); return; }
    const notes = this.noteIndex.tagIndex().find((entry) => entry.tag === tag)?.notes ?? [];
    if (!notes.length) { this.toast(`No indexed note is tagged #${tag}.`); return; }
    if (notes.length === 1) { await this.openIndexedNote(notes[0].name, notes[0].relative); return; }
    const list = notes.map((note) => `• ${note.relative}`).join('\n');
    const choice = await this.confirm(`${notes.length} notes tagged #${tag}`, `${list}\n\nOpen the first one?`, [
      { id: 'cancel', label: 'Close' }, { id: 'open', label: 'Open first note', style: 'primary' },
    ], 'TAG SEARCH');
    if (choice === 'open') await this.openIndexedNote(notes[0].name, notes[0].relative);
  }

  private async openIndexedNote(name: string, relative: string, line?: number): Promise<void> {
    const rootName = this.workbench.workspaceNames()[0] ?? null;
    // `relative` already includes the extension, so it opens as-is.
    await this.openFolderNote(rootName, relative, '', line);
    void name;
  }

  /** Forget the index so the next panel open rebuilds it from disk. */
  private invalidateNoteIndex(): void {
    this.indexToken++;
    this.indexStale = true;
    this.renderNotesPanel();
  }

  private async buildNoteIndex(force = false): Promise<void> {
    if (this.indexBusy) return;
    if (!force && this.noteIndex.size && !this.indexStale) return;
    this.indexBusy = true;
    this.renderTags();
    const token = ++this.indexToken;
    try {
      const files = await this.workbench.indexableFiles();
      if (token !== this.indexToken) return;
      const next = new NoteIndex();
      for (const file of files) next.set({ name: file.name, relative: file.relative, rootName: file.rootName }, file.text);
      this.noteIndex = next;
      this.indexStale = false;
      $('#index-status').textContent = this.indexStatusText();
    } catch (error) {
      $('#index-status').textContent = `Could not index folder notes: ${this.errorText(error)}`;
    } finally {
      this.indexBusy = false;
      this.renderTags();
      this.renderLinks();
    }
  }

  /* Focus, typewriter and zen ------------------------------------------------------------- */

  private applyFocusModes(): void {
    const focus = this.settings.focus;
    document.documentElement.classList.remove(...FOCUS_CLASSES);
    for (const name of focusClassList(focus)) document.documentElement.classList.add(name);
    const chip = $('#focus-chip');
    chip.hidden = !isAnyFocusActive(focus);
    $('#focus-text').textContent = focusLabel(focus);
    $('#setting-focus').setAttribute('aria-checked', String(focus.focus));
    $('#setting-typewriter').setAttribute('aria-checked', String(focus.typewriter));
    $('#setting-focus-scope').textContent = `Scope: ${focus.scope}`;
    if (this.view) applyFocus(this.view, focus);
    this.scheduleTypewriterScroll();
  }

  private toggleFocus(part: keyof FocusSettings): void {
    if (part === 'scope') return;
    this.settings.focus = { ...this.settings.focus, [part]: !this.settings.focus[part] };
    this.persistSettings();
    this.applyFocusModes();
    this.toast(focusLabel(this.settings.focus));
  }

  /** Keep the caret near the vertical centre when typewriter mode is on. */
  private scheduleTypewriterScroll(): void {
    if (!this.settings.focus.typewriter || !this.view) return;
    window.cancelAnimationFrame(this.typewriterRaf);
    this.typewriterRaf = window.requestAnimationFrame(() => {
      const view = this.view;
      if (!view) return;
      const head = view.state.selection.main.head;
      const height = view.scrollDOM.clientHeight;
      const block = view.lineBlockAt(head);
      const target = block.top - height / 2 + block.height / 2;
      const scroller = view.scrollDOM;
      const desired = Math.max(0, Math.min(scroller.scrollHeight - height, scroller.scrollTop + target));
      if (Math.abs(desired - scroller.scrollTop) > 4) scroller.scrollTop = desired;
    });
  }

  /* Minimap -------------------------------------------------------------------------------- */

  private drawMinimap(): void {
    const holder = $('#minimap');
    const canvas = this.minimapCanvas ?? ($('#minimap-canvas') as HTMLCanvasElement);
    this.minimapCanvas = canvas;
    if (!this.view || !this.active) { holder.hidden = true; return; }
    const text = this.active.state.doc.toString();
    holder.hidden = !minimapAvailable(text.length, this.settings.minimap);
    if (holder.hidden) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const height = Math.max(200, holder.clientHeight);
    canvas.width = Math.floor(holder.clientWidth * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, holder.clientWidth, height);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--dim').trim() || '#888';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-strong').trim() || '#aaa';
    const bars = buildMinimapBars(text, Math.min(240, Math.max(40, Math.floor(height / 3))));
    const barHeight = Math.max(1, height / Math.max(1, bars.length) - 1);
    context.fillStyle = color;
    context.globalAlpha = 0.55;
    for (const bar of bars) {
      if (bar.width <= 0) continue;
      context.fillRect(2, bar.y * height, Math.max(1, (holder.clientWidth - 4) * bar.width), barHeight);
    }
    context.globalAlpha = 1;
    // Viewport marker, so the map answers "where am I" as well as "what is where".
    const lines = this.active.state.doc.lines;
    // Measuring the caret keeps this cheap on very large files, where blocks are not laid out.
    const caret = this.active.state.selection.main.head;
    const caretLine = this.active.state.doc.lineAt(caret).number;
    const caretPos = Math.max(1, Math.min(lines, caretLine));
    const visible = Math.max(1, Math.floor(this.view.scrollDOM.clientHeight / Math.max(14, this.settings.fontSize)));
    const fraction = viewportFraction(lines, visible);
    const top = ((caretPos - 1) / lines) * height;
    context.strokeStyle = accent;
    context.lineWidth = 1;
    context.strokeRect(1.5, top + 0.5, holder.clientWidth - 3, Math.max(8, fraction * height));
  }

  private openGoalDialog(): void {
    $<HTMLInputElement>('#goal-input').value = String(this.goalTracker.target || 500);
    $('#goal-status').textContent = this.goalTracker.enabled
      ? `${this.goalTracker.words.toLocaleString()} words written today. Set 0 to turn the goal off.`
      : 'No goal set. A common starting point is 500 words a day.';
    this.showDialog('goal-dialog');
    $<HTMLInputElement>('#goal-input').focus();
  }

  private bindMinimap(): void {
    const holder = $('#minimap');
    holder.addEventListener('click', (event) => {
      if (!this.view) return;
      const rect = holder.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      const lines = this.view.state.doc.lines;
      this.goToLine(Math.max(1, Math.round(fraction * lines)));
    });
    this.view.scrollDOM.addEventListener('scroll', () => {
      if (this.settings.minimap) this.drawMinimap();
    }, { passive: true });
  }

  /* Markdown editing commands -------------------------------------------------------------- */

  private applyTextEdit(edit: TextEdit | null): void {
    if (!edit) { this.toast('That command does not apply here.'); return; }
    this.view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.selection.from, head: edit.selection.to },
      scrollIntoView: true,
      userEvent: 'input.format',
    });
    this.view.focus();
  }

  private runFormat(action: string): void {
    if (!this.view) return;
    const text = this.view.state.doc.toString();
    const span = { from: this.view.state.selection.main.from, to: this.view.state.selection.main.to };
    switch (action) {
      case 'bold': this.applyTextEdit(toggleBold(text, span)); return;
      case 'italic': this.applyTextEdit(toggleItalic(text, span)); return;
      case 'code': this.applyTextEdit(toggleInlineCode(text, span)); return;
      case 'strike': this.applyTextEdit(toggleStrikethrough(text, span)); return;
      case 'link': this.applyTextEdit(wrapLink(text, span)); return;
      case 'quote': this.applyTextEdit(toggleQuote(text, span)); return;
      case 'bullets': this.applyTextEdit(toggleBulletList(text, span)); return;
      case 'numbers': this.applyTextEdit(toggleNumberedList(text, span)); return;
      case 'tasks': this.applyTextEdit(toggleTaskList(text, span)); return;
      case 'code-block': this.applyTextEdit(wrapCodeBlock(text, span)); return;
      case 'smart-typography': {
        const selected = text.slice(span.from, span.to);
        if (!selected) { this.toast('Select text to convert its quotes and dashes.'); return; }
        const converted = applySmartTypography(selected);
        if (converted === selected) { this.toast('Nothing to convert in the selection.'); return; }
        this.applyTextEdit({ from: span.from, to: span.to, insert: converted, selection: span });
        return;
      }
      case 'heading': this.applyTextEdit(toggleHeading(text, span)); return;
      default:
        if (action.startsWith('heading-')) this.applyTextEdit(toggleHeading(text, span, Number(action.slice(-1))));
        else if (action.startsWith('line-')) this.applyTextEdit(applyLineOperation(text, span, action.slice(5) as LineOperation));
    }
  }

  /* Notes: capture, daily notes, templates ------------------------------------------------- */

  private async openFolderNote(rootName: string | null, relative: string, template: string, line?: number): Promise<void> {
    if (!this.workbench.workspaceNames().length) {
      this.toast('Open a folder first — folder notes live inside the folder you chose.');
      return;
    }
    try {
      // The workbench owns file creation so a template is written through one bounded path.
      const result = await this.workbench.ensureFolderNote(rootName, relative, template);
      const doc = await this.openWorkspaceFile(result.file);
      if (!doc) return;
      if (line) this.goToLine(line);
      if (!result.created) this.toast(`${relative} is already in your folder — opened it instead of overwriting.`);
    } catch (error) { this.toast(`Could not open ${relative}: ${this.errorText(error)}`); }
    finally { this.invalidateNoteIndex(); }
  }

  private async appendToFolderNote(rootName: string | null, relative: string, text: string, header = ''): Promise<void> {
    if (!this.workbench.workspaceNames().length) { this.toast('Open a folder first — capture writes into it.'); return; }
    try {
      const result = await this.workbench.appendToNote(rootName, relative, text, header);
      // Re-read through the ordinary open path so an already-open tab is replaced by the
      // version on disk; a stale tab would otherwise save over the capture.
      const open = this.docs.find((doc) => this.sameRefPath(doc, result.file));
      if (open) await this.replaceDocFromDisk(open);
      else await this.openWorkspaceFile(result.file);
      this.toast(result.created ? `Captured to a new ${relative}.` : `Captured to ${relative}.`);
    } catch (error) { this.toast(`Could not capture: ${this.errorText(error)}`); }
    finally { this.invalidateNoteIndex(); }
  }

  /** Swap an open tab's text for the file on disk, keeping the tab and its cursor line. */
  private async replaceDocFromDisk(doc: Doc): Promise<void> {
    const ref = doc.ref;
    if (!ref || ref.kind !== 'native') return;
    const revision = doc.revision;
    const file = await readNative(ref.path);
    if (doc.revision !== revision || this.docs.includes(doc) === false) return;
    const decoded = decodeFile(file.bytes);
    const line = doc.state.doc.lineAt(Math.min(doc.state.selection.main.head, doc.state.doc.length)).number;
    doc.state = createEditorState(decoded.text, this.settings, (update) => this.onEditorUpdate(update), doc.state.selection.main.head);
    doc.savedDoc = doc.state.doc;
    doc.encoding = doc.savedEncoding = decoded.encoding;
    doc.lineEnding = doc.savedLineEnding = decoded.lineEnding;
    doc.mixedLineEndings = decoded.mixedLineEndings;
    doc.hash = await sha256(file.bytes); doc.revision++;
    if (doc.id === this.activeId) {
      this.view.setState(doc.state);
      this.applyEditorPreferences();
      this.goToLine(Math.min(line, doc.state.doc.lines));
    }
    this.renderAll(); void this.applyLanguage(); this.scheduleRecovery();
  }

  private sameRefPath(doc: Doc, file: WorkspaceFile): boolean {
    if (!doc.ref || doc.ref.kind !== file.kind) return false;
    if (doc.ref.kind === 'native' && file.kind === 'native') return doc.ref.path.toLowerCase() === file.path.toLowerCase();
    return false;
  }

  private capturePath(): string {
    const raw = this.settings.capturePath.trim();
    if (raw && isSafeRelativePath(raw)) return raw.endsWith('.md') ? raw : `${raw}.md`;
    return 'Inbox.md';
  }

  private openCapture(): void {
    if (!this.workbench.workspaceNames().length) { this.toast('Open a folder first — quick capture writes into it.'); return; }
    $('#capture-target-name').textContent = this.capturePath();
    $<HTMLTextAreaElement>('#capture-text').value = '';
    $<HTMLInputElement>('#capture-task').checked = false;
    $('#capture-status').textContent = '';
    this.showDialog('capture-dialog');
    $<HTMLTextAreaElement>('#capture-text').focus();
  }

  private async submitCapture(): Promise<void> {
    const text = $<HTMLTextAreaElement>('#capture-text').value.trim();
    if (!text) { $('#capture-status').textContent = 'Write something first — an empty capture is not appended.'; return; }
    if (text.length > 20_000) { $('#capture-status').textContent = 'Captures are limited to 20,000 characters.'; return; }
    const asTasks = $<HTMLInputElement>('#capture-task').checked;
    const now = new Date();
    const body = text.split('\n').map((line) => asTasks && line.trim() && !/^\s*[-*+]\s/u.test(line) ? `- [ ] ${line.trim()}` : line).join('\n');
    const block = `${DEFAULT_CAPTURE_SNIPPET.replace(/\{\{\s*time\s*\}\}/giu, isoTime(now))}${body}\n`;
    const button = $<HTMLButtonElement>('#capture-submit');
    button.disabled = true;
    $('#capture-status').textContent = 'Appending…';
    try {
      await this.appendToFolderNote(null, this.capturePath(), block);
      $<HTMLDialogElement>('#capture-dialog').close();
    } catch (error) { $('#capture-status').textContent = this.errorText(error); }
    finally { button.disabled = false; }
  }

  private openDailyNote(): void {
    if (!this.workbench.workspaceNames().length) { this.toast('Open a folder first — today’s note is written into it.'); return; }
    const now = new Date();
    const relative = `${dailyNotePath(this.settings.daily.format, now, this.settings.daily.folder)}.md`;
    const title = humanDate(now);
    const template = this.settings.daily.template || DEFAULT_DAILY_TEMPLATE;
    void this.openFolderNote(null, relative, expandDailyTemplate(template, now, title));
  }

  private openTemplateDialog(kind: 'daily' | 'template'): void {
    if (!this.workbench.workspaceNames().length) { this.toast('Open a folder first — new notes are written into it.'); return; }
    const now = new Date();
    $('#note-dialog-eyebrow').textContent = kind === 'daily' ? "TODAY'S NOTE" : 'NEW NOTE FROM TEMPLATE';
    $('#note-dialog-title').textContent = kind === 'daily' ? "Today's note" : 'Create a note';
    $('#note-dialog-intro').textContent = kind === 'daily'
      ? 'Creates today’s dated note in your folder using the template below. An existing note with that name is opened, never overwritten.'
      : 'Creates a note from the template below inside your chosen folder. An existing file is opened, never overwritten.';
    $<HTMLInputElement>('#note-name').value = kind === 'daily' ? dailyNotePath(this.settings.daily.format, now, '') : '';
    $<HTMLInputElement>('#note-folder').value = this.settings.daily.folder;
    $<HTMLTextAreaElement>('#note-template').value = this.settings.daily.template;
    $('#note-create').textContent = 'Create and open';
    $('#note-dialog-status').textContent = '';
    this.showDialog('note-dialog');
    $<HTMLInputElement>(kind === 'daily' ? '#note-template' : '#note-name').focus();
  }

  private async submitNoteDialog(): Promise<void> {
    const name = $<HTMLInputElement>('#note-name').value.trim();
    const folder = $<HTMLInputElement>('#note-folder').value.trim();
    const template = $<HTMLInputElement>('#note-use-template').checked ? $<HTMLTextAreaElement>('#note-template').value : '';
    if (!name) { $('#note-dialog-status').textContent = 'Give the note a name.'; return; }
    if (/[\\/]/u.test(name) || /[<>:"|?*\u0000-\u001f]/u.test(name)) { $('#note-dialog-status').textContent = 'Use one file name without slashes or special characters.'; return; }
    if (folder && !isSafeRelativePath(folder)) { $('#note-dialog-status').textContent = 'The folder path is not valid.'; return; }
    const relative = `${folder ? `${folder.replace(/^[\\/]+|[\\/]+$/gu, '')}/` : ''}${name.endsWith('.md') ? name : `${name}.md`}`;
    const now = new Date();
    const body = template ? expandDailyTemplate(template, now, name.replace(/\.md$/iu, '')) : '';
    $<HTMLButtonElement>('#note-create').disabled = true;
    $('#note-dialog-status').textContent = 'Creating…';
    try {
      await this.openFolderNote(null, relative, body);
      this.settings.daily.template = $<HTMLTextAreaElement>('#note-template').value.slice(0, 50_000);
      this.settings.daily.folder = folder;
      this.persistSettings();
      $<HTMLDialogElement>('#note-dialog').close();
    } catch (error) { $('#note-dialog-status').textContent = this.errorText(error); }
    finally { $<HTMLButtonElement>('#note-create').disabled = false; }
  }

  private showTabOutline(): void {
    const text = this.active.state.doc.toString();
    const headings = extractOutline(text, { underline: /\.txt$/iu.test(this.active.name) }).headings;
    const input = $<HTMLInputElement>('#outline-input');
    input.value = '';
    const render = () => {
      const results = $('#outline-results');
      results.replaceChildren();
      const matched = rankHeadings(headings, input.value, 60);
      if (!matched.length) {
        const empty = el('p', 'notes-hint');
        empty.textContent = headings.length ? 'No heading matches that filter.' : 'This note has no headings yet. Start a line with # or use Ctrl+Shift+1.';
        results.append(empty);
        return;
      }
      for (const heading of matched) {
        const button = el('button'); button.type = 'button'; button.setAttribute('role', 'option');
        button.textContent = `${'·'.repeat(Math.max(0, heading.level - 1))}${'·'.repeat(heading.level > 1 ? 1 : 0)}${heading.text}`;
        button.title = `Line ${heading.line + 1}`;
        button.addEventListener('click', () => { $<HTMLDialogElement>('#outline-dialog').close(); this.goToLine(heading.line + 1); });
        results.append(button);
      }
    };
    render();
    input.oninput = render;
    input.onkeydown = (event) => {
      if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); document.querySelector<HTMLButtonElement>('#outline-results button')?.click(); }
    };
    $('#outline-status').textContent = headings.length
      ? `${headings.length} heading${headings.length === 1 ? '' : 's'} in this note.`
      : 'No headings found.';
    this.showDialog('outline-dialog');
    input.focus();
  }

  private toggleNotesPanel(): void {
    this.notesOpen = !this.notesOpen;
    this.renderNotesPanel();
    this.view?.requestMeasure();
    if (this.notesOpen) void this.buildNoteIndex();
  }

  private selectNotesTab(tab: 'outline' | 'tags' | 'links'): void {
    this.notesTab = tab;
    this.renderNotesPanel();
    this.view?.requestMeasure();
    if (tab !== 'outline') void this.buildNoteIndex();
  }

  /* Zoom ----------------------------------------------------------------------------------- */

  private zoom(delta: number | 'reset'): void {
    const next = delta === 'reset' ? 14 : Math.max(11, Math.min(28, this.settings.fontSize + delta));
    if (next === this.settings.fontSize) return;
    this.settings.fontSize = next;
    this.persistSettings();
    this.toast(`Editor text ${next}px`);
  }

  private updateStatus(): void {
    if (!this.view || !this.active) return;
    const doc = this.active;
    const position = doc.state.selection.main.head;
    const line = doc.state.doc.lineAt(position);
    $('#position').textContent = `Ln ${line.number}, Col ${position - line.from + 1}`;
    $('#status-language').textContent = languageLabel(doc.name, doc.override);
    $<HTMLSelectElement>('#encoding').value = doc.encoding;
    $<HTMLSelectElement>('#line-ending').value = doc.lineEnding;
    $<HTMLSelectElement>('#tab-size').value = String(this.settings.tabSize);
    const language = $<HTMLSelectElement>('#language');
    language.options[0].textContent = `Auto · ${languageLabel(doc.name, null)}`;
    language.value = doc.override || '__auto__';
  }

  private renderRecoveryStatus(): void {
    const status = $('#recovery-status');
    const label = this.settingsReadFailed ? 'Recovery paused — settings unavailable'
      : this.recoveryBlocked ? 'Recovery paused — save your work'
      : this.recoveryCleanupFailed && !this.settings.recovery ? 'Recovery off — old copy not removed'
      : this.recoveryFailed && this.settings.recovery ? 'Recovery unavailable — save your work'
      : this.settings.recovery ? 'Local session recovery on' : 'Session recovery off';
    status.innerHTML = '<span class="status-dot"></span> <span></span>';
    status.lastElementChild!.textContent = label;
    status.title = this.settings.recovery ? 'Recovery copies are stored locally, unencrypted. They are not backups.' : 'Save important work to files. Recovery copies are not backups.';
  }

  private renderStorageWarning(): void {
    const messages: string[] = [];
    if (this.settingsReadFailed) messages.push('Settings could not be read. AI is off and recovery is paused; any existing recovery copy is untouched. Save your files and restart after fixing storage.');
    else if (this.settingsSaveFailed) messages.push('Settings could not be saved. Changes, including recovery preferences, may revert after restarting. AI always starts off.');
    if (this.recoveryBlocked) messages.push(this.partialRecovery ? 'The latest recovery attempt stored tab metadata only; unsaved text was not saved. Any restored complete snapshot may be older. Recovery is paused to preserve the stored copies; save your work to files.' : 'The previous recovery session could not be read. Its stored copy has not been overwritten. Save your current work and restart after fixing storage.');
    else if (this.recoveryFailed && this.settings.recovery) messages.push(this.recoveryQuotaExceeded ? `A recovery copy could not be saved because storage is full. ${this.recoveryMetadataSaved ? 'Only tab metadata was stored; it cannot restore unsaved text. ' : ''}The previous complete copy was left untouched. Save your work to a file.` : 'A recovery copy could not be saved. Save your work to a file.');
    if (this.recoveryCleanupFailed && !this.settings.recovery) messages.push('Recovery is off, but an old recovery copy could not be removed and may still contain text.');
    if (this.recentClearFailed) messages.push('Recent file paths could not be cleared from local storage and may still be present after restart.');
    const warning = $('#storage-warning');
    $('#storage-warning-text').textContent = messages.join(' ');
    warning.hidden = messages.length === 0;
    const inSettings = $('#settings-storage-message');
    inSettings.textContent = messages.join(' ');
    inSettings.hidden = messages.length === 0;
    $<HTMLButtonElement>('#setting-recovery').disabled = this.settingsReadFailed || this.recoveryOperationBusy || (!this.settings.recovery && this.recoveryCleanupFailed);
    const retry = $<HTMLButtonElement>('#retry-recovery-cleanup');
    retry.hidden = !this.recoveryCleanupFailed || this.settings.recovery || this.settingsReadFailed;
    retry.disabled = this.recoveryOperationBusy;
  }

  private renderAll(): void {
    if (!this.view) return;
    this.renderFiles(); this.renderDiskChange(); this.updateStatus(); this.renderRecoveryStatus(); this.renderStorageWarning(); this.renderAiStatus(); this.updateMarkdownPreview();
    this.refreshStats();
  }

  private updateMarkdownPreview(): void {
    if (!this.markdownPreview.isOpen() || !this.activeId) return;
    const doc = this.active;
    this.markdownPreview.update(`${doc.id}:${doc.revision}`, doc.state.doc.length, () => doc.state.doc.toString());
  }

  private toggleMarkdownPreview(): void {
    this.markdownPreview.setOpen(!this.markdownPreview.isOpen());
    this.updateMarkdownPreview();
    this.view.requestMeasure();
  }

  private applyEditorPreferences(): void {
    if (!this.view) return;
    applyEditorExtensions(this.view, this.settings);
    this.applyTypeface();
    this.applyFocusModes();
    this.drawMinimap();
  }

  private applyTypeface(): void {
    const holder = $('#editor');
    holder.classList.toggle('typeface-serif', this.settings.fontFamily === 'serif');
    holder.classList.toggle('typeface-sans', this.settings.fontFamily === 'sans');
  }

  private applySettings(): void {
    document.documentElement.dataset.theme = this.settings.theme;
    document.documentElement.style.setProperty('--editor-font-size', `${this.settings.fontSize}px`);
    $('#sidebar').hidden = !this.settings.sidebar;
    $('#show-sidebar').hidden = this.settings.sidebar;
    $('#wrap-button').setAttribute('aria-pressed', String(this.settings.wrap));
    $('#setting-wrap').setAttribute('aria-checked', String(this.settings.wrap));
    $('#setting-recovery').setAttribute('aria-checked', String(this.settings.recovery));
    $('#setting-recent').setAttribute('aria-checked', String(this.settings.rememberRecent));
    $<HTMLButtonElement>('#setting-recovery').disabled = this.settingsReadFailed || this.recoveryOperationBusy || (!this.settings.recovery && this.recoveryCleanupFailed);
    $<HTMLButtonElement>('#setting-recent').disabled = this.settingsReadFailed;
    $<HTMLSelectElement>('#setting-theme').value = this.settings.theme;
    $<HTMLSelectElement>('#setting-font').value = String(this.settings.fontSize);
    $<HTMLSelectElement>('#tab-size').value = String(this.settings.tabSize);
    $<HTMLInputElement>('#model-name').value = this.settings.model;
    $('#ai-toggle').setAttribute('aria-checked', String(this.settings.aiEnabled));
    $<HTMLSelectElement>('#setting-font-family').value = this.settings.fontFamily;
    $<HTMLSelectElement>('#setting-ruler').value = String(this.settings.maxLineLength);
    $('#setting-spellcheck').setAttribute('aria-checked', String(this.settings.spellcheck));
    $('#setting-minimap').setAttribute('aria-checked', String(this.settings.minimap));
    $('#setting-smart').setAttribute('aria-checked', String(this.settings.smart ?? false));
    $('#setting-focus').setAttribute('aria-checked', String(this.settings.focus.focus));
    $('#setting-typewriter').setAttribute('aria-checked', String(this.settings.focus.typewriter));
    $('#setting-focus-scope').textContent = `Scope: ${this.settings.focus.scope}`;
    $<HTMLInputElement>('#setting-daily-folder').value = this.settings.daily.folder;
    $('#setting-goal-value').textContent = this.goalTracker.target ? `${this.goalTracker.words.toLocaleString()} of ${this.goalTracker.target.toLocaleString()}` : 'Off';
    this.applyEditorPreferences();
    this.renderRecoveryStatus();
    this.renderStorageWarning();
  }

  private persistSettings(): boolean {
    // Do not replace unreadable settings with defaults; doing so could also erase the user's recovery preference.
    const saved = !this.settingsReadFailed && saveSettings(this.settings);
    this.settingsSaveFailed = !saved && !this.settingsReadFailed;
    if (saved && this.settings.recentFiles.length === 0) this.recentClearFailed = false;
    this.applySettings(); this.updateStatus(); this.scheduleRecovery();
    return saved;
  }
  private toggleSidebar(): void { this.settings.sidebar = !this.settings.sidebar; this.persistSettings(); }
  private toggleWrap(): void { this.settings.wrap = !this.settings.wrap; this.persistSettings(); this.toast(`Word wrap ${this.settings.wrap ? 'on' : 'off'}.`); }
  private toggleTheme(): void { this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark'; this.persistSettings(); }

  private toast(message: string): void {
    const toast = $('#toast'); toast.textContent = message; toast.hidden = false;
    window.clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4500);
  }
  private errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  private confirm(title: string, message: string, buttons: ConfirmButton[], eyebrow = 'BEFORE YOU GO'): Promise<string> {
    const dialog = $<HTMLDialogElement>('#confirm-dialog');
    if (dialog.open) return Promise.resolve('cancel');
    $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-eyebrow').textContent = eyebrow;
    const actions = $('#confirm-actions'); actions.replaceChildren();
    return new Promise((resolve) => {
      let done = false;
      const finish = (id: string) => { if (done) return; done = true; dialog.removeEventListener('cancel', onCancel); dialog.close(); resolve(id); };
      const onCancel = (event: Event) => { event.preventDefault(); finish('cancel'); };
      dialog.addEventListener('cancel', onCancel, { once: true });
      const x = $('#confirm-x'); x.onclick = () => finish('cancel');
      for (const item of buttons) {
        const button = el('button', item.style || ''); button.textContent = item.label; button.type = 'button';
        button.addEventListener('click', () => { dialog.removeEventListener('cancel', onCancel); finish(item.id); }); actions.append(button);
      }
      dialog.showModal();
      (actions.querySelector('button') as HTMLButtonElement | null)?.focus();
    });
  }

  private showDialog(id: string): void {
    const dialog = $<HTMLDialogElement>(`#${id}`); if (!dialog.open) dialog.showModal();
  }

  private async handleAction(action: string): Promise<void> {
    this.closeMenus();
    if (await this.workbench.action(action)) return;
    switch (action) {
      case 'new': this.newFile(); break;
      case 'open': await this.openFiles(); break;
      case 'save': await this.saveDoc(this.active); break;
      case 'save-as': await this.saveDoc(this.active, true); break;
      case 'close': await this.closeDoc(this.activeId); break;
      case 'undo': undo(this.view); this.view.focus(); break;
      case 'redo': redo(this.view); this.view.focus(); break;
      case 'select-all': selectAll(this.view); this.view.focus(); break;
      case 'find': this.showFind(false); break;
      case 'replace': this.showFind(true); break;
      case 'sidebar': this.toggleSidebar(); break;
      case 'wrap': this.toggleWrap(); break;
      case 'preview-markdown': this.toggleMarkdownPreview(); break;
      case 'theme': this.toggleTheme(); break;
      case 'settings': this.showDialog('settings-dialog'); break;
      case 'shortcuts': this.showDialog('help-dialog'); break;
      case 'ai': this.toggleAiPanel(); break;
      case 'about': await this.confirm('A little space for big ideas.', `Morrow 0.4.0 is an open-source text and code editor. Your files stay yours. This is an early preview; save important work regularly.`, [{ id: 'ok', label: 'Sounds good', style: 'primary' }], 'ABOUT MORROW'); break;
      case 'bold': case 'italic': case 'code': case 'strike': case 'link': case 'quote': case 'bullets': case 'numbers': case 'tasks': case 'code-block': case 'smart-typography': case 'heading':
        this.runFormat(action); break;
      case 'line-duplicate': this.runFormat('line-duplicate'); break;
      case 'line-delete': this.runFormat('line-delete'); break;
      case 'line-sort': this.runFormat('line-sort'); break;
      case 'quick-capture': this.openCapture(); break;
      case 'daily-note': this.openDailyNote(); break;
      case 'new-template': this.openTemplateDialog('template'); break;
      case 'tab-outline': this.showTabOutline(); break;
      case 'notes-panel': case 'sidebar-notes': this.toggleNotesPanel(); break;
      case 'build-index': void this.buildNoteIndex(true); break;
      case 'clear-index': this.noteIndex.clear(); this.indexStale = true; this.toast('The local note index was cleared. Nothing on disk was changed.'); this.renderNotesPanel(); break;
      case 'focus-mode': this.toggleFocus('focus'); break;
      case 'typewriter-mode': this.toggleFocus('typewriter'); break;
      case 'zen-mode': this.toggleFocus('zen'); break;
      case 'spellcheck': this.settings.spellcheck = !this.settings.spellcheck; this.persistSettings(); this.toast(`Spell-check ${this.settings.spellcheck ? 'on' : 'off'}.`); break;
      case 'minimap': this.settings.minimap = !this.settings.minimap; this.persistSettings(); this.drawMinimap(); this.toast(`Minimap ${this.settings.minimap ? 'on' : 'off'}.`); break;
      case 'zoom-in': this.zoom(1); break;
      case 'zoom-out': this.zoom(-1); break;
      case 'zoom-reset': this.zoom('reset'); break;
      case 'goal': this.openGoalDialog(); break;
    }
  }

  private closeMenus(): void {
    document.querySelectorAll<HTMLElement>('[data-menu-panel]').forEach((panel) => { panel.hidden = true; });
    document.querySelectorAll<HTMLElement>('[data-menu]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }

  private showFind(replace: boolean): void {
    this.findOpen = true; $('#find-panel').hidden = false; $('#replace-row').hidden = !replace;
    const range = this.view.state.selection.main;
    const selected = this.view.state.sliceDoc(range.from, range.to);
    if (selected && !selected.includes('\n')) $<HTMLInputElement>('#find-input').value = selected;
    openSearchPanel(this.view); this.updateSearchQuery();
    const input = $<HTMLInputElement>('#find-input'); input.focus(); input.select();
  }
  private closeFind(): void {
    this.findOpen = false; $('#find-panel').hidden = true; closeSearchPanel(this.view); this.view.focus();
  }
  private updateSearchQuery(): void {
    if (!this.view) return;
    const text = $<HTMLInputElement>('#find-input').value;
    const query = new SearchQuery({ search: text, replace: $<HTMLInputElement>('#replace-input').value, caseSensitive: this.findCase, regexp: this.findRegex, literal: !this.findRegex });
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    const error = $('#find-error'); error.hidden = !text || query.valid; error.textContent = error.hidden ? '' : 'Invalid regular expression.';
    this.updateFindCount();
  }
  private updateFindCount(): void {
    if (!this.findOpen || !this.view) return;
    const text = $<HTMLInputElement>('#find-input').value;
    const query = new SearchQuery({ search: text, replace: $<HTMLInputElement>('#replace-input').value, caseSensitive: this.findCase, regexp: this.findRegex, literal: !this.findRegex });
    if (!query.valid) { $('#find-count').textContent = '0'; return; }
    try {
      const cursor = query.getCursor(this.view.state);
      let n = 0; while (n <= 1000 && !cursor.next().done) n++;
      $('#find-count').textContent = n > 1000 ? '1000+' : String(n);
    } catch { $('#find-count').textContent = '0'; }
  }

  private toggleAiPanel(): void {
    this.aiPanelOpen = !this.aiPanelOpen;
    $('#assistant-panel').hidden = !this.aiPanelOpen;
    $('#main').classList.toggle('assistant-open', this.aiPanelOpen);
    this.renderAiStatus();
    if (!this.aiPanelOpen) this.view.focus();
  }
  private renderAiStatus(message?: string, error = false): void {
    const status = $('#ai-status');
    const label = message || (!desktop ? 'Desktop app only in this preview' : this.settings.aiEnabled ? 'On · using Ollama' : 'Off · enable for this session');
    status.classList.toggle('on', this.settings.aiEnabled && !error);
    status.classList.toggle('error', error);
    status.innerHTML = '<span class="status-dot"></span><span></span>';
    status.lastElementChild!.textContent = label;
    $('#ai-toggle').setAttribute('aria-checked', String(this.settings.aiEnabled));
    const top = $('#ai-top-state'); top.textContent = this.settings.aiEnabled ? 'ON' : 'OFF'; top.classList.toggle('on', this.settings.aiEnabled);
  }
  private async toggleAi(): Promise<void> {
    if (!desktop) { this.toast('AI suggestions run in the Windows desktop app, not the browser preview.'); return; }
    if (this.settings.aiEnabled) {
      this.settings.aiEnabled = false; this.cancelAi(); clearGhost(this.view); this.persistSettings(); this.renderAiStatus(); return;
    }
    const choice = await this.confirm('Turn on AI suggestions?', 'As you type, up to 3,500 characters before and 1,200 after your cursor are sent to Ollama at 127.0.0.1 on this computer. Ollama can route to cloud models, so a local address alone does not guarantee on-device processing. Verify your model and Ollama configuration. Suggestions turn off when Morrow restarts.', [
      { id: 'cancel', label: 'Not now' }, { id: 'enable', label: 'Enable suggestions', style: 'primary' },
    ], 'YOUR CHOICE');
    if (choice !== 'enable') return;
    this.settings.aiEnabled = true; this.persistSettings(); this.renderAiStatus('On · check that Ollama is running');
    await this.checkAi();
  }
  private async checkAi(): Promise<void> {
    if (!desktop) { this.renderAiStatus('Desktop app only in this preview'); this.toast('Install the Windows desktop app to connect to Ollama on your own PC.'); return; }
    this.renderAiStatus('Checking local Ollama…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const models = await listModels(controller.signal);
      const present = models.some((model) => model === this.settings.model || (model === `${this.settings.model}:latest`) || (`${model}:latest` === this.settings.model));
      this.renderAiStatus(present ? 'Connected · model found' : `Connected · model “${this.settings.model}” not found`, !present);
    } catch (error) { this.renderAiStatus('Ollama unavailable · check that it is running', true); this.toast(`Could not connect to local Ollama: ${this.errorText(error)}`); }
    finally { window.clearTimeout(timeout); }
  }
  private cancelAi(): void {
    this.aiGeneration++; window.clearTimeout(this.aiTimer); this.aiController?.abort(); this.aiController = null;
  }

  private showAiActions(): void {
    if (!this.aiPanelOpen) this.toggleAiPanel();
    $('#ai-actions-title').scrollIntoView({ block: 'center' });
    const first = document.querySelector<HTMLButtonElement>('[data-ai-action="improve"]');
    first?.focus();
    if (!desktop) this.renderAiActionStatus('AI actions run in the Windows desktop app, not this browser preview.', true);
    else this.renderAiActionStatus('Select text in the editor, choose an action, then run it.');
  }

  private selectAiAction(id: string): void {
    const action = getAiAction(id);
    if (!action) return;
    this.aiActionId = action.id;
    document.querySelectorAll<HTMLElement>('[data-ai-action]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.aiAction === action.id));
    });
    if (action.kind === 'replace') this.setAiActionResult(null);
    this.renderAiActionStatus(action.kind === 'answer'
      ? `${action.label}: the answer appears below. The document is not changed.`
      : `${action.label}: you will review a diff before anything changes.`);
    if (action.id === 'custom') $<HTMLInputElement>('#ai-action-instruction').focus();
  }

  private renderAiActionStatus(message: string, error = false): void {
    const status = $('#ai-action-status');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  private setAiActionResult(text: string | null): void {
    const result = $('#ai-action-result');
    const output = $('#ai-action-output');
    output.textContent = text ?? '';
    result.hidden = !text;
  }

  private cancelAiAction(): void {
    if (!this.aiActionBusy) return;
    this.aiActionController?.abort();
    this.renderAiActionStatus('Cancelling the AI action…');
  }

  private async copyAiActionAnswer(): Promise<void> {
    const text = $('#ai-action-output').textContent || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.renderAiActionStatus('Answer copied to the clipboard.');
    } catch {
      this.renderAiActionStatus('Could not copy automatically. Select the answer and press Ctrl+C.', true);
    }
  }

  /**
   * One explicit, cancellable request. Only the selected text and instruction
   * are sent. Replace actions always open the diff review; nothing is applied
   * or saved here.
   */
  private async runAiAction(): Promise<void> {
    if (this.aiActionBusy) return;
    const action = getAiAction(this.aiActionId);
    if (!action) return;
    if (!desktop) {
      this.renderAiActionStatus('AI actions run in the Windows desktop app, not this browser preview.', true);
      this.toast('Install the Windows desktop app to use AI actions with Ollama.');
      return;
    }
    let target: ReviewTarget;
    try { target = this.captureReviewSelection(); }
    catch (error) { this.renderAiActionStatus(this.errorText(error), true); return; }
    if (target.original.length > MAX_ACTION_SELECTION) {
      this.renderAiActionStatus(`Select at most ${MAX_ACTION_SELECTION.toLocaleString()} characters for an AI action.`, true);
      return;
    }
    const model = this.settings.model;
    const instruction = $<HTMLInputElement>('#ai-action-instruction').value.trim();
    try { buildActionRequest({ selection: target.original, action: action.id, instruction, model }); }
    catch (error) { this.renderAiActionStatus(this.errorText(error), true); return; }

    if (!this.aiActionConsent || this.aiActionConsentModel !== model) {
      const choice = await this.confirm('Send this selection to Ollama?', `“${action.label}” sends only the ${target.original.length.toLocaleString()} selected characters and your instruction to Ollama at 127.0.0.1:11434 using “${model}”. Inline suggestions may be off; this is a separate request. A loopback address does not guarantee local processing, because Ollama can route to a cloud model. Nothing is applied automatically: you review a diff first. Morrow asks once per session per model and sends nothing when you cancel.`, [
        { id: 'cancel', label: 'Cancel' },
        { id: 'send', label: 'Send and review', style: 'primary' },
      ], 'YOUR CHOICE');
      if (choice !== 'send') { this.renderAiActionStatus('Nothing was sent.'); return; }
      this.aiActionConsent = true;
      this.aiActionConsentModel = model;
    }

    if (!this.reviewIsCurrent(target)) {
      this.renderAiActionStatus('The selection changed while the request was being prepared. Nothing was sent; select the text again.', true);
      return;
    }

    const controller = new AbortController();
    this.aiActionController = controller;
    this.aiActionBusy = true;
    const runButton = $<HTMLButtonElement>('#ai-action-run');
    runButton.disabled = true;
    $('#ai-action-cancel').hidden = false;
    if (action.kind === 'answer') this.setAiActionResult(null);
    this.renderAiActionStatus(`Sending ${target.original.length.toLocaleString()} selected characters to ${model}…`);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    try {
      const output = await runAction({ selection: target.original, action: action.id, instruction, model }, controller.signal);
      if (controller.signal.aborted) return;
      if (!output) { this.renderAiActionStatus('The model returned no usable text. Try again or choose another action.', true); return; }
      if (action.kind === 'answer') {
        this.setAiActionResult(output);
        this.renderAiActionStatus(`Answer ready · ${output.length.toLocaleString()} characters · the document was not changed.`);
        return;
      }
      if (!this.reviewIsCurrent(target)) {
        this.renderAiActionStatus('The selection changed while the model was working. Nothing was applied; select the text again.', true);
        return;
      }
      if (output.replace(/\r\n?/gu, '\n') === target.original.replace(/\r\n?/gu, '\n')) {
        this.renderAiActionStatus('The model returned the same text. There is nothing to review.');
        return;
      }
      this.workbench.previewChange(target, output);
      this.renderAiActionStatus('Suggestion ready · review the diff, then apply or reject it.');
    } catch (error) {
      if (controller.signal.aborted && !timedOut) { this.renderAiActionStatus('AI action cancelled. Nothing was applied.'); return; }
      this.renderAiActionStatus(timedOut ? 'The model took too long and the request was cancelled. Nothing was applied.' : `AI action failed: ${this.errorText(error)}`, true);
    } finally {
      window.clearTimeout(timeout);
      if (this.aiActionController === controller) this.aiActionController = null;
      this.aiActionBusy = false;
      runButton.disabled = false;
      $('#ai-action-cancel').hidden = true;
    }
  }
  private scheduleAi(): void {
    if (!desktop || !this.settings.aiEnabled || Date.now() < this.aiCooldownUntil) return;
    window.clearTimeout(this.aiTimer);
    this.aiTimer = window.setTimeout(() => { void this.requestAi(false); }, 1000);
  }
  private async requestAi(manual: boolean): Promise<void> {
    if (!desktop) { if (manual) this.toast('AI suggestions are available in the Windows desktop app.'); return; }
    if (!this.settings.aiEnabled) { if (manual) { if (!this.aiPanelOpen) this.toggleAiPanel(); this.toast('Turn on AI suggestions to request a completion.'); } return; }
    const doc = this.active; const range = doc.state.selection.main;
    if (!range.empty || doc.state.selection.ranges.length !== 1) return;
    this.cancelAi();
    const generation = this.aiGeneration, revision = doc.revision, pos = range.head;
    const prefix = doc.state.doc.sliceString(Math.max(0, pos - 3500), pos);
    const suffix = doc.state.doc.sliceString(pos, Math.min(doc.state.doc.length, pos + 1200));
    if (!prefix.trim() && !manual) return;
    const controller = new AbortController();
    this.aiController = controller;
    const signal = controller.signal;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    this.renderAiStatus('Thinking via Ollama…');
    try {
      const suggestion = await complete(prefix + suffix, prefix.length, this.settings.model, signal);
      if (signal.aborted || generation !== this.aiGeneration || this.activeId !== doc.id || doc.revision !== revision || this.view.state.selection.main.head !== pos) return;
      if (suggestion) { showGhost(this.view, pos, suggestion); this.renderAiStatus('Suggestion ready · Tab to accept'); }
      else { this.renderAiStatus('No suggestion this time'); if (manual) this.toast('No suggestion this time.'); }
    } catch (error) {
      if ((!timedOut && signal.aborted) || generation !== this.aiGeneration) return;
      this.aiCooldownUntil = Date.now() + 5000;
      this.renderAiStatus(timedOut ? 'Suggestion timed out · check Ollama' : 'Could not get a suggestion · check Ollama', true);
      if (manual) this.toast(timedOut ? 'AI suggestion timed out.' : `AI suggestion unavailable: ${this.errorText(error)}`);
    } finally {
      window.clearTimeout(timeout);
      if (this.aiController === controller) this.aiController = null;
    }
  }

  private bindUi(): void {
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const menu = target.closest<HTMLElement>('[data-menu]');
      if (menu) {
        const name = menu.dataset.menu; const wasOpen = menu.getAttribute('aria-expanded') === 'true'; this.closeMenus();
        if (!wasOpen) { menu.setAttribute('aria-expanded', 'true'); const panel = document.querySelector<HTMLElement>(`[data-menu-panel="${name}"]`); if (panel) panel.hidden = false; }
        return;
      }
      const aiAction = target.closest<HTMLElement>('[data-ai-action]');
      if (aiAction) { this.selectAiAction(aiAction.dataset.aiAction || ''); return; }
      const action = target.closest<HTMLElement>('[data-action]');
      if (action) { void this.handleAction(action.dataset.action || ''); return; }
      const close = target.closest<HTMLElement>('[data-close-dialog]');
      if (close) { const dialog = document.getElementById(close.dataset.closeDialog || '') as HTMLDialogElement | null; dialog?.close(); this.view?.focus(); return; }
      if (!target.closest('[data-menu-panel]')) this.closeMenus();
    });
    document.addEventListener('keydown', (event) => this.onKey(event), true);

    $('#language').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      this.active.override = value === '__auto__' ? null : value;
      this.updateStatus(); void this.applyLanguage(); this.scheduleRecovery(); this.view.focus();
    });
    $('#encoding').addEventListener('change', (event) => {
      this.active.encoding = (event.target as HTMLSelectElement).value as TextEncoding;
      this.renderAll(); this.scheduleRecovery();
    });
    $('#line-ending').addEventListener('change', (event) => {
      this.active.lineEnding = (event.target as HTMLSelectElement).value as LineEnding;
      this.renderAll(); this.scheduleRecovery();
    });
    $('#tab-size').addEventListener('change', (event) => {
      this.settings.tabSize = Number((event.target as HTMLSelectElement).value) as 2 | 4 | 8;
      this.persistSettings(); this.view.focus();
    });
    $('#setting-theme').addEventListener('change', (event) => { this.settings.theme = (event.target as HTMLSelectElement).value as 'dark' | 'light'; this.persistSettings(); });
    $('#setting-font').addEventListener('change', (event) => { this.settings.fontSize = Number((event.target as HTMLSelectElement).value); this.persistSettings(); });
    $('#setting-wrap').addEventListener('click', () => this.toggleWrap());
    $('#setting-recent').addEventListener('click', () => {
      if (this.settingsReadFailed) return;
      this.settings.rememberRecent = !this.settings.rememberRecent;
      if (!this.settings.rememberRecent) this.settings.recentFiles = [];
      const saved = this.persistSettings();
      if (!saved && !this.settings.rememberRecent) { this.recentClearFailed = true; this.renderStorageWarning(); }
    });
    $('#clear-recent').addEventListener('click', () => {
      this.settings.recentFiles = [];
      if (this.persistSettings()) this.toast('Recent file paths cleared.');
      else { this.recentClearFailed = true; this.renderStorageWarning(); this.toast('Could not clear stored recent file paths.'); }
    });
    $('#setting-recovery').addEventListener('click', () => { void this.toggleRecovery(); });
    $('#retry-recovery-cleanup').addEventListener('click', () => { void this.retryRecoveryCleanup(); });
    $('#disk-change-reload').addEventListener('click', () => { void this.reloadActiveFromDisk(); });
    window.addEventListener('focus', () => { void this.checkActiveDisk(); });
    $('#capture-submit').addEventListener('click', () => { void this.submitCapture(); });
    $<HTMLTextAreaElement>('#capture-text').addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter' && ((event as KeyboardEvent).ctrlKey || (event as KeyboardEvent).metaKey)) {
        event.preventDefault(); void this.submitCapture();
      }
    });
    $('#note-create').addEventListener('click', () => { void this.submitNoteDialog(); });
    $('#goal-save').addEventListener('click', () => {
      const value = Number($<HTMLInputElement>('#goal-input').value);
      if (!Number.isFinite(value) || value < 0 || value > 100_000) { $('#goal-status').textContent = 'Enter a whole number between 0 and 100,000.'; return; }
      this.setGoal(Math.trunc(value));
      $<HTMLDialogElement>('#goal-dialog').close();
    });
    $('#setting-goal').addEventListener('click', () => this.openGoalDialog());
    $('#goal-chip').addEventListener('click', () => this.openGoalDialog());
    $('#focus-chip').addEventListener('click', () => { this.settings.focus = { ...this.settings.focus, focus: false, typewriter: false, zen: false }; this.persistSettings(); this.applyFocusModes(); });
    $('#notes-chip').addEventListener('click', () => this.toggleNotesPanel());
    for (const tab of ['outline', 'tags', 'links'] as const) {
      $(`#notes-tab-${tab}`).addEventListener('click', () => this.selectNotesTab(tab));
    }
    $('#index-notes-button').addEventListener('click', () => { void this.buildNoteIndex(true); });
    $('#setting-focus').addEventListener('click', () => this.toggleFocus('focus'));
    $('#setting-typewriter').addEventListener('click', () => this.toggleFocus('typewriter'));
    $('#setting-focus-scope').addEventListener('click', () => {
      this.settings.focus = { ...this.settings.focus, scope: this.settings.focus.scope === 'sentence' ? 'paragraph' : 'sentence' };
      this.persistSettings(); this.applyFocusModes();
    });
    $('#setting-smart').addEventListener('click', () => { this.settings.smart = !this.settings.smart; this.persistSettings(); });
    $('#setting-spellcheck').addEventListener('click', () => { this.settings.spellcheck = !this.settings.spellcheck; this.persistSettings(); this.toast(`Spell-check ${this.settings.spellcheck ? 'on' : 'off'}.`); });
    $('#setting-minimap').addEventListener('click', () => { this.settings.minimap = !this.settings.minimap; this.persistSettings(); this.drawMinimap(); });
    $('#setting-font-family').addEventListener('change', (event) => { this.settings.fontFamily = (event.target as HTMLSelectElement).value as Settings['fontFamily']; this.persistSettings(); });
    $('#setting-ruler').addEventListener('change', (event) => { this.settings.maxLineLength = Number((event.target as HTMLSelectElement).value); this.persistSettings(); });
    $('#setting-daily-folder').addEventListener('change', (event) => {
      const value = (event.target as HTMLInputElement).value.trim();
      if (value && !isSafeRelativePath(value)) { this.toast('That folder path is not valid; keeping the previous value.'); (event.target as HTMLInputElement).value = this.settings.daily.folder; return; }
      this.settings.daily.folder = value; this.persistSettings();
    });
    $('#ai-toggle').addEventListener('click', () => { void this.toggleAi(); });
    $('#ai-action-run').addEventListener('click', () => { void this.runAiAction(); });
    $('#ai-action-cancel').addEventListener('click', () => this.cancelAiAction());
    $('#ai-action-copy').addEventListener('click', () => { void this.copyAiActionAnswer(); });
    $('#test-ai').addEventListener('click', () => { void this.checkAi(); });
    $('#model-name').addEventListener('change', (event) => {
      this.settings.model = (event.target as HTMLInputElement).value.trim().slice(0, 120) || DEFAULT_MODEL;
      this.cancelAi(); clearGhost(this.view); this.persistSettings(); this.renderAiStatus();
    });
    for (const id of ['#find-input', '#replace-input']) $(id).addEventListener('input', () => this.updateSearchQuery());
    $('#find-case').addEventListener('click', () => { this.findCase = !this.findCase; $('#find-case').setAttribute('aria-pressed', String(this.findCase)); this.updateSearchQuery(); });
    $('#find-regex').addEventListener('click', () => { this.findRegex = !this.findRegex; $('#find-regex').setAttribute('aria-pressed', String(this.findRegex)); this.updateSearchQuery(); });
    $('#find-next').addEventListener('click', () => { findNext(this.view); });
    $('#find-prev').addEventListener('click', () => { findPrevious(this.view); });
    $('#find-close').addEventListener('click', () => this.closeFind());
    $('#replace-one').addEventListener('click', () => { this.updateSearchQuery(); replaceNext(this.view); this.updateFindCount(); });
    $('#replace-all').addEventListener('click', () => { this.updateSearchQuery(); replaceAll(this.view); this.updateFindCount(); });
    $('#find-input').addEventListener('keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key === 'Enter') { keyboard.preventDefault(); keyboard.shiftKey ? findPrevious(this.view) : findNext(this.view); }
    });
    window.addEventListener('beforeunload', (event) => {
      // Desktop close has its own per-document confirmation; avoid a second WebView prompt.
      if (!desktop && (!this.settings.recovery || this.recoveryBlocked || this.recoveryFailed) && this.docs.some((doc) => this.dirty(doc))) { event.preventDefault(); event.returnValue = ''; }
    });
  }

  private async removeRecoveryCopy(): Promise<boolean> {
    try {
      const result = await saveSession(null);
      if (!result.saved) throw new Error('Could not remove recovery data.');
      this.recoveryCleanupFailed = false;
      this.recoveryBlocked = false;
      this.partialRecovery = false;
      this.recoveryFailed = false;
      return true;
    } catch {
      this.recoveryCleanupFailed = true;
      return false;
    } finally { this.renderRecoveryStatus(); this.renderStorageWarning(); }
  }

  private async retryRecoveryCleanup(): Promise<void> {
    if (this.recoveryOperationBusy || this.settings.recovery || this.settingsReadFailed || !this.recoveryCleanupFailed) return;
    this.recoveryOperationBusy = true;
    this.renderStorageWarning();
    try {
      if (await this.removeRecoveryCopy()) {
        this.toast(this.settingsSaveFailed ? 'The recovery copy was removed, but the off setting may not persist.' : 'The old recovery copy was removed.');
      } else this.toast('Could not remove the old recovery copy. It may still contain text.');
    } finally { this.recoveryOperationBusy = false; this.renderStorageWarning(); }
  }

  private async toggleRecovery(): Promise<void> {
    if (this.recoveryOperationBusy || this.settingsReadFailed || (!this.settings.recovery && this.recoveryCleanupFailed)) return;
    this.recoveryOperationBusy = true;
    this.renderStorageWarning();
    try {
      if (this.settings.recovery && this.recoveryBlocked) {
        const choice = await this.confirm('Remove the old recovery copy?', 'Recovery is paused to protect stored data. Turning recovery off will try to delete the recovery copies, which may contain unsaved work. Save your current files first.', [
          { id: 'cancel', label: 'Cancel' }, { id: 'remove', label: 'Turn off and remove', style: 'danger' },
        ], 'RECOVERY NEEDS ATTENTION');
        if (choice !== 'remove') return;
      }
      this.settings.recovery = !this.settings.recovery;
      if (!this.settings.recovery) window.clearTimeout(this.recoveryTimer);
      const persisted = this.persistSettings();
      if (!this.settings.recovery) {
        if (await this.removeRecoveryCopy()) {
          this.toast(persisted ? 'Local recovery is off and the saved session was removed.' : 'Recovery is off for this session, but the off setting may not persist.');
        } else this.toast('Could not remove the old recovery copy. It may still contain text.');
      } else {
        const saved = await this.flushRecovery();
        if (saved && !persisted) this.toast('Recovery is on for this session, but the setting could not be saved.');
      }
    } finally {
      this.recoveryOperationBusy = false;
      this.applySettings();
    }
  }

  private onKey(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const openMenu = document.querySelector<HTMLElement>('[data-menu-panel]:not([hidden])');
    if (openMenu && !document.querySelector('dialog[open]')) {
      const name = openMenu.dataset.menuPanel;
      const trigger = document.querySelector<HTMLElement>(`[data-menu="${name}"]`);
      const items = Array.from(openMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      if (event.key === 'Escape') { event.preventDefault(); this.closeMenus(); trigger?.focus(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && items.length) {
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus(); return;
      }
    }
    if (event.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      if (this.findOpen) { event.preventDefault(); this.closeFind(); return; }
      if (this.view && hasGhost(this.view)) { event.preventDefault(); clearGhost(this.view); this.renderAiStatus(); return; }
      this.closeMenus(); return;
    }
    if (document.querySelector('dialog[open]')) return;
    if (mod && event.shiftKey && event.code === 'Space') { event.preventDefault(); void this.requestAi(true); return; }
    if (mod && key === 'tab') {
      event.preventDefault(); const index = this.docs.findIndex((doc) => doc.id === this.activeId);
      const direction = event.shiftKey ? -1 : 1; this.switchDoc(this.docs[(index + direction + this.docs.length) % this.docs.length].id); return;
    }
    if (event.key === 'F8' && !mod) { event.preventDefault(); this.toggleFocus('focus'); return; }
    if (event.key === 'F9' && !mod) { event.preventDefault(); this.toggleFocus('typewriter'); return; }
    if (event.key === 'F11' && !mod) { event.preventDefault(); this.toggleFocus('zen'); return; }
    if (mod && event.altKey && key === 'n') { event.preventDefault(); event.stopPropagation(); this.openCapture(); return; }
    if (mod && event.altKey && key === 'd') { event.preventDefault(); event.stopPropagation(); this.openDailyNote(); return; }
    if (mod && event.altKey && key === 'b') { event.preventDefault(); event.stopPropagation(); this.toggleNotesPanel(); return; }
    if (mod && !event.altKey && (key === '+' || key === '=' || key === '-' || key === '0')) {
      event.preventDefault(); event.stopPropagation();
      this.zoom(key === '0' ? 'reset' : key === '-' ? -(event.shiftKey ? 2 : 1) : event.shiftKey ? 2 : 1);
      return;
    }
    if (mod && event.shiftKey && event.code === 'KeyO') { event.preventDefault(); event.stopPropagation(); this.showTabOutline(); return; }
    if (mod && !event.altKey && ['b', 'i', 'k'].includes(key) && !event.shiftKey) {
      // Ctrl+B means "bold" only where bold can exist: a Markdown note with a real selection.
      // Everywhere else it keeps its documented "toggle sidebar" behaviour.
      const markdownBuffer = isMarkdownName(this.active.name);
      const hasSelection = !!this.view && this.view.state.selection.main.from !== this.view.state.selection.main.to;
      if (key !== 'b' || (markdownBuffer && hasSelection)) {
        event.preventDefault(); event.stopPropagation();
        this.runFormat(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'link');
        return;
      }
    }
    if (mod && event.shiftKey && /^Digit[1-6]$/u.test(event.code)) {
      event.preventDefault(); event.stopPropagation();
      this.runFormat(`heading-${event.code.slice(-1)}`);
      return;
    }
    if (mod && event.shiftKey && event.code === 'KeyQ') { event.preventDefault(); event.stopPropagation(); this.runFormat('quote'); return; }
    if (mod && event.shiftKey && event.code === 'KeyU') { event.preventDefault(); event.stopPropagation(); this.runFormat('bullets'); return; }
    if (mod && event.shiftKey && event.code === 'KeyD' && !event.altKey) { event.preventDefault(); event.stopPropagation(); this.runFormat('line-duplicate'); return; }
    if (mod && event.shiftKey && event.code === 'KeyK' && !event.altKey) { event.preventDefault(); event.stopPropagation(); this.runFormat('line-delete'); return; }
    if (event.altKey && !mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); event.stopPropagation();
      this.runFormat(event.key === 'ArrowUp' ? 'line-move-up' : 'line-move-down');
      return;
    }
    if (event.key === 'F3' && this.findOpen) { event.preventDefault(); event.shiftKey ? findPrevious(this.view) : findNext(this.view); return; }
    if (event.altKey && !mod && key === 'z') { event.preventDefault(); this.toggleWrap(); return; }
    if (!mod || event.altKey) return;
    if (event.shiftKey && (key === 'f' || key === 'p')) {
      event.preventDefault(); event.stopPropagation(); void this.handleAction(key === 'f' ? 'find-files' : 'command-palette'); return;
    }
    const map: Record<string, string> = { n: 'new', o: 'open', s: event.shiftKey ? 'save-as' : 'save', w: 'close', f: 'find', h: 'replace', b: 'sidebar', p: 'quick-open', g: 'goto-line', ',': 'settings' };
    if (map[key] && (!event.shiftKey || key === 's')) { event.preventDefault(); event.stopPropagation(); void this.handleAction(map[key]); }
  }

  private bindBrowserDrop(): void {
    const overlay = $('#drop-overlay');
    window.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); overlay.hidden = false; }
    });
    window.addEventListener('dragleave', (event) => { if (!event.relatedTarget) overlay.hidden = true; });
    window.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault(); overlay.hidden = true;
      void (async () => {
        const failures: OpenFailure[] = [];
        for (const file of Array.from(event.dataTransfer!.files)) {
          try {
            if (file.size > 20 * 1024 * 1024) throw new Error('This file is larger than the 20 MiB safety limit.');
            await this.addOpened({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), ref: { kind: 'download' } });
          } catch (error) { failures.push({ name: file.name, message: this.errorText(error) }); }
        }
        this.reportOpenFailures(failures);
      })();
    });
  }

  private async bindDesktop(): Promise<void> {
    const window = getCurrentWindow();
    await window.onCloseRequested(async (event) => {
      event.preventDefault(); // Must happen synchronously, before the first await.
      if (this.closing) return;
      if (this.recoveryOperationBusy) { this.toast('Please wait for the recovery setting to finish updating.'); return; }
      this.closing = true;
      try {
        if (this.settings.recovery && await this.flushRecovery()) { await window.destroy(); return; }
        for (const doc of [...this.docs]) {
          if (this.dirty(doc)) { this.switchDoc(doc.id); if (!(await this.confirmClose(doc))) return; }
        }
        await window.destroy();
      } catch (error) { this.toast(`Could not close the window: ${this.errorText(error)}`); }
      finally { this.closing = false; }
    });
    await getCurrentWebview().onDragDropEvent((event) => {
      const overlay = $('#drop-overlay');
      if (event.payload.type === 'enter') overlay.hidden = false;
      if (event.payload.type === 'leave') overlay.hidden = true;
      if (event.payload.type === 'drop') { overlay.hidden = true; void this.openNativePaths(event.payload.paths); }
    });
    await listen('morrow-open-files', () => { void this.openLaunchFiles(); });
    await this.openLaunchFiles();
  }
  private async openLaunchFiles(): Promise<void> {
    try { const paths = await invoke<string[]>('take_launch_files'); await this.openNativePaths(paths); }
    catch (error) { this.toast(`Could not open launch files: ${this.errorText(error)}`); }
  }
  private async openNativePaths(paths: string[]): Promise<void> {
    const failures: OpenFailure[] = [];
    for (const path of paths) {
      try { await this.addOpened(await readNative(path)); }
      catch (error) { failures.push({ name: path, message: this.errorText(error) }); }
    }
    this.reportOpenFailures(failures);
  }
}

const app = new MorrowApp();
void app.start().catch((error) => {
  console.error(error);
  const message = `Morrow couldn't start: ${error instanceof Error ? error.message : String(error)}`;
  $('#startup-status').textContent = message;
  const toast = $('#toast'); toast.textContent = message; toast.hidden = false;
});
