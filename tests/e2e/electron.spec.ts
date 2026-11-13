import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

function launch(): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const args = process.platform === 'linux' ? ['.', '--no-sandbox'] : ['.'];
  return _electron.launch({ args, env });
}

async function quit(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app, BrowserWindow }) => {
    app.removeAllListeners('window-all-closed');
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  await app.close();
}

test('the shell serves the app, persists sounds and blocks, and updates the document title', async () => {
  const app = await launch();
  const name = `shell-test-${randomUUID()}`;
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL('app://hadjitron/');
    expect(await page.evaluate(() => window.hadji?.frame)).toBe('custom');
    // MIDI is granted to the app (which asks for it without system exclusive messages); other permissions are refused.
    const permission = (descriptor: object) => page.evaluate(
      async (d) => (await navigator.permissions.query(d as PermissionDescriptor)).state, descriptor,
    );
    expect(await permission({ name: 'midi' })).toBe('granted');
    expect(await permission({ name: 'notifications' })).toBe('denied');
    expect(await permission({ name: 'geolocation' })).toBe('denied');
    // Without a sound card the machine may not support MIDI, but the app is never refused it.
    expect(await page.evaluate(() => navigator.requestMIDIAccess({ sysex: false })
      .then(() => 'granted', (error: DOMException) => error.name))).not.toBe('NotAllowedError');
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
    await quit(app);
  }
});

test('the shell serves the audio processors as scripts, and the crusher crushes in the packaged app', async () => {
  // The built module of the processors, the one asset that registers them.
  const file = readdirSync('dist/assets').find((f) => f.endsWith('.js') && readFileSync(`dist/assets/${f}`, 'utf8')
    .includes('registerProcessor'));
  expect(file).toBeTruthy();
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const result = await page.evaluate(async (url) => {
      const type = (await fetch(url)).headers.get('content-type');
      // A 440 Hz sine of amplitude 0.6 through the crusher at 2 bits and the full rate: three levels remain.
      const ctx = new OfflineAudioContext(2, 4410, 44100);
      await ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ctx, 'crusher', { outputChannelCount: [2] });
      const values: Record<string, number> = { bits: 2, rate: 48000, detune: 0, mix: 1 };
      for (const [id, value] of Object.entries(values)) node.parameters.get(id)!.value = value;
      const osc = new OscillatorNode(ctx, { frequency: 440 });
      osc.connect(new GainNode(ctx, { gain: 0.6 })).connect(node).connect(ctx.destination);
      osc.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      return { type, levels: [...new Set(out)].sort((a, b) => a - b), peak: Math.max(...out.map(Math.abs)) };
    }, `assets/${file}`);
    expect(result.type).toMatch(/^text\/javascript/);
    expect(result.levels).toEqual([-0.5, 0, 0.5]);
    expect(result.peak).toBe(0.5);

    // The app loads the processors into its own context when it starts playing, and says so if it cannot.
    const welcome = page.getByRole('button', { name: 'Listen to the Demo' });
    if (await welcome.isVisible()) await welcome.click();
    await page.locator('[data-tour="play"]').click();
    await page.mouse.move(640, 400);
    await page.waitForTimeout(1500);
    await expect(page.locator('.h-statusfield').first()).not.toContainText('could not be loaded');
    await page.keyboard.press('Space');
  } finally {
    await quit(app);
  }
});
