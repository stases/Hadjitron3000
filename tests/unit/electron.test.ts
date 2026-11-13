import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** Load main.cjs and preload.cjs; `installed` is a folder holding install.json, as in a packaged .app. */
async function shell(argv: string[] = [], platform = 'linux', installed: string | null = null) {
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
    focus: vi.fn(),
  });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: installed !== null,
    getPath: (name: string) => {
      expect(['documents', 'exe']).toContain(name);
      return name === 'exe' ? EXE : documents;
    },
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    quit: vi.fn(),
  });
  const openPath = vi.fn(async (_directory: string) => '');
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
    dialog: {},
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
    runInNewContext(await readFile(path.join(electronDirectory, file), 'utf8'), {
      require: (id: string) => id === 'electron' ? electron : require(id),
      __dirname: file === 'main.cjs' && installed ? installed : electronDirectory,
      process: { argv: ['hadjitron', ...argv], env: {}, platform, cwd: () => documents },
      Uint8Array, URL, console,
    });
  }
  return { app, bridge, invoke, event, openPath, handlers, windowOptions: () => windowOptions };
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

test('Electron offers updates only in an installed application on a Mac', async () => {
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
  expect(flag(mac.windowOptions())).toEqual(['--hadjitron-updates']);
  expect([...mac.handlers.keys()].filter((key) => key.startsWith('update-'))).toEqual([
    'update-check', 'update-build', 'update-restart',
  ]);
  await expect(mac.invoke('update-restart')).rejects.toThrow('Nothing to install');
  await expect(mac.invoke('update-build')).rejects.toThrow('Cannot write to /Applications.');
});
