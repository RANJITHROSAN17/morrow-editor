import { test, expect, type Page } from '@playwright/test';
import { MAX_MARKDOWN_CHARS } from '../../src/markdown-preview-contract';

async function fresh(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
    (window as Window & { __previewPwned?: boolean }).__previewPwned = false;
  });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
}

test('Markdown preview updates unsaved text without executing HTML or loading links and images', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => { if (request.url().includes('tracking.invalid')) external.push(request.url()); });
  await fresh(page); await page.keyboard.press('Control+n');
  const source = '# A safe note\n\n**Bold** and `code`\n\n![Image description](https://tracking.invalid/pixel)\n\n[External](https://tracking.invalid/link)\n\n<script>window.__previewPwned=true</script>\n\n<img src="https://tracking.invalid/raw" onerror="window.__previewPwned=true">';
  await page.keyboard.insertText(source);
  await page.getByRole('button', { name: 'Toggle Markdown preview' }).click();
  const preview = page.locator('#markdown-content');
  await expect(preview.locator('h1')).toHaveText('A safe note');
  await expect(preview.locator('strong')).toHaveText('Bold');
  await expect(preview.locator('code').first()).toHaveText('code');
  await expect(preview).toContainText('Image not loaded: Image description');
  await expect(preview).toContainText('<script>window.__previewPwned=true</script>');
  await expect(preview.locator('a, img, script, iframe')).toHaveCount(0);
  await expect(preview.locator('.markdown-link')).toHaveText('External');
  expect(await page.evaluate(() => (window as Window & { __previewPwned?: boolean }).__previewPwned)).toBe(false);
  expect(external).toEqual([]);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n## Later edit');
  await expect(preview.locator('h2')).toHaveText('Later edit');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  await page.getByRole('button', { name: 'Close Markdown preview' }).click();
  await expect(page.locator('#markdown-panel')).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('Later edit');
});

test('preview follows the active tab and refuses oversized content without changing it', async ({ page }) => {
  await fresh(page); await page.keyboard.press('Control+n'); await page.keyboard.insertText('# My draft');
  await page.getByRole('button', { name: 'Toggle Markdown preview' }).click();
  await expect(page.locator('#markdown-content h1')).toHaveText('My draft');
  await page.getByRole('tab', { name: /quick-notes\.md/ }).click();
  await expect(page.locator('#markdown-content')).not.toContainText('My draft');
  await page.getByRole('tab', { name: /Untitled/ }).click();
  await expect(page.locator('#markdown-content h1')).toHaveText('My draft');
  await page.evaluate((length) => {
    type TestView = { state: { doc: { length: number } }; dispatch: (transaction: { changes: { from: number; to: number; insert: string } }) => void };
    const content = document.querySelector('.cm-content') as HTMLElement & { cmTile: { root: { view: TestView } } };
    const view = content.cmTile.root.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'x'.repeat(length) } });
  }, MAX_MARKDOWN_CHARS + 1);
  await expect(page.locator('#markdown-status')).toContainText('limited to 150,000');
  await expect(page.locator('#markdown-content')).toBeEmpty();
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  await page.getByRole('button', { name: 'Close Markdown preview' }).click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toContainText('My draft');
});

test('Arena highlights common credential patterns locally without revealing matched values', async ({ page }) => {
  await fresh(page); await page.keyboard.press('Control+n');
  await page.keyboard.insertText('api_key = "sample-secret-not-a-real-key"');
  await page.keyboard.press('Control+a');
  await page.locator('[data-menu="edit"]').click();
  await page.locator('[data-menu-panel="edit"] [data-action="arena"]').click();
  await page.getByRole('button', { name: 'Capture selection' }).click();
  const warning = page.locator('#arena-sensitive-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('credential assignment');
  await expect(warning).toContainText('can miss secrets');
  await expect(warning).not.toContainText('sample-secret-not-a-real-key');
  await page.locator('#arena-instruction').fill('Authorization: Bearer abcdefghijklmnop');
  await expect(warning).toContainText('authorization token');
  await page.getByRole('button', { name: 'Close Arena tools' }).click();
  await expect(page.locator('#arena-instruction')).toHaveValue('');
  await expect(page.locator('#arena-selection')).toHaveValue('');
  await expect(warning).toBeHidden();
});
