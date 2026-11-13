// Updates for the installed application. `npm run app` builds the .app from a git checkout and writes
// install.json next to this file: where the checkout is, the PATH to run git and npm with, and the commit
// it was built from. Updating pulls the checkout, rebuilds the .app there and swaps it in after quitting.
// The user's sounds, blocks and projects live outside the application and are never touched.

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function readInstall(directory) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(directory, 'install.json'), 'utf8'));
    if (typeof info.source === 'string' && typeof info.path === 'string' && typeof info.commit === 'string') return info;
  } catch {}
  return null;
}

function run(info, command, args, log) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: info.path, GIT_TERMINAL_PROMPT: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(command, args, { cwd: info.source, env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      log?.(`$ ${command} ${args.join(' ')}\n${stdout}${stderr}`);
      if (!error) return resolve(stdout.trim());
      const lines = (stderr || stdout || error.message).trim().split('\n');
      reject(new Error(lines.slice(-4).join('\n')));
    });
  });
}

/** What GitHub has that this application lacks. */
async function check(info) {
  const git = (...args) => run(info, 'git', args);
  await git('fetch', '--quiet');
  const latest = await git('rev-parse', '@{upstream}');
  const changes = latest === info.commit ? [] : (await git('log', '--format=%s', `${info.commit}..${latest}`))
    .split('\n').filter(Boolean);
  const local = await git('status', '--porcelain', '--untracked-files=no');
  const ahead = Number(await git('rev-list', '--count', '@{upstream}..HEAD'));
  let blocked = null;
  if (local) blocked = `The program folder ${info.source} has changes of its own.`;
  else if (ahead) blocked = `The program folder ${info.source} has commits that are not on GitHub.`;
  return { current: info.commit.slice(0, 7), latest: latest.slice(0, 7), changes, blocked };
}

/** Pull, install and build. Resolves to the path of the new .app. */
async function build(info, progress, log) {
  progress('Fetching the new version');
  await run(info, 'git', ['pull', '--ff-only', '--quiet'], log);
  progress('Installing packages');
  await run(info, 'npm', ['install', '--no-audit', '--no-fund'], log);
  progress('Building the application');
  const out = await run(info, 'node', ['scripts/install-app.mjs', '--build-only'], log);
  const built = out.split('\n').pop();
  if (!built.endsWith('.app') || !fs.existsSync(built)) throw new Error('The build did not produce an application.');
  return built;
}

// Waits for the old application to exit, puts the new one in its place and opens it.
const SWAP = `
pid=$1; new=$2; target=$3
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
rm -rf "$target.old"
if mv "$target" "$target.old"; then
  if mv "$new" "$target"; then rm -rf "$target.old"; else mv "$target.old" "$target"; fi
fi
open "$target"
`;

/** The .app bundle that contains the running executable, or null when not running from one. */
function bundleOf(exe) {
  const bundle = path.resolve(exe, '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

function swapAfterExit(pid, built, target) {
  spawn('/bin/sh', ['-c', SWAP, 'swap', String(pid), built, target], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { readInstall, check, build, bundleOf, swapAfterExit, SWAP };
