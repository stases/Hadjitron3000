// Everything the menus, the toolbar and the views can ask the app to do.
// Commands talk to the platform (files, dialogs) and the store; views only call them.

const todo = (): never => {
  throw new Error('Not built yet.');
};

/** Start a new project from the starter kit, after offering to save unsaved changes. */
export async function newProject(): Promise<void> {
  todo();
}

/** Ask for a project file and open it, after offering to save unsaved changes. */
export async function openProject(): Promise<void> {
  todo();
}

/** Save the project where it lives, or ask where when it has never been saved. False when cancelled. */
export async function saveProject(): Promise<boolean> {
  return todo();
}

export async function saveProjectAs(): Promise<boolean> {
  return todo();
}

/** Ask for audio files and add each as a new sampler channel. */
export async function importAudio(): Promise<void> {
  todo();
}

/** Files dropped on the window: audio becomes sampler channels, a .h3s a new channel, a .h3k is opened. */
export async function dropFiles(_files: File[]): Promise<void> {
  todo();
}

/** Open the Sound Library to add a sound to the project. */
export function addSound(): void {
  todo();
}

/** Open the Sound Library to replace the sound of a channel. */
export function replaceSound(_channelId: string): void {
  todo();
}

/** Ask for an audio file and load it into a sampler channel. */
export async function loadSample(_channelId: string): Promise<void> {
  todo();
}

/** Load a dropped audio file into a sampler channel. */
export async function loadSampleFile(_channelId: string, _file: File): Promise<void> {
  todo();
}

/** Save a channel's sound into the user's sound library under its name. */
export async function saveSoundToLibrary(_channelId: string): Promise<void> {
  todo();
}

/** Save a channel's sound as a .h3s file anywhere. */
export async function saveSoundAs(_channelId: string): Promise<void> {
  todo();
}

/** Open the Export dialog (song or pattern, WAV or MP3). */
export function exportAudio(): void {
  todo();
}

/** Render one note of a channel's sound to a WAV file. */
export async function exportSound(_channelId: string): Promise<void> {
  todo();
}

export function showAbout(): void {
  todo();
}

export function showShortcuts(): void {
  todo();
}
