/**
 * focus — distraction-free writing helpers.
 *
 * iA Writer and Typora sell themselves on two switches: **Focus mode**, which dims everything
 * except the sentence or paragraph you are editing, and **Typewriter mode**, which keeps the
 * caret on a fixed line. Both are small state machines, so the state lives here and the CSS
 * lives in `style.css`; nothing in this module touches the DOM.
 */

export interface FocusSettings {
  /** Dim everything but the active sentence/paragraph. */
  focus: boolean;
  /** Accepted values match iA Writer's three scopes. */
  scope: 'sentence' | 'paragraph';
  /** Keep the caret vertically centred while typing. */
  typewriter: boolean;
  /** Hide the file tree, tabs and status bar. Escape always restores them. */
  zen: boolean;
}

export const defaultFocus: FocusSettings = { focus: false, scope: 'paragraph', typewriter: false, zen: false };

export function sanitizeFocus(value: unknown): FocusSettings {
  const raw = (value ?? {}) as Partial<FocusSettings>;
  return {
    focus: raw.focus === true,
    scope: raw.scope === 'sentence' ? 'sentence' : 'paragraph',
    typewriter: raw.typewriter === true,
    zen: raw.zen === true,
  };
}

export function isAnyFocusActive(settings: FocusSettings): boolean {
  return settings.focus || settings.typewriter || settings.zen;
}

export function focusLabel(settings: FocusSettings): string {
  const active: string[] = [];
  if (settings.focus) active.push('Focus');
  if (settings.typewriter) active.push('Typewriter');
  if (settings.zen) active.push('Zen');
  return active.length ? active.join(' + ') : 'Free layout';
}

/** Text for the polite live region; it is deliberately concise and never a toast-only message. */
export function focusAnnouncement(settings: FocusSettings): string {
  return isAnyFocusActive(settings) ? `${focusLabel(settings)} mode on.` : 'Focus, typewriter and zen modes off.';
}

/** Classes applied to `<html>` so CSS can react without measuring anything in JavaScript. */
export function focusClassList(settings: FocusSettings): string[] {
  const classes: string[] = [];
  if (settings.focus) classes.push('focus-mode', `focus-${settings.scope}`);
  if (settings.typewriter) classes.push('typewriter-mode');
  if (settings.zen) classes.push('zen-mode');
  return classes;
}

/** Removes every focus-related class. Used when the mode is switched off or reset by Escape. */
export const FOCUS_CLASSES = ['focus-mode', 'focus-sentence', 'focus-paragraph', 'typewriter-mode', 'zen-mode'] as const;

/**
 * Space above the last line that lets typewriter mode keep the caret centred even at the end of
 * a short document. Returned in CSS pixels, clamped so a tall window cannot scroll the caret off.
 */
export function typewriterPadding(viewportHeight: number, lineHeight: number, enabled: boolean): number {
  if (!enabled) return 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 21;
  return Math.max(0, Math.round(height / 2 - line * 2));
}

/**
 * Where the active sentence starts and ends. Terminal punctuation followed by whitespace ends a
 * sentence. The search is bounded to the current paragraph (and to a window inside it) so a
 * stray comma in a 40 KB paragraph cannot cost a full scan on every keystroke.
 */
export function sentenceAround(text: string, position: number): { from: number; to: number } {
  const at = Math.max(0, Math.min(position, text.length));
  const paragraphStart = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
  const breakIndex = text.indexOf('\n', at);
  let blockStart = paragraphStart;
  let blockEnd = breakIndex < 0 ? text.length : breakIndex;
  const WINDOW = 4_000;
  if (blockEnd - blockStart > WINDOW) {
    blockStart = Math.max(blockStart, at - WINDOW / 2);
    blockEnd = Math.min(blockEnd, at + WINDOW / 2);
  }
  const terminal = (index: number): boolean => {
    const char = text[index];
    if (char !== '.' && char !== '!' && char !== '?' && char !== '\u3002' && char !== '\u0964') return false;
    // CJK terminators are followed directly by the next sentence, without a space.
    if (char === '\u3002' || char === '\u0964') return true;
    const next = text[index + 1];
    return next === undefined || /\s/u.test(next);
  };
  let from = blockStart;
  for (let index = at - 1; index >= blockStart; index--) {
    if (terminal(index)) { from = index + 1; break; }
  }
  let to = blockEnd;
  for (let index = at; index < blockEnd; index++) {
    if (terminal(index)) { to = index + 1; break; }
  }
  while (from < to && /\s/u.test(text[from])) from++;
  while (to > from && /\s/u.test(text[to - 1])) to--;
  return { from, to };
}

export function paragraphAround(text: string, position: number): { from: number; to: number } {
  const at = Math.max(0, Math.min(position, text.length));
  const from = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
  const breakIndex = text.indexOf('\n', at);
  return { from, to: breakIndex < 0 ? text.length : breakIndex };
}

/**
 * The range focus mode decorates for the caret position and scope. A caret sitting on an empty
 * line has an empty paragraph; callers treat `from === to` as "decorate nothing".
 */
export function focusRange(text: string, position: number, scope: FocusSettings['scope']): { from: number; to: number } {
  return scope === 'sentence' ? sentenceAround(text, position) : paragraphAround(text, position);
}
