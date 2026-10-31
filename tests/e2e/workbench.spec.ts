import { expect, test, type Page } from '@playwright/test';

async function freshProject(page: Page, multiRoot = false) {
  await page.addInitScript((multi) => {
    type Handle = { kind: 'file' | 'directory'; name: string; [key: string]: unknown };
    const win = window as Window & { __projectWrites?: number; __projectCreates?: number };
    win.__projectWrites = 0; win.__projectCreates = 0;
    const file = (name: string, initial: string): Handle => {
      let text = initial;
      const handle: Handle = {
        kind: 'file', name,
        getFile: async () => new File([text], name),
        isSameEntry: async (other: unknown) => other === handle,
        createWritable: async () => {
          let next = '';
          return { write: async (value: Uint8Array) => { next = new TextDecoder().decode(value); }, close: async () => { text = next; win.__projectWrites = (win.__projectWrites || 0) + 1; }, abort: async () => {} };
        },
      };
      return handle;
    };
    const dir = (name: string, entries: Handle[]): Handle => {
      const handle: Handle = {
        kind: 'directory', name,
        values: async function* () { for (const entry of entries) yield entry; },
        isSameEntry: async (other: unknown) => other === handle,
        getFileHandle: async (child: string, options?: { create?: boolean }) => {
          const found = entries.find((entry) => entry.name === child);
          if (found && found.kind !== 'file') throw new DOMException('Wrong type', 'TypeMismatchError');
          if (found) return found;
          if (!options?.create) throw new DOMException('Not found', 'NotFoundError');
          const created = file(child, ''); entries.push(created); win.__projectCreates!++; return created;
        },
        getDirectoryHandle: async (child: string, options?: { create?: boolean }) => {
          const found = entries.find((entry) => entry.name === child);
          if (found && found.kind !== 'directory') throw new DOMException('Wrong type', 'TypeMismatchError');
          if (found) return found;
          if (!options?.create) throw new DOMException('Not found', 'NotFoundError');
          const created = dir(child, []); entries.push(created); win.__projectCreates!++; return created;
        },
        resolve: async (target: Handle) => {
          const find = (node: Handle, path: string[]): string[] | null => {
            if (node === target) return path;
            const children = node.__entries as Handle[] | undefined;
            if (!children) return null;
            for (const child of children) { const result = find(child, [...path, child.name]); if (result) return result; }
            return null;
          };
          return find(handle, []);
        },
        __entries: entries,
      };
      return handle;
    };
    const root = dir('demo-project', [
      dir('src', [file('one.ts', 'first line\nNeedle first\nlast line'), file('two.ts', 'something\nneedle second'), file('shared.txt', 'source copy')]),
      dir('docs', [file('readme.md', 'needle in docs'), file('shared.txt', 'docs copy')]),
      dir('node_modules', [file('skip.ts', 'needle in dependencies')]),
      file('top.txt', 'some note'),
    ]);
    const second = dir('docs-project', [file('guide.md', 'Needle from the other project'), dir('notes', [file('ideas.txt', 'other notes')])]);
    let pick = 0;
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => multi && pick++ === 1 ? second : root });
  }, multiRoot);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
}

