// Install the Setup .exe on the Windows machine of the workflow as a user would, silently, and check what the
// installer did: the program in the user's Programs folder, the Start menu and desktop shortcuts, the uninstaller and
// the file types. Then it hands the program to the end-to-end tests through HADJITRON_EXE. `uninstall` removes it again
// and checks that it is gone. Used by .github/workflows/build.yml only.
//   node scripts/ci-windows-install.mjs install
//   node scripts/ci-windows-install.mjs uninstall

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const PROGRAM = 'Hadjitron 3000.exe';
const programs = path.join(process.env.LOCALAPPDATA ?? '', 'Programs');
const startMenu = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const TYPES = { h3k: 'Hadjitron3000.Project', h3s: 'Hadjitron3000.Sound', h3b: 'Hadjitron3000.Block' };

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function run(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8' });
  if (result.error) fail(`${program} did not start: ${result.error.message}`);
  return result;
}

async function waitFor(check, what, seconds = 120) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end;) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return fail(`${what} after ${seconds} seconds.`);
}

/** The installed program: a folder under Programs that holds it. */
function installed() {
  if (!existsSync(programs)) return null;
  const folder = readdirSync(programs).find((name) => existsSync(path.join(programs, name, PROGRAM)));
  return folder ? path.join(programs, folder) : null;
}

/** The default value of a key under HKEY_CURRENT_USER\Software\Classes, or null. */
function classValue(key) {
  const result = run('reg', ['query', `HKCU\\Software\\Classes\\${key}`, '/ve']);
  return result.status === 0 ? /REG_SZ\s+(.*)/.exec(result.stdout)?.[1].trim() ?? '' : null;
}

function desktop() {
  const result = run('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"]);
  return result.stdout.trim();
}

async function install() {
  const release = path.resolve('release');
  const setup = readdirSync(release).find((name) => /^Hadjitron-3000-Setup-.*\.exe$/.test(name));
  if (!setup) fail(`No Hadjitron-3000-Setup-*.exe in ${release}.`);
  if (installed()) fail(`Hadjitron 3000 is already installed in ${installed()}.`);
  console.log(`Installing ${setup} silently`);
  const result = run(path.join(release, setup), ['/S']);
  if (result.status !== 0) fail(`The installer ended with exit code ${result.status}.`);
  const folder = await waitFor(installed, `No ${PROGRAM} under ${programs}`);
  const exe = path.join(folder, PROGRAM);
  console.log(`Installed ${exe}`);
  if (!readdirSync(folder).some((name) => /^Uninstall .*\.exe$/.test(name))) fail(`No uninstaller in ${folder}.`);
  if (!existsSync(path.join(folder, 'resources', 'app-update.yml'))) {
    fail('The installed program has no resources\\app-update.yml, so it cannot find its updates.');
  }
  for (const shortcut of [path.join(startMenu, 'Hadjitron 3000.lnk'), path.join(desktop(), 'Hadjitron 3000.lnk')]) {
    if (!existsSync(shortcut)) fail(`No shortcut ${shortcut}.`);
  }
  for (const [ext, type] of Object.entries(TYPES)) {
    if (classValue(`.${ext}`) !== type) fail(`.${ext} files are not registered as ${type}.`);
    const open = classValue(`${type}\\shell\\open\\command`) ?? '';
    if (!open.toLowerCase().includes(exe.toLowerCase()) || !open.includes('%1')) {
      fail(`.${ext} files do not open with ${exe}: the command is ${open || 'missing'}.`);
    }
  }
  console.log('The shortcuts, the uninstaller and the .h3k, .h3s and .h3b file types are in place.');
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `HADJITRON_EXE=${exe}\n`);
}

async function uninstall() {
  const folder = installed();
  if (!folder) fail(`Hadjitron 3000 is not installed under ${programs}.`);
  const uninstaller = readdirSync(folder).find((name) => /^Uninstall .*\.exe$/.test(name));
  if (!uninstaller) fail(`No uninstaller in ${folder}.`);
  console.log(`Running ${uninstaller} silently`);
  // The uninstaller copies itself elsewhere and lets the first copy end at once, so wait for the program to go.
  run(path.join(folder, uninstaller), ['/S']);
  await waitFor(() => !existsSync(path.join(folder, PROGRAM)), `${PROGRAM} is still there`);
  await waitFor(() => !existsSync(path.join(startMenu, 'Hadjitron 3000.lnk')), 'The Start menu shortcut is still there');
  await waitFor(() => classValue(`${TYPES.h3k}\\shell\\open\\command`) === null, 'The .h3k file type is still there');
  console.log('Uninstalled: the program, its Start menu shortcut and its file types are gone.');
}

const action = process.argv[2];
if (action === 'install') await install();
else if (action === 'uninstall') await uninstall();
else fail('Usage: node scripts/ci-windows-install.mjs install|uninstall');
