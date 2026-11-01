import { test, expect, type Page } from '@playwright/test';

async function startWithSelection(page: Page, text = 'const secretFree = 1;') {
  await page.addInitScript(() => {
    const values: string[] = [];
    const opened: string[] = [];
    (window as unknown as Window & { __copied: string[]; __opened: string[] }).__copied = values;
    (window as unknown as Window & { __copied: string[]; __opened: string[] }).__opened = opened;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { values.push(value); } } });
    window.open = ((url?: string | URL) => { opened.push(String(url)); return {} as Window; }) as typeof window.open;
  });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await page.keyboard.press('Control+n');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Open Arena assistant' }).click();
}

test('website workflow copies only on request and reviews a literal response before applying', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => { if (request.url().includes('arena.ai')) external.push(request.url()); });
  await startWithSelection(page);
  await expect(page.getByRole('button', { name: /Website Sign in/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#arena-browser-instruction').fill('Simplify this');
  await page.getByRole('button', { name: 'Capture selection', exact: true }).click();
  const preview = 'Instruction:\nSimplify this\n\nSelected text:\nconst secretFree = 1;';
  await expect(page.locator('#arena-browser-preview')).toHaveValue(preview);
  expect(await page.evaluate(() => (window as unknown as Window & { __copied: string[] }).__copied)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as Window & { __opened: string[] }).__opened)).toEqual([]);
  await page.getByRole('button', { name: 'Copy preview' }).click();
  expect(await page.evaluate(() => (window as unknown as Window & { __copied: string[] }).__copied)).toEqual([preview]);
  await page.getByRole('button', { name: 'Open Arena in browser' }).click();
  expect(await page.evaluate(() => (window as unknown as Window & { __opened: string[] }).__opened)).toEqual(['https://arena.ai/agent']);
  await page.getByRole('button', { name: 'Review a pasted change' }).click();
  await expect(page.locator('#review-before')).toHaveValue('const secretFree = 1;');
  await page.locator('#review-after').fill('const secretFree = 1;');
  await expect(page.locator('#review-status')).toContainText('no change');
  await expect(page.locator('#review-apply')).toBeDisabled();
  await expect(page.locator('#review-summary')).toHaveText('Line counts unavailable');
  await page.locator('#review-after').fill('let improved = 2;');
  await expect(page.locator('#review-summary')).toHaveText('+1 added / −1 removed · 0 unchanged');
  await expect(page.locator('.cm-content')).not.toContainText('let improved = 2;');
  await expect(page.locator('#review-diff')).toContainText('+ let improved = 2;');
  await page.getByRole('button', { name: 'Apply to selection' }).click();
  await expect(page.locator('.cm-content')).toContainText('let improved = 2;');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toContainText('const secretFree = 1;');
  await expect(page.locator('#arena-browser-preview')).toHaveValue('');
  expect(external).toEqual([]);
});

test('changed documents cannot be copied or patched through a stale captured target', async ({ page }) => {
  await startWithSelection(page);
  await page.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await page.evaluate(() => {
    type TestView = { dispatch: (transaction: { changes: { from: number; to: number; insert: string } }) => void };
    const content = document.querySelector('.cm-content') as HTMLElement & { cmTile: { root: { view: TestView } } };
    content.cmTile.root.view.dispatch({ changes: { from: 0, to: 0, insert: 'changed ' } });
  });
  await page.getByRole('button', { name: 'Copy preview' }).click();
  await expect(page.locator('#arena-browser-status')).toContainText('changed or was closed');
  await page.getByRole('button', { name: 'Review a pasted change' }).click();
  await expect(page.locator('#arena-browser-status')).toContainText('Capture the selection again');
  await expect(page.locator('#review-dialog')).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Window & { __copied: string[] }).__copied)).toEqual([]);
});

test('secret warning is local and clipboard denial offers manual copy', async ({ page }) => {
  await startWithSelection(page, 'api_key = "sample-secret-not-real"');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await page.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await expect(page.locator('#arena-browser-warning')).toContainText('credential assignment');
  await expect(page.locator('#arena-browser-warning')).not.toContainText('sample-secret-not-real');
  await page.getByRole('button', { name: 'Copy preview' }).click();
  await expect(page.locator('#arena-browser-status')).toContainText('Press Ctrl+C');
  await expect(page.locator('#arena-browser-preview')).toBeFocused();
  await page.getByRole('button', { name: 'Close Arena tools' }).click();
  await expect(page.locator('#arena-browser-preview')).toHaveValue('');
  await expect(page.locator('#arena-browser-warning')).toBeHidden();
});

test('the website workflow remains reachable in a compact window', async ({ page }) => {
  await page.setViewportSize({ width: 704, height: 500 });
  await startWithSelection(page);
  const dialog = page.getByRole('dialog', { name: 'Arena & change review' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await expect(page.locator('#arena-browser-preview')).toHaveValue('const secretFree = 1;');
  await page.getByRole('button', { name: 'Copy preview' }).click();
  await expect(page.locator('#arena-browser-status')).toContainText('Copied.');
  expect(await dialog.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});
