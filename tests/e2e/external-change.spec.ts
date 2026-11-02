import { expect, test, type Page } from '@playwright/test';

async function openNative(page: Page) {
  await page.addInitScript(() => {
    type State = Window & { isTauri: boolean; __diskText: string; __holdRead: boolean; __failRead: boolean; __writes: number; __releaseRead?: () => void; __TAURI_INTERNALS__: unknown };
    const win = window as unknown as State;
    win.isTauri = true;
    win.__diskText = 'original file';
    win.__holdRead = false; win.__failRead = false; win.__writes = 0;
    let next = 0;
    win.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++next,
      invoke: async (command: string) => {
        if (command === 'take_launch_files') return ['C:\\notes\\draft.txt'];
        if (command === 'plugin:event|listen') return ++next;
        if (command === 'safe_write') { win.__writes++; throw 'MORROW_FILE_CHANGED'; }
        if (command === 'workspace_read_file') {
          if (win.__failRead) throw new Error('Permission denied');
          if (win.__holdRead) await new Promise<void>((resolve) => { win.__releaseRead = resolve; });
          return new TextEncoder().encode(win.__diskText).buffer;
        }
        return undefined;
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.cm-content')).toContainText('original file');
}

test('clean native tabs show a notice on focus and reload only on request', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('changed on disk');
  await expect(page.locator('.cm-content')).toContainText('original file');
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'newer external file'; });
  await page.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(page.locator('.cm-content')).toContainText('newer external file');
  await expect(page.locator('#disk-change-warning')).toBeHidden();
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
});

test('dirty native tabs preserve edits and do not offer reload', async ({ page }) => {
  await openNative(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('unsaved edits are preserved');
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
});

test('edits made during reload are never replaced by the asynchronous read', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __holdRead: boolean }).__holdRead = true; });
  await page.getByRole('button', { name: 'Reload from disk' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __releaseRead?: () => void }).__releaseRead)).toBe('function');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { const w = window as unknown as { __holdRead: boolean; __releaseRead: () => void }; w.__holdRead = false; w.__releaseRead(); });
  await expect(page.locator('#toast')).toContainText('Your edits were kept');
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeHidden();
});


test('a dirty conflict still requires confirmation before any overwrite', async ({ page }) => {
  await openNative(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('unsaved edits are preserved');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('heading', { name: 'File changed on disk' })).toBeVisible();
  await page.locator('#confirm-actions').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
  expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __diskText: string }).__diskText)).toBe('external file');
});

test('an unreadable disk file does not silently appear unchanged', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __failRead: boolean }).__failRead = true; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('Cannot check');
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('original file');
});
