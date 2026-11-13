import { Compartment, EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle, LanguageDescription } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import type { Settings } from './storage';
import { focusRange, typewriterPadding, type FocusSettings } from './focus-mode';
import { smartCharacter } from './markdown-format';

export const languageCompartment = new Compartment();
export const wrapCompartment = new Compartment();
export const indentCompartment = new Compartment();
export const spellcheckCompartment = new Compartment();
export const focusCompartment = new Compartment();
export const smartCompartment = new Compartment();

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

/* ---------------------------------------------------------------------------------------- *
 * Focus mode: dim everything except the sentence or paragraph around the caret.
 * Implemented as line decorations so the highlighted range survives scrolling and wrapping
 * without measuring the DOM. When disabled the field holds `Decoration.none`.
 * ---------------------------------------------------------------------------------------- */

const focusEffect = StateEffect.define<FocusSettings | null>();
type FocusState = { settings: FocusSettings; decorations: DecorationSet };

function buildFocusDecorations(state: EditorState, settings: FocusSettings): DecorationSet {
  if (!settings.focus) return Decoration.none;
  const ranges = state.selection.ranges.filter((range) => range.empty);
  if (!ranges.length) return Decoration.none;
  const marks: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const line = state.doc.lineAt(range.head);
    const focus = focusRange(line.text, range.head - line.from, settings.scope);
    const from = line.from + focus.from;
    const to = line.from + focus.to;
    if (to > from) marks.push({ from, to });
  }
  if (!marks.length) return Decoration.none;
  return Decoration.set(marks.map((mark) => Decoration.mark({ class: 'cm-focus-active' }).range(mark.from, mark.to)), true);
}

const focusField = StateField.define<FocusState>({
  create: () => ({ settings: { focus: false, scope: 'paragraph', typewriter: false, zen: false }, decorations: Decoration.none }),
  update(value, transaction) {
    let settings = value.settings;
    for (const effect of transaction.effects) if (effect.is(focusEffect)) settings = effect.value ?? { ...settings, focus: false };
    if (!settings.focus) return settings === value.settings ? value : { settings, decorations: Decoration.none };
    if (transaction.docChanged || transaction.selection || transaction.effects.length) {
      return { settings, decorations: buildFocusDecorations(transaction.state, settings) };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function applyFocus(view: EditorView, settings: FocusSettings): void {
  view.dispatch({ effects: focusEffect.of(settings) });
}

/**
 * Typewriter mode: keep the caret on a fixed line by adding trailing padding equal to half the
 * viewport, so the last line can still reach the middle of the screen.
 */
function typewriterExtension(enabled: boolean): Extension {
  if (!enabled) return [];
  return EditorView.theme({
    '.cm-content': { paddingBottom: 'calc(50vh - 4rem) !important', paddingTop: 'calc(50vh - 4rem) !important' },
  });
}

/**
 * Smart typography while typing. Only a single typed character with no selection is considered,
 * so pastes, IME composition, undo and multi-cursor edits are never rewritten.
 */
function smartTypingExtension(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1 || from !== to) return false;
    if (view.composing) return false;
    // Only rewrite when the document looks like prose; code and config files keep ASCII quotes.
    const line = view.state.doc.lineAt(from);
    if (/^\s{0,3}(?:[`>#|]|[-*+]\s|\d+[.)]\s)/u.test(line.text)) return false;
    const replacement = smartCharacter(view.state.doc.toString(), from, text);
    if (!replacement || replacement === text) return false;
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + replacement.length },
      userEvent: 'input.type',
    });
    return true;
  });
}

/** A ruler line at the configured column, drawn with a repeating gradient. */
function rulerExtension(column: number): Extension {
  if (!column) return [];
  return EditorView.theme({
    '.cm-content': { backgroundImage: `linear-gradient(to right, transparent calc(${column}ch - 1px), var(--line) calc(${column}ch - 1px), var(--line) ${column}ch, transparent ${column}ch)` },
  });
}

export function createEditorState(text: string, settings: Settings, onUpdate: (update: ViewUpdate) => void, cursor = 0): EditorState {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const spellcheck = settings.spellcheck ? 'true' : 'false';
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
      focusField,
      focusCompartment.of(typewriterExtension(settings.focus.typewriter)),
      smartCompartment.of(settings.smart ? smartTypingExtension() : []),
      rulerExtension(settings.maxLineLength),
      spellcheckCompartment.of(EditorView.contentAttributes.of({ spellcheck })),
      Prec.highest(keymap.of([
        { key: 'Tab', run: acceptGhost },
        { key: 'Escape', run: (view) => { if (!hasGhost(view)) return false; clearGhost(view); return true; } },
      ])),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
      EditorView.updateListener.of(onUpdate),
      EditorView.contentAttributes.of({ 'aria-label': 'Document text' }),
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

/** Re-apply the settings that are expressed as compartments (no editor rebuild required). */
export function applyEditorExtensions(view: EditorView, settings: Settings): void {
  view.dispatch({ effects: [
    wrapCompartment.reconfigure(settings.wrap ? EditorView.lineWrapping : []),
    indentCompartment.reconfigure([EditorState.tabSize.of(settings.tabSize), indentUnit.of(' '.repeat(settings.tabSize))]),
    focusCompartment.reconfigure(typewriterExtension(settings.focus.typewriter)),
    spellcheckCompartment.reconfigure(EditorView.contentAttributes.of({ spellcheck: settings.spellcheck ? 'true' : 'false' })),
    smartCompartment.reconfigure(settings.smart ? smartTypingExtension() : []),
    focusEffect.of(settings.focus),
  ] });
}

/** Height, in CSS pixels, that typewriter mode would add for this viewport. */
export function typewriterSpace(view: EditorView, enabled: boolean): number {
  return typewriterPadding(view.scrollDOM.clientHeight, view.defaultLineHeight, enabled);
}

export { typewriterPadding };
