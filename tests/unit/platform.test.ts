import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test, vi } from 'vitest';
import { browserPlatform } from '../../src/platform/browser';

const databases = vi.hoisted(() => new Map<string, Map<string, Uint8Array>>());
vi.mock('idb-keyval', () => ({
  createStore: (database: string, name: string) => {
    const store = new Map<string, Uint8Array>();
    databases.set(`${database}/${name}`, store);
    return store;
  },
  keys: async (store: Map<string, Uint8Array>) => [...store.keys()],
  get: async (name: string, store: Map<string, Uint8Array>) => store.get(name),
  set: async (name: string, bytes: Uint8Array, store: Map<string, Uint8Array>) => { store.set(name, bytes); },
  del: async (name: string, store: Map<string, Uint8Array>) => { store.delete(name); },
}));

beforeEach(() => {
  for (const store of databases.values()) store.clear();
});

const require = createRequire(import.meta.url);
const { validateLibraryName, suggestedName, appFilePath, contentType } = require('../../electron/paths.cjs') as {
  validateLibraryName(name: unknown, platform?: string): string;
  suggestedName(name: string, platform: string): string;
  appFilePath(url: unknown, dist: string): string | null;
  contentType(file: string): string;
};
const dist = fileURLToPath(new URL('../../dist', import.meta.url));

test.each([
  ['index.html', 'text/html; charset=utf-8'],
  ['assets/app.js', 'text/javascript; charset=utf-8'],
  ['assets/app.mjs', 'text/javascript; charset=utf-8'],
  ['assets/app.css', 'text/css; charset=utf-8'],
  ['project.json', 'application/json; charset=utf-8'],
  ['assets/app.js.map', 'application/json; charset=utf-8'],
  ['assets/encoder.wasm', 'application/wasm'],
  ['assets/font.woff2', 'font/woff2'],
  ['assets/icon.png', 'image/png'],
  ['assets/icon.svg', 'image/svg+xml; charset=utf-8'],
  ['favicon.ico', 'image/x-icon'],
  ['notes.txt', 'text/plain; charset=utf-8'],
  ['INDEX.HTML', 'text/html; charset=utf-8'],
  ['sound.h3s', 'application/octet-stream'],
  ['block.h3b', 'application/octet-stream'],
  ['unknown', 'application/octet-stream'],
])('serves %s with the correct content type', (file, expected) => {
  expect(contentType(file)).toBe(expected);
});

test.each(['Bass', 'Warm pad', 'a.b', '音色', 'sound.h3s', 'block.h3b'])('accepts a library name: %s', (name) => {
  expect(validateLibraryName(name)).toBe(name);
});

test.each(['', '.', '..', '../bass', 'folder/bass', 'folder\\bass', 'a\0b', null, 1])(
  'rejects an unsafe library name: %s', (name) => {
    expect(() => validateLibraryName(name)).toThrow('Invalid library name');
  },
);

test.each(['Bass?', 'a:b', 'x|y', 'a"b', '<a>', 'a*b', 'tab\there', 'Pad.', 'Pad ', 'CON', 'con.h3s', 'Nul', 'COM1',
  'lpt9.txt'])('on Windows rejects a name Windows cannot store: %s', (name) => {
  expect(() => validateLibraryName(name, 'win32')).toThrow('Invalid library name');
  expect(validateLibraryName(name, 'darwin')).toBe(name);
});

test.each(['Bass', 'Warm pad', 'a.b', '音色', 'Console', 'Concrete', 'com10', 'Pad (2)'])(
  'on Windows accepts a library name: %s', (name) => {
    expect(validateLibraryName(name, 'win32')).toBe(name);
  },
);

test.each([
  ['Night Drive.h3k', 'Night Drive.h3k'],
  ['What? Night: 2.h3k', 'What- Night- 2.h3k'],
  ['A <b> "c" | d*.wav', 'A -b- -c- - d-.wav'],
  ['Trailing. ', 'Trailing'],
  ['...', '-'],
])('the save dialog suggests %s on Windows as %s', (name, windows) => {
  expect(suggestedName(name, 'win32')).toBe(windows);
  expect(suggestedName(name, 'darwin')).toBe(name);
});

