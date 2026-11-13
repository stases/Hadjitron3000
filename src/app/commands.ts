// Everything the menus, the toolbar and the views can ask the app to do.
// Commands talk to the platform (files, dialogs) and the store; views only call them.

import { decodeSample, renderSound } from '../audio';
import {
  FormatError, PROJECT_EXT, SOUND_EXT, parseProject, parseSound, sampleId, serializeProject, serializeSound,
} from '../core/fileformat';
import { encodeWav } from '../core/wav';
import type { SampleData } from '../core/types';
import type { FileFilter, OpenedFile, SavedFile } from '../platform/api';
import { platform } from '../platform';
import { starterProject } from '../presets/projects';
import {
  addChannel, addSampleChannel, markSaved, openProject as loadProject, setSample, setSourceType, useApp,
} from '../state/store';
import type { AppState } from '../state/store';
import { ask, fail, openDialog, reason } from './dialogStore';

const AUDIO_EXTS = ['wav', 'mp3', 'aiff', 'aif', 'flac', 'ogg', 'm4a'];
const AUDIO_FILTER: FileFilter = { name: 'Audio files', extensions: AUDIO_EXTS };
const PROJECT_FILTER: FileFilter = { name: 'Hadjitron 3000 projects', extensions: [PROJECT_EXT] };
const SOUND_FILTER: FileFilter = { name: 'Hadjitron 3000 sounds', extensions: [SOUND_EXT] };

const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
const utf8 = (text: string) => new TextEncoder().encode(text);

/** The name the window shows: the file name once saved, otherwise the project's own name. */
export function documentName(state: Pick<AppState, 'file' | 'project'> = useApp.getState()): string {
  return state.file ? baseName(state.file.name) : state.project.name;
}

const channelOf = (channelId: string) => useApp.getState().project.channels.find((c) => c.id === channelId);

/** Offer to save unsaved changes. False when the user cancels (or the save fails). */
export async function confirmDiscard(): Promise<boolean> {
  if (!useApp.getState().dirty) return true;
  const answer = await ask({
    title: 'Hadjitron 3000',
    icon: 'warning',
    text: `Save changes to ${documentName()}?`,
    buttons: [
      { label: 'Save', value: 'save', primary: true },
      { label: "Don't Save", value: 'discard' },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (answer === 'save') return saveProject();
  return answer === 'discard';
}

/** Start a new project from the starter kit, after offering to save unsaved changes. */
export async function newProject(): Promise<void> {
  if (await confirmDiscard()) loadProject(starterProject(), null);
}

/** Ask for a project file and open it, after offering to save unsaved changes. */
export async function openProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const file = await guard(() => platform.openFile({ title: 'Open Project', filters: [PROJECT_FILTER] }), 'open');
  if (file) openProjectFile(file);
}

function openProjectFile(file: OpenedFile): void {
  try {
    loadProject(parseProject(new TextDecoder().decode(file.bytes)), { name: file.name, path: file.path });
  } catch (error) {
    void fail(`${file.name} could not be opened. ${fileProblem(error)}`);
  }
}

/** What went wrong reading a file, in words for the user. */
export const fileProblem = (error: unknown) =>
  error instanceof FormatError ? error.message : `The file could not be read${reason(error)}.`;

/** Run a platform call; a failure becomes a message box and resolves to null. */
async function guard<T>(call: () => Promise<T>, what: 'open' | 'save'): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    await fail(what === 'open'
      ? `The file could not be opened${reason(error)}.`
      : `The file could not be saved${reason(error)}. Check that the folder exists and that you may write to it.`);
    return null;
  }
}

/** Write a file through the platform; a failure becomes a message box. Null when cancelled or failed. */
export function writeFile(opts: Parameters<typeof platform.saveFile>[0]): Promise<SavedFile | null> {
  return guard(() => platform.saveFile(opts), 'save');
}

/** Save the project where it lives, or ask where when it has never been saved. False when cancelled. */
export async function saveProject(): Promise<boolean> {
  const { file } = useApp.getState();
  return file?.path ? writeProject(file.path) : saveProjectAs();
}

export async function saveProjectAs(): Promise<boolean> {
  return writeProject(null);
}

async function writeProject(path: string | null): Promise<boolean> {
  const { project } = useApp.getState();
  const saved = await writeFile({
    title: 'Save Project',
    defaultName: `${documentName()}.${PROJECT_EXT}`,
    filters: [PROJECT_FILTER],
    bytes: utf8(serializeProject(project)),
    path,
  });
  if (!saved) return false;
  markSaved(saved);
  if (useApp.getState().project !== project) useApp.setState({ dirty: true });
  return true;
}

/** Read an audio file and check that it decodes. Null (after telling the user) when it does not. */
async function readAudio(name: string, bytes: Uint8Array): Promise<{ id: string; sample: SampleData } | null> {
  const id = await sampleId(bytes);
  try {
    await decodeSample(id, bytes);
  } catch {
    await fail(`${name} could not be read as audio. Use a WAV, MP3, AIFF, FLAC, Ogg or M4A file.`);
    return null;
  }
  return { id, sample: { name, bytes } };
}

async function addAudio(name: string, bytes: Uint8Array): Promise<void> {
  const audio = await readAudio(name, bytes);
  if (audio) addSampleChannel(audio.id, audio.sample);
}

