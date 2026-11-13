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

/** Where a set of exported files goes: a folder the user chose in Electron; the browser downloads each file. */
export interface Folder {
  /** Write a file by its plain name (no folders in it), replacing one of that name. */
  write(name: string, bytes: Uint8Array): Promise<void>;
}

/** A folder of named files of one kind (~/Documents/Hadjitron 3000/Sounds or /Blocks in Electron). */
export interface Library {
  list(): Promise<string[]>; // names without extension, sorted
  read(name: string): Promise<Uint8Array>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  reveal: (() => void) | null; // show the folder in Finder; null in the browser
}

export interface UpdateCheck {
  current: string; // short commit the application was built from
  latest: string; // short commit on GitHub
  changes: string[]; // commit subjects between the two, newest first
  blocked: string | null; // why the program folder cannot be updated, if it cannot
}

export interface Updates {
  check(): Promise<UpdateCheck>;
  /** Pull, install and build the new application; reports each step. */
  build(onProgress: (step: string) => void): Promise<void>;
  /** Close the window (offering to save) and restart into the new application. */
  restart(): void;
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

  /** Ask where a set of audio files should go. Resolves to null when the user cancels. */
  chooseFolder(opts: { title: string }): Promise<Folder | null>;

  library: Library; // the user's sounds, .h3s
  blocks: Library; // the user's blocks, .h3b

  /** Window controls for the custom title bar; null when the host draws its own frame. */
  window: { minimize(): void; toggleMaximize(): void; close(): void } | null;

  /** Updating the installed application from GitHub; null when not running as an installed .app. */
  updates: Updates | null;

  /** Tell the host the document name and whether it has unsaved changes. */
  setDocument(title: string, dirty: boolean): void;

  /** Called before the window closes; resolve false to keep it open. */
  onCloseRequest(handler: () => Promise<boolean>): void;

  /** Called when the host is asked to open a file (double-click in Finder, drop on the dock icon). */
  onOpenFile(handler: (file: OpenedFile) => void): void;
}
