import { _electron, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('the shell serves the app, persists sounds and blocks, and updates the document title', async () => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const args = process.platform === 'linux' ? ['.', '--no-sandbox'] : ['.'];
  const app = await _electron.launch({ args, env });
  const name = `shell-test-${randomUUID()}`;
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL('app://hadjitron/');
    expect(await page.evaluate(() => window.hadji?.frame)).toBe('custom');
    try {
      const bytes = Array.from(new TextEncoder().encode('{"format":"h3s","version":1}'));
      await page.evaluate(async ({ name, bytes }) => {
        await window.hadji!.library.write(name, new Uint8Array(bytes));
      }, { name, bytes });
      expect(await page.evaluate(() => window.hadji!.library.list())).toContain(name);
      expect(await page.evaluate(async (name) => Array.from(await window.hadji!.library.read(name)), name))
        .toEqual(bytes);
      const blockBytes = Array.from(new TextEncoder().encode('{"format":"h3b","version":1}'));
      expect(await page.evaluate(() => window.hadji!.blocks.list())).not.toContain(name);
      await page.evaluate(async ({ name, bytes }) => {
        await window.hadji!.blocks.write(name, new Uint8Array(bytes));
      }, { name, bytes: blockBytes });
      expect(await page.evaluate(() => window.hadji!.blocks.list())).toContain(name);
      expect(await page.evaluate(async (name) => Array.from(await window.hadji!.blocks.read(name)), name))
        .toEqual(blockBytes);
      expect(await page.evaluate(async (name) => Array.from(await window.hadji!.library.read(name)), name))
        .toEqual(bytes);
    } finally {
      await page.evaluate(async (name) => {
        if ((await window.hadji!.library.list()).includes(name)) await window.hadji!.library.remove(name);
        if ((await window.hadji!.blocks.list()).includes(name)) await window.hadji!.blocks.remove(name);
      }, name);
    }
    expect(await page.evaluate(() => window.hadji!.library.list())).not.toContain(name);
    expect(await page.evaluate(() => window.hadji!.blocks.list())).not.toContain(name);
    await page.evaluate(() => window.hadji!.setDocument('Shell test', true));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
      .toBe('Shell test - Hadjitron 3000');
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => {
      app.removeAllListeners('window-all-closed');
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
    });
    await app.close();
  }
});