test.each([
  ['app://hadjitron/', 'index.html'],
  ['app://hadjitron', 'index.html'],
  ['app://hadjitron/assets/app.js', 'assets/app.js'],
  ['app://hadjitron/assets/a%20b.wav?cache=1#play', 'assets/a b.wav'],
  ['app://hadjitron/factory', 'factory'],
])('maps %s inside dist', (url, relative) => {
  expect(appFilePath(url, dist)).toBe(path.join(dist, relative));
});

test.each(['library', 'blocks'] as const)('the browser %s supports sorted names and file operations', async (kind) => {
  const library = browserPlatform[kind];
  const bytes = new Uint8Array([1, 2, 3]);
  await library.write('zebra', bytes);
  await library.write('Alpha', bytes);
  expect(await library.list()).toEqual(['Alpha', 'zebra']);
  expect(await library.read('zebra')).toEqual(bytes);
  await library.write('zebra', new Uint8Array([4]));
  expect(await library.read('zebra')).toEqual(new Uint8Array([4]));
  await library.remove('zebra');
  expect(await library.list()).toEqual(['Alpha']);
  await expect(library.read('zebra')).rejects.toThrow('not found');
  expect(library.reveal).toBeNull();
});

test('browser libraries are isolated and existing sounds remain readable', async () => {
  const sound = new Uint8Array([1]);
  const block = new Uint8Array([2]);
  databases.get('hadjitron-library/sounds')!.set('Existing', sound);
  expect(await browserPlatform.library.read('Existing')).toEqual(sound);
  expect(await browserPlatform.blocks.list()).toEqual([]);
  await browserPlatform.blocks.write('Existing', block);
  expect(await browserPlatform.library.read('Existing')).toEqual(sound);
  expect(await browserPlatform.blocks.read('Existing')).toEqual(block);
  await browserPlatform.blocks.remove('Existing');
  expect(await browserPlatform.library.list()).toEqual(['Existing']);
  await browserPlatform.blocks.write('Existing', block);
  await browserPlatform.library.remove('Existing');
  expect(await browserPlatform.blocks.read('Existing')).toEqual(block);
});

test.each(['library', 'blocks'] as const)('the browser %s rejects unsafe names', async (kind) => {
  const library = browserPlatform[kind];
  for (const name of ['', '.', '..', '../bass', 'folder/bass', 'folder\\bass', 'a\0b', null, 1]) {
    for (const operation of [
      () => library.read(name as string),
      () => library.write(name as string, new Uint8Array([1])),
      () => library.remove(name as string),
    ]) {
      await expect(Promise.resolve().then(async () => { await operation(); })).rejects.toThrow('Invalid library name');
    }
  }
  expect(await library.list()).toEqual([]);
});

test.each([
  'app://hadjitron/../package.json',
  'app://hadjitron/%2e%2e/package.json',
  'app://hadjitron/%2E%2E%2Fpackage.json',
  'app://hadjitron/assets/../../package.json',
  'app://hadjitron/assets/%2e%2e/%2e%2e/package.json',
  'app://hadjitron/..%5cpackage.json',
  'app://hadjitron/C:/package.json',
  'app://hadjitron/%00',
  'app://hadjitron/%ZZ',
  'app://elsewhere/index.html',
  'app://hadjitron.evil/index.html',
  'app://user@hadjitron/index.html',
  'https://hadjitron/index.html',
  'file:///etc/passwd',
])('rejects traversal or an invalid app URL: %s', (url) => {
  expect(appFilePath(url, dist)).toBeNull();
});

test('double encoding and URL normalization cannot escape dist', () => {
  for (const url of [
    'app://hadjitron/%252e%252e%252fpackage.json',
    new URL('app://hadjitron/../package.json').href,
    new URL('app://hadjitron/%2e%2e/package.json').href,
    'app://hadjitron//etc/passwd',
  ]) {
    const file = appFilePath(url, dist);
    expect(file).not.toBeNull();
    expect(path.relative(dist, file!)).not.toMatch(/^\.\.(?:[/\\]|$)/);
    expect(path.isAbsolute(path.relative(dist, file!))).toBe(false);
  }
});