async function openFolder(page: Page) {
  await page.locator('#sidebar [data-action="open-folder"]').click();
  await expect(page.getByRole('heading', { name: 'Choose a folder?' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await expect(page.locator('#workspace-name')).toHaveText('demo-project');
  await expect(page.getByRole('button', { name: 'Expand folder src' })).toBeVisible();
}
async function openOne(page: Page) {
  await page.getByRole('button', { name: 'Expand folder src' }).click();
  await page.getByRole('button', { name: 'Open src/one.ts' }).click();
  await expect(page.locator('#breadcrumb-file')).toHaveText('one.ts');
}
async function reviewFromMenu(page: Page) {
  await page.locator('[data-menu="edit"]').click();
  await page.locator('[data-menu-panel="edit"] [data-action="review-change"]').click();
  await expect(page.getByRole('heading', { name: 'Preview a change' })).toBeVisible();
}

test('folder tree opens one tab per file, searches saved files and navigates to a result', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await freshProject(page); await openFolder(page); await openOne(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nUnsaved addition');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  await page.getByRole('button', { name: 'Open src/one.ts' }).click();
  await expect(page.locator('#file-count')).toHaveText('3');
  await expect(page.locator('.cm-content')).toContainText('Unsaved addition');

  await page.keyboard.press('Control+Shift+f');
  await expect(page.getByRole('heading', { name: 'Find in files' })).toBeVisible();
  await page.locator('#workspace-query').fill('needle');
  await page.locator('#workspace-filter').fill('.ts');
  await page.getByRole('button', { name: 'Search folder' }).click();
  await expect(page.locator('#workspace-search-status')).toContainText('Finished');
  await expect(page.locator('#workspace-search-results')).toContainText('src/one.ts:2:1');
  await expect(page.locator('#workspace-search-results')).toContainText('src/two.ts:2:1');
  await expect(page.locator('#workspace-search-results')).not.toContainText('node_modules');
  await expect(page.locator('#workspace-search-results')).not.toContainText('readme.md');
  await page.locator('#workspace-search-results button').filter({ hasText: 'src/one.ts' }).click();
  await expect(page.locator('#position')).toHaveText('Ln 2, Col 1');
  await expect(page.locator('#toast')).toContainText('saved file');
  await expect(page.locator('.cm-content')).toContainText('Unsaved addition');
  expect(errors).toEqual([]);
});

test('same-named files in different folders remain distinct and show their paths', async ({ page }) => {
  await freshProject(page); await openFolder(page);
  await page.getByRole('button', { name: 'Expand folder src' }).click();
  await page.getByRole('button', { name: 'Open src/shared.txt' }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' edited');
  await page.getByRole('button', { name: 'Expand folder docs' }).click();
  await page.getByRole('button', { name: 'Open docs/shared.txt' }).click();
  await expect(page.locator('.cm-content')).toContainText('docs copy');
  await expect(page.locator('#tabs')).toContainText('shared.txt · demo-project/src');
  await expect(page.locator('#tabs')).toContainText('shared.txt · demo-project/docs');
  await page.getByRole('button', { name: 'Open src/shared.txt' }).click();
  await expect(page.locator('.cm-content')).toContainText('source copy edited');
});

test('quick open, go to line and the command palette work with keyboard shortcuts', async ({ page }) => {
  await freshProject(page); await openFolder(page);
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('heading', { name: 'Quick open' })).toBeVisible();
  await expect(page.locator('#quick-status')).toContainText('indexed');
  await page.locator('#quick-input').fill('two.ts');
  await page.keyboard.press('Enter');
  await expect(page.locator('#breadcrumb-file')).toHaveText('two.ts');
  await page.keyboard.press('Control+g');
  await expect(page.getByRole('heading', { name: 'Go to line' })).toBeVisible();
  await page.locator('#goto-input').fill('2'); await page.keyboard.press('Enter');
  await expect(page.locator('#position')).toHaveText('Ln 2, Col 1');
  await page.keyboard.press('Control+Shift+p');
  await expect(page.getByRole('heading', { name: 'Command palette' })).toBeVisible();
  await page.locator('#command-input').fill('word wrap'); await page.keyboard.press('Enter');
  await expect(page.locator('#wrap-button')).toHaveAttribute('aria-pressed', 'true');
});

test('pasted changes require acceptance, do not save automatically, and undo as one isolated step', async ({ page }) => {
  await freshProject(page); await openFolder(page); await openOne(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('!');
  await page.keyboard.press('Control+a'); await reviewFromMenu(page);
  await page.locator('#review-after').fill('rejected replacement');
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('.cm-content')).toContainText('Needle first');
  await expect(page.locator('.cm-content')).not.toContainText('rejected replacement');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+a'); await reviewFromMenu(page);
  await page.locator('#review-after').fill('```ts\nreplacement\n```');
  await expect(page.locator('#review-status')).toContainText('fence');
  await page.getByRole('button', { name: 'Apply to selection' }).click();
  await expect(page.locator('.cm-content')).toContainText('```ts');
  await expect(page.locator('.cm-content')).toContainText('replacement');
  expect(await page.evaluate(() => (window as Window & { __projectWrites?: number }).__projectWrites)).toBe(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toContainText('Needle first');
  await expect(page.locator('.cm-content')).toContainText('last line!');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).not.toContainText('last line!');
  expect(await page.evaluate(() => (window as Window & { __projectWrites?: number }).__projectWrites)).toBe(0);
});

test('a background edit invalidates a captured preview, even when selected text is unchanged', async ({ page }) => {
  await freshProject(page); await openFolder(page); await openOne(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End'); await reviewFromMenu(page);
  await page.locator('#review-after').fill('replacement line');
  await expect(page.locator('#review-apply')).toBeEnabled();
  // Simulate an external asynchronous editor transaction while the modal is open.
  await page.evaluate(() => {
    type TestView = { state: { doc: { length: number } }; dispatch: (transaction: { changes: { from: number; insert: string } }) => void };
    const content = document.querySelector('.cm-content') as HTMLElement & { cmTile: { root: { view: TestView } } };
    const view = content.cmTile.root.view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\nbackground edit' } });
  });
  await page.locator('#review-apply').click();
  await expect(page.locator('#review-status')).toContainText('changed or was closed');
  await expect(page.locator('#review-apply')).toBeDisabled();
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('.cm-content')).toContainText('first line');
  await expect(page.locator('.cm-content')).toContainText('background edit');
  await expect(page.locator('.cm-content')).not.toContainText('replacement line');
});

test('Arena browser workflow requires an explicit click, and API keys are not persisted or sent by the preview', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => { if (req.url().includes('arena.ai')) external.push(req.url()); });
  await page.addInitScript(() => {
    const win = window as Window & { __openedArena?: string };
    window.open = ((url: string | URL | undefined) => { win.__openedArena = String(url); return {} as Window; }) as typeof window.open;
  });
  await freshProject(page); await openFolder(page); await openOne(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('[data-menu="edit"]').click(); await page.locator('[data-menu-panel="edit"] [data-action="arena"]').click();
  await expect(page.getByRole('heading', { name: 'Arena & change review' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __openedArena?: string }).__openedArena)).toBeUndefined();
  await page.locator('.arena-browser-fallback summary').click();
  await page.getByRole('button', { name: 'Open Arena in browser' }).click();
  expect(await page.evaluate(() => (window as Window & { __openedArena?: string }).__openedArena)).toBe('https://arena.ai/');
  await page.locator('#arena-key').fill('private-test-key');
  await page.locator('#arena-instruction').fill('Improve this');
  await page.getByRole('button', { name: 'Capture selection' }).click();
  await expect(page.locator('#arena-selection')).toHaveValue('first line\nNeedle first\nlast line');
  await page.getByRole('button', { name: 'Send to Arena', exact: true }).click();
  await expect(page.locator('#arena-status')).toContainText('desktop app');
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('private-test-key');
  await page.getByRole('button', { name: 'Close Arena tools' }).click();
  await expect(page.locator('#arena-key')).toHaveValue('');
  expect(external).toEqual([]);
});

