import { describe, expect, it } from 'vitest';
import { buildIndex, buildNoteRecord, isPathInsideRoot, MAX_INDEX_FILE_BYTES, MAX_INDEX_FILES, NoteIndex, shouldInvalidateIndexOnSave, type IndexWalkEntry } from '../src/note-index';
import { dailyNotePath, expandDailyTemplate, isSafeRelativePath, isoDate } from '../src/daily';

const note = (relative: string, text: string, rootName = 'vault') => ({
  entry: { name: relative.split('/').pop()!, relative, rootName },
  text,
});

describe('note records', () => {
  it('extracts title, tags, links and word count from one note', () => {
    const record = buildNoteRecord({
      name: 'Plan.md', relative: 'projects/Plan.md', rootName: 'vault', now: 5,
      text: ['---', 'title: The Plan', 'tags: [work]', '---', 'See [[Roadmap]] and #ideas.', 'more words here'].join('\n'),
    });
    expect(record).toMatchObject({ key: 'plan', title: 'The Plan', indexedAt: 5 });
    expect(record.tags.sort()).toEqual(['ideas', 'work']);
    expect(record.links.map((link) => link.target)).toEqual(['Roadmap']);
    expect(record.words).toBeGreaterThan(3);
    expect(record.indexedAt).toBe(5);
  });
});

describe('save invalidation decision', () => {
  it('marks a successful save inside an open native folder stale', () => {
    const roots = ['C:\\Vault', 'D:\\Work\\Notes'];
    expect(shouldInvalidateIndexOnSave('C:\\Vault\\Plan.md', roots)).toBe(true);
    expect(shouldInvalidateIndexOnSave('c:/vault/projects/Plan.md', roots)).toBe(true);
    expect(shouldInvalidateIndexOnSave('C:\\Vault\\', roots)).toBe(true);
    expect(shouldInvalidateIndexOnSave('D:\\Work\\Notes\\Inbox.md', roots)).toBe(true);
  });

  it('does not confuse a sibling folder prefix with containment', () => {
    const roots = ['C:\\Vault', '/home/me/vault'];
    expect(shouldInvalidateIndexOnSave('C:\\Vault2\\Plan.md', roots)).toBe(false);
    expect(shouldInvalidateIndexOnSave('C:\\Vault-old\\Plan.md', roots)).toBe(false);
    expect(shouldInvalidateIndexOnSave('/home/me/vault2/Plan.md', roots)).toBe(false);
    expect(shouldInvalidateIndexOnSave('/home/me/other/Plan.md', roots)).toBe(false);
  });

  it('ignores saves with no folder path and empty workspaces', () => {
    expect(shouldInvalidateIndexOnSave(null, ['C:\\Vault'])).toBe(false);
    expect(shouldInvalidateIndexOnSave(undefined, ['C:\\Vault'])).toBe(false);
    expect(shouldInvalidateIndexOnSave('', ['C:\\Vault'])).toBe(false);
    expect(shouldInvalidateIndexOnSave('C:\\Vault\\Plan.md', [])).toBe(false);
    expect(shouldInvalidateIndexOnSave('C:\\Vault\\Plan.md', ['', '   '])).toBe(false);
  });

  it('handles nested POSIX paths and filesystem roots', () => {
    expect(isPathInsideRoot('/home/me/vault/notes/Plan.md', '/home/me/vault/')).toBe(true);
    expect(shouldInvalidateIndexOnSave('/home/me/vault/notes/Plan.md', ['/home/me/vault'])).toBe(true);
    expect(shouldInvalidateIndexOnSave('C:\\Plan.md', ['C:\\'])).toBe(true);
    expect(shouldInvalidateIndexOnSave('/Plan.md', ['/'])).toBe(true);
    expect(shouldInvalidateIndexOnSave('relative/Plan.md', ['/'])).toBe(false);
  });
});

