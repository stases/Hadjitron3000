import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const updates = require('../../electron/update.cjs');
const cacheDirectory = fileURLToPath(new URL('../../.cache/', import.meta.url));
let dir: string;

beforeEach(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  dir = await mkdtemp(path.join(cacheDirectory, 'update-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

async function commit(repo: string, file: string, message: string) {
  await writeFile(path.join(repo, file), message);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

/** An origin, the user's checkout (cloned from it) and a second clone that pushes new work. */
async function repos() {
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  const source = path.join(dir, 'source');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  await mkdir(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'remote', 'add', 'origin', origin);
  const first = await commit(work, 'a.txt', 'First');
  git(work, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '-q', origin, source);
  return { work, source, info: { source, path: process.env.PATH!, commit: first } };
}

test('check reports nothing new when the application matches GitHub', async () => {
  const { info } = await repos();
  expect(await updates.check(info)).toEqual({
    current: info.commit.slice(0, 7), latest: info.commit.slice(0, 7), changes: [], blocked: null,
  });
});

test('check lists the commits the application lacks, newest first', async () => {
  const { work, info } = await repos();
  await commit(work, 'b.txt', 'Second');
  const third = await commit(work, 'c.txt', 'Third');
  git(work, 'push', '-q', 'origin', 'main');
  const result = await updates.check(info);
  expect(result.changes).toEqual(['Third', 'Second']);
  expect(result.latest).toBe(third.slice(0, 7));
  expect(result.blocked).toBeNull();
});

test('check counts a checkout pulled by hand but not yet rebuilt', async () => {
  const { work, source, info } = await repos();
  await commit(work, 'b.txt', 'Second');
  git(work, 'push', '-q', 'origin', 'main');
  git(source, 'pull', '-q');
  expect((await updates.check(info)).changes).toEqual(['Second']);
});

test('check refuses a checkout with local edits or unpushed commits', async () => {
  const { work, source, info } = await repos();
  await commit(work, 'b.txt', 'Second');
  git(work, 'push', '-q', 'origin', 'main');
  await writeFile(path.join(source, 'a.txt'), 'edited');
  expect((await updates.check(info)).blocked).toMatch(/changes of its own/);
  git(source, 'checkout', '-q', '--', 'a.txt');
  await commit(source, 'mine.txt', 'Mine');
  expect((await updates.check(info)).blocked).toMatch(/not on GitHub/);
});

test('check reports git failures', async () => {
  const { info } = await repos();
  await expect(updates.check({ ...info, source: dir })).rejects.toThrow();
});

test('readInstall accepts only complete records', async () => {
  expect(updates.readInstall(dir)).toBeNull();
  await writeFile(path.join(dir, 'install.json'), JSON.stringify({ source: '/x', path: '/bin' }));
  expect(updates.readInstall(dir)).toBeNull();
  const info = { source: '/x', path: '/bin', commit: 'abc' };
  await writeFile(path.join(dir, 'install.json'), JSON.stringify(info));
  expect(updates.readInstall(dir)).toEqual(info);
});

test('bundleOf finds the .app around the executable', () => {
  expect(updates.bundleOf('/Applications/Hadjitron 3000.app/Contents/MacOS/Hadjitron 3000'))
    .toBe('/Applications/Hadjitron 3000.app');
  expect(updates.bundleOf('/home/me/node_modules/electron/dist/electron')).toBeNull();
});

async function swap(target: string, built: string) {
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'open'), `#!/bin/sh\necho "$1" > "${path.join(dir, 'opened')}"\n`);
  await chmod(path.join(bin, 'open'), 0o755);
  const waiter = spawn('sleep', ['0.5']);
  const child = spawn('/bin/sh', ['-c', updates.SWAP, 'swap', String(waiter.pid), built, target], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const started = Date.now();
  await new Promise((resolve) => child.once('exit', resolve));
  return { waited: Date.now() - started, opened: (await readFile(path.join(dir, 'opened'), 'utf8')).trim() };
}

test('the swap waits for the old application, replaces it and opens the new one', async () => {
  const target = path.join(dir, 'Apps', 'H.app');
  const built = path.join(dir, 'release', 'H.app');
  await mkdir(target, { recursive: true });
  await mkdir(built, { recursive: true });
  await writeFile(path.join(target, 'v'), 'old');
  await writeFile(path.join(built, 'v'), 'new');
  const { waited, opened } = await swap(target, built);
  expect(waited).toBeGreaterThanOrEqual(400);
  expect(opened).toBe(target);
  expect(await readFile(path.join(target, 'v'), 'utf8')).toBe('new');
  await expect(readFile(path.join(`${target}.old`, 'v'))).rejects.toThrow();
});

test('the swap keeps and reopens the old application when the new one is missing', async () => {
  const target = path.join(dir, 'Apps', 'H.app');
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'v'), 'old');
  const { opened } = await swap(target, path.join(dir, 'missing.app'));
  expect(opened).toBe(target);
  expect(await readFile(path.join(target, 'v'), 'utf8')).toBe('old');
});
