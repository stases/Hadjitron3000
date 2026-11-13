const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateLibraryName, appFilePath, contentType } = require('./paths.cjs');
const updates = require('./update.cjs');

const dist = path.join(__dirname, '..', 'dist');
const devURL = process.env.HADJITRON_DEV_URL;
const appURL = new URL(devURL || 'app://hadjitron/');
const nativeFrame = process.argv.includes('--native-frame') || process.env.HADJITRON_NATIVE_FRAME === '1';
let win;
let closeRegistered = false;
let openRegistered = false;
let closeSequence = 0;
let pendingClose = null;
let unresponsive = false;
let lastDirectory = null;
const pendingFiles = [];
// Updating needs an installed application (from `npm run app`) inside a .app bundle.
const install = app.isPackaged ? updates.readInstall(__dirname) : null;
const bundle = install && process.platform === 'darwin' ? updates.bundleOf(app.getPath('exe')) : null;
let updating = false;
let builtApp = null;
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
    validateLibraryName(name);
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
    validateLibraryName(opts.defaultName);
    filters(opts.filters);
    assert(opts.bytes instanceof Uint8Array);
    let file = opts.path;
    if (file != null) {
      text(file);
      assert(path.isAbsolute(file));
    } else {
      const result = await dialog.showSaveDialog(win, {
        title: opts.title,
        defaultPath: path.join(await dialogDirectory(), opts.defaultName),
        filters: opts.filters,
      });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath;
    }
    await fs.writeFile(file, opts.bytes);
    if (opts.path == null) lastDirectory = path.dirname(file);
    return { name: path.basename(file), path: file };
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
  if (bundle) registerUpdates();
  handle('open-register', 0, () => {
    openRegistered = true;
    void deliverFiles();
  });
}

function registerUpdates() {
  handle('update-check', 0, () => updates.check(install));
  handle('update-build', 0, async () => {
    assert(!updating, 'An update is already running');
    try {
      await fs.access(path.dirname(bundle), fs.constants.W_OK);
    } catch {
      throw new Error(`Cannot write to ${path.dirname(bundle)}.`);
    }
    updating = true;
    const logFile = path.join(app.getPath('userData'), 'update.log');
    const log = (text) => { void fs.appendFile(logFile, text + '\n').catch(() => {}); };
    try {
      await fs.writeFile(logFile, `Update started ${new Date().toISOString()}\n`);
      builtApp = await updates.build(install, (step) => win?.webContents.send('update-progress', step), log);
    } catch (error) {
      throw new Error(`${error.message}\n\nThe full output is in ${logFile}.`);
    } finally {
      updating = false;
    }
  });
  handle('update-restart', 0, () => {
    assert(builtApp, 'Nothing to install');
    restartPending = true;
    win.close();
  });
  app.on('will-quit', () => {
    if (restartPending && builtApp) updates.swapAfterExit(process.pid, builtApp, bundle);
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

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(console.error);
}

function resetHandlers() {
  closeRegistered = false;
  openRegistered = false;
  pendingClose = null;
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
        ...(bundle ? ['--hadjitron-updates'] : []),
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
  win.on('closed', () => { resetHandlers(); win = null; });
  win.webContents.on('render-process-gone', resetHandlers);
  win.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) resetHandlers();
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
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
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    registerRequests();
    setMenu();
    createWindow();
  }).catch((error) => {
    console.error(error);
    app.quit();
  });
}
