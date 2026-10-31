import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
}

async function writeDraft(page: Page, text: string, waitForSave = true): Promise<void> {
  await page.keyboard.press('Control+n');
  await page.keyboard.insertText(text);
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  if (waitForSave) {
    // Recovery is deliberately debounced. Poll the actual record rather than assuming a fast disk.
    await expect.poll(() => page.evaluate((needle) => new Promise<boolean>((resolve) => {
      const request = indexedDB.open('morrow-local-session-v1', 1);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        const query = db.transaction('session', 'readonly').objectStore('session').get('current');
        query.onsuccess = () => {
          const found = query.result?.documents?.some((doc: { text: string }) => doc.text.includes(needle)) ?? false;
          db.close(); resolve(found);
        };
        query.onerror = () => { db.close(); resolve(false); };
      };
    }), text), { timeout: 8_000 }).toBe(true);
  }
}

test('failed preference writes are visible and an old AI-on setting never re-enables AI', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    if (!get.call(sessionStorage, 'test-settings-seeded')) {
      set.call(localStorage, 'morrow.settings.v1', JSON.stringify({ aiEnabled: true, recovery: true, wrap: false }));
      set.call(sessionStorage, 'test-settings-seeded', 'yes');
    }
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'morrow.settings.v1') throw new DOMException('Full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await ready(page);
  await expect(page.locator('#ai-top-state')).toHaveText('OFF');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Word wrap' }).click();
  await expect(page.locator('#settings-storage-message')).toContainText('Settings could not be saved');
  await expect(page.locator('#storage-warning')).toContainText('may revert after restarting');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('morrow.settings.v1')!).aiEnabled)).toBe(true);
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#ai-top-state')).toHaveText('OFF');
});

test('failed recovery opt-out persistence is not reported as a durable success', async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'morrow.settings.v1') throw new DOMException('Full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await ready(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Remember my session' }).click();
  await expect(page.locator('#settings-storage-message')).toContainText('recovery preferences, may revert');
  await expect(page.locator('#recovery-status')).toContainText('Session recovery off');
  await expect(page.locator('#toast')).toContainText('off for this session');
});

test('unreadable settings pause recovery without deleting or overwriting the old draft', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    if (get.call(sessionStorage, 'test-fail-settings-read') === 'yes') {
      sessionStorage.removeItem('test-fail-settings-read');
      Storage.prototype.getItem = function (key) {
        if (this === localStorage && key === 'morrow.settings.v1') throw new DOMException('Blocked', 'SecurityError');
        return get.call(this, key);
      };
    }
  });
  await ready(page);
  await writeDraft(page, 'Do not lose this recovery copy');
  await page.evaluate(() => sessionStorage.setItem('test-fail-settings-read', 'yes'));
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#storage-warning')).toContainText('Settings could not be read');
  await expect(page.locator('#recovery-status')).toContainText('Recovery paused');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Remember my session' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.waitForTimeout(1600);
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.cm-content')).toContainText('Do not lose this recovery copy');
});

test('an unreadable recovery session is not replaced by examples', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('test-fail-session-read') === 'yes') {
      sessionStorage.removeItem('test-fail-session-read');
      const original = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        if (this.name === 'session' && key === 'current') throw new DOMException('Read failed', 'UnknownError');
        return original.call(this, key);
      };
    }
  });
  await ready(page);
  await writeDraft(page, 'Keep this draft even if recovery cannot be read');
  await page.evaluate(() => sessionStorage.setItem('test-fail-session-read', 'yes'));
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#storage-warning')).toContainText('previous recovery session could not be read');
  await expect(page.locator('#recovery-status')).toContainText('Recovery paused');
  await page.keyboard.press('Control+n');
  await page.keyboard.insertText('A new unsaved draft while recovery is paused');
  await page.waitForTimeout(1600);
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.cm-content')).toContainText('Keep this draft even if recovery cannot be read');
});

test('failed snapshot writes warn and recover after storage is available again', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'session' && key === 'current' && sessionStorage.getItem('test-allow-session-write') !== 'yes') {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };
  });
  await ready(page);
  await writeDraft(page, 'Unsaved while recovery is unavailable', false);
  await expect(page.locator('#storage-warning')).toContainText('recovery copy could not be saved');
  await expect(page.locator('#recovery-status')).toContainText('Recovery unavailable');
  const blocked = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(blocked).toBe(true);
  await page.evaluate(() => sessionStorage.setItem('test-allow-session-write', 'yes'));
  await page.keyboard.insertText(' and storage is back');
  await expect(page.locator('#storage-warning')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#recovery-status')).toContainText('Local session recovery on');
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.cm-content')).toContainText('Unsaved while recovery is unavailable and storage is back');
});

test('an incompatible recovery snapshot remains untouched', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('morrow-local-session-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('session', 'readwrite');
      tx.objectStore('session').put({ version: 99, draft: 'preserve this unknown format' }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#storage-warning')).toContainText('previous recovery session could not be read');
  await page.waitForTimeout(1600);
  const stored = await page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('morrow-local-session-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const query = db.transaction('session', 'readonly').objectStore('session').get('current');
      query.onsuccess = () => { db.close(); resolve(query.result); };
      query.onerror = () => reject(query.error);
    };
  }));
  expect(stored).toEqual({ version: 99, draft: 'preserve this unknown format' });
});

