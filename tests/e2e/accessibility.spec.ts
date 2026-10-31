import { test, expect } from '@playwright/test';

test('the editor focus indicator remains visible in both themes and forced colors', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
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

test('settings has a named dialog and labelled theme and font controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Editor font size' })).toBeVisible();
});

test('tab close buttons work with Enter and Space, and tab arrows switch focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#tabs [role="tab"]')).toHaveCount(2);
  const activeTab = page.locator('#tabs [role="tab"][aria-selected="true"]');
  await activeTab.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#breadcrumb-file')).toHaveText('quick-notes.md');
  await expect(page.locator('#tabs [role="tab"][aria-selected="true"]')).toBeFocused();
  const closeNotes = page.getByRole('button', { name: 'Close quick-notes.md' });
  await closeNotes.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Close quick-notes.md' })).toHaveCount(0);
  const closeWelcome = page.getByRole('button', { name: 'Close welcome.py' });
  await closeWelcome.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close welcome.py' })).toHaveCount(0);
  await expect(page.locator('#breadcrumb-file')).toHaveText('Untitled');
});

test('application menus support arrow keys and Escape returns focus to the trigger', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'File', exact: true });
  await trigger.click(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-menu-panel="file"] [role="menuitem"]').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-menu-panel="file"] [role="menuitem"]').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('active sample and light status text have sufficient rendered contrast', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  const ratio = async (foreground: string, background: string) => page.evaluate(([fg, bg]) => {
    const read = (selector: string, property: 'color' | 'backgroundColor') => {
      const value = getComputedStyle(document.querySelector(selector)!)[property];
      const rgb = value.match(/\d+(?:\.\d+)?/gu)!.slice(0, 3).map(Number).map((x) => x / 255)
        .map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const a = read(fg, 'color'), b = read(bg, 'backgroundColor');
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, [foreground, background]);
  expect(await ratio('.file-list-item.active .file-list-state', '.file-list-item.active')).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('light');
  await page.getByRole('button', { name: 'Close settings' }).click();
  expect(await ratio('#runtime-status', '.statusbar')).toBeGreaterThanOrEqual(4.5);
  expect(await page.locator('#runtime-status').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
});

test('compact top bar keeps Settings and AI controls fully visible and usable', async ({ page }) => {
  // A 720px decorated Windows window can leave roughly 704px for its webview.
  await page.setViewportSize({ width: 704, height: 500 });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  for (const name of ['Open Arena assistant', 'AI suggestions settings', 'Settings']) {
    const control = page.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    const rect = await control.boundingBox();
    expect(rect, name).not.toBeNull();
    expect(rect!.x, name).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width, name).toBeLessThanOrEqual(704);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});
