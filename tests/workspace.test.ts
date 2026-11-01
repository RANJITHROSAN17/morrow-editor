import { describe, expect, it } from 'vitest';
import { MAX_DIRECTORY_ENTRIES, MAX_SEARCH_FILE_BYTES, MAX_SEARCH_RESULTS, MAX_WORKSPACE_ROOTS, listWorkspaceDirectory, matchesFileFilters, parseFileFilters, rankWorkspaceFiles, readWorkspaceFile, searchWorkspace, validateNewEntryName, walkWorkspace, type SearchResult, type WorkspaceDirectory, type WorkspaceFile } from '../src/workspace';

type MockHandle = { kind: 'file' | 'directory'; name: string; [key: string]: unknown };
function file(name: string, text: string | Uint8Array): MockHandle {
  const content = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return { kind: 'file', name, getFile: async () => new File([new Uint8Array(content)], name) };
}
function dir(name: string, entries: MockHandle[], broken = false): MockHandle {
  return { kind: 'directory', name, values: async function* () {
    if (broken) throw new Error('Permission denied');
    for (const entry of entries) yield entry;
  } };
}
function root(entries: MockHandle[]): WorkspaceDirectory {
  return { kind: 'browser', type: 'directory', name: 'project', relative: '', handle: dir('project', entries) } as unknown as WorkspaceDirectory;
}
async function search(folder: WorkspaceDirectory, query: string, options: { extensions?: string; caseSensitive?: boolean; signal?: AbortSignal; onResult?: (item: SearchResult) => void } = {}) {
  const items: SearchResult[] = [];
  const progress = await searchWorkspace(folder, {
    query, extensions: options.extensions || '', caseSensitive: options.caseSensitive || false, signal: options.signal,
    onResult: (item) => { items.push(item); options.onResult?.(item); },
  });
  return { items, progress };
}

