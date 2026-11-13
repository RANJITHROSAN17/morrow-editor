/**
 * markdown-extensions — the Markdown dialect Morrow renders.
 *
 * Plain CommonMark is the floor, not the ceiling. Obsidian users expect `[[wikilinks]]`,
 * `#tags`, `- [ ]` task lists and `> [!note]` callouts; GitHub users expect the same callouts;
 * Typora users expect `$math$`. Each transform here runs **before** the third-party parser
 * (so the output stays inside the inert node contract) and is a pure string function with a
 * unit test. Nothing here emits HTML.
 */

export const MAX_TAG_TEXT = 48;
export const MAX_LINK_TEXT = 120;

/** `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]` → a Markdown link with a `note:` scheme. */
export function renderWikiLinks(source: string): string {
  return source.replace(/\[\[([^\]\n]{1,200})\]\]/gu, (whole, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed) return whole;
    const pipe = trimmed.indexOf('|');
    const beforeAlias = pipe >= 0 ? trimmed.slice(0, pipe) : trimmed;
    const alias = pipe >= 0 ? trimmed.slice(pipe + 1).trim() : '';
    const hash = beforeAlias.indexOf('#');
    const target = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim();
    const heading = hash >= 0 ? beforeAlias.slice(hash + 1).trim() : '';
    const label = (alias || (heading ? `${target || 'This note'} › ${heading}` : target)).slice(0, MAX_LINK_TEXT);
    const safe = target.replace(/[()\\]/gu, '\\$&');
    const suffix = heading ? `#${heading.replace(/[()\\]/gu, '\\$&')}` : '';
    return `[${label}](note:${safe}${suffix})`;
  });
}

/**
 * `#tag` in body text (not headings, not code fences) → an inert `tag:` link. The tag text is
 * preserved in the label so a reader who never clicks still sees it.
 */
export function renderInlineTags(source: string): string {
  let fence: string | null = null;
  return source
    .split('\n')
    .map((line) => {
      const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
      if (match) {
        const marker = match[1][0];
        if (fence === null) fence = marker;
        else if (marker === fence) fence = null;
        return line;
      }
      if (fence !== null) return line;
      if (/^\s{0,3}#{1,6}\s/u.test(line)) return line;
      const withoutCode = line.replace(/`[^`]*`/gu, (code) => code);
      return withoutCode.replace(/(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_/-]{0,47})/gu, (whole, lead: string, tag: string) => {
        // Trailing punctuation is not part of a tag.
        const cleaned = tag.replace(/[-/]+$/u, '');
        if (!cleaned || /^\d+$/u.test(cleaned) && !/[a-z]/iu.test(cleaned)) return whole;
        return `${lead}[#${cleaned}](tag:${cleaned.toLowerCase()})`;
      });
    })
    .join('\n');
}

/** `- [ ]` / `- [x]` → a text checkbox that is read-only in the preview. */
export function renderTaskLists(source: string): string {
  return source.split('\n')
    .map((line) => line.replace(/^(\s*[-*+]\s+)\[([ xX])\]\s/u, (_whole, lead: string, state: string) => `${lead}${state.toLowerCase() === 'x' ? '☑\uFE0E' : '☐\uFE0E'} `))
    .join('\n');
}

const CALLOUT_KINDS = new Set(['note', 'tip', 'important', 'warning', 'caution', 'info', 'success', 'question', 'quote', 'danger', 'bug', 'example', 'abstract', 'summary', 'todo', 'attention', 'failure', 'hint']);

/**
 * `> [!warning] Title` blocks become `> **⚠ Warning** — Title`, keeping them inside the
 * blockquote node the preview contract already understands (no new tags, no HTML).
 */
export function renderCallouts(source: string): string {
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*>\s*)\[!([a-zA-Z]+)\]([+-])?(?:\s+(.*))?$/u.exec(lines[index]);
    if (!match) continue;
    const kind = match[2].toLowerCase();
    if (!CALLOUT_KINDS.has(kind)) continue;
    const title = (match[4] ?? '').trim();
    const icon = kind === 'warning' || kind === 'caution' || kind === 'attention' ? '⚠'
      : kind === 'danger' || kind === 'failure' || kind === 'bug' ? '⛔'
      : kind === 'tip' || kind === 'hint' ? '💡'
      : kind === 'question' ? '❓'
      : kind === 'success' ? '✅'
      : kind === 'todo' ? '📋'
      : kind === 'quote' ? '❝'
      : 'ℹ';
    const name = kind.charAt(0).toUpperCase() + kind.slice(1);
    lines[index] = `${match[1]}**${icon} ${name}**${title ? ` — ${title}` : ''}`;
  }
  return lines.join('\n');
}

/**
 * `$inline$` and `$$block$$` math. Morrow does not bundle a TeX renderer (a new dependency, a
 * font, and an injection surface), so math is shown as a labelled, monospaced literal and the
 * user can copy it into another tool. Saying so plainly beats pretending to render.
 */
export function renderMath(source: string): string {
  const withBlocks = source.replace(/\$\$\s*\n?([\s\S]{0,4000}?)\n?\s*\$\$/gu, (_whole, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return _whole;
    return `\n\n\`∑ ${trimmed.replace(/`/gu, "'").replace(/\n/gu, ' ')}\`\n\n`;
  });
  return withBlocks.replace(/(^|[\s(])\$([^$\n]{1,400})\$(?=[\s).,;:!?]|$)/gu, (whole, lead: string, body: string) => {
    if (!/[\\^_=<>]/u.test(body)) return whole;
    return `${lead}\`∑ ${body.replace(/`/gu, "'")}\``;
  });
}

/** Order matters: math first (it can contain `$`), then links/tags, then block-level rewrites. */
export function preprocessMarkdown(source: string): string {
  let result = source;
  result = renderMath(result);
  result = renderCallouts(result);
  result = renderTaskLists(result);
  result = renderWikiLinks(result);
  result = renderInlineTags(result);
  return result;
}

/** True when a document contains any extension syntax, used to decide whether to preprocess. */
export function hasExtensions(source: string): boolean {
  return /\[\[|\]\]|(^|\s)#[\p{L}\p{N}]|\[[ xX]\]|\[![a-zA-Z]+\]|\$/mu.test(source);
}
