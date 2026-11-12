// What the app needs from the outside world. There are two implementations:
// the Electron shell (real files, the sound library folder, the window) and the
// plain browser (file pickers, downloads, a library kept in IndexedDB).

export interface FileFilter {
  name: string;
  extensions: string[]; // without dots, e.g. ['h3k']
}

export interface OpenedFile {
  name: string; // file name with extension
  path: string | null; // absolute path in Electron, null in the browser
  bytes: Uint8Array;
}

export interface SavedFile {
  name: string;
  path: string | null;
}

export interface Platform {
  readonly kind: 'electron' | 'browser';

  /** Ask for one file. Resolves to null when the user cancels. */
  openFile(opts: { title: string; filters: FileFilter[] }): Promise<OpenedFile | null>;

  /**
   * Write a file. With `path` the file is overwritten in place without asking;
   * otherwise the user chooses where it goes. Resolves to null when cancelled.
   */
  saveFile(opts: {
    title: string;
    defaultName: string;
    filters: FileFilter[];
    bytes: Uint8Array;
    path?: string | null;
  }): Promise<SavedFile | null>;

  /** The user's sound library: named .h3s files (~/Documents/Hadjitron 3000/Sounds in Electron). */
  library: {
    list(): Promise<string[]>; // sound names without extension, sorted
    read(name: string): Promise<Uint8Array>;
    write(name: string, bytes: Uint8Array): Promise<void>;
    remove(name: string): Promise<void>;
    reveal: (() => void) | null; // show the folder in Finder; null in the browser
  };

  /** Window controls for the custom title bar; null when the host draws its own frame. */
  window: { minimize(): void; toggleMaximize(): void; close(): void } | null;

  /** Tell the host the document name and whether it has unsaved changes. */
  setDocument(title: string, dirty: boolean): void;

  /** Called before the window closes; resolve false to keep it open. */
  onCloseRequest(handler: () => Promise<boolean>): void;

  /** Called when the host is asked to open a file (double-click in Finder, drop on the dock icon). */
  onOpenFile(handler: (file: OpenedFile) => void): void;
}
