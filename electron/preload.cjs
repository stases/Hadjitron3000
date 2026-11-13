const { contextBridge, ipcRenderer } = require('electron');

let closeHandler;
let openHandler;
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const notify = (channel, ...args) => { void invoke(channel, ...args).catch(console.error); };

function library(channel) {
  return {
    list: () => invoke(`${channel}-list`),
    read: (name) => invoke(`${channel}-read`, name),
    write: (name, bytes) => invoke(`${channel}-write`, name, bytes),
    remove: (name) => invoke(`${channel}-remove`, name),
    reveal: () => notify(`${channel}-reveal`),
  };
}

ipcRenderer.on('close-request', async (_event, id) => {
  let allowed = false;
  try {
    allowed = await closeHandler?.() === true;
  } catch (error) {
    console.error(error);
  }
  notify('close-answer', id, allowed);
});
ipcRenderer.on('open-file', (_event, file) => openHandler?.(file));

const updates = {
  check: () => invoke('update-check'),
  build: async (onProgress) => {
    const listener = (_event, step) => onProgress(step);
    ipcRenderer.on('update-progress', listener);
    try {
      await invoke('update-build');
    } finally {
      ipcRenderer.removeListener('update-progress', listener);
    }
  },
  restart: () => notify('update-restart'),
};

contextBridge.exposeInMainWorld('hadji', {
  frame: process.argv.includes('--hadjitron-native-frame') ? 'native' : 'custom',
  openFile: (opts) => invoke('file-open', opts),
  saveFile: (opts) => invoke('file-save', opts),
  library: library('library'),
  blocks: library('blocks'),
  window: {
    minimize: () => notify('window-minimize'),
    toggleMaximize: () => notify('window-toggle-maximize'),
    close: () => notify('window-close'),
  },
  updates: process.argv.includes('--hadjitron-updates') ? updates : null,
  setDocument: (title, dirty) => notify('document-set', title, dirty),
  onCloseRequest: (handler) => {
    if (typeof handler !== 'function') throw new TypeError('Expected a close handler');
    closeHandler = handler;
    notify('close-register');
  },
  onOpenFile: (handler) => {
    if (typeof handler !== 'function') throw new TypeError('Expected an open-file handler');
    openHandler = handler;
    notify('open-register');
  },
});
