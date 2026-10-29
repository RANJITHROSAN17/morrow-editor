import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function fresh(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    // Exercise browser fallback deterministically instead of a system picker.
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
}

test('examples are editable, syntax-highlighted, and have a large language selector', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await fresh(page);
  await expect(page.getByText('This is an example file, not saved on your computer.')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('class Note');
  await expect(page.locator('#language')).toHaveValue('__auto__');
  await expect(page.locator('#status-language')).toHaveText('Python');
  expect(await page.locator('#language option').count()).toBeGreaterThan(140);
  await page.locator('#language').selectOption('Rust');
  await expect(page.locator('#status-language')).toHaveText('Rust');
  expect(errors).toEqual([]);
});

test('new, edit, undo, tabs, and unsaved close confirmation', async ({ page }) => {
  await fresh(page);
  await page.keyboard.press('Control+n');
  await expect(page.locator('#breadcrumb-file')).toHaveText('Untitled');
  await page.keyboard.insertText('hello world');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  await expect(page.locator('.tab.active .dirty-dot')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toHaveText('');
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
  await page.keyboard.insertText('important draft');
  await page.getByRole('button', { name: 'Close Untitled' }).click();
  await expect(page.getByRole('heading', { name: 'Save your changes?' })).toBeVisible();
  await page.locator('#confirm-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('important draft');
  await page.getByRole('button', { name: 'Close Untitled' }).click();
  await page.getByRole('button', { name: 'Don’t save' }).click();
  await expect(page.locator('#breadcrumb-file')).not.toHaveText('Untitled');
});

test('find, regex, and replace all actually change the editor', async ({ page }) => {
  await fresh(page); await page.keyboard.press('Control+n');
  await page.keyboard.insertText('apple pear apple\nAPPLE pear');
  await page.keyboard.press('Control+h');
  await page.getByLabel('Find text').fill('apple');
  await expect(page.locator('#find-count')).toHaveText('3');
  await page.getByLabel('Match case').click();
  await expect(page.locator('#find-count')).toHaveText('2');
  await page.getByLabel('Replace with').fill('plum');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('plum pear plum');
  await expect(page.locator('.cm-content')).toContainText('APPLE pear');
  await page.getByLabel('Use regular expression').click();
  await page.getByLabel('Find text').fill('[');
  await expect(page.locator('#find-error')).toContainText('Invalid regular expression');
  await page.keyboard.press('Escape');
  await expect(page.locator('#find-panel')).toBeHidden();
});

test('local session restores an unsaved note after reload', async ({ page }) => {
  await fresh(page); await page.keyboard.press('Control+n');
  await page.keyboard.insertText('A recovery test with தமிழ் 🦋');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  await page.waitForTimeout(1700);
  await page.reload();
  await expect(page.locator('#breadcrumb-file')).toHaveText('Untitled');
  await expect(page.locator('.cm-content')).toContainText('A recovery test with தமிழ் 🦋');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
});

test('browser fallback opens UTF-16 and downloads the matching format', async ({ page }) => {
  await fresh(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a file/ }).click();
  const chooser = await chooserPromise;
  const body = Buffer.from('hello\r\nworld', 'utf16le');
  await chooser.setFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), body]) });
  await expect(page.locator('#breadcrumb-file')).toHaveText('hello.txt');
  await expect(page.locator('#encoding')).toHaveValue('UTF-16 LE');
  await expect(page.locator('#line-ending')).toHaveValue('CRLF');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('!');
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('hello.txt');
  const result = await readFile(await download.path());
  expect(result.equals(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello\r\nworld!', 'utf16le')]))).toBe(true);
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
});

test('settings, sidebar, word wrap, and AI privacy affordances work in preview', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (r.url().includes('11434')) external.push(r.url()); });
  await fresh(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#setting-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('switch', { name: 'Word wrap' }).click();
  await expect(page.locator('#wrap-button')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.keyboard.press('Control+b'); await expect(page.locator('#sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Show sidebar' }).click(); await expect(page.locator('#sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'AI suggestions settings' }).click();
  await expect(page.getByText('Desktop app only in this preview')).toBeVisible();
  await page.getByRole('switch', { name: 'Enable AI suggestions' }).click();
  await expect(page.locator('#ai-toggle')).toHaveAttribute('aria-checked', 'false');
  expect(external).toEqual([]);
});

test('opening a file replaces an unused blank tab without corrupting the active document', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fresh(page);
  await page.keyboard.press('Control+n');
  await expect(page.locator('#breadcrumb-file')).toHaveText('Untitled');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a file/ }).click();
  await (await chooserPromise).setFiles({ name: 'opened.txt', mimeType: 'text/plain', buffer: Buffer.from('opened safely') });
  await expect(page.locator('#breadcrumb-file')).toHaveText('opened.txt');
  await expect(page.locator('#file-count')).toHaveText('3');
  await expect(page.getByRole('button', { name: 'Close Untitled' })).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('opened safely');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' and edited');
  await expect(page.locator('.cm-content')).toContainText('opened safely and edited');
  expect(errors).toEqual([]);
});

test('closing after an asynchronous save never discards edits made while saving', async ({ page }) => {
  await page.addInitScript(() => {
    type TestWindow = Window & { __saveStarted?: boolean; __releaseSave?: () => void };
    const testWindow = window as TestWindow;
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: async () => ({
        name: 'race.txt',
        createWritable: async () => ({
          write: () => new Promise<void>((resolve) => { testWindow.__saveStarted = true; testWindow.__releaseSave = resolve; }),
          close: async () => {}, abort: async () => {},
        }),
      }),
    });
  });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('Control+n');
  await page.keyboard.insertText('first version');
  await page.getByRole('button', { name: 'Close Untitled' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __saveStarted?: boolean }).__saveStarted)).toBe(true);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' plus later edits');
  await page.evaluate(() => (window as Window & { __releaseSave?: () => void }).__releaseSave?.());
  await expect(page.locator('#breadcrumb-file')).toHaveText('race.txt');
  await expect(page.locator('.cm-content')).toContainText('first version plus later edits');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('changed while saving');
});