test('a failed recent-path opt-out is visible and can be cleared after storage recovers', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('morrow.settings.v1', JSON.stringify({ rememberRecent: true, recentFiles: ['C:\\private\\note.txt'] }));
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'morrow.settings.v1' && (window as Window & { __failPreferences?: boolean }).__failPreferences) throw new DOMException('Storage full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Remember recent files' })).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => { (window as Window & { __failPreferences?: boolean }).__failPreferences = true; });
  await page.getByRole('switch', { name: 'Remember recent files' }).click();
  await expect(page.locator('#settings-storage-message')).toContainText('Recent file paths could not be cleared');
  expect(await page.evaluate(() => localStorage.getItem('morrow.settings.v1'))).toContain('private');
  await page.evaluate(() => { (window as Window & { __failPreferences?: boolean }).__failPreferences = false; });
  await page.getByRole('button', { name: 'Clear recent files' }).click();
  await expect(page.locator('#settings-storage-message')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('morrow.settings.v1'))).not.toContain('private');
});

test('multi-folder workspace adds and removes roots without deleting files and searches across roots', async ({ page }) => {
  await freshProject(page, true); await openFolder(page);
  await page.getByRole('button', { name: 'Add folder to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Add a folder?' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await expect(page.locator('#workspace-name')).toHaveText('WORKSPACE · 2 FOLDERS');
  await expect(page.getByRole('button', { name: 'Collapse project folder demo-project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse project folder docs-project' })).toBeVisible();
  await page.keyboard.press('Control+Shift+f');
  await page.locator('#workspace-query').fill('needle');
  await page.getByRole('button', { name: 'Search folder' }).click();
  await expect(page.locator('#workspace-search-status')).toContainText('Finished');
  await expect(page.locator('#workspace-search-results')).toContainText('demo-project/src/one.ts');
  await expect(page.locator('#workspace-search-results')).toContainText('docs-project/guide.md');
  await page.locator('#workspace-query').fill('something else');
  await expect(page.locator('#workspace-search-results button')).toHaveCount(0);
  await expect(page.locator('#workspace-search-status')).toContainText('Search changed');
  await page.getByRole('button', { name: 'Close folder search' }).click();
  await page.keyboard.press('Control+p');
  await page.locator('#quick-input').fill('docs-project/guide');
  await expect(page.locator('#quick-results')).toContainText('docs-project/guide.md');
  await page.locator('#quick-results button').first().click();
  await expect(page.locator('.cm-content')).toContainText('Needle from the other project');
  await page.getByRole('button', { name: 'Remove folder docs-project from workspace' }).click();
  await expect(page.locator('#workspace-name')).toHaveText('demo-project');
  await expect(page.locator('.cm-content')).toContainText('Needle from the other project');
  expect(await page.evaluate(() => (window as Window & { __projectWrites?: number }).__projectWrites)).toBe(0);
  await page.getByRole('button', { name: 'Add folder to workspace' }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('already in the workspace');
  await expect(page.locator('#workspace-name')).toHaveText('demo-project');
});

test('create file and folder explicitly inside a selected directory, with collisions and unsafe names refused', async ({ page }) => {
  await freshProject(page); await openFolder(page);
  await page.getByRole('button', { name: 'Expand folder src' }).click();
  await page.getByRole('button', { name: 'Create a file or folder in src' }).click();
  await expect(page.getByRole('heading', { name: 'Create an item' })).toBeVisible();
  await page.locator('#workspace-create-name').fill('../escape.ts');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#workspace-create-status')).toContainText('valid filename');
  expect(await page.evaluate(() => (window as Window & { __projectCreates?: number }).__projectCreates)).toBe(0);
  await page.locator('#workspace-create-name').fill('new.ts');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#breadcrumb-file')).toHaveText('new.ts');
  await expect(page.getByRole('button', { name: 'Open src/new.ts' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __projectCreates?: number }).__projectCreates)).toBe(1);
  await page.getByRole('button', { name: 'Create a file or folder in demo-project' }).click();
  await page.locator('#workspace-create-kind').selectOption('directory');
  await page.locator('#workspace-create-name').fill('lib');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand folder lib' })).toBeVisible();
  await page.getByRole('button', { name: 'Create a file or folder in demo-project' }).click();
  await page.locator('#workspace-create-name').fill('top.txt');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#workspace-create-status')).toContainText('already exists');
  expect(await page.evaluate(() => (window as Window & { __projectCreates?: number }).__projectCreates)).toBe(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Open top.txt' }).click();
  await expect(page.locator('.cm-content')).toContainText('some note');
});

test('compact workspace keeps tree and open-file headings separate and scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 500 });
  await freshProject(page); await openFolder(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+n');
  const boxes = await page.evaluate(() => {
    const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
    return { add: rect('.new-primary'), section: rect('#workspace-section'), tree: rect('#workspace-tree'), heading: rect('.open-files-heading'), list: rect('#file-list') };
  });
  expect(boxes.add.height).toBeGreaterThanOrEqual(35);
  expect(boxes.tree.height).toBeGreaterThanOrEqual(80);
  expect(boxes.section.bottom).toBeLessThanOrEqual(boxes.heading.top + 1);
  expect(boxes.heading.bottom).toBeLessThanOrEqual(boxes.list.top + 1);
  expect(boxes.list.height).toBeGreaterThanOrEqual(38);
  await page.locator('#file-list').scrollIntoViewIfNeeded();
  await expect(page.locator('#file-list')).toBeVisible();
});
