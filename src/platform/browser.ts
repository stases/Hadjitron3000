import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Library, Platform } from './api';

const beforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  event.returnValue = '';
};

function libraryName(name: string): string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new TypeError('Invalid library name');
  }
  return name;
}

function createLibrary(database: string, storeName: string): Library {
  const store = createStore(database, storeName);
  return {
    list: async () => (await keys<string>(store)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    read: async (name) => {
      const bytes = await get<Uint8Array>(libraryName(name), store);
      if (!bytes) throw new Error(`File not found: ${name}`);
      return bytes;
    },
    write: (name, bytes) => set(libraryName(name), bytes, store),
    remove: (name) => del(libraryName(name), store),
    reveal: null,
  };
}

export const browserPlatform: Platform = {
  kind: 'browser',
  openFile: ({ filters }) => new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    const extensions = filters.flatMap((filter) => filter.extensions);
    input.accept = extensions.includes('*') ? '' : extensions.map((ext) => `.${ext}`).join(',');
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    }, { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) resolve(null);
      else void file.arrayBuffer().then((buffer) => {
        resolve({ name: file.name, path: null, bytes: new Uint8Array(buffer) });
      }, reject);
    }, { once: true });
    document.body.append(input);
    input.click();
  }),
  saveFile: async ({ defaultName, bytes }) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = defaultName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { name: defaultName, path: null };
  },
  library: createLibrary('hadjitron-library', 'sounds'),
  blocks: createLibrary('hadjitron-block-library', 'blocks'),
  window: null,
  updates: null,
  setDocument: (title, dirty) => {
    document.title = `${title} - Hadjitron 3000`;
    if (dirty) window.addEventListener('beforeunload', beforeUnload);
    else window.removeEventListener('beforeunload', beforeUnload);
  },
  onCloseRequest: () => {},
  onOpenFile: () => {},
};