describe('note index', () => {
  const index = new NoteIndex();
  const roadmap = note('Roadmap.md', '# Roadmap\nlinks to [[Plan]]');
  const plan = note('Plan.md', '# Plan\nsee [[Roadmap]]');
  const duplicate = note('Notes/Plan.md', '# Duplicate name\nsee [[Roadmap]]');
  const inbox = note('Inbox.md', 'Ideas #work #later');
  for (const entry of [roadmap, plan, duplicate, inbox]) index.set(entry.entry, entry.text);

  it('lists the notes that link to a uniquely named note', () => {
    const { backlinks } = index.backlinksTo('Roadmap');
    expect(backlinks.map((entry) => entry.record.relative).sort()).toEqual(['Notes/Plan.md', 'Plan.md']);
    expect(index.backlinksTo('Missing').backlinks).toEqual([]);
  });

  it('reports an ambiguous link instead of quietly choosing a note', () => {
    const result = index.backlinksTo('Plan');
    expect(result.ambiguous.map((entry) => entry.record.relative)).toEqual(['Roadmap.md']);
    expect(result.backlinks).toEqual([]);
  });

  it('finds orphans, sorted by path', () => {
    // Only notes that a *resolvable* link points at are "linked". `[[Plan]]` is ambiguous, so
    // neither Plan.md nor Notes/Plan.md counts as linked, and Inbox is genuinely unreferenced.
    expect(index.orphans().map((record) => record.relative)).toEqual(['Inbox.md', 'Notes/Plan.md', 'Plan.md']);
  });

  it('counts tags across every indexed note', () => {
    expect(index.tagIndex().map((entry) => [entry.tag, entry.count])).toEqual([['later', 1], ['work', 1]]);
  });

  it('searches titles and paths with prefix matches first', () => {
    expect(index.search('road').map((record) => record.relative)).toEqual(['Roadmap.md']);
    expect(index.search('notes').map((record) => record.relative)).toEqual(['Notes/Plan.md']);
    expect(index.search('')).toHaveLength(4);
  });

  it('removes a record and reports its size', () => {
    const copy = new NoteIndex();
    copy.set(note('a.md', 'x').entry, 'x');
    expect(copy.size).toBe(1);
    copy.remove('vault', 'a.md');
    expect(copy.size).toBe(0);
    copy.clear();
    expect(copy.lastProgress.read).toBe(0);
  });
});

describe('bounded indexing', () => {
  it('reads only supported extensions and reports every failure', async () => {
    const files: IndexWalkEntry[] = [
      { name: 'a.md', relative: 'a.md', rootName: 'v' },
      { name: 'image.png', relative: 'image.png', rootName: 'v' },
      { name: 'broken.md', relative: 'broken.md', rootName: 'v' },
      { name: 'big.md', relative: 'big.md', rootName: 'v' },
    ];
    const texts: Record<string, string> = {
      'a.md': '# A',
      'broken.md': '',
      'big.md': 'x'.repeat(MAX_INDEX_FILE_BYTES + 1),
    };
    const { index, progress } = await buildIndex(files, async (entry) => {
      if (entry.relative === 'broken.md') throw new Error('Permission denied');
      return texts[entry.relative];
    });
    // a.md is read; big.md is indexed by name only; image.png is skipped; broken.md fails.
    expect(index.size).toBe(2);
    expect(progress.read).toBe(1);
    expect(progress.issues.join(' ')).toContain('Permission denied');
    expect(progress.issues.join(' ')).toContain('name only');
  });

  it('stops at the file cap and marks the result truncated', async () => {
    const files: IndexWalkEntry[] = Array.from({ length: MAX_INDEX_FILES + 5 }, (_, index) => ({
      name: `n${index}.md`, relative: `n${index}.md`, rootName: 'v',
    }));
    const { progress } = await buildIndex(files, async () => 'body');
    expect(progress.read).toBe(MAX_INDEX_FILES);
    expect(progress.truncated).toBe(true);
  });

  it('honours an abort signal so a cancelled index never claims to be complete', async () => {
    const controller = new AbortController();
    const files: IndexWalkEntry[] = Array.from({ length: 10 }, (_, index) => ({ name: `n${index}.md`, relative: `n${index}.md`, rootName: 'v' }));
    const { progress } = await buildIndex(files, async () => { controller.abort(); return 'body'; }, { signal: controller.signal });
    expect(progress.read).toBeLessThan(files.length);
    expect(progress.issues).toEqual([]);
  });
});

describe('daily notes and capture', () => {
  const date = new Date(2026, 10, 13, 9, 5);

  it('builds safe, dated paths for every format', () => {
    expect(dailyNotePath('yyyy-mm-dd', date)).toBe('2026-11-13');
    expect(dailyNotePath('yyyy-mm-dd', date, 'Daily')).toBe('Daily/2026-11-13');
    expect(dailyNotePath('yyyy/MM/dd', date, 'journal')).toBe('journal/2026/11/13');
    expect(dailyNotePath('dd-MM-yyyy', date)).toBe('13-11-2026');
    expect(dailyNotePath('yyyy-mm', date)).toBe('2026-11');
    expect(() => dailyNotePath('yyyy-mm-dd', date, '../escape')).toThrow();
  });

  it('rejects traversal, device names and control characters in folder paths', () => {
    expect(isSafeRelativePath('Daily')).toBe(true);
    expect(isSafeRelativePath('notes/2026')).toBe(true);
    expect(isSafeRelativePath('..')).toBe(false);
    expect(isSafeRelativePath('a/../b')).toBe(false);
    expect(isSafeRelativePath('C:/notes')).toBe(false);
    expect(isSafeRelativePath('CON')).toBe(false);
    expect(isSafeRelativePath('trailing ')).toBe(false);
  });

  it('expands template placeholders with local values', () => {
    const expanded = expandDailyTemplate('{{title}} {{date}} {{time}} {{weekday}}', date, 'Daily');
    expect(expanded).toMatch(/^Daily 2026-11-13 09:05 \w+$/);
    expect(isoDate(date)).toBe('2026-11-13');
  });
});