describe('folder browsing and bounded saved-file search', () => {
  it('validates portable new names and rejects traversal, device names and alternate streams', () => {
    for (const value of ['notes.md', 'app.ts', '.gitignore', 'notes 📝.txt']) expect(() => validateNewEntryName(value)).not.toThrow();
    for (const value of ['', '.', '..', '../outside', 'a/b', 'a\\\\b', 'NUL', 'CON.txt', 'com1.md', 'LPT¹', 'file.', 'file ', 'a:stream', 'what?', 'x'.repeat(181)]) {
      expect(() => validateNewEntryName(value), value).toThrow(/valid filename/);
    }
  });

  it('applies one search result limit across all selected roots', async () => {
    const first = root([file('one.txt', Array.from({ length: 300 }, () => 'needle').join('\n'))]);
    const second = root([file('two.txt', Array.from({ length: 300 }, () => 'needle').join('\n'))]);
    first.name = 'first'; second.name = 'second';
    const results: SearchResult[] = [];
    const progress = await searchWorkspace([first, second], { query: 'needle', extensions: '', caseSensitive: false, onResult: (item) => results.push(item) });
    expect(results).toHaveLength(MAX_SEARCH_RESULTS);
    expect(progress.matches).toBe(MAX_SEARCH_RESULTS);
    expect(progress.truncated).toBe(true);
    expect(results.filter((item) => item.root === first)).toHaveLength(300);
    expect(results.filter((item) => item.root === second)).toHaveLength(200);
    await expect(walkWorkspace(Array.from({ length: MAX_WORKSPACE_ROOTS + 1 }, () => first), async () => {})).rejects.toThrow(/up to 12/);
  });

  it('ranks Quick Open matches by basename, path boundary and subsequence', () => {
    const files = ['docs/archive/old-main.ts.bak', 'tests/e2e/domain.ts', 'docs/main.ts.md', 'src/main.ts', 'src/mainframe.ts']
      .map((relative) => ({ kind: 'native', type: 'file', name: relative.split('/').pop()!, path: `/w/${relative}`, relative })) as WorkspaceFile[];
    expect(rankWorkspaceFiles(files, 'MAIN.TS').map((file) => file.relative))
      .toEqual(['src/main.ts', 'docs/main.ts.md', 'docs/archive/old-main.ts.bak', 'src/mainframe.ts', 'tests/e2e/domain.ts']);
    expect(rankWorkspaceFiles(files, '', 2).map((file) => file.relative)).toEqual(['src/main.ts', 'docs/main.ts.md']);
  });

  it('ranks multi-root display paths and normalizes Windows query separators', () => {
    const files = [
      { name: 'guide.md', relative: 'docs-project/guide.md', root: 'docs-project' },
      { name: 'guide.md', relative: 'other-project/guide.md', root: 'other-project' },
    ];
    expect(rankWorkspaceFiles(files, 'docs-project\\guide').map((file) => file.root)).toEqual(['docs-project']);
  });

  it('ranks a 5,000-entry Quick Open index in under 25 ms', () => {
    const files = Array.from({ length: 5000 }, (_, i) => {
      const relative = i === 4321 ? 'src/main.ts' : `pkg/module-${i % 97}/dir-${i % 13}/file-${i}.ts`;
      return { kind: 'native', type: 'file', name: relative.split('/').pop()!, path: `/w/${relative}`, relative } as WorkspaceFile;
    });
    const started = performance.now();
    const ranked = rankWorkspaceFiles(files, 'main.ts');
    const elapsed = performance.now() - started;
    expect(ranked[0]?.relative).toBe('src/main.ts');
    expect(ranked.length).toBeLessThanOrEqual(50);
    expect(elapsed).toBeLessThan(25);
  });

  it('accepts safe literal extension/name filters and rejects regex or paths', () => {
    expect(parseFileFilters(' .ts, *.MD, README.md ')).toEqual(['.ts', '.md', 'readme.md']);
    expect(matchesFileFilters('notes.MD', ['.md'])).toBe(true);
    expect(matchesFileFilters('README.md', ['readme.md'])).toBe(true);
    expect(matchesFileFilters('report.md', ['readme.md'])).toBe(false);
    for (const value of ['../secret', '*.t?', '[ab]', '/tmp/file']) expect(() => parseFileFilters(value)).toThrow();
  });

  it('sorts folders first, ignores unsafe names and truncates enumeration', async () => {
    const small = await listWorkspaceDirectory(root([file('b.txt', 'b'), file('bad/name', ''), dir('src', []), file('a.txt', 'a')]));
    expect(small.entries.map((entry) => entry.name)).toEqual(['src', 'a.txt', 'b.txt']);
    expect(small.skippedLinks).toBe(1);
    const many = await listWorkspaceDirectory(root(Array.from({ length: MAX_DIRECTORY_ENTRIES + 1 }, (_, i) => file(`${i}.txt`, ''))));
    expect(many.entries).toHaveLength(MAX_DIRECTORY_ENTRIES);
    expect(many.truncated).toBe(true);
  });

  it('searches supported saved text, skips generated folders, respects filters and reports unreadable files', async () => {
    const folder = root([
      file('first.ts', 'Alpha\nfind me\n'),
      file('bad.ts', new Uint8Array([0xff, 0x00, 0xff])),
      dir('src', [file('second.ts', 'FIND ME\nnot here')]),
      dir('node_modules', [file('skip.ts', 'find me')]),
      dir('locked', [], true),
      file('other.md', 'find me'),
    ]);
    const { items, progress } = await search(folder, 'find me', { extensions: '.ts' });
    expect(items.map((item) => `${item.file.relative}:${item.line}`)).toEqual(['first.ts:2', 'src/second.ts:1']);
    expect(progress.matches).toBe(2);
    expect(progress.issues.join(' ')).toMatch(/bad\.ts/);
    expect(progress.issues.join(' ')).toMatch(/locked/);
    expect(progress.skipped).toBeGreaterThanOrEqual(3);
    const sensitive = await search(folder, 'FIND ME', { extensions: '.ts', caseSensitive: true });
    expect(sensitive.items.map((item) => item.file.relative)).toEqual(['src/second.ts']);
  });

  it('maps Unicode case-insensitive matches to original UTF-16 columns', async () => {
    const result = await search(root([file('unicode.txt', 'İx\n😀İX')]), 'x');
    expect(result.items.map((item) => item.column)).toEqual([2, 4]);
  });

  it('stops at the matching-line safety limit and supports cancellation', async () => {
    const folder = root([file('lots.txt', Array.from({ length: MAX_SEARCH_RESULTS + 10 }, () => 'match').join('\n'))]);
    const limited = await search(folder, 'match');
    expect(limited.items).toHaveLength(MAX_SEARCH_RESULTS);
    expect(limited.progress.truncated).toBe(true);
    const controller = new AbortController();
    const cancelled = await search(folder, 'match', { signal: controller.signal, onResult: () => controller.abort() });
    expect(cancelled.items).toHaveLength(1);
    expect(cancelled.progress.cancelled).toBe(true);
  });

  it('rejects oversized files and invalid or multiline queries', async () => {
    const folder = root([file('large.txt', new Uint8Array(MAX_SEARCH_FILE_BYTES + 1))]);
    const result = await search(folder, 'hello');
    expect(result.progress.skipped).toBe(1);
    expect(result.progress.issues.join(' ')).toContain('large.txt');
    await expect(search(folder, '')).rejects.toThrow(/single-line/);
    await expect(search(folder, 'a\nb')).rejects.toThrow(/single-line/);
    const entry = (await listWorkspaceDirectory(root([file('small.txt', 'abc')]))).entries[0] as WorkspaceFile;
    await expect(readWorkspaceFile(entry, 2)).rejects.toThrow(/limit/);
  });
});
