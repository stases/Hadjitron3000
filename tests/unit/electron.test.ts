import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { electronPlatform } from '../../src/platform/electron';
import type { Hadji } from '../../src/platform';

const electronDirectory = fileURLToPath(new URL('../../electron/', import.meta.url));
const require = createRequire(path.join(electronDirectory, 'main.cjs'));
const cacheDirectory = fileURLToPath(new URL('../../.cache/', import.meta.url));
let documents: string;

beforeEach(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  documents = await mkdtemp(path.join(cacheDirectory, 'electron-test-'));
});

afterEach(async () => {
  await rm(documents, { recursive: true, force: true });
});

const EXE = '/Applications/Hadjitron 3000.app/Contents/MacOS/Hadjitron 3000';

/**
 * Load main.cjs and preload.cjs. `installed` makes a packaged application from that folder, which holds install.json
 * when it was built from source; `autoUpdater` stands in for electron-updater's, which is missing otherwise.
 */
async function shell(argv: string[] = [], platform = 'linux', installed: string | null = null, autoUpdater?: unknown) {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  const renderer = new EventEmitter();
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    setWindowOpenHandler: vi.fn(),
    send: vi.fn((channel: string, data: unknown) => renderer.emit(channel, {}, data)),
  });
  const win = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
    isMinimized: () => false,
    loadURL: async () => {},
    show: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
  });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: installed !== null,
    getPath: (name: string) => {
      expect(['documents', 'exe', 'userData']).toContain(name);
      return name === 'exe' ? EXE : documents;
    },
    requestSingleInstanceLock: () => true,
    setAppUserModelId: vi.fn(),
    whenReady: async () => {},
    quit: vi.fn(),
  });
  const openPath = vi.fn(async (_directory: string) => '');
  const showOpenDialog = vi.fn(async (_win: unknown, _opts: unknown) =>
    ({ canceled: true, filePaths: [] as string[] }));
  const showSaveDialog = vi.fn(async (_win: unknown, _opts: { defaultPath: string }) =>
    ({ canceled: true, filePath: '' }));
  type RequestHandler = (contents: unknown, permission: string, callback: (granted: boolean) => void,
    details: { requestingUrl: string }) => void;
  type CheckHandler = (contents: unknown, permission: string, origin: string) => boolean;
  const permissions: { request?: RequestHandler; check?: CheckHandler } = {};
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const invoke = (channel: string, args: unknown[] = [], sender = event) =>
    Promise.resolve().then(() => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler: ${channel}`);
      return handler(sender, ...args);
    });
  let bridge!: Hadji;
  let windowOptions: unknown;
  const electron = {
    app,
    BrowserWindow: function (options: unknown) {
      windowOptions = options;
      return win;
    },
    dialog: { showOpenDialog, showSaveDialog },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (handler: RequestHandler) => { permissions.request = handler; },
        setPermissionCheckHandler: (handler: CheckHandler) => { permissions.check = handler; },
      },
    },
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    shell: { openPath },
    contextBridge: { exposeInMainWorld: (name: string, value: Hadji) => {
      expect(name).toBe('hadji');
      bridge = value;
    } },
    ipcRenderer: Object.assign(renderer, {
      invoke: (channel: string, ...args: unknown[]) => invoke(channel, args),
    }),
  };
  for (const file of ['main.cjs', 'preload.cjs']) {
    // The page's preload runs in the window, and sees the arguments the main process gave the window.
    const extra = file === 'preload.cjs' ? await vi.waitFor(() => {
      if (!windowOptions) throw new Error('No window yet');
      return (windowOptions as { webPreferences: { additionalArguments: string[] } }).webPreferences.additionalArguments;
    }) : [];
    runInNewContext(await readFile(path.join(electronDirectory, file), 'utf8'), {
      require: (id: string) => {
        if (id === 'electron') return electron;
        if (id !== 'electron-updater') return require(id);
        if (!autoUpdater) throw new Error(`Cannot find module '${id}'`);
        return { autoUpdater };
      },
      __dirname: file === 'main.cjs' && installed ? installed : electronDirectory,
      process: { argv: ['hadjitron', ...argv, ...extra], env: {}, platform, cwd: () => documents },
      Uint8Array, URL, console,
    });
  }
  return {
    app, bridge, invoke, event, openPath, showOpenDialog, showSaveDialog, permissions, webContents, handlers, win,
    windowOptions: () => windowOptions,
  };
}

test.each([
  ['library', 'Sounds', '.h3s'],
  ['blocks', 'Blocks', '.h3b'],
] as const)('Electron %s persists, filters, sorts and reveals its folder', async (kind, folder, extension) => {
  const { bridge, openPath } = await shell();
  const platform = electronPlatform(bridge);
  expect(platform[kind]).toBe(bridge[kind]);
  const library = platform[kind];
  const directory = path.join(documents, 'Hadjitron 3000', folder);
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await library.list()).toEqual([]);
  await library.write('zebra', bytes);
  await library.write('Alpha', bytes);
  await writeFile(path.join(directory, 'ignore.txt'), bytes);
  await writeFile(path.join(directory, kind === 'library' ? 'ignore.h3b' : 'ignore.h3s'), bytes);
  await mkdir(path.join(directory, `ignore${extension}`));
  expect(await library.list()).toEqual(['Alpha', 'zebra']);
  expect(new Uint8Array(await readFile(path.join(directory, `zebra${extension}`)))).toEqual(bytes);
  expect(await library.read('zebra')).toEqual(bytes);
  await library.write('zebra', new Uint8Array([4]));
  expect(await library.read('zebra')).toEqual(new Uint8Array([4]));
  library.reveal!();
  await vi.waitFor(() => expect(openPath).toHaveBeenCalledWith(directory));
  await library.remove('zebra');
  expect(await library.list()).toEqual(['Alpha']);
  await expect(library.read('zebra')).rejects.toThrow();
});

test('Electron libraries keep the same name isolated', async () => {
  const { bridge } = await shell();
  const sound = new Uint8Array([1]);
  const block = new Uint8Array([2]);
  await bridge.library.write('Shared', sound);
  expect(await bridge.blocks.list()).toEqual([]);
  await bridge.blocks.write('Shared', block);
  expect(await bridge.library.read('Shared')).toEqual(sound);
  expect(await bridge.blocks.read('Shared')).toEqual(block);
  await bridge.library.remove('Shared');
  expect(await bridge.blocks.read('Shared')).toEqual(block);
  await bridge.library.write('Shared', sound);
  await bridge.blocks.remove('Shared');
  expect(await bridge.library.read('Shared')).toEqual(sound);
});

test.each(['library', 'blocks'] as const)('Electron %s retains IPC safety checks', async (kind) => {
  const { bridge, invoke, event } = await shell();
  const library = bridge[kind];
  for (const name of ['', '.', '..', '../bass', 'folder/bass', 'folder\\bass', 'a\0b', null, 1]) {
    await expect(library.read(name as string)).rejects.toThrow('Invalid library name');
    await expect(library.write(name as string, new Uint8Array([1]))).rejects.toThrow('Invalid library name');
    await expect(library.remove(name as string)).rejects.toThrow('Invalid library name');
  }
  await expect(invoke(`${kind}-write`, ['Name', [1]])).rejects.toThrow('Invalid arguments');
  for (const [operation, args] of [
    ['list', []], ['read', ['Name']], ['write', ['Name', new Uint8Array([1])]],
    ['remove', ['Name']], ['reveal', []],
  ] as const) {
    const channel = `${kind}-${operation}`;
    await expect(invoke(channel, [...args, 'extra'])).rejects.toThrow('Invalid arguments');
    if (args.length) await expect(invoke(channel, [])).rejects.toThrow('Invalid arguments');
    await expect(invoke(channel, [...args], { ...event, sender: {} as typeof event.sender }))
      .rejects.toThrow('Untrusted sender');
    await expect(invoke(channel, [...args], { ...event, senderFrame: {} })).rejects.toThrow('Untrusted sender');
  }
  expect(await library.list()).toEqual([]);
});

test('Electron queues blocks from initial and second-instance arguments like sounds', async () => {
  const bytes = new Uint8Array([1, 2]);
  for (const name of ['sound.h3s', 'block.H3B', 'second.h3b']) {
    await writeFile(path.join(documents, name), bytes);
  }
  const { app, bridge } = await shell(['sound.h3s', 'block.H3B', '--ignore.h3b', 'ignore.txt']);
  const opened = vi.fn();
  bridge.onOpenFile(opened);
  await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
  expect(opened.mock.calls.map(([file]) => file.name)).toEqual(['sound.h3s', 'block.H3B']);
  app.emit('second-instance', {}, ['hadjitron', 'second.h3b'], documents);
  await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(3));
  expect(opened).toHaveBeenLastCalledWith({
    name: 'second.h3b', path: path.join(documents, 'second.h3b'), bytes,
  });
});

test('Electron queues open-file blocks until the renderer registers', async () => {
  const { app, bridge } = await shell([], 'darwin');
  const file = path.join(documents, 'block.h3b');
  const bytes = new Uint8Array([3]);
  await writeFile(file, bytes);
  const preventDefault = vi.fn();
  app.emit('open-file', { preventDefault }, file);
  expect(preventDefault).toHaveBeenCalledOnce();
  const opened = vi.fn();
  bridge.onOpenFile(opened);
  await vi.waitFor(() => expect(opened).toHaveBeenCalledExactlyOnceWith({ name: 'block.h3b', path: file, bytes }));
});

test('Electron rebuilds from source only in an application built from a checkout on a Mac', async () => {
  const flag = (options: unknown) =>
    (options as { webPreferences: { additionalArguments: string[] } }).webPreferences.additionalArguments;
  const plain = await shell([], 'darwin');
  await vi.waitFor(() => expect(plain.windowOptions()).toBeDefined());
  expect(flag(plain.windowOptions())).toEqual([]);
  expect(plain.handlers.has('update-check')).toBe(false);
  expect(plain.bridge.updates).toBeNull();

  await writeFile(path.join(documents, 'install.json'), JSON.stringify({ source: documents, path: '', commit: 'abc' }));
  const linux = await shell([], 'linux', documents);
  await vi.waitFor(() => expect(linux.windowOptions()).toBeDefined());
  expect(linux.handlers.has('update-check')).toBe(false);

  const mac = await shell([], 'darwin', documents);
  await vi.waitFor(() => expect(mac.windowOptions()).toBeDefined());
  expect(flag(mac.windowOptions())).toEqual(['--hadjitron-updates=source']);
  expect(mac.bridge.updates!.kind).toBe('source');
  expect([...mac.handlers.keys()].filter((key) => key.startsWith('update-'))).toEqual([
    'update-check', 'update-build', 'update-restart',
  ]);
  await expect(mac.invoke('update-restart')).rejects.toThrow('Nothing to install');
  // It fails either way here: the folder of the pretended bundle cannot be written to, or there is no checkout.
  await expect(mac.invoke('update-build')).rejects.toThrow(/The details are in .*update\.log\.$/);
});

/** Stands in for electron-updater's autoUpdater with one newer release waiting on GitHub. */
function fakeAutoUpdater() {
  const updater = Object.assign(new EventEmitter(), {
    currentVersion: { version: '0.1.0' },
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true, updateInfo: { version: '0.2.0', releaseNotes: '<ul><li>New pads</li></ul>' },
    })),
    downloadUpdate: vi.fn(async () => {
      updater.emit('download-progress', { percent: 50 });
      return [];
    }),
    quitAndInstall: vi.fn(),
  });
  return updater;
}

test('Electron updates from GitHub releases only in an installed Windows application', async () => {
  const flag = (options: unknown) =>
    (options as { webPreferences: { additionalArguments: string[] } }).webPreferences.additionalArguments;
  const autoUpdater = fakeAutoUpdater();
  const dev = await shell([], 'win32', null, autoUpdater);
  await vi.waitFor(() => expect(dev.windowOptions()).toBeDefined());
  expect(dev.app.setAppUserModelId).toHaveBeenCalledWith('com.hadjitron.app');
  expect(flag(dev.windowOptions())).toEqual([]);
  expect(dev.bridge.updates).toBeNull();

  const installed = await shell([], 'win32', documents, autoUpdater);
  await vi.waitFor(() => expect(installed.windowOptions()).toBeDefined());
  expect(flag(installed.windowOptions())).toEqual(['--hadjitron-updates=release']);
  const { bridge, app, win } = installed;
  expect(bridge.updates!.kind).toBe('release');
  expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  expect(await bridge.updates!.check()).toEqual({
    current: '0.1.0', latest: '0.2.0', changes: ['New pads'], blocked: null,
  });
  await expect(installed.invoke('update-restart')).rejects.toThrow('Nothing to install');
  const progress = vi.fn();
  await bridge.updates!.build(progress);
  expect(progress.mock.calls.map(([p]) => p.value)).toEqual([0, 0.5]);
  app.emit('will-quit');
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  bridge.updates!.restart();
  await vi.waitFor(() => expect(win.close).toHaveBeenCalledOnce());
  app.emit('will-quit');
  expect(autoUpdater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);

  // Without electron-updater the application still starts, without updates; a build from source is not offered one.
  const broken = await shell([], 'win32', documents);
  await vi.waitFor(() => expect(broken.windowOptions()).toBeDefined());
  expect(broken.bridge.updates).toBeNull();
  await writeFile(path.join(documents, 'install.json'), JSON.stringify({ source: documents, path: '', commit: 'abc' }));
  const source = await shell([], 'win32', documents, autoUpdater);
  await vi.waitFor(() => expect(source.windowOptions()).toBeDefined());
  expect(source.bridge.updates).toBeNull();
});

test('Electron on Windows refuses library names Windows cannot store and cleans a suggested name', async () => {
  const windows = await shell([], 'win32');
  for (const name of ['Bass?', 'a:b', 'Pad.', 'Pad ', 'CON', 'nul.txt', 'com1', 'x|y', 'a"b', '<a>', 'a*b']) {
    await expect(windows.bridge.library.write(name, new Uint8Array([1])), name).rejects.toThrow('Invalid library name');
  }
  await windows.bridge.library.write('Console', new Uint8Array([1]));
  expect(await windows.bridge.library.list()).toEqual(['Console']);
  await windows.bridge.saveFile({
    title: 'Save Project', defaultName: 'What? Night: 2.h3k', filters: [{ name: 'Project', extensions: ['h3k'] }],
    bytes: new Uint8Array([1]),
  });
  expect(path.basename(windows.showSaveDialog.mock.calls[0][1].defaultPath)).toBe('What- Night- 2.h3k');

  const mac = await shell([], 'darwin');
  await mac.bridge.saveFile({
    title: 'Save Project', defaultName: 'What? Night: 2.h3k', filters: [{ name: 'Project', extensions: ['h3k'] }],
    bytes: new Uint8Array([1]),
  });
  expect(path.basename(mac.showSaveDialog.mock.calls[0][1].defaultPath)).toBe('What? Night: 2.h3k');
});

test('Electron grants MIDI to the app itself and refuses every other permission', async () => {
  const shellUnderTest = await shell();
  const { permissions, webContents } = shellUnderTest;
  await vi.waitFor(() => expect(shellUnderTest.windowOptions()).toBeDefined());
  const request = (permission: string, url: string, contents: unknown = webContents) => {
    let granted: boolean | undefined;
    permissions.request!(contents, permission, (answer) => { granted = answer; }, { requestingUrl: url });
    return granted;
  };
  expect(request('midi', 'app://hadjitron/')).toBe(true);
  expect(request('midi', 'app://hadjitron/index.html#x')).toBe(true);
  // Electron names even a request without system exclusive messages 'midiSysex'.
  expect(request('midiSysex', 'app://hadjitron/')).toBe(true);
  expect(request('midiSysex', 'https://example.com/')).toBe(false);
  for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read', 'fullscreen', 'openExternal']) {
    expect(request(permission, 'app://hadjitron/'), permission).toBe(false);
  }
  for (const url of ['https://example.com/', 'app://other/', 'file:///tmp/x.html', 'not a url']) {
    expect(request('midi', url), url).toBe(false);
  }
  expect(request('midi', 'app://hadjitron/', {})).toBe(false);
  expect(permissions.check!(webContents, 'midi', 'app://hadjitron')).toBe(true);
  expect(permissions.check!(null, 'midi', 'app://hadjitron')).toBe(true);
  expect(permissions.check!(webContents, 'notifications', 'app://hadjitron')).toBe(false);
  expect(permissions.check!(webContents, 'midi', 'https://example.com')).toBe(false);
});

test('Electron writes exported files only by plain audio names into a folder the user chose', async () => {
  const { bridge, invoke, event, showOpenDialog } = await shell();
  expect(await bridge.chooseFolder({ title: 'Export' })).toBeNull();
  const folder = path.join(documents, 'Stems');
  await mkdir(folder);
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [folder] });
  const chosen = await bridge.chooseFolder({ title: 'Export' });
  expect(showOpenDialog.mock.calls[1][1]).toMatchObject({ properties: ['openDirectory', 'createDirectory'] });
  const bytes = new Uint8Array([1, 2, 3]);
  await chosen!.write('Song - Kick.wav', bytes);
  await chosen!.write('Song - Bass.MP3', bytes);
  await chosen!.write('Song - Kick.wav', new Uint8Array([4]));
  expect(new Uint8Array(await readFile(path.join(folder, 'Song - Kick.wav')))).toEqual(new Uint8Array([4]));
  expect(new Uint8Array(await readFile(path.join(folder, 'Song - Bass.MP3')))).toEqual(bytes);

  for (const name of ['', '.', '..', '../up.wav', 'sub/x.wav', 'sub\\x.wav', 'a\0b.wav', '.hidden.wav', 'x.txt',
    'x.wav.h3k', 'x', null, 1]) {
    await expect(chosen!.write(name as string, bytes), String(name)).rejects.toThrow();
  }
  await expect(invoke('folder-write', [1, 'x.wav', [1, 2]])).rejects.toThrow('Invalid arguments');
  // Only folders handed out by the dialog can be written to.
  for (const id of [0, 2, '1', null, folder]) {
    await expect(invoke('folder-write', [id, 'x.wav', bytes])).rejects.toThrow('Unknown folder');
  }
  await expect(invoke('folder-write', [1, 'x.wav'])).rejects.toThrow('Invalid arguments');
  await expect(invoke('folder-write', [1, 'x.wav', bytes], { ...event, sender: {} as typeof event.sender }))
    .rejects.toThrow('Untrusted sender');
  await expect(invoke('folder-choose', [{ title: 1 }])).rejects.toThrow('Invalid arguments');
  await expect(invoke('folder-choose', [])).rejects.toThrow('Invalid arguments');
  expect((await readdir(folder)).sort()).toEqual(['Song - Bass.MP3', 'Song - Kick.wav']);
  expect(await readdir(documents)).not.toContain('up.wav');
});
