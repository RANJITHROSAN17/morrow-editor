import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), stat: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { MAX_FILE_BYTES } from '../src/encoding';
import { collectOpenedFiles, pickFiles, writeTo, ExternalChangeError } from '../src/platform';

beforeEach(() => { vi.resetAllMocks(); });

describe('independent file opening', () => {
  it('opens the valid native files and reports each unreadable or oversized item', async () => {
    vi.mocked(open).mockResolvedValue(['C:\\work\\one.txt', 'C:\\work\\huge.log', 'C:\\work\\locked.txt', 'C:\\work\\two.txt']);
    vi.mocked(stat).mockImplementation(async (path) => {
      if (String(path).endsWith('locked.txt')) throw new Error('Permission denied');
      return { isFile: true, size: String(path).endsWith('huge.log') ? MAX_FILE_BYTES + 1 : 5 } as Awaited<ReturnType<typeof stat>>;
    });
    vi.mocked(readFile).mockImplementation(async (path) => new TextEncoder().encode(String(path).endsWith('one.txt') ? 'first' : 'other'));

    const result = await pickFiles();
    expect(result.files.map((file) => file.name)).toEqual(['one.txt', 'two.txt']);
    expect(result.failures).toEqual([
      { name: 'huge.log', message: 'This file is larger than the 20 MiB safety limit.' },
      { name: 'locked.txt', message: 'Permission denied' },
    ]);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('returns no files and no failures when the native dialog is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null);
    expect(await pickFiles()).toEqual({ files: [], failures: [] });
    expect(stat).not.toHaveBeenCalled();
  });

  it('continues after a loader throws and processes items sequentially', async () => {
    const calls: string[] = [];
    const result = await collectOpenedFiles(['a', 'bad', 'c'], async (name) => {
      calls.push(`start:${name}`);
      await Promise.resolve();
      calls.push(`end:${name}`);
      if (name === 'bad') throw 'read failed';
      return { name, bytes: new Uint8Array([1]), ref: { kind: 'download' } };
    }, (name) => name);
    expect(calls).toEqual(['start:a', 'end:a', 'start:bad', 'end:bad', 'start:c', 'end:c']);
    expect(result.files.map((file) => file.name)).toEqual(['a', 'c']);
    expect(result.failures).toEqual([{ name: 'bad', message: 'read failed' }]);
  });
});

describe('native save IPC safety metadata', () => {
  const ref = { kind: 'native', path: 'C:\\notes\\draft 📝.txt' } as const;
  const bytes = new TextEncoder().encode('new text\r\n');

  it('sends a nonempty absent sentinel for a new destination', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const result = await writeTo(ref, bytes, 'draft 📝.txt', null);
    expect(result).toMatch(/^[0-9a-f]{64}$/u);
    expect(invoke).toHaveBeenCalledWith('safe_write', bytes, { headers: {
      'x-morrow-path': encodeURIComponent(ref.path),
      'x-morrow-expected': 'absent',
      'x-morrow-force': '0',
    } });
  });

  it('sends a validated opened-file hash, and force only when explicitly requested', async () => {
    const hash = 'a'.repeat(64);
    await writeTo(ref, bytes, 'draft.txt', hash);
    expect(invoke).toHaveBeenLastCalledWith('safe_write', bytes, { headers: {
      'x-morrow-path': encodeURIComponent(ref.path), 'x-morrow-expected': hash, 'x-morrow-force': '0',
    } });
    await writeTo(ref, bytes, 'draft.txt', hash, true);
    expect(invoke).toHaveBeenLastCalledWith('safe_write', bytes, { headers: {
      'x-morrow-path': encodeURIComponent(ref.path), 'x-morrow-expected': hash, 'x-morrow-force': '1',
    } });
  });

  it('rejects invalid version metadata before IPC and translates conflict errors', async () => {
    for (const invalid of ['', 'absent', 'not-a-hash', 'A'.repeat(64)]) {
      await expect(writeTo(ref, bytes, 'draft.txt', invalid)).rejects.toThrow(/Invalid saved file version/);
    }
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValue('MORROW_FILE_CHANGED: destination already exists');
    await expect(writeTo(ref, bytes, 'draft.txt', null)).rejects.toBeInstanceOf(ExternalChangeError);
  });
});
