import { Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle, LanguageDescription } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import type { Settings } from './storage';

export const languageCompartment = new Compartment();
export const wrapCompartment = new Compartment();
export const indentCompartment = new Compartment();

const colors = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--dim)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: 'var(--syntax-purple)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-green)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-orange)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-blue)' },
  { tag: [tags.className, tags.typeName, tags.namespace], color: 'var(--syntax-orange)' },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: 'var(--text)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-blue)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--muted)' },
  { tag: [tags.tagName, tags.meta, tags.annotation], color: 'var(--syntax-red)' },
  { tag: [tags.heading, tags.strong], color: 'var(--accent)', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--syntax-blue)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--syntax-red)' },
]);

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: GhostWidget) { return this.text === other.text; }
  toDOM(): HTMLElement { const el = document.createElement('span'); el.className = 'cm-ghost'; el.textContent = this.text; return el; }
  ignoreEvent(): boolean { return true; }
}
type Ghost = { at: number; text: string; decorations: DecorationSet } | null;
const ghostEffect = StateEffect.define<{ at: number; text: string } | null>();
const ghostField = StateField.define<Ghost>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) value = null;
    for (const effect of transaction.effects) {
      if (effect.is(ghostEffect)) {
        value = effect.value ? { ...effect.value, decorations: Decoration.set([Decoration.widget({ widget: new GhostWidget(effect.value.text), side: 1 }).range(effect.value.at)]) } : null;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value?.decorations || Decoration.none),
});

export function showGhost(view: EditorView, at: number, text: string): void {
  view.dispatch({ effects: ghostEffect.of({ at, text }) });
}
export function clearGhost(view: EditorView): void {
  if (view.state.field(ghostField, false)) view.dispatch({ effects: ghostEffect.of(null) });
}
export function hasGhost(view: EditorView): boolean { return !!view.state.field(ghostField, false); }
function acceptGhost(view: EditorView): boolean {
  const suggestion = view.state.field(ghostField, false);
  if (!suggestion || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty || view.state.selection.main.head !== suggestion.at) return false;
  view.dispatch({ changes: { from: suggestion.at, insert: suggestion.text }, selection: { anchor: suggestion.at + suggestion.text.length }, effects: ghostEffect.of(null), userEvent: 'input.complete' });
  return true;
}

export function createEditorState(text: string, settings: Settings, onUpdate: (update: ViewUpdate) => void, cursor = 0): EditorState {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  return EditorState.create({
    doc: text,
    selection: { anchor: safeCursor },
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(), drawSelection(), dropCursor(),
      EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(colors), bracketMatching(), closeBrackets(),
      autocompletion({ activateOnTyping: false }), rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
      search({ top: true, createPanel: () => { const dom = document.createElement('div'); dom.hidden = true; return { dom, top: true }; } }),
      languageCompartment.of([]),
      wrapCompartment.of(settings.wrap ? EditorView.lineWrapping : []),
      indentCompartment.of([EditorState.tabSize.of(settings.tabSize), indentUnit.of(' '.repeat(settings.tabSize))]),
      ghostField,
      Prec.highest(keymap.of([
        { key: 'Tab', run: acceptGhost },
        { key: 'Escape', run: (view) => { if (!hasGhost(view)) return false; clearGhost(view); return true; } },
      ])),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
      EditorView.updateListener.of(onUpdate),
      EditorView.contentAttributes.of({ 'aria-label': 'Document text', spellcheck: 'false' }),
    ],
  });
}

export function findLanguage(name: string, override: string | null): LanguageDescription | null {
  if (override === 'Plain text') return null;
  if (override) return languages.find((language) => language.name === override) || null;
  return LanguageDescription.matchFilename(languages, name) || null;
}
export function allLanguages(): readonly LanguageDescription[] { return languages; }
export function languageLabel(name: string, override: string | null): string { return findLanguage(name, override)?.name || 'Plain text'; }
