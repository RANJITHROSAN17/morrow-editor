import { test, expect } from '@playwright/test';

test('the editor focus indicator remains visible in both themes and forced colors', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  const editor = page.locator('.cm-editor');
  const gutters = page.locator('.cm-gutters');
  await expect(editor).toHaveClass(/cm-focused/);
  expect(await gutters.evaluate((element) => parseFloat(getComputedStyle(element).borderLeftWidth))).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#setting-theme').selectOption('light');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(editor).toHaveClass(/cm-focused/);
  expect(await gutters.evaluate((element) => parseFloat(getComputedStyle(element).borderLeftWidth))).toBeGreaterThanOrEqual(2);

  await page.emulateMedia({ forcedColors: 'active' });
  await expect(editor).toHaveClass(/cm-focused/);
  const focus = await gutters.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.borderLeftWidth), style: style.borderLeftStyle };
  });
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.style).not.toBe('none');
});
