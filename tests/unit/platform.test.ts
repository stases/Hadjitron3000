import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { validateLibraryName, appFilePath, contentType } = require('../../electron/paths.cjs') as {
  validateLibraryName(name: unknown): string;
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
  ['unknown', 'application/octet-stream'],
])('serves %s with the correct content type', (file, expected) => {
  expect(contentType(file)).toBe(expected);
});

test.each(['Bass', 'Warm pad', 'a.b', '音色', 'sound.h3s'])('accepts a library name: %s', (name) => {
  expect(validateLibraryName(name)).toBe(name);
});

test.each(['', '.', '..', '../bass', 'folder/bass', 'folder\\bass', 'a\0b', null, 1])(
  'rejects an unsafe library name: %s', (name) => {
    expect(() => validateLibraryName(name)).toThrow('Invalid sound name');
  },
);

test.each([
  ['app://hadjitron/', 'index.html'],
  ['app://hadjitron', 'index.html'],
  ['app://hadjitron/assets/app.js', 'assets/app.js'],
  ['app://hadjitron/assets/a%20b.wav?cache=1#play', 'assets/a b.wav'],
  ['app://hadjitron/factory', 'factory'],
])('maps %s inside dist', (url, relative) => {
  expect(appFilePath(url, dist)).toBe(path.join(dist, relative));
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
