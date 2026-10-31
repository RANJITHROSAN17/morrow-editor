import { expect, test } from '@playwright/test';

const ratio = (foreground: string, background: string) => {
  const lum = (value: string) => {
    const rgb = value.match(/\d+(?:\.\d+)?/gu)!.slice(0, 3).map(Number).map((n) => n / 255)
      .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const a = lum(foreground), b = lum(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test('visible quick-open affordance is keyboard operable', async ({ page }) => {
  await page.goto('/');
  const quick = page.getByRole('button', { name: 'Quick open files' });
  await quick.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quick open' })).toBeVisible();
  await expect(page.locator('#quick-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Quick open' })).not.toBeVisible();
});

test('primary controls and light-theme tab icons remain legible', async ({ page }) => {
  await page.goto('/');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Appearance' }).selectOption('light');
      await page.getByRole('button', { name: 'Close settings' }).click();
    }
    const newButton = page.locator('.new-primary');
    const colors = await newButton.evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(ratio(colors.fg, colors.bg), theme).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: 'Open Arena assistant' }).click();
    const arenaButton = page.locator('#arena-open-browser');
    const arenaColors = await arenaButton.evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(ratio(arenaColors.fg, arenaColors.bg), `${theme} Arena button`).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: 'Close Arena tools' }).click();
  }
  const icons = page.locator('.tab .file-icon');
  for (let i = 0; i < await icons.count(); i++) {
    const colors = await icons.nth(i).evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el.closest('.tab')!).backgroundColor }));
    // Inactive tabs are transparent; the tabs row is the effective backing color.
    if (colors.bg === 'rgba(0, 0, 0, 0)') colors.bg = await page.locator('.tabs-row').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(ratio(colors.fg, colors.bg), `light tab ${i}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('compact header keeps the brand and menus separate', async ({ page }) => {
  await page.setViewportSize({ width: 704, height: 500 });
  await page.goto('/');
  const brand = await page.locator('.brand-name').boundingBox();
  const file = await page.getByRole('button', { name: 'File', exact: true }).boundingBox();
  expect(brand).not.toBeNull(); expect(file).not.toBeNull();
  expect(brand!.x + brand!.width).toBeLessThan(file!.x);
  await expect(page.locator('#breadcrumb-file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});
