import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import electronPath from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The installed application to test instead of this checkout, as the Windows workflow does after installing it.
const exe = process.env.HADJITRON_EXE;

function environment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  return env;
}

/** The program and the arguments that start the app with `files`, from this checkout or installed. */
function command(files: string[] = []): [string, string[]] {
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
  if (exe) return [exe, [...sandbox, ...files]];
  return [electronPath as unknown as string, ['.', ...sandbox, ...files]];
}

function launch(files: string[] = []): Promise<ElectronApplication> {
  const [executablePath, args] = command(files);
  return _electron.launch({ ...(exe && { executablePath }), args, env: environment() });
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
    // The app draws its own menu bar; outside a Mac there is no native one for Alt to bring up.
    if (process.platform !== 'darwin') expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull();
    await expect(page.locator('.h-menubar-item').first()).toHaveText('File');
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

test('the Guide Book detaches into a window of its own and attaches again, and no other window opens', async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Start docked on the first page at the default size, whatever an earlier run left in the preferences.
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('hadjitron-prefs') ?? '{}');
      localStorage.setItem('hadjitron-prefs', JSON.stringify({ ...prefs, bookPage: '', bookDetached: false, bookWindow: undefined }));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const welcome = page.getByRole('button', { name: 'Listen to the Demo' });
    if (await welcome.isVisible()) await welcome.click();
    const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .map((w) => ({ title: w.getTitle(), menu: w.isMenuBarVisible(), size: w.getContentSize() })));

    await page.locator('.h-menubar-item', { hasText: 'Help' }).click();
    await page.locator('.h-menu-item', { hasText: 'Guide Book' }).click();
    const [book] = await Promise.all([
      app.waitForEvent('window'), page.locator('.h-book .h-title-button', { hasText: 'Detach' }).click(),
    ]);
    await expect(book.locator('.h-book-title')).toHaveText(/\w/);
    await expect(page.locator('.h-book')).toHaveCount(0);
    expect(await windows()).toContainEqual({ title: 'Guide Book', menu: false, size: [440, 640] });
    await book.locator('.h-button', { hasText: 'Next' }).click();
    expect(await book.locator('.h-book-title').textContent()).toBe('Sounds, blocks and songs');

    // Only the book's window may open; anything else is refused as before, and the book's window stays on its page.
    expect(await page.evaluate(() => window.open('', 'other') === null)).toBe(true);
    expect(await page.evaluate(() => window.open('app://hadjitron/kit.html', 'book') === null)).toBe(true);
    expect(await page.evaluate(() => window.open('app://hadjitron/kit.html', 'guide-book') === null)).toBe(true);
    expect(await page.evaluate(() => window.open('', 'guide-book') === null)).toBe(true);
    expect(book.url()).toBe('about:blank');
    await expect(book.locator('.h-book-title')).toHaveText('Sounds, blocks and songs');
    expect(await windows()).toHaveLength(2);

    await book.locator('.h-title-button', { hasText: 'Attach' }).click();
    await expect.poll(async () => (await windows()).length).toBe(1);
    await expect(page.locator('.h-book .h-book-title')).toHaveText('Sounds, blocks and songs');

    // Closing the book's window from outside, as its own close box does, closes the book.
    await Promise.all([app.waitForEvent('window'), page.locator('.h-book .h-title-button').first().click()]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Guide Book')!
      .close());
    await expect.poll(async () => (await windows()).length).toBe(1);
    await expect(page.locator('.h-book')).toHaveCount(0);
    await page.locator('.h-menubar-item', { hasText: 'Help' }).click();
    const [again] = await Promise.all([
      app.waitForEvent('window'), page.locator('.h-menu-item', { hasText: 'Guide Book' }).click(),
    ]);
    await expect(again.locator('.h-book-title')).toHaveText('Sounds, blocks and songs');

    // Reloading the app's page closes the book's window; the book opens detached again from the Help menu.
    await page.reload();
    await expect.poll(async () => (await windows()).length).toBe(1);
    await page.locator('.h-menubar-item', { hasText: 'Help' }).click();
    const [last] = await Promise.all([
      app.waitForEvent('window'), page.locator('.h-menu-item', { hasText: 'Guide Book' }).click(),
    ]);
    await last.locator('.h-title-button', { hasText: 'Attach' }).click();
    await expect.poll(async () => (await windows()).length).toBe(1);
    await expect(page.locator('.h-book')).toHaveCount(1);
  } finally {
    await quit(app);
  }
});

test('an installed Windows application asks GitHub for a newer release, and answers in a sentence', async () => {
  test.skip(!exe || process.platform !== 'win32', 'Only the application installed from the Setup .exe updates this way');
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    expect(await page.evaluate(() => window.hadji?.updates?.kind)).toBe('release');
    const version = await app.evaluate(({ app }) => app.getVersion());
    // Whether a release exists yet or not, the check either names versions or fails with a readable sentence.
    const result = await page.evaluate(() => window.hadji!.updates!.check()
      .then((check) => ({ check, error: null }), (error: Error) => ({ check: null, error: error.message })));
    if (result.check) {
      expect(result.check.current).toBe(version);
      expect(result.check.blocked).toBeNull();
    } else {
      const sentence = result.error!.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
      expect(sentence.length).toBeLessThanOrEqual(200);
      expect(sentence).not.toMatch(/\n|\bat \S+:\d+/);
    }
  } finally {
    await quit(app);
  }
});

test('a project named on the command line opens, and so does one handed to the app while it runs', async () => {
  test.skip(process.platform === 'darwin', 'A Mac hands files to the app with open-file instead');
  const dir = mkdtempSync(path.join(tmpdir(), 'hadjitron-open-'));
  const project = (name: string, bpm: number) => {
    const file = path.join(dir, `${name}.h3k`);
    const text = { format: 'hadjitron3000/project', version: 3, project: { name, bpm, channels: [] } };
    writeFileSync(file, JSON.stringify(text));
    return file;
  };
  const app = await launch([project('First song', 97)]);
  try {
    const page = await app.firstWindow();
    const title = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
    await expect.poll(title).toBe('First song - Hadjitron 3000');
    await expect(page.locator('.h-app-bpm')).toHaveText('97.0');
    // A second start, as a double-click on a file does, hands the file to the running app and ends.
    const [program, args] = command([project('Second song', 133)]);
    const second = spawn(program, args, { env: environment(), stdio: 'ignore' });
    expect(await new Promise((resolve) => second.once('exit', resolve))).toBe(0);
    await expect.poll(title).toBe('Second song - Hadjitron 3000');
    await expect(page.locator('.h-app-bpm')).toHaveText('133.0');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    await quit(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
