import { clear, createStore, get, set } from 'idb-keyval';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { App } from '../../src/app/App';
import * as audio from '../../src/app/audio';
import * as commands from '../../src/app/commands';
import { useDialogs } from '../../src/app/dialogStore';
import { installKeys } from '../../src/app/keys';
import { restoreSession, saveSession } from '../../src/app/session';
import { emptyProject, newSound } from '../../src/core/defaults';
import { parseProject } from '../../src/core/fileformat';
import { platform } from '../../src/platform';
import { demoProject, starterProject } from '../../src/presets/projects';
import * as store from '../../src/state/store';

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  tap: vi.fn(),
  audition: vi.fn(async () => {}),
}));

const state = store.useApp.getState;
const sessionStore = createStore('hadjitron-session', 'session');
let root: { root: Root; host: HTMLElement } | null = null;
let removeKeys: (() => void) | null = null;

function renderApp(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  flushSync(() => r.render(<App />));
  root = { root: r, host };
  return host;
}

beforeEach(() => {
  store.openProject(demoProject(), null);
  store.setView('track');
  store.setOctave(3);
  removeKeys = installKeys();
});

afterEach(async () => {
  removeKeys?.();
  await userEvent.cleanup();
  flushSync(() => useDialogs.setState({ dialog: null, messages: [] }));
  root?.root.unmount();
  root?.host.remove();
  root = null;
  platform.window = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const title = () => $('.h-titlebar-text').textContent;
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const code = key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key === ' ' ? 'Space' : key;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init }));
};
const release = (key: string) =>
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key, code: `Key${key.toUpperCase()}`, bubbles: true }));

async function openMenu(label: string): Promise<HTMLElement[]> {
  const item = $$('.h-menubar-item').find((el) => el.textContent === label)!;
  await userEvent.click(item);
  await expect.poll(() => $$('.h-menu-item').length).toBeGreaterThan(0);
  return $$('.h-menu-item');
}
const labels = (items: HTMLElement[]) => items.map((el) => el.querySelector('.h-menu-label')!.textContent);
const disabled = (items: HTMLElement[], label: string) =>
  items.find((el) => el.querySelector('.h-menu-label')!.textContent === label)!.classList.contains('is-disabled');

async function messageText(): Promise<string> {
  await expect.poll(() => document.querySelector('.h-message-text')).not.toBeNull();
  return $('.h-message-text').textContent ?? '';
}
// Buttons of the open dialog when there is one, so a view's button of the same name is not picked.
const button = (label: string) =>
  $$(document.querySelector('.h-dialog') ? '.h-dialog .h-button' : '.h-button').find((b) => b.textContent === label)!;

test('the title shows the document name and an asterisk for unsaved changes', async () => {
  const setDocument = vi.spyOn(platform, 'setDocument');
  renderApp();
  expect(title()).toBe('Welcome - Hadjitron 3000');
  expect(document.querySelector('.h-title-button')).toBeNull();
  store.setBpm(100);
  await expect.poll(title).toBe('Welcome* - Hadjitron 3000');
  expect(setDocument).toHaveBeenLastCalledWith('Welcome', true);
  store.markSaved({ name: 'Night Drive.h3k', path: null });
  await expect.poll(title).toBe('Night Drive - Hadjitron 3000');
  expect(setDocument).toHaveBeenLastCalledWith('Night Drive', false);
});

test('the title bar buttons control the window when there is one', async () => {
  platform.window = { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() };
  renderApp();
  await userEvent.click($('[aria-label="Minimize"]'));
  await userEvent.click($('[aria-label="Close"]'));
  expect(platform.window.minimize).toHaveBeenCalledOnce();
  expect(platform.window.close).toHaveBeenCalledOnce();
  expect(labels(await openMenu('File'))).toContain('Quit');
});

