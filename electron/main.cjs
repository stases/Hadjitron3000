const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateLibraryName, suggestedName, appFilePath, contentType } = require('./paths.cjs');
const { releaseUpdates } = require('./release.cjs');
const updates = require('./update.cjs');

const dist = path.join(__dirname, '..', 'dist');
const devURL = process.env.HADJITRON_DEV_URL;
const appURL = new URL(devURL || 'app://hadjitron/');
const nativeFrame = process.argv.includes('--native-frame') || process.env.HADJITRON_NATIVE_FRAME === '1';
let win;
// The Guide Book's own window, while it is open.
let book = null;
let closeRegistered = false;
let openRegistered = false;
let closeSequence = 0;
let pendingClose = null;
let unresponsive = false;
let lastDirectory = null;
const pendingFiles = [];
// Folders the user chose for an export, by the number the page writes into them with.
const folders = new Map();
// The application updates itself in one of two ways. Built from a git checkout by `npm run app` on a Mac, with
// install.json next to this file, it pulls and rebuilds that checkout (update.cjs). Installed from the Setup .exe
// of a release on Windows, it downloads the next release's installer (release.cjs). In development it does not.
const install = app.isPackaged ? updates.readInstall(__dirname) : null;
const bundle = install && process.platform === 'darwin' ? updates.bundleOf(app.getPath('exe')) : null;
const fromRelease = app.isPackaged && !install && process.platform === 'win32';
let updater = null;
let updating = false;
let updateReady = false;
let restartPending = false;
let deliveringFiles = false;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.on('open-file', (event, file) => {
  event.preventDefault();
  pendingFiles.push(file);
  void deliverFiles();
});

async function openedFile(file) {
  const bytes = new Uint8Array(await fs.readFile(file));
  lastDirectory = path.dirname(file);
  return { name: path.basename(file), path: file, bytes };
}

async function deliverFiles() {
  if (deliveringFiles) return;
  deliveringFiles = true;
  try {
    while (openRegistered && win && !win.isDestroyed() && pendingFiles.length) {
      const file = pendingFiles[0];
      try {
        const data = await openedFile(file);
        if (!openRegistered || !win || win.isDestroyed()) break;
        win.webContents.send('open-file', data);
      } catch (error) {
        console.error('Could not open file:', error);
      }
      pendingFiles.shift();
    }
  } finally {
    deliveringFiles = false;
  }
}

// Windows passes a double-clicked file as an argument, to a new process or, through the single instance lock, to
// the running one; macOS sends open-file instead.
function queueArguments(argv, cwd = process.cwd()) {
  if (process.platform === 'darwin') return;
  for (const arg of argv.slice(process.defaultApp ? 2 : 1)) {
    if (!arg.startsWith('-') && /\.(h3k|h3s|h3b)$/i.test(arg)) pendingFiles.push(path.resolve(cwd, arg));
  }
  void deliverFiles();
}

function assert(condition, message = 'Invalid arguments') {
  if (!condition) throw new TypeError(message);
}

function text(value) {
  assert(typeof value === 'string' && !value.includes('\0'));
}

function filters(value) {
  assert(Array.isArray(value));
  for (const filter of value) {
    assert(filter && typeof filter === 'object');
    text(filter.name);
    assert(Array.isArray(filter.extensions) && filter.extensions.length > 0);
    assert(filter.extensions.every((ext) => typeof ext === 'string' && /^(\*|[a-z0-9]+)$/i.test(ext)));
  }
}

function handle(channel, count, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assert(win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame,
      'Untrusted sender');
    assert(args.length === count);
    return handler(...args);
  });
}