test('deleting an unreadable recovery snapshot requires explicit confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('test-fail-session-read-for-delete') === 'yes') {
      sessionStorage.removeItem('test-fail-session-read-for-delete');
      const original = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        if (this.name === 'session' && key === 'current') throw new DOMException('Read failed', 'UnknownError');
        return original.call(this, key);
      };
    }
  });
  await ready(page);
  await writeDraft(page, 'Existing snapshot before delete confirmation');
  await page.evaluate(() => sessionStorage.setItem('test-fail-session-read-for-delete', 'yes'));
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#storage-warning')).toContainText('previous recovery session could not be read');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const recoverySwitch = page.getByRole('switch', { name: 'Remember my session' });
  await recoverySwitch.click();
  await expect(page.getByRole('heading', { name: /remove.*recovery/i })).toBeVisible();
  await page.locator('#confirm-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(recoverySwitch).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#storage-warning')).toContainText('has not been overwritten');
  await recoverySwitch.click();
  await page.getByRole('button', { name: 'Turn off and remove' }).click();
  await expect(recoverySwitch).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#storage-warning')).toBeHidden();
  await expect(page.locator('#recovery-status')).toContainText('Session recovery off');
});

test('failed recovery deletion remains visible and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    type TestWindow = Window & { __failDelete?: boolean };
    (window as TestWindow).__failDelete = true;
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'session' && (window as TestWindow).__failDelete) throw new DOMException('Delete failed', 'UnknownError');
      return original.call(this, key);
    };
  });
  await ready(page);
  await writeDraft(page, 'A draft in the old snapshot');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Remember my session' }).click();
  await expect(page.locator('#settings-storage-message')).toContainText('old recovery copy could not be removed');
  await expect(page.locator('#recovery-status')).toContainText('old copy not removed');
  await expect(page.getByRole('switch', { name: 'Remember my session' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.evaluate(() => { (window as Window & { __failDelete?: boolean }).__failDelete = false; });
  await page.getByRole('button', { name: 'Retry removal' }).click();
  await expect(page.locator('#storage-warning')).toBeHidden();
  await expect(page.locator('#recovery-status')).toContainText('Session recovery off');
  const value = await page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('morrow-local-session-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const query = db.transaction('session', 'readonly').objectStore('session').get('current');
      query.onsuccess = () => { db.close(); resolve(query.result ?? null); };
      query.onerror = () => reject(query.error);
    };
  }));
  expect(value).toBeNull();
});

test('a mixed batch opens valid files and lists all individual failures', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [
      { name: 'one.txt', getFile: async () => new File(['first valid file'], 'one.txt') },
      { name: 'huge.log', getFile: async () => ({ name: 'huge.log', size: 20 * 1024 * 1024 + 1 }) },
      { name: 'locked.txt', getFile: async () => { throw new Error('Permission denied'); } },
      { name: 'bad.bin', getFile: async () => new File([new Uint8Array([0xff, 0x00])], 'bad.bin') },
      { name: 'two.txt', getFile: async () => new File(['second valid file'], 'two.txt') },
    ] });
  });
  await ready(page);
  await page.keyboard.press('Control+n');
  await page.keyboard.insertText('existing unsaved draft');
  await page.getByRole('button', { name: /Open a file/ }).click();
  await expect(page.getByRole('heading', { name: 'Some files could not be opened' })).toBeVisible();
  await expect(page.locator('#open-errors-list li')).toHaveCount(3);
  await expect(page.locator('#open-errors-list')).toContainText('huge.log');
  await expect(page.locator('#open-errors-list')).toContainText('locked.txt');
  await expect(page.locator('#open-errors-list')).toContainText('Permission denied');
  await expect(page.locator('#open-errors-list')).toContainText('bad.bin');
  await expect(page.locator('#breadcrumb-file')).toHaveText('two.txt');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.cm-content')).toContainText('second valid file');
  await page.locator('.file-list-item').filter({ hasText: 'one.txt' }).click();
  await expect(page.locator('.cm-content')).toContainText('first valid file');
  await page.locator('.file-list-item').filter({ hasText: 'Untitled' }).click();
  await expect(page.locator('.cm-content')).toContainText('existing unsaved draft');
});

test('recovery keeps more than 100 tabs rather than silently truncating the snapshot', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('morrow-local-session-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('session', 'readwrite');
      const documents = Array.from({ length: 101 }, (_, index) => ({
        id: `doc-${index}`, name: `file-${index}.txt`, text: `contents ${index}`,
        savedText: null, path: null, selection: 0,
      }));
      tx.objectStore('session').put({ version: 1, activeId: 'doc-100', documents }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#file-count')).toHaveText('101');
  await expect(page.locator('.cm-content')).toContainText('contents 100');
  await expect.poll(() => page.evaluate(async () => new Promise<{ count: number; resaved: boolean }>((resolve, reject) => {
    const request = indexedDB.open('morrow-local-session-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const query = db.transaction('session', 'readonly').objectStore('session').get('current');
      query.onsuccess = () => {
        const documents = query.result.documents;
        const result = { count: documents.length, resaved: documents[0].wasBrowserFile === false };
        db.close(); resolve(result);
      };
      query.onerror = () => reject(query.error);
    };
  })), { timeout: 8_000 }).toEqual({ count: 101, resaved: true });
});