test('the menus list their commands and follow the store', async () => {
  renderApp();
  expect(labels(await openMenu('File'))).toEqual([
    'New Project', 'Open Project…', 'Save Project', 'Save Project As…', 'Import Audio…', 'Export Audio…',
  ]);
  let edit = await openMenu('Edit');
  expect(labels(edit)).toEqual(['Undo', 'Redo']);
  expect(disabled(edit, 'Undo')).toBe(true);
  expect(disabled(edit, 'Redo')).toBe(true);
  await userEvent.keyboard('{Escape}');
  store.setBpm(99);
  edit = await openMenu('Edit');
  expect(disabled(edit, 'Undo')).toBe(false);
  await userEvent.click(edit[0]);
  expect(state().project.bpm).toBe(126);
  expect(disabled(await openMenu('Edit'), 'Redo')).toBe(false);
  await userEvent.keyboard('{Escape}');

  const sound = await openMenu('Sound');
  expect(labels(sound)).toEqual([
    'New Sound…', 'Replace from Library…', 'Duplicate', 'Remove', 'Save to Library', 'Save Sound As…',
    'Export Sound as WAV…',
  ]);
  expect(disabled(sound, 'Duplicate')).toBe(false);
  await userEvent.keyboard('{Escape}');
  store.selectChannel(null);
  expect(disabled(await openMenu('Sound'), 'Duplicate')).toBe(true);
  await userEvent.keyboard('{Escape}');

  const track = await openMenu('Track');
  expect(labels(track)).toEqual([
    'Play / Stop', 'New Pattern', 'Duplicate Pattern', 'Clear Pattern', 'Delete Pattern', 'Play Pattern', 'Play Song',
  ]);
  expect(track[5].querySelector('.h-menu-check svg')).not.toBeNull();
  await userEvent.click(track[6]);
  expect(state().scope).toBe('song');
  expect(labels(await openMenu('View'))).toEqual(['Factory', 'Track']);
  await userEvent.keyboard('{Escape}');
  expect(labels(await openMenu('Help'))).toEqual(['Keyboard Shortcuts…', 'About Hadjitron 3000…']);
});

test('the tempo follows dragging, the wheel and typing', async () => {
  renderApp();
  const tempo = $('.h-app-tempo');
  await userEvent.wheel(tempo, { delta: { y: -100 } });
  expect(state().project.bpm).toBe(127);
  const r = tempo.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  await userEvent.pointer([
    { coords: { x, y } }, { keys: '[MouseLeft>]' }, { coords: { x, y: y - 20 } }, { keys: '[/MouseLeft]' },
  ]);
  expect(state().project.bpm).toBe(137);

  await userEvent.dblClick(tempo);
  expect(document.activeElement).toBe($('input.h-app-bpm'));
  await userEvent.keyboard('{Control>}a{/Control}98.26{Enter}');
  expect(state().project.bpm).toBe(98.3);
  await expect.poll(() => $('.h-app-bpm').textContent).toBe('98.3');

  await userEvent.dblClick(tempo);
  expect(document.activeElement).toBe($('input.h-app-bpm'));
  await userEvent.keyboard('{Control>}a{/Control}fast');
  expect($<HTMLInputElement>('input.h-app-bpm').value).toBe('fast');
  await userEvent.keyboard('{Enter}');
  expect(await messageText()).toBe('The tempo must be a number from 40 to 240.');
  expect(state().project.bpm).toBe(98.3);
});

test('tapping sets the tempo from the spacing of the taps', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  renderApp();
  for (const t of [0, 500, 1000, 1500]) {
    now = t;
    await userEvent.click(button('Tap'));
  }
  expect(state().project.bpm).toBe(120);
  now = 5000;
  await userEvent.click(button('Tap'));
  expect(state().project.bpm).toBe(120);
});

