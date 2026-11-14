import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const cacheDirectory = fileURLToPath(new URL('../../.cache/', import.meta.url));
const script = fileURLToPath(new URL('../../scripts/release.mjs', import.meta.url));
let dir: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();

/** A checkout with the release script and a package at 0.1.0, as the repository is before its first release. */
beforeEach(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  dir = await mkdtemp(path.join(cacheDirectory, 'release-test-'));
  await mkdir(path.join(dir, 'scripts'));
  await copyFile(script, path.join(dir, 'scripts', 'release.mjs'));
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  await writeFile(path.join(dir, 'package.json'), json({ name: 'h', version: '0.1.0', private: true }));
  await writeFile(path.join(dir, 'package-lock.json'), json({
    name: 'h', version: '0.1.0', lockfileVersion: 3, packages: { '': { name: 'h', version: '0.1.0' } },
  }));
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'First');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const release = (...args: string[]) => spawnSync(process.execPath, ['scripts/release.mjs', ...args], {
  cwd: dir, encoding: 'utf8',
  env: {
    ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t',
  },
});

test('release sets the version, commits it, tags it and only prints the push', async () => {
  const result = release('0.2.0');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('git push --atomic origin main v0.2.0');
  expect(JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).version).toBe('0.2.0');
  const lock = JSON.parse(await readFile(path.join(dir, 'package-lock.json'), 'utf8'));
  expect([lock.version, lock.packages[''].version]).toEqual(['0.2.0', '0.2.0']);
  expect(git('log', '-1', '--format=%s')).toBe('Version 0.2.0');
  expect(git('describe', '--exact-match', 'HEAD')).toBe('v0.2.0');
  expect(git('status', '--porcelain')).toBe('');
  expect(git('remote')).toBe('');
});

test('release tags the current commit when the version is already set', () => {
  expect(release('0.1.0').status).toBe(0);
  expect(git('log', '-1', '--format=%s')).toBe('First');
  expect(git('describe', '--exact-match', 'HEAD')).toBe('v0.1.0');
});

test('release refuses a bad version, an existing tag and uncommitted changes', async () => {
  for (const version of [[], ['1.2'], ['v1.2.0'], ['1.2.0-beta']]) {
    const result = release(...version);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: npm run release -- <version>');
  }
  expect(release('0.2.0').status).toBe(0);
  expect(release('0.2.0').stderr).toContain('The tag v0.2.0 exists already.');
  await writeFile(path.join(dir, 'package.json'), '{}\n');
  expect(release('0.3.0').stderr).toContain('Commit or stash your changes first.');
  expect(git('tag', '--list')).toBe('v0.2.0');
});
