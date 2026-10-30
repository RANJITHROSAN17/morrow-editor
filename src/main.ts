import './style.css';
import { EditorState, Text } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { isolateHistory, redo, selectAll, undo } from '@codemirror/commands';
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { allLanguages, clearGhost, createEditorState, findLanguage, hasGhost, indentCompartment, languageCompartment, languageLabel, showGhost, wrapCompartment } from './editor';
import { decodeFile, encodeFile, sha256, type LineEnding, type TextEncoding } from './encoding';
import { chooseSaveTarget, desktop, ExternalChangeError, pickFiles, readNative, refPath, writeTo, type FileRef, type OpenedFile, type OpenFailure } from './platform';
import { complete, listModels, DEFAULT_MODEL } from './ai';
import { loadSession, loadSettings, saveSession, saveSettings, type SavedDocument, type Session, type Settings } from './storage';
import { MARKDOWN_SAMPLE, PYTHON_SAMPLE } from './samples';
import { icon } from './icons';
import { makeReviewTarget, reviewTargetIsCurrent, type ReviewTarget } from './change-review';
import { readWorkspaceFile, type WorkspaceFile } from './workspace';
import { Workbench } from './workbench';
import { MarkdownPreview } from './markdown-preview';

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
  private toastTimer = 0;
  private aiTimer = 0;
  private aiGeneration = 0;
  private aiController: AbortController | null = null;
  private aiCooldownUntil = 0;
  private aiPanelOpen = false;
  private lastTitle = '';
  private findOpen = false;
  private findRegex = false;
  private findCase = false;
  private closing = false;

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
      lineCount: () => this.view.state.doc.lines,
      goToLine: (line, column) => this.goToLine(line, column),
      openWorkspaceFile: (entry, line, column) => this.openWorkspaceFile(entry, line, column),
      openRecent: (path) => this.openRecent(path),
      listOpenDocuments: () => this.docs.map((doc) => ({ id: doc.id, name: doc.name, detail: refPath(doc.ref) || doc.displayPath || (doc.sample ? 'Example' : 'Unsaved'), path: refPath(doc.ref) })),
      recentPaths: () => this.settings.rememberRecent ? [...this.settings.recentFiles] : [],
      switchDocument: (id) => this.switchDoc(id),
    });
  }

  private get active(): Doc { return this.docs.find((doc) => doc.id === this.activeId) || this.docs[0]; }

  async start(): Promise<void> {
    document.querySelectorAll<HTMLElement>('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon || 'info'); });
    this.populateLanguages();
    this.applySettings();
    this.bindUi();
    let restored = false;
    if (this.settings.recovery) {
      try {
        const session = await loadSession();
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
      try { await saveSession(null); }
      catch { this.recoveryCleanupFailed = true; }
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
    await this.applyLanguage();
    this.view.focus();
    if (this.recoveryFailed) this.toast('Session recovery is unavailable. Save your work to a file.');
    this.scheduleRecovery();
    if (desktop) await this.bindDesktop();
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
      this.updateStatus();
      this.updateMarkdownPreview();
      this.scheduleRecovery();
      this.cancelAi();
      this.renderAiStatus();
      if (this.settings.aiEnabled) this.scheduleAi();
      if (this.findOpen) this.updateFindCount();
    } else if (update.selectionSet) {
      this.updateStatus();
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
    try { await saveSession(this.snapshot()); this.recoveryFailed = false; this.renderRecoveryStatus(); this.renderStorageWarning(); return true; }
    catch { if (!this.recoveryFailed) this.toast('Could not save a local recovery copy. Save your work to a file.'); this.recoveryFailed = true; this.renderRecoveryStatus(); this.renderStorageWarning(); return false; }
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

  private async openWorkspaceFile(entry: WorkspaceFile, line?: number, column?: number): Promise<void> {
    try {
      const opened = await readWorkspaceFile(entry);
      await this.addOpened(opened);
      if (line) {
        const doc = this.active;
        if (this.dirty(doc)) this.toast('Search results refer to the saved file; unsaved changes may shift the line.');
        else if (doc.hash && await sha256(opened.bytes) !== doc.hash) this.toast('The file changed on disk since it was opened; this saved-file result may not match the editor.');
        if (!this.docs.includes(doc)) return;
        if (this.activeId !== doc.id) this.switchDoc(doc.id);
        this.goToLine(line, column);
      }
    } catch (error) { this.reportOpenFailures([{ name: entry.relative, message: this.errorText(error) }]); }
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
      let expected = this.sameRef(doc.ref, target.ref) ? doc.hash : null;
      let digest: string;
      try { digest = await writeTo(target.ref, bytes, target.name, expected); }
      catch (error) {
        if (!(error instanceof ExternalChangeError)) throw error;
        const choice = await this.confirm('File changed on disk', `“${doc.name}” was changed outside Morrow after it was opened. Overwriting may lose those changes.`, [
          { id: 'cancel', label: 'Cancel' }, { id: 'save-as', label: 'Save a copy' }, { id: 'overwrite', label: 'Overwrite', style: 'danger' },
        ], 'YOUR FILE IS SAFE');
        if (choice === 'cancel') return false;
        if (choice === 'save-as') {
          const newTarget = await chooseSaveTarget(doc.name); if (!newTarget) return false;
          target = newTarget; expected = this.sameRef(doc.ref, target.ref) ? doc.hash : null;
          // Choosing the same file is not a bypass for the external-change check.
          digest = await writeTo(target.ref, bytes, target.name, expected);
        } else digest = await writeTo(target.ref, bytes, target.name, expected, true);
      }
      if (!this.sameRef(doc.ref, target.ref)) doc.displayPath = null;
      doc.ref = target.ref; doc.name = target.name; doc.hash = digest; doc.sample = false;
      if (target.ref.kind === 'native') this.recordRecent(target.ref.path);
      doc.savedDoc = textAtSave; doc.savedEncoding = encodingAtSave; doc.savedLineEnding = endingAtSave; doc.mixedLineEndings = false;
      this.renderAll(); if (doc.id === this.activeId) void this.applyLanguage();
      this.scheduleRecovery();
      this.toast(target.ref.kind === 'download' ? 'A copy was downloaded. Browser preview cannot overwrite the original file.' : `Saved ${doc.name}.`);
      return true;
    } catch (error) { this.toast(`Could not save ${doc.name}: ${this.errorText(error)}`); return false; }
    finally { doc.saving = false; }
  }

  private sameRef(a: FileRef | null, b: FileRef): boolean {
    if (!a || a.kind !== b.kind) return false;
    if (a.kind === 'native' && b.kind === 'native') return a.path.toLowerCase() === b.path.toLowerCase();
    return a.kind === 'browser' && b.kind === 'browser' && a.handle === b.handle;
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
    this.docs.splice(index, 1);
    if (!this.docs.length) this.docs.push(this.makeDoc('Untitled'));
    if (wasActive) {
      // switchDoc needs a valid old active document while clearing ghost.
      this.activeId = this.docs[Math.min(index, this.docs.length - 1)].id;
      this.cancelAi(); this.view.setState(this.active.state); this.applyEditorPreferences();
      if (this.findOpen) { openSearchPanel(this.view); this.updateSearchQuery(); }
      void this.applyLanguage(); this.view.focus();
    }
    this.renderAll(); this.scheduleRecovery();
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
      tab.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.switchDoc(doc.id); } });
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
    // Avoid scanning a huge file on every keypress. For large buffers show line count instead.
    if (doc.state.doc.length > 1_000_000) $('#word-count').textContent = `${doc.state.doc.lines.toLocaleString()} lines`;
    else {
      const count = doc.state.doc.toString().trim().match(/\S+/gu)?.length || 0;
      $('#word-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
    }
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
    if (this.recoveryBlocked) messages.push('The previous recovery session could not be read. Its stored copy has not been overwritten. Save your current work and restart after fixing storage.');
    else if (this.recoveryFailed && this.settings.recovery) messages.push('A recovery copy could not be saved. Save your work to a file.');
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
    this.renderFiles(); this.updateStatus(); this.renderRecoveryStatus(); this.renderStorageWarning(); this.renderAiStatus(); this.updateMarkdownPreview();
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
    this.view.dispatch({ effects: [
      wrapCompartment.reconfigure(this.settings.wrap ? EditorView.lineWrapping : []),
      indentCompartment.reconfigure([EditorState.tabSize.of(this.settings.tabSize), indentUnit.of(' '.repeat(this.settings.tabSize))]),
    ] });
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
      case 'about': await this.confirm('A little space for big ideas.', `Morrow 0.2.0 is an open-source text and code editor. Your files stay yours. This is an early preview; save important work regularly.`, [{ id: 'ok', label: 'Sounds good', style: 'primary' }], 'ABOUT MORROW'); break;
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
    $('#ai-toggle').addEventListener('click', () => { void this.toggleAi(); });
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
      await saveSession(null);
      this.recoveryCleanupFailed = false;
      this.recoveryBlocked = false;
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
        const choice = await this.confirm('Remove the old recovery copy?', 'Morrow could not read the previous recovery session. Turning recovery off will try to delete that copy, which may contain unsaved work. Save your current files first.', [
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
  const toast = $('#toast'); toast.textContent = `Morrow couldn't start: ${error instanceof Error ? error.message : String(error)}`; toast.hidden = false;
});