test('Play and Stop switch the transport, and Space on a focused button only toggles once', async () => {
  renderApp();
  const [play, stop] = $$('.h-app-transport .h-button');
  await userEvent.click(play);
  expect(state().playing).toBe(true);
  await expect.poll(() => play.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(stop);
  expect(state().playing).toBe(false);
  await userEvent.click(play);
  expect(document.activeElement).toBe(play);
  await userEvent.keyboard(' ');
  expect(state().playing).toBe(false);
});

test('Space, undo and redo, and the view shortcuts', () => {
  press(' ');
  expect(state().playing).toBe(true);
  press(' ');
  expect(state().playing).toBe(false);
  store.setBpm(90);
  press('z', { ctrlKey: true });
  expect(state().project.bpm).toBe(126);
  press('Z', { ctrlKey: true, shiftKey: true });
  expect(state().project.bpm).toBe(90);
  press('z', { ctrlKey: true });
  press('y', { ctrlKey: true });
  expect(state().project.bpm).toBe(90);
  press('1', { ctrlKey: true, code: 'Digit1' });
  expect(state().view).toBe('factory');
  press('2', { ctrlKey: true, code: 'Digit2' });
  expect(state().view).toBe('track');
});

test('the computer keyboard plays the selected sound from the C of the octave', () => {
  const channel = state().channelId!;
  press('a');
  press('a', { repeat: true });
  expect(audio.noteOn).toHaveBeenCalledTimes(1);
  expect(audio.noteOn).toHaveBeenLastCalledWith(channel, 60);
  release('a');
  expect(audio.noteOff).toHaveBeenLastCalledWith(channel, 60);
  press('x');
  expect(state().octave).toBe(4);
  press('w');
  expect(audio.noteOn).toHaveBeenLastCalledWith(channel, 73);
  press('z');
  press('z');
  press('p');
  expect(audio.noteOn).toHaveBeenLastCalledWith(channel, 63);
  window.dispatchEvent(new Event('blur'));
  expect(audio.noteOff).toHaveBeenCalledWith(channel, 73);
  expect(audio.noteOff).toHaveBeenCalledWith(channel, 63);
});

test('step entry writes notes, moves the selection and edits the selected step', () => {
  const { patternId } = state();
  const channelId = state().project.channels[3].id;
  const cells = () => state().project.patterns.find((p) => p.id === patternId)!.cells[channelId] ?? {};
  store.clearPattern(patternId);
  store.selectStep({ channelId, index: 30 });
  press('d');
  expect(cells()[30]).toEqual({ note: 64, vel: 0.8, len: 1 });
  expect(state().step).toEqual({ channelId, index: 31 });
  press('f');
  expect(cells()[31].note).toBe(65);
  expect(state().step!.index).toBe(0);

  press('ArrowLeft');
  expect(state().step!.index).toBe(31);
  press('ArrowUp');
  expect(cells()[31].note).toBe(66);
  expect(audio.tap).toHaveBeenLastCalledWith(channelId, 66, 0.8);
  press('ArrowDown', { shiftKey: true });
  expect(cells()[31].note).toBe(54);
  press('Delete');
  expect(cells()[31]).toBeUndefined();
  press('ArrowRight');
  expect(state().step!.index).toBe(0);
  press('Escape');
  expect(state().step).toBeNull();

  store.selectStep({ channelId, index: 4 });
  store.setView('factory');
  press('a');
  expect(cells()[4]).toBeUndefined();
});

test('no shortcut fires while a text field has the focus', () => {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  press(' ', {}, input);
  press('a', {}, input);
  press('z', { ctrlKey: true }, input);
  input.remove();
  expect(state().playing).toBe(false);
  expect(audio.noteOn).not.toHaveBeenCalled();
});

test('saving and opening a project round-trips through the platform', async () => {
  let written: Uint8Array = new Uint8Array();
  const saveFile = vi.spyOn(platform, 'saveFile').mockImplementation(async ({ bytes, defaultName, path }) => {
    written = bytes;
    return { name: defaultName, path: path ?? '/songs/Welcome.h3k' };
  });
  store.setBpm(101);
  expect(await commands.saveProject()).toBe(true);
  expect(saveFile).toHaveBeenLastCalledWith(expect.objectContaining({ defaultName: 'Welcome.h3k', path: null }));
  expect(state().dirty).toBe(false);
  expect(state().file).toEqual({ name: 'Welcome.h3k', path: '/songs/Welcome.h3k' });
  const saved = parseProject(new TextDecoder().decode(written));
  expect(saved.bpm).toBe(101);
  expect(saved.channels.map((c) => c.sound.name)).toEqual(state().project.channels.map((c) => c.sound.name));

  store.setSwing(0.5);
  await commands.saveProject();
  expect(saveFile).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/songs/Welcome.h3k' }));

  store.openProject(emptyProject(), null);
  const groove = { name: 'Groove.h3k', path: '/songs/Groove.h3k', bytes: new Uint8Array(written) };
  vi.spyOn(platform, 'openFile').mockResolvedValue(groove);
  await commands.openProject();
  expect(state().project.swing).toBe(0.5);
  expect(state().file).toEqual({ name: 'Groove.h3k', path: '/songs/Groove.h3k' });
  expect(commands.documentName()).toBe('Groove');
});

test('New asks to save unsaved changes first', async () => {
  renderApp();
  const saveFile = vi.spyOn(platform, 'saveFile').mockResolvedValue({ name: 'Welcome.h3k', path: null });
  store.setBpm(100);
  let done = commands.newProject();
  expect(await messageText()).toBe('Save changes to Welcome?');
  await userEvent.click(button('Cancel'));
  await done;
  expect(state().project.name).toBe('Welcome');

  done = commands.newProject();
  await messageText();
  await userEvent.click(button('Save'));
  await done;
  expect(saveFile).toHaveBeenCalledOnce();
  expect(state().project.channels.map((c) => c.sound.name)).toEqual(starterProject().channels.map((c) => c.sound.name));

  store.setBpm(100);
  done = commands.newProject();
  await messageText();
  await userEvent.click(button("Don't Save"));
  await done;
  expect(saveFile).toHaveBeenCalledOnce();
  expect(state().dirty).toBe(false);
});

test('the Sound Library lists new, factory and saved sounds and adds one', async () => {
  vi.spyOn(platform.library, 'list').mockResolvedValue(['My Bell']);
  renderApp();
  const count = state().project.channels.length;
  commands.addSound();
  await expect.poll(() => $$('.h-list-row').map((r) => r.textContent)).toContain('My Bell');
  const rows = $$('.h-list-row').map((r) => r.textContent);
  expect(rows.slice(0, 4)).toEqual(['Oscillator', 'FM Pair', 'Noise', 'Sampler']);
  expect(rows).toEqual(expect.arrayContaining(['Kick', 'Sub Bass', 'Kalimba', 'Warm Pad']));
  expect($$('.h-list-header').map((h) => h.textContent)).toEqual([
    'New', 'Factory · Drums', 'Factory · Bass', 'Factory · Keys', 'Factory · Pads', 'My Sounds',
  ]);
  expect((button('Delete') as HTMLButtonElement).disabled).toBe(true);

  const snare = $$('.h-list-row').find((r) => r.textContent === 'Snare')!;
  await userEvent.dblClick(snare);
  await expect.poll(() => vi.mocked(audio.audition).mock.calls.length).toBe(1);
  expect(vi.mocked(audio.audition).mock.lastCall![0].name).toBe('Snare');
  await userEvent.click(button('Add to Track'));
  await expect.poll(() => state().project.channels.length).toBe(count + 1);
  expect(state().project.channels.at(-1)!.sound.name).toBe('Snare');
  expect(document.querySelector('.h-dialog')).toBeNull();
});

test('a library sound replaces the sound of a channel', async () => {
  vi.spyOn(platform.library, 'list').mockResolvedValue([]);
  renderApp();
  const channel = state().project.channels[0].id;
  commands.replaceSound(channel);
  await expect.poll(() => document.querySelector('.h-list-row')).not.toBeNull();
  await userEvent.click($$('.h-list-row').find((r) => r.textContent === 'Tom')!);
  await userEvent.click(button('Replace'));
  await expect.poll(() => state().project.channels[0].sound.name).toBe('Tom');
});

test('files that cannot be read end in a message box', async () => {
  renderApp();
  const notes = { name: 'notes.h3k', path: null, bytes: new TextEncoder().encode('hello') };
  vi.spyOn(platform, 'openFile').mockResolvedValue(notes);
  void commands.openProject();
  expect(await messageText()).toBe('notes.h3k could not be opened. This is not a Hadjitron 3000 project file.');
  await userEvent.click(button('OK'));

  void commands.dropFiles([new File(['x'], 'shopping.txt')]);
  expect(await messageText()).toMatch(/^shopping\.txt is not something Hadjitron 3000 can open/);
  await userEvent.click(button('OK'));

  const count = state().project.channels.length;
  void commands.dropFiles([new File(['not audio'], 'broken.wav')]);
  expect(await messageText()).toBe('broken.wav could not be read as audio. Use a WAV, MP3, AIFF, FLAC, Ogg or M4A file.');
  expect(state().project.channels.length).toBe(count);
  await userEvent.click(button('OK'));

  vi.spyOn(platform, 'saveFile').mockRejectedValue(new Error('disk full'));
  const saved = commands.saveProjectAs();
  expect(await messageText()).toMatch(/^The file could not be saved \(disk full\)\./);
  await userEvent.click(button('OK'));
  expect(await saved).toBe(false);
  expect(state().dirty).toBe(false);
});

test('the session stores the project with its samples and restores it', async () => {
  await clear(sessionStore);
  await restoreSession();
  expect(state().project.name).toBe('Welcome');

  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
  const channel = store.addSampleChannel('s0123456789abcdef', { name: 'loop.wav', bytes });
  store.setBpm(88);
  store.markSaved({ name: 'Loops.h3k', path: '/x/Loops.h3k' });
  store.setSwing(0.1);
  await saveSession();
  expect(await get('sample:s0123456789abcdef', sessionStore)).toEqual({ name: 'loop.wav', bytes });

  store.openProject(emptyProject(), null);
  await restoreSession();
  expect(state().project.bpm).toBe(88);
  expect(state().file).toEqual({ name: 'Loops.h3k', path: '/x/Loops.h3k' });
  expect(state().dirty).toBe(true);
  const restored = state().project.channels.find((c) => c.id === channel)!;
  expect(restored.sound.source.params.sample).toBe('s0123456789abcdef');
  expect(state().project.samples.s0123456789abcdef.bytes).toEqual(bytes);

  store.replaceSound(channel, newSound('osc'));
  await saveSession();
  expect(await get('sample:s0123456789abcdef', sessionStore)).toBeUndefined();

  await set('doc', { project: 'not a project', samples: [], file: null, dirty: false }, sessionStore);
  store.openProject(emptyProject(), null);
  await restoreSession();
  expect(state().project.name).toBe('Welcome');
  expect(await get('doc', sessionStore)).toBeUndefined();
});
