// Page-side adapters. Each engine exposes the same small surface so the same workload
// runs on all three. Timing happens inside the page with performance.now().
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { SearchQuery } from '@codemirror/search';
import * as monaco from 'monaco-editor';
import EditorWorker from '../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker';
import ace from 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/mode-text';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const AceSearch = ace.require('ace/search').Search;

const adapters = {
  // CodeMirror 6 core, the engine Wrytrove uses. Line numbers and undo history only.
  codemirror: {
    mount(host, text) {
      const view = new EditorView({
        state: EditorState.create({ doc: text, extensions: [lineNumbers(), history()] }),
        parent: host,
      });
      return {
        length: () => view.state.doc.length,
        count(needle) {
          const cursor = new SearchQuery({ search: needle, literal: true, caseSensitive: true }).getCursor(view.state.doc);
          let n = 0;
          for (let r = cursor.next(); !r.done; r = cursor.next()) n++;
          return n;
        },
        replaceAll(needle, replacement) {
          const cursor = new SearchQuery({ search: needle, replace: replacement, literal: true, caseSensitive: true }).getCursor(view.state.doc);
          const changes = [];
          for (let r = cursor.next(); !r.done; r = cursor.next()) {
            changes.push({ from: r.value.from, to: r.value.to, insert: replacement });
          }
          view.dispatch({ changes });
          return changes.length;
        },
        insertAt(offset, s) {
          view.dispatch({ changes: { from: offset, insert: s } });
        },
        dispose() {
          view.destroy();
        },
      };
    },
  },

  // Monaco, the editor inside VS Code. Plain text mode, no minimap, workers enabled.
  monaco: {
    mount(host, text) {
      const model = monaco.editor.createModel(text, 'plaintext');
      const editor = monaco.editor.create(host, {
        model,
        lineNumbers: 'on',
        minimap: { enabled: false },
        wordWrap: 'off',
        automaticLayout: false,
      });
      const scope = model.getFullModelRange();
      const matches = (needle) => model.findMatches(needle, scope, false, true, null, false, 1e9);
      return {
        length: () => model.getValueLength(),
        count: (needle) => matches(needle).length,
        replaceAll(needle, replacement) {
          const found = matches(needle);
          editor.executeEdits('bench', found.map((m) => ({ range: m.range, text: replacement })));
          return found.length;
        },
        insertAt(offset, s) {
          const p = model.getPositionAt(offset);
          editor.executeEdits('bench', [
            { range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: s, forceMoveMarkers: true },
          ]);
        },
        dispose() {
          editor.dispose();
          model.dispose();
        },
      };
    },
  },

  // Ace, the editor used by Cloud9 and many web tools. Plain text mode, no worker.
  ace: {
    mount(host, text) {
      const editor = ace.edit(host, { mode: 'ace/mode/text', showPrintMargin: false, wrap: false, useWorker: false });
      editor.setValue(text, -1);
      const session = editor.session;
      return {
        length: () => session.getValue().length,
        count: (needle) => new AceSearch().set({ needle, caseSensitive: true }).findAll(session).length,
        replaceAll(needle, replacement) {
          const found = new AceSearch().set({ needle, caseSensitive: true }).findAll(session).length;
          editor.replaceAll(replacement, { needle, caseSensitive: true });
          return found;
        },
        insertAt(offset, s) {
          session.insert(session.doc.indexToPosition(offset), s);
        },
        dispose() {
          editor.destroy();
        },
      };
    },
  },
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const EDITS_PER_RUN = 200;

// Runs the workload `runs` times on a fresh editor each time. Callers discard the first run as warm-up.
window.runEngine = async function runEngine(name, text, runs, needle, replacement) {
  const adapter = adapters[name];
  const out = [];
  for (let i = 0; i < runs; i++) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:900px;height:600px';
    document.body.append(host);

    let t = performance.now();
    const handle = adapter.mount(host, text);
    await nextFrame();
    const mountMs = performance.now() - t;

    t = performance.now();
    const found = handle.count(needle);
    const findMs = performance.now() - t;

    t = performance.now();
    const replaced = handle.replaceAll(needle, replacement);
    await nextFrame();
    const replaceMs = performance.now() - t;

    // Typing-like edits in the middle of the document. One frame at the end, so the
    // figure is per edit including one render flush rather than per-keystroke frame time.
    const mid = Math.floor(handle.length() / 2);
    t = performance.now();
    for (let k = 0; k < EDITS_PER_RUN; k++) handle.insertAt(mid, 'x');
    await nextFrame();
    const editMs = (performance.now() - t) / EDITS_PER_RUN;

    // Verify the document really changed: no needle may remain after replace-all.
    const leftover = handle.count(needle);
    handle.dispose();
    host.remove();
    out.push({ mountMs, findMs, replaceMs, editMs, found, replaced, leftover, correct: found > 0 && replaced === found && leftover === 0 });
  }
  return out;
};
window.engineNames = Object.keys(adapters);
window.benchReady = true;