async function dialogDirectory() {
  if (lastDirectory) return lastDirectory;
  const directory = path.join(app.getPath('documents'), 'Hadjitron 3000');
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

function registerLibrary(channel, folder, extension) {
  async function directory() {
    const dir = path.join(app.getPath('documents'), 'Hadjitron 3000', folder);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  async function file(name) {
    validateLibraryName(name, process.platform);
    return path.join(await directory(), name + extension);
  }
  handle(`${channel}-list`, 0, async () => {
    const entries = await fs.readdir(await directory(), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name.slice(0, -extension.length))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  });
  handle(`${channel}-read`, 1, async (name) => new Uint8Array(await fs.readFile(await file(name))));
  handle(`${channel}-write`, 2, async (name, bytes) => {
    assert(bytes instanceof Uint8Array);
    await fs.writeFile(await file(name), bytes);
  });
  handle(`${channel}-remove`, 1, async (name) => { await fs.unlink(await file(name)); });
  handle(`${channel}-reveal`, 0, async () => {
    const error = await shell.openPath(await directory());
    if (error) throw new Error(error);
  });
}

function registerRequests() {
  handle('file-open', 1, async (opts) => {
    assert(opts && typeof opts === 'object');
    text(opts.title);
    filters(opts.filters);
    const result = await dialog.showOpenDialog(win, {
      title: opts.title, filters: opts.filters, properties: ['openFile'],
      defaultPath: await dialogDirectory(),
    });
    return result.canceled ? null : openedFile(result.filePaths[0]);
  });
  handle('file-save', 1, async (opts) => {
    assert(opts && typeof opts === 'object');
    text(opts.title);
    text(opts.defaultName);
    const defaultName = validateLibraryName(suggestedName(opts.defaultName, process.platform), process.platform);
    filters(opts.filters);
    assert(opts.bytes instanceof Uint8Array);
    let file = opts.path;
    if (file != null) {
      text(file);
      assert(path.isAbsolute(file));
    } else {
      const result = await dialog.showSaveDialog(win, {
        title: opts.title,
        defaultPath: path.join(await dialogDirectory(), defaultName),
        filters: opts.filters,
      });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath;
    }
    await fs.writeFile(file, opts.bytes);
    if (opts.path == null) lastDirectory = path.dirname(file);
    return { name: path.basename(file), path: file };
  });
  handle('folder-choose', 1, async (opts) => {
    assert(opts && typeof opts === 'object');
    text(opts.title);
    const result = await dialog.showOpenDialog(win, {
      title: opts.title, properties: ['openDirectory', 'createDirectory'], defaultPath: await dialogDirectory(),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    lastDirectory = result.filePaths[0];
    folders.set(folders.size + 1, lastDirectory);
    return folders.size;
  });
  handle('folder-write', 3, async (id, name, bytes) => {
    assert(folders.has(id), 'Unknown folder');
    validateLibraryName(name, process.platform);
    assert(/^[^.].*\.(wav|mp3)$/i.test(name), 'Invalid file name');
    assert(bytes instanceof Uint8Array);
    await fs.writeFile(path.join(folders.get(id), name), bytes);
  });
  registerLibrary('library', 'Sounds', '.h3s');
  registerLibrary('blocks', 'Blocks', '.h3b');
  handle('window-minimize', 0, () => win.minimize());
  handle('window-toggle-maximize', 0, () => win.isMaximized() ? win.unmaximize() : win.maximize());
  handle('window-close', 0, () => win.close());
  handle('document-set', 2, (title, dirty) => {
    text(title);
    assert(typeof dirty === 'boolean');
    win.setTitle(`${title} - Hadjitron 3000`);
    if (process.platform === 'darwin') win.setDocumentEdited(dirty);
  });
  handle('close-register', 0, () => { closeRegistered = true; });
  handle('close-answer', 2, (id, allowed) => {
    assert(Number.isSafeInteger(id) && typeof allowed === 'boolean');
    if (pendingClose !== id) return;
    pendingClose = null;
    if (allowed) win.destroy();
    else restartPending = false;
  });
  if (updater) registerUpdates();
  handle('open-register', 0, () => {
    openRegistered = true;
    void deliverFiles();
  });
}

function sourceUpdater() {
  let built = null;
  return {
    kind: 'source',
    check: () => updates.check(install),
    async build(progress, log) {
      try {
        await fs.access(path.dirname(bundle), fs.constants.W_OK);
      } catch {
        throw new Error(`Cannot write to ${path.dirname(bundle)}.`);
      }
      built = await updates.build(install, progress, log);
    },
    install: () => updates.swapAfterExit(process.pid, built, bundle),
  };
}

function releaseUpdater(log) {
  try {
    return { kind: 'release', ...releaseUpdates(require('electron-updater').autoUpdater, log) };
  } catch (error) {
    console.error('Updates are off:', error);
    return null;
  }
}

const updateLog = () => path.join(app.getPath('userData'), 'update.log');
const logUpdate = (text) => { void fs.appendFile(updateLog(), text + '\n').catch(() => {}); };

function createUpdater() {
  if (bundle) return sourceUpdater();
  return fromRelease ? releaseUpdater(logUpdate) : null;
}

function registerUpdates() {
  handle('update-check', 0, () => updater.check());
  handle('update-build', 0, async () => {
    assert(!updating, 'An update is already running');
    updating = true;
    try {
      await fs.writeFile(updateLog(), `Update started ${new Date().toISOString()}\n`).catch(() => {});
      await updater.build((progress) => win?.webContents.send('update-progress', progress), logUpdate);
      updateReady = true;
    } catch (error) {
      logUpdate(error.stack ?? error.message);
      throw new Error(`${error.message}\n\nThe details are in ${updateLog()}.`);
    } finally {
      updating = false;
    }
  });
  handle('update-restart', 0, () => {
    assert(updateReady, 'Nothing to install');
    restartPending = true;
    win.close();
  });
  app.on('will-quit', () => {
    if (restartPending && updateReady) updater.install();
  });
}

async function serve(request) {
  let file = appFilePath(request.url, dist);
  if (!file) return new Response(null, { status: 404 });
  try {
    try {
      await fs.access(file);
    } catch (error) {
      if (error.code !== 'ENOENT' || path.extname(file)) throw error;
      file = path.join(dist, 'index.html');
    }
    const [root, realFile] = await Promise.all([fs.realpath(dist), fs.realpath(file)]);
    if (!realFile.startsWith(root + path.sep) || !(await fs.stat(realFile)).isFile()) {
      return new Response(null, { status: 404 });
    }
    const bytes = await fs.readFile(realFile);
    return new Response(bytes, { headers: { 'content-type': contentType(realFile) } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function fromApp(url) {
  try {
    const target = new URL(url);
    return target.protocol === appURL.protocol && target.host === appURL.host;
  } catch {
    return false;
  }
}

// The app's own page may use MIDI; every other permission is refused, and so is any other page. The page asks for
// MIDI without system exclusive messages, but Electron hands even that request over as 'midiSysex', so both names
// are answered alike.
const MIDI = ['midi', 'midiSysex'];

function setPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(MIDI.includes(permission) && webContents === win?.webContents && fromApp(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin) =>
    MIDI.includes(permission) && fromApp(origin));
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(console.error);
}

function resetHandlers() {
  closeRegistered = false;
  openRegistered = false;
  pendingClose = null;
}

// The page opens the Guide Book as a blank page of its own origin by this name, and draws the book into it.
const BOOK_WINDOW = 'guide-book';

function bookOptions() {
  return {
    // A packaged application's windows take the icon of its executable; build/ is not packed.
    title: 'Guide Book', ...(app.isPackaged ? {} : { icon: path.join(__dirname, '..', 'build', 'icon.png') }),
    minWidth: 380, minHeight: 360, useContentSize: true, autoHideMenuBar: true,
    backgroundColor: '#d8d0be', frame: nativeFrame,
    ...(process.platform === 'darwin' && !nativeFrame ? { roundedCorners: false } : {}),
  };
}

function closeBookWindow() {
  if (book && !book.isDestroyed()) book.destroy();
  book = null;
}

function watchBook(child) {
  book = child;
  child.removeMenu();
  child.on('closed', () => { if (book === child) book = null; });
  child.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  child.webContents.on('will-redirect', (event) => event.preventDefault());
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 680,
    backgroundColor: '#d8d0be', title: 'Hadjitron 3000', show: false, frame: nativeFrame,
    ...(process.platform === 'darwin' && !nativeFrame ? { roundedCorners: false } : {}),
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false,
      additionalArguments: [
        ...(nativeFrame ? ['--hadjitron-native-frame'] : []),
        ...(updater ? [`--hadjitron-updates=${updater.kind}`] : []),
      ],
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('unresponsive', () => { unresponsive = true; pendingClose = null; });
  win.on('responsive', () => { unresponsive = false; });
  win.on('close', (event) => {
    if (!closeRegistered || unresponsive) return;
    event.preventDefault();
    if (pendingClose !== null) return;
    pendingClose = ++closeSequence;
    win.webContents.send('close-request', pendingClose);
  });
  win.on('closed', () => { resetHandlers(); closeBookWindow(); win = null; });
  win.webContents.on('render-process-gone', () => { resetHandlers(); closeBookWindow(); });
  win.webContents.on('did-start-navigation', (event) => {
    if (!event.isMainFrame || event.isSameDocument) return;
    resetHandlers();
    closeBookWindow();
  });
  win.webContents.on('will-frame-navigate', (event) => {
    try {
      const target = new URL(event.url);
      // Node reports custom-scheme origins as null, so compare protocol and host.
      if (event.isMainFrame && target.protocol === appURL.protocol && target.host === appURL.host) return;
    } catch {}
    event.preventDefault();
    openExternal(event.url);
  });
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName === BOOK_WINDOW && !book) {
      return { action: 'allow', overrideBrowserWindowOptions: bookOptions() };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', watchBook);
  void win.loadURL(devURL || 'app://hadjitron/').catch(console.error);
}

function setMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    { label: 'Hadjitron 3000', submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' },
      { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }] },
  ];
  if (devURL) template.push({ label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  queueArguments(process.argv);
  app.on('second-instance', (_event, argv, cwd) => {
    queueArguments(argv, cwd);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  // The Start menu shortcut carries the application's id; the window must carry the same one, or Windows shows a
  // second taskbar button beside a pinned one.
  if (process.platform === 'win32') app.setAppUserModelId('com.hadjitron.app');
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    setPermissions();
    updater = createUpdater();
    registerRequests();
    setMenu();
    createWindow();
  }).catch((error) => {
    console.error(error);
    app.quit();
  });
}
