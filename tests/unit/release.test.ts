import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { expect, test, vi } from 'vitest';
import type { UpdateCheck, UpdateProgress } from '../../src/platform/api';

interface Release {
  check(): Promise<UpdateCheck>;
  build(progress: (progress: UpdateProgress) => void): Promise<void>;
  install(): void;
}

const require = createRequire(import.meta.url);
const { releaseUpdates, changesOf, readableError } = require('../../electron/release.cjs') as {
  releaseUpdates(updater: unknown, log: (text: string) => void): Release;
  changesOf(notes: unknown): string[];
  readableError(error: unknown): string;
};

const failure = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

/** Stands in for electron-updater's NsisUpdater: the calls and events the release updates use. */
function fakeUpdater(version = '0.1.0') {
  return Object.assign(new EventEmitter(), {
    currentVersion: { version },
    autoDownload: true,
    autoInstallOnAppQuit: true,
    fullChangelog: false,
    disableWebInstaller: false,
    logger: null as unknown,
    checkForUpdates: vi.fn(async (): Promise<unknown> => null),
    downloadUpdate: vi.fn(async () => ['C:\\cache\\Hadjitron-3000-Setup-0.2.0.exe']),
    quitAndInstall: vi.fn(),
  });
}

const found = (version: string, releaseNotes: unknown) => ({
  isUpdateAvailable: true,
  updateInfo: { version, releaseNotes, files: [], path: '', sha512: '', releaseDate: '' },
});

test('nothing downloads or installs on its own, and every release since this one is read', () => {
  const updater = fakeUpdater();
  const log = vi.fn();
  releaseUpdates(updater, log);
  expect(updater).toMatchObject({
    autoDownload: false, autoInstallOnAppQuit: false, fullChangelog: true, disableWebInstaller: true,
  });
  (updater.logger as { info(message: string): void }).info('Checking for update');
  updater.emit('error', new Error('boom'));
  expect(log).toHaveBeenCalledWith('Checking for update');
  expect(log.mock.calls[1][0]).toMatch(/^Error: boom/);
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  expect(updater.downloadUpdate).not.toHaveBeenCalled();
});

test('check reports nothing new when GitHub has no newer release', async () => {
  const updater = fakeUpdater('0.2.0');
  updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '0.2.0' } });
  expect(await releaseUpdates(updater, () => {}).check()).toEqual({
    current: '0.2.0', latest: '0.2.0', changes: [], blocked: null,
  });
});

test('check names the new version and lists the notes of every newer release, newest first', async () => {
  const updater = fakeUpdater();
  updater.checkForUpdates.mockResolvedValue(found('0.3.0', [
    { version: '0.3.0', note: '<ul>\n<li>Faster song view</li>\n<li>Pads &amp; drones</li>\n</ul>' },
    { version: '0.2.0', note: '<ul><li>Fixed <code>.h3b</code> opening</li></ul>' },
  ]));
  expect(await releaseUpdates(updater, () => {}).check()).toEqual({
    current: '0.1.0', latest: '0.3.0', changes: ['Faster song view', 'Pads & drones', 'Fixed .h3b opening'],
    blocked: null,
  });
  expect(updater.downloadUpdate).not.toHaveBeenCalled();
});

test('release notes become plain lines whatever shape they come in', () => {
  expect(changesOf('<p>One line<br>Another &lt;one&gt;</p>')).toEqual(['One line', 'Another <one>']);
  expect(changesOf('- First\n- Second\n\n* Third')).toEqual(['First', 'Second', 'Third']);
  expect(changesOf('<h2>What changed</h2><ul><li><p>Nested &#8220;quote&#x201d;</p></li></ul>'))
    .toEqual(['Nested “quote”']);
  expect(changesOf('<script>alert(1)</script>')).toEqual(['alert(1)']);
  expect(changesOf('&#99999999; &bogus;')).toEqual(['&#99999999; &bogus;']);
  expect(changesOf(null)).toEqual([]);
  expect(changesOf([{ version: '0.2.0', note: null }])).toEqual([]);
});

test('build downloads the installer and reports real progress', async () => {
  const updater = fakeUpdater();
  updater.downloadUpdate.mockImplementation(async () => {
    for (const percent of [12.5, 60, 100]) updater.emit('download-progress', { percent, total: 100 });
    return [];
  });
  const progress = vi.fn();
  await releaseUpdates(updater, () => {}).build(progress);
  expect(progress.mock.calls.map(([p]) => p)).toEqual([0, 0.125, 0.6, 1].map((value) => ({
    step: 'Downloading the new version', value,
  })));
  expect(updater.listenerCount('download-progress')).toBe(0);
});

test('a failed download says what went wrong in a sentence and stops listening', async () => {
  const updater = fakeUpdater();
  updater.downloadUpdate.mockRejectedValue(failure('sha512 checksum mismatch, expected abc, got def'));
  await expect(releaseUpdates(updater, () => {}).build(() => {})).rejects.toThrow(
    /^The download arrived damaged\. Try again\.$/);
  expect(updater.listenerCount('download-progress')).toBe(0);
});

test('a failed check says what went wrong in a sentence', async () => {
  const updater = fakeUpdater();
  updater.checkForUpdates.mockRejectedValue(failure('net::ERR_INTERNET_DISCONNECTED'));
  await expect(releaseUpdates(updater, () => {}).check()).rejects.toThrow(
    'GitHub could not be reached. Check that the computer is online, then try again.');
  updater.checkForUpdates.mockResolvedValue(null);
  await expect(releaseUpdates(updater, () => {}).check()).rejects.toThrow(
    'Only the installed application can update itself.');
});

test.each([
  [failure('net::ERR_NAME_NOT_RESOLVED'), 'GitHub could not be reached. Check that the computer is online, then try'],
  [failure('getaddrinfo ENOTFOUND github.com', { code: 'ENOTFOUND' }), 'GitHub could not be reached'],
  [failure('Unable to find latest version on GitHub (https://github.com/stases/Hadjitron3000/releases/latest), please '
    + 'ensure a production release exists: HttpError: 503 Service Unavailable\n  at stack', {
    code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  }), 'GitHub is not answering properly right now (error 503). Try again later.'],
  [failure('rate limited', { statusCode: 429 }), 'GitHub is not answering properly right now (error 429).'],
  [failure('Unable to find latest version on GitHub: HttpError: 404 Not Found', {
    code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  }), 'GitHub has no release of Hadjitron 3000 yet.'],
  [failure('No published versions on GitHub', { code: 'ERR_XML_MISSED_ELEMENT' }),
    'GitHub has no release of Hadjitron 3000 yet.'],
  [failure('Cannot find latest.yml in the latest release artifacts', { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }),
    'The newest release on GitHub has no Windows installer yet.'],
  [failure('ENOSPC: no space left on device, write', { code: 'ENOSPC' }), 'The disk is full.'],
  [failure('HttpError: 410 Gone'), 'GitHub answered with error 410. Try again later.'],
  [failure(`\n  Something odd ${'x'.repeat(400)}\n  at stack`), `Something odd ${'x'.repeat(185)}…`],
  ['plain text', 'plain text'],
])('a readable sentence for %s', (error, expected) => {
  const text = readableError(error);
  expect(text.startsWith(expected) || text === expected).toBe(true);
  expect(text.length).toBeLessThanOrEqual(200);
  expect(text).not.toContain('\n');
});

test('install quits into the installer, which shows its progress and opens the new version', () => {
  const updater = fakeUpdater();
  releaseUpdates(updater, () => {}).install();
  expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
});
