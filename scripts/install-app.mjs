// Build Hadjitron 3000.app from this checkout and put it in /Applications (or ~/Applications).
// The application remembers this folder so that Help > Check for Updates can pull and rebuild it.
// With --build-only it only builds and prints the path of the new .app (used by the updater).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync, writeFileSync, accessSync, constants, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const buildOnly = process.argv.includes('--build-only');
const APP = 'Hadjitron 3000.app';
const sh = (command, args) => execFileSync(command, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });

if (process.platform !== 'darwin') {
  console.error('The application can only be built on a Mac.');
  process.exit(1);
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const install = path.join(root, 'electron', 'install.json');
writeFileSync(install, JSON.stringify({ source: root, path: process.env.PATH, commit }, null, 2));
try {
  sh('npx', ['vite', 'build']);
  sh('npx', ['electron-builder', '--mac', 'dir', '--publish', 'never']);
} finally {
  rmSync(install, { force: true });
}

const release = path.join(root, 'release');
const built = readdirSync(release)
  .filter((dir) => dir.startsWith('mac'))
  .map((dir) => path.join(release, dir, APP))
  .filter((app) => existsSync(app))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!built) {
  console.error(`No ${APP} under ${release}.`);
  process.exit(1);
}

if (buildOnly) {
  console.log(built);
} else {
  const writable = (dir) => {
    try {
      accessSync(dir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  const folder = writable('/Applications') ? '/Applications' : path.join(homedir(), 'Applications');
  mkdirSync(folder, { recursive: true });
  const target = path.join(folder, APP);
  rmSync(target, { recursive: true, force: true });
  sh('ditto', [built, target]);
  console.log(`\nHadjitron 3000 is in ${folder}. Open it from there or from Launchpad.`);
}
