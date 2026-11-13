/**
 * note-index — a bounded, local index of the notes in your folders.
 *
 * Backlinks and tags are the reason people stay with Obsidian, and they are impossible without
 * reading the other notes in a folder. The difference here is that the index is **bounded,
 * visible and disposable**: it reads only folders you explicitly opened, caps the number of
 * files and the size of each read, never writes an index file, never leaves the machine, and
 * can be discarded with one action. What it found (and what it skipped) is reported back so the
 * UI can say it plainly.
 *
 * The parsing helpers are pure (`buildNoteRecord`); the walker takes an injected reader so the
 * whole thing can be tested without a filesystem.
 */

import { collectTags, extractWikiLinks, noteKey, parseFrontmatter, resolveWikiTarget, type NoteCandidate, type WikiLink } from './notes';
import { countTextStats } from './word-stats';

export const MAX_INDEX_FILES = 2_000;
export const MAX_INDEX_FILE_BYTES = 512 * 1024;
export const INDEXABLE_EXTENSIONS = /\.(?:md|markdown|mdown|mkd|mdx|txt|text|kanban)$/iu;

export interface NoteRecord {
  /** File name, e.g. `roadmap.md`. */
  name: string;
  /** Path relative to the folder root. */
  relative: string;
  rootName: string;
  /** Lower-cased, extension-free key used for `[[link]]` matching. */
  key: string;
  title: string | null;
  tags: string[];
  links: WikiLink[];
  words: number;
  /** Epoch millis of the read, for "recently changed" ordering. */
  indexedAt: number;
}

export interface Backlink { record: NoteRecord; link: WikiLink; }

export interface IndexProgress {
  files: number;
  read: number;
  skipped: number;
  issues: string[];
  truncated: boolean;
}

export interface IndexedNote extends NoteCandidate { record: NoteRecord; }

/** Extract everything the index needs from one note's text. Pure and cheap. */
export function buildNoteRecord(input: { name: string; relative: string; rootName: string; text: string; now?: number }): NoteRecord {
  const front = parseFrontmatter(input.text);
  const titleValue = front.data.title;
  const title = typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim().slice(0, 200) : null;
  return {
    name: input.name,
    relative: input.relative,
    rootName: input.rootName,
    key: noteKey(input.name),
    title,
    tags: collectTags(input.text),
    links: extractWikiLinks(input.text),
    words: countTextStats(input.text, 200_000).words,
    indexedAt: input.now ?? Date.now(),
  };
}

/** Every candidate whose key or relative path matches `target` exactly. */
function uniqueMatches(target: string, candidates: readonly NoteCandidate[]): NoteCandidate[] {
  const wanted = noteKey(target);
  if (!wanted) return [];
  const matches = candidates.filter((candidate) =>
    noteKey(candidate.name) === wanted || noteKey(candidate.relative ?? candidate.name) === wanted);
  return matches.length === 1 ? matches : [];
}

export class NoteIndex {
  private records = new Map<string, NoteRecord>();
  private progress: IndexProgress = { files: 0, read: 0, skipped: 0, issues: [], truncated: false };

  clear(): void {
    this.records.clear();
    this.progress = { files: 0, read: 0, skipped: 0, issues: [], truncated: false };
  }

  get size(): number { return this.records.size; }
  get lastProgress(): IndexProgress { return { ...this.progress, issues: [...this.progress.issues] }; }
  all(): NoteRecord[] { return [...this.records.values()]; }

  private static id(rootName: string, relative: string): string {
    return `${rootName}/${relative}`.toLowerCase();
  }

  set(file: { name: string; relative: string; rootName: string }, text: string): void {
    const record = buildNoteRecord({ ...file, text });
    this.records.set(NoteIndex.id(file.rootName, file.relative), record);
  }

  remove(rootName: string, relative: string): void {
    this.records.delete(NoteIndex.id(rootName, relative));
  }

  candidates(): NoteCandidate[] {
    return this.all().map((record) => ({ name: record.name, relative: record.relative }));
  }

  /**
   * Notes that link to `target`. Resolution is reused from `resolveWikiTarget` so a broken or
   * ambiguous link is visible instead of silently disappearing from the backlink pane.
   */
  backlinksTo(target: string): { backlinks: Backlink[]; ambiguous: Backlink[] } {
    const wanted = noteKey(target);
    const backlinks: Backlink[] = [];
    const ambiguous: Backlink[] = [];
    const candidates = this.candidates();
    for (const record of this.records.values()) {
      if (record.key === wanted) continue;
      for (const link of record.links) {
        const resolved = resolveWikiTarget(link.target, candidates);
        if (resolved.status === 'missing') continue;
        const matchesSelf = resolved.match ? noteKey(resolved.match.name) === wanted
          : link.target.trim().toLowerCase().includes(wanted);
        if (!matchesSelf) continue;
        (resolved.status === 'ambiguous' ? ambiguous : backlinks).push({ record, link });
      }
    }
    return { backlinks, ambiguous };
  }

