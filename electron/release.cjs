// Updates for the Windows application, which is installed from the Setup .exe of a release on GitHub. electron-updater
// reads latest.yml of the newest release of stases/Hadjitron3000 (app-update.yml in the installed application says
// where) and the release notes of every newer release. Nothing is downloaded until the user asks for the update, and
// the new version is installed only when the user restarts from the dialog. The user's sounds, blocks and projects
// live outside the application and are never touched.

const STEP = 'Downloading the new version';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(entity, name) {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
  const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

/** One line of a release note as plain text: no tags, entities decoded, no bullet. */
function plain(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, decode)
    .replace(/\s+/g, ' ').trim().replace(/^[-*•]\s+/, '');
}

function lines(html) {
  const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
  return (items.length ? items : html.split(/<br\s*\/?>|<\/p>|<\/h\d>|\n/i)).map(plain).filter(Boolean);
}

/**
 * The release notes as a list of changes, newest first. GitHub hands them over as HTML: one string for the newest
 * release, or, with the full changelog, one note for each release newer than this one.
 */
function changesOf(notes) {
  if (Array.isArray(notes)) return notes.flatMap((release) => lines(release?.note ?? ''));
  return typeof notes === 'string' ? lines(notes) : [];
}

const OFFLINE = new RegExp([
  'ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED', 'ERR_NETWORK_CHANGED',
  'ERR_CONNECTION_', 'ERR_TIMED_OUT', 'ERR_ADDRESS_UNREACHABLE', 'ERR_PROXY_CONNECTION_FAILED',
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
].join('|'));

/** A sentence for the dialog from whatever electron-updater threw; the whole story goes to update.log. */
function readableError(error) {
  const text = String(error?.message ?? error);
  const code = String(error?.code ?? '');
  if (OFFLINE.test(text) || OFFLINE.test(code)) {
    return 'GitHub could not be reached. Check that the computer is online, then try again.';
  }
  const status = Number(error?.statusCode ?? /HttpError: (\d{3})\b/.exec(text)?.[1] ?? 0);
  if (status >= 500 || status === 429 || status === 403) {
    return `GitHub is not answering properly right now (error ${status}). Try again later.`;
  }
  if (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' || /No published versions/.test(text)) {
    return 'GitHub has no release of Hadjitron 3000 yet.';
  }
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
    return 'The newest release on GitHub has no Windows installer yet. Try again later.';
  }
  if (/checksum mismatch|ERR_CHECKSUM|ERR_CONTENT_LENGTH_MISMATCH/i.test(text)) {
    return 'The download arrived damaged. Try again.';
  }
  if (code === 'ENOSPC') return 'The disk is full. Make some room, then try again.';
  if (status) return `GitHub answered with error ${status}. Try again later.`;
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? 'Something went wrong.';
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** Check, download and install around an electron-updater instance; `log` takes its messages for update.log. */
function releaseUpdates(updater, log) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.fullChangelog = true;
  updater.disableWebInstaller = true;
  const write = (message) => log(String(message?.stack ?? message));
  updater.logger = { info: write, warn: write, error: write };
  updater.on('error', write);
  const failed = (error) => new Error(readableError(error));
  return {
    async check() {
      let result;
      try {
        result = await updater.checkForUpdates();
      } catch (error) {
        throw failed(error);
      }
      if (!result) throw new Error('Only the installed application can update itself.');
      const current = updater.currentVersion.version;
      if (!result.isUpdateAvailable) return { current, latest: current, changes: [], blocked: null };
      const { version, releaseNotes } = result.updateInfo;
      return { current, latest: version, changes: changesOf(releaseNotes), blocked: null };
    },
    async build(progress) {
      const listener = (info) => progress({ step: STEP, value: Math.min(1, Math.max(0, info.percent / 100)) });
      progress({ step: STEP, value: 0 });
      updater.on('download-progress', listener);
      try {
        await updater.downloadUpdate();
      } catch (error) {
        throw failed(error);
      } finally {
        updater.removeListener('download-progress', listener);
      }
    },
    // The installer waits for this process to end, shows its progress bar and opens the new version.
    install: () => updater.quitAndInstall(false, true),
  };
}

module.exports = { releaseUpdates, changesOf, readableError };
