// Prepare a release: `npm run release -- 1.2.0` sets the version in package.json and package-lock.json, commits
// "Version 1.2.0", tags it v1.2.0 and prints the command that pushes both. It pushes nothing itself. The workflow
// in .github/workflows/build.yml builds the tag on Windows and macOS and publishes the release.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function stop(message) {
  console.error(message);
  process.exit(1);
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) stop('Usage: npm run release -- <version>, for example 1.2.0');
const tag = `v${version}`;
if (git('status', '--porcelain', '--untracked-files=no')) stop('Commit or stash your changes first.');
if (git('tag', '--list', tag)) stop(`The tag ${tag} exists already.`);

function setVersion(file, change) {
  const path = new URL(file, new URL('..', import.meta.url));
  const json = JSON.parse(readFileSync(path, 'utf8'));
  change(json);
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
}

const previous = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (previous !== version) {
  setVersion('package.json', (json) => { json.version = version; });
  setVersion('package-lock.json', (json) => {
    json.version = version;
    json.packages[''].version = version;
  });
  git('add', 'package.json', 'package-lock.json');
  git('commit', '--quiet', '-m', `Version ${version}`);
}
git('tag', '-a', tag, '-m', `Version ${version}`);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
console.log(`Tagged ${tag}${previous === version ? '' : ` on a new commit, Version ${version}`}. To publish it:\n`);
console.log(`  git push --atomic origin ${branch} ${tag}\n`);
console.log('GitHub Actions then builds and tests it on Windows and macOS and publishes the release.');