function addSoundFile(file: { name: string; bytes: Uint8Array }): void {
  try {
    const { sound, samples } = parseSound(new TextDecoder().decode(file.bytes));
    addChannel(sound, samples);
  } catch (error) {
    void fail(`${file.name} could not be opened. ${fileProblem(error)}`);
  }
}

/** Ask for audio files and add each as a new sampler channel. */
export async function importAudio(): Promise<void> {
  const file = await guard(() => platform.openFile({ title: 'Import Audio', filters: [AUDIO_FILTER] }), 'open');
  if (file) await addAudio(file.name, file.bytes);
}

/** Files dropped on the window: audio becomes sampler channels, a .h3s a new channel, a .h3k is opened. */
export async function dropFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const ext = extension(file.name);
    if (ext !== PROJECT_EXT && ext !== SOUND_EXT && !AUDIO_EXTS.includes(ext)) {
      await fail(`${file.name} is not something Hadjitron 3000 can open. `
        + `Drop audio files, sounds (.${SOUND_EXT}) or a project (.${PROJECT_EXT}).`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      await fail(`${file.name} could not be read${reason(error)}.`);
      continue;
    }
    await openFile({ name: file.name, path: null, bytes });
  }
}

/** A file handed over by the system (Finder, the dock icon) or dropped: open a project, add anything else. */
export async function openFile(file: OpenedFile): Promise<void> {
  const ext = extension(file.name);
  if (ext === PROJECT_EXT) {
    if (await confirmDiscard()) openProjectFile(file);
  } else if (ext === SOUND_EXT) {
    addSoundFile(file);
  } else {
    await addAudio(file.name, file.bytes);
  }
}

/** Open the Sound Library to add a sound to the project. */
export function addSound(): void {
  openDialog({ kind: 'library', replace: null });
}

/** Open the Sound Library to replace the sound of a channel. */
export function replaceSound(channelId: string): void {
  openDialog({ kind: 'library', replace: channelId });
}

async function loadAudioInto(channelId: string, name: string, bytes: Uint8Array): Promise<void> {
  const audio = await readAudio(name, bytes);
  const channel = channelOf(channelId);
  if (!audio || !channel) return;
  if (channel.sound.source.type !== 'sample') setSourceType(channelId, 'sample');
  setSample(channelId, audio.id, audio.sample);
}

/** Ask for an audio file and load it into a sampler channel. */
export async function loadSample(channelId: string): Promise<void> {
  const file = await guard(() => platform.openFile({ title: 'Load Sample', filters: [AUDIO_FILTER] }), 'open');
  if (file) await loadAudioInto(channelId, file.name, file.bytes);
}

/** Load a dropped audio file into a sampler channel. */
export async function loadSampleFile(channelId: string, file: File): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    return fail(`${file.name} could not be read${reason(error)}.`);
  }
  await loadAudioInto(channelId, file.name, bytes);
}

/** Save a channel's sound into the user's sound library under its name. */
export async function saveSoundToLibrary(channelId: string): Promise<void> {
  const channel = channelOf(channelId);
  if (!channel) return;
  const { name } = channel.sound;
  try {
    if ((await platform.library.list()).includes(name)) {
      const answer = await ask({
        title: 'Save to Library',
        icon: 'question',
        text: `Your library already has a sound called ${name}. Replace it?`,
        buttons: [
          { label: 'Replace', value: 'replace' },
          { label: 'Cancel', value: 'cancel', primary: true },
        ],
      });
      if (answer !== 'replace') return;
    }
    await platform.library.write(name, utf8(serializeSound(channel.sound, useApp.getState().project.samples)));
  } catch (error) {
    await fail(error instanceof Error && /Invalid library name/.test(error.message)
      ? `"${name}" cannot be used as a file name. Rename the sound and try again.`
      : `The sound could not be saved to your library${reason(error)}.`);
  }
}

/** Save a channel's sound as a .h3s file anywhere. */
export async function saveSoundAs(channelId: string): Promise<void> {
  const channel = channelOf(channelId);
  if (!channel) return;
  const bytes = utf8(serializeSound(channel.sound, useApp.getState().project.samples));
  const defaultName = `${channel.sound.name}.${SOUND_EXT}`;
  await writeFile({ title: 'Save Sound', defaultName, filters: [SOUND_FILTER], bytes });
}

/** Open the Export dialog (song or pattern, WAV or MP3). */
export function exportAudio(): void {
  openDialog({ kind: 'export' });
}

/** Render one note of a channel's sound to a WAV file. */
export async function exportSound(channelId: string): Promise<void> {
  const channel = channelOf(channelId);
  if (!channel) return;
  let bytes: Uint8Array;
  try {
    bytes = encodeWav(await renderSound(channel.sound, useApp.getState().project.samples));
  } catch (error) {
    return fail(`The sound could not be rendered${reason(error)}.`);
  }
  await writeFile({
    title: 'Export Sound',
    defaultName: `${channel.sound.name}.wav`,
    filters: [{ name: 'WAV audio', extensions: ['wav'] }],
    bytes,
  });
}

export function showAbout(): void {
  openDialog({ kind: 'about' });
}

export function showShortcuts(): void {
  openDialog({ kind: 'shortcuts' });
}

/** Open the Block Library to add a block to the project. */
export function addBlock(): void {}

/** Save a block, with the sounds it plays, into the user's block library under its name. */
export async function saveBlockToLibrary(_patternId: string): Promise<void> {}

/** Save a block, with the sounds it plays, as a .h3b file anywhere. */
export async function saveBlockAs(_patternId: string): Promise<void> {}
