/**
 * notes — the thin notes layer: front matter, tags and `[[wiki links]]`.
 *
 * Deliberately not a database. Everything here reads ordinary Markdown text and returns plain
 * values, so a note stays a file you can open in Notepad. The whole module is pure: no DOM, no
 * storage, no network, which is what lets the index live in the browser preview too.
 *
 * Scope, stated plainly:
 *  - YAML front matter is the small subset people actually write (scalars, inline lists,
 *    `- item` lists, one level deep). It is **not** a general YAML parser and never evaluates
 *    anything.
 *  - Tags are `#tag` in body text plus a `tags:` front-matter key.
 *  - Links use `[[Target]]`, `[[Target|alias]]` and `[[Target#Heading]]`.
 */

export const MAX_TAG_CHARS = 48;
export const MAX_TAGS_PER_NOTE = 64;
export const MAX_LINKS_PER_NOTE = 256;
export const MAX_FRONTMATTER_CHARS = 8_192;

export interface Frontmatter {
  present: boolean;
  /** Scalar or list values, in file order. Never nested objects. */
  data: Record<string, string | string[]>;
  /** Source with the front matter removed. */
  body: string;
  /** UTF-16 offset of `body` inside the original source. */
  bodyOffset: number;
}

const KEY = /^([A-Za-z0-9_-]{1,64}):(?:[ \t]+(.*))?$/u;
const LIST_ITEM = /^[ \t]*-(?:[ \t]+(.*))?$/u;

export function parseFrontmatter(source: string): Frontmatter {
  if (!source.startsWith('---')) return { present: false, data: {}, body: source, bodyOffset: 0 };
  const firstBreak = source.indexOf('\n');
  if (firstBreak < 0 || firstBreak > 3) return { present: false, data: {}, body: source, bodyOffset: 0 };
  const limit = Math.min(source.length, MAX_FRONTMATTER_CHARS);
  let lineStart = firstBreak + 1;
  let current: string | null = null;
  const data: Record<string, string | string[]> = {};
  while (lineStart < limit) {
    const lineEnd = source.indexOf('\n', lineStart);
    const line = source.slice(lineStart, lineEnd < 0 ? limit : lineEnd);
    if (line.trim() === '---' || line.trim() === '...') {
      // `---` directly followed by `---` is a horizontal rule pair, not an empty metadata block.
      if (!Object.keys(data).length && lineStart === firstBreak + 1) return { present: false, data: {}, body: source, bodyOffset: 0 };
      if (!Object.keys(data).length) return { present: false, data: {}, body: source, bodyOffset: 0 };
      const bodyOffset = lineEnd < 0 ? source.length : lineEnd + 1;
      return { present: true, data, body: source.slice(bodyOffset), bodyOffset };
    }
    const key = KEY.exec(line);
    if (key) {
      current = key[1].toLowerCase();
      const value = (key[2] ?? '').trim();
      if (!value) data[current] = [];
      else if (value.startsWith('[') && value.endsWith(']')) {
        data[current] = value.slice(1, -1).split(',').map((part) => unquote(part.trim())).filter(Boolean).slice(0, MAX_TAGS_PER_NOTE);
      } else data[current] = unquote(value);
    } else {
      const item = LIST_ITEM.exec(line);
      if (item && current) {
        const value = unquote((item[1] ?? '').trim());
        const existing = data[current];
        const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
        if (value) list.push(value);
        data[current] = list.slice(0, MAX_TAGS_PER_NOTE);
      }
      // Anything else (comments, nested maps, multi-line strings) is kept out of `data` rather
      // than guessed at. The body still contains the original text.
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }
  // Unterminated front matter is treated as ordinary text: never hide the user's first lines.
  return { present: false, data: {}, body: source, bodyOffset: 0 };
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

export function frontmatterValue(front: Frontmatter, key: string): string[] {
  const value = front.data[key.toLowerCase()];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/** Lower-cased, trimmed, `#`-stripped, single-token tag; null when it is not a usable tag. */
export function normalizeTag(raw: string): string | null {
  const value = raw.trim().replace(/^#+/u, '').replace(/[.,;:!?)\]}'"]+$/u, '').toLowerCase();
  if (!value || value.length > MAX_TAG_CHARS) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\-_/]*$/u.test(value)) return null;
  return value;
}

const INLINE_TAG = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/u;

/**
 * Tags found in the body plus the front-matter `tags:` key. Code fences, inline code and
 * Markdown headings (`# Title`) are skipped, because `#` means something else there.
 */
export function collectTags(source: string): string[] {
  const front = parseFrontmatter(source);
  const tags = new Set<string>();
  for (const raw of frontmatterValue(front, 'tags')) {
    for (const part of raw.split(/[,\s]+/u)) {
      const tag = normalizeTag(part);
      if (tag) tags.add(tag);
      if (tags.size >= MAX_TAGS_PER_NOTE) return [...tags];
    }
  }
  let fence: string | null = null;
  for (const line of front.body.split('\n')) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const withoutCode = line.replace(/`[^`]*`/gu, ' ');
    if (/^\s{0,3}#{1,6}\s/u.test(withoutCode)) continue;
    for (const match of withoutCode.matchAll(INLINE_TAG)) {
      const tag = normalizeTag(match[2]);
      if (tag) tags.add(tag);
      if (tags.size >= MAX_TAGS_PER_NOTE) return [...tags];
    }
  }
  return [...tags];
}

export interface WikiLink {
  /** The link target as written, without alias or heading. */
  target: string;
  alias: string | null;
  heading: string | null;
  /** 0-based line index, used for "references" lists. */
  line: number;
}

const WIKI = /\[\[([^\]\n]{1,200})\]\]/gu;

export function extractWikiLinks(source: string): WikiLink[] {
  const front = parseFrontmatter(source);
  const links: WikiLink[] = [];
  let line = 0;
  let fence: string | null = null;
  const frontLines = source.slice(0, front.present ? source.length - front.body.length : 0).split('\n').length - 1;
  for (const text of front.body.split('\n')) {
    const fenceMatch = FENCE.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
    } else if (fence === null) {
      const withoutCode = text.replace(/`[^`]*`/gu, ' ');
      for (const match of withoutCode.matchAll(WIKI)) {
        const inner = match[1].trim();
        if (!inner) continue;
        const pipe = inner.indexOf('|');
        const beforeAlias = pipe >= 0 ? inner.slice(0, pipe) : inner;
        const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() || null : null;
        const hash = beforeAlias.indexOf('#');
        const target = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim().replace(/\.md$/iu, '');
        const heading = hash >= 0 ? beforeAlias.slice(hash + 1).trim() || null : null;
        links.push({ target, alias, heading, line: line + frontLines });
        if (links.length >= MAX_LINKS_PER_NOTE) return links;
      }
    }
    line++;
  }
  return links;
}