  /** Notes with no incoming links — the "orphans" view Obsidian ships as a core plugin. */
  orphans(): NoteRecord[] {
    const linked = new Set<string>();
    const candidates = this.candidates();
    for (const record of this.records.values()) {
      for (const link of record.links) {
        // Only a unique match counts. An ambiguous link links nothing, so a reader is never told
        // a note is connected when Morrow cannot tell which note was meant.
        for (const candidate of uniqueMatches(link.target, candidates)) {
          linked.add(NoteIndex.id(record.rootName, candidate.relative ?? candidate.name));
        }
      }
    }
    return this.all()
      .filter((record) => !linked.has(NoteIndex.id(record.rootName, record.relative)))
      .sort((a, b) => a.relative.localeCompare(b.relative));
  }

  tagIndex(): { tag: string; count: number; notes: NoteRecord[] }[] {
    const map = new Map<string, NoteRecord[]>();
    for (const record of this.records.values()) {
      for (const tag of record.tags) {
        const list = map.get(tag) ?? [];
        list.push(record);
        map.set(tag, list);
      }
    }
    return [...map.entries()]
      .map(([tag, notes]) => ({ tag, count: notes.length, notes: notes.sort((a, b) => a.relative.localeCompare(b.relative)) }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** Simple, predictable title/path search over notes the full-text folder search does not cover. */
  search(query: string, limit = 40): NoteRecord[] {
    const needle = query.trim().toLowerCase();
    const records = this.all();
    if (!needle) return records.sort((a, b) => b.indexedAt - a.indexedAt).slice(0, limit);
    return records
      .map((record) => {
        const title = (record.title ?? record.name).toLowerCase();
        const index = title.indexOf(needle);
        const pathIndex = record.relative.toLowerCase().indexOf(needle);
        if (index < 0 && pathIndex < 0) return null;
        return { record, score: (index === 0 ? 200 : index > 0 ? 100 - index : 0) + (pathIndex >= 0 ? 20 : 0) };
      })
      .filter((entry): entry is { record: NoteRecord; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score || a.record.relative.localeCompare(b.record.relative))
      .slice(0, limit)
      .map((entry) => entry.record);
  }
}

export interface IndexWalkEntry { name: string; relative: string; rootName: string; }

/**
 * Build an index from an already-walked file list. The caller decides which folders are open;
 * this function only enforces the caps and reports what it could not read.
 */
export async function buildIndex(
  files: readonly IndexWalkEntry[],
  read: (entry: IndexWalkEntry) => Promise<string>,
  options: { signal?: AbortSignal; onProgress?: (progress: IndexProgress) => void } = {},
): Promise<{ index: NoteIndex; progress: IndexProgress }> {
  const index = new NoteIndex();
  const progress: IndexProgress = { files: 0, read: 0, skipped: 0, issues: [], truncated: false };
  for (const entry of files) {
    if (options.signal?.aborted) break;
    if (!INDEXABLE_EXTENSIONS.test(entry.name)) { progress.skipped++; continue; }
    if (progress.read >= MAX_INDEX_FILES) { progress.truncated = true; break; }
    progress.files++;
    try {
      const text = await read(entry);
      if (options.signal?.aborted) break;
      // Files above the cap are indexed for name only, so links to them still resolve.
      if (text.length > MAX_INDEX_FILE_BYTES) {
        index.set(entry, '');
        progress.truncated = true;
        progress.skipped++;
        if (progress.issues.length < 8) progress.issues.push(`${entry.relative}: larger than ${Math.round(MAX_INDEX_FILE_BYTES / 1024)} KB, indexed by name only.`);
        continue;
      }
      index.set(entry, text);
      progress.read++;
    } catch (error) {
      progress.skipped++;
      if (progress.issues.length < 8) progress.issues.push(`${entry.relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (options.onProgress && progress.read % 20 === 0) options.onProgress({ ...progress, issues: [...progress.issues] });
  }
  options.onProgress?.({ ...progress, issues: [...progress.issues] });
  return { index, progress };
}
