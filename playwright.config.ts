import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20_000,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:1420', headless: true, viewport: { width: 1280, height: 800 } },
  reporter: 'list',
});