/** Case-insensitive key used to match `[[Some Note]]` against `Some Note.md`. */
export function noteKey(name: string): string {
  const base = name.replace(/^.*[\\/]/u, '').replace(/\.(?:md|markdown|mdown|mkd|mdx|txt)$/iu, '');
  return base.trim().toLowerCase();
}

export interface NoteCandidate {
  /** File name including extension. */
  name: string;
  /** Path relative to its folder root, when known. */
  relative?: string;
}

export interface ResolvedLink {
  status: 'linked' | 'ambiguous' | 'missing';
  /** Chosen candidate when exactly one match exists. */
  match: NoteCandidate | null;
  matches: number;
}

/**
 * Resolve one wiki target against a list of note names. A target containing `/` also matches
 * on relative path, so `[[projects/roadmap]]` prefers `projects/roadmap.md` over a same-named
 * file elsewhere. Ambiguity is reported rather than guessed: silently linking the wrong note is
 * the failure mode that makes backlink panes untrustworthy.
 */
export function resolveWikiTarget(target: string, candidates: readonly NoteCandidate[]): ResolvedLink {
  const wanted = noteKey(target);
  if (!wanted) return { status: 'missing', match: null, matches: 0 };
  const trailing = wanted.includes('/') ? wanted : null;
  const exact: NoteCandidate[] = [];
  const loose: NoteCandidate[] = [];
  for (const candidate of candidates) {
    const key = noteKey(candidate.name);
    if (key === wanted) exact.push(candidate);
    else if (trailing && noteKey(candidate.relative ?? candidate.name) === trailing) exact.push(candidate);
    else if (trailing && noteKey(candidate.relative ?? candidate.name).endsWith(`/${trailing}`)) loose.push(candidate);
  }
  const found = exact.length ? exact : loose;
  if (found.length === 1) return { status: 'linked', match: found[0], matches: 1 };
  if (found.length > 1) return { status: 'ambiguous', match: null, matches: found.length };
  return { status: 'missing', match: null, matches: 0 };
}

/** Merge ranked tag lists into `name → count`, bounded for display. */
export function tagCounts(lists: Iterable<readonly string[]>, limit = 200): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const tag of list) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** Template expansion for new notes, using `{{date}}`, `{{time}}`, `{{title}}`. */
export function expandTemplate(template: string, values: { date: string; time: string; title: string }): string {
  return template
    .replace(/\{\{\s*date\s*\}\}/giu, values.date)
    .replace(/\{\{\s*time\s*\}\}/giu, values.time)
    .replace(/\{\{\s*title\s*\}\}/giu, values.title)
    .slice(0, 100_000);
}
