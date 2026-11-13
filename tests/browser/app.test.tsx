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
import { SHORTCUT_GROUPS } from '../../src/app/shortcuts';
import { extractBlock } from '../../src/core/block';
import { emptyProject, newSound } from '../../src/core/defaults';
import { parseBlock, parseProject, serializeBlock } from '../../src/core/fileformat';
import { platform } from '../../src/platform';
import { demoProject, factoryBlocks, starterProject } from '../../src/presets/projects';
import * as store from '../../src/state/store';

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  tap: vi.fn(),
  audition: vi.fn(async () => {}),
  auditionBlock: vi.fn(async () => {}),
}));

const state = store.useApp.getState;
const current = () => state().project.patterns.find((p) => p.id === state().patternId)!;
/** A block of the demo song as the bytes of a .h3b file. */
function blockFile(name: string) {
  const project = demoProject();
  const block = extractBlock(project, project.patterns.find((p) => p.name === name)!.id)!;
  return new TextEncoder().encode(serializeBlock(block));
}
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
const messageButton = (label: string) => $$('.h-message-buttons .h-button').find((b) => b.textContent === label)!;
const row = (label: string) => $$('.h-list-row').find((r) => r.textContent === label)!;

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

  expect(labels(await openMenu('Track'))).toEqual(['Play / Stop']);
  await userEvent.keyboard('{Escape}');

  const block = await openMenu('Block');
  expect(labels(block)).toEqual([
    'New Block', 'Duplicate Block', 'Clear Block', 'Delete Block', 'Block Library…', 'Save Block to Library',
    'Save Block As…', 'Play Block', 'Play Song',
  ]);
  expect(block[7].querySelector('.h-menu-check svg')).not.toBeNull();
  await userEvent.click(block[8]);
  expect(state().scope).toBe('song');
  await userEvent.click((await openMenu('Block'))[0]);
  expect(current().name).toBe('A');
  expect(state().project.patterns).toHaveLength(9);
  await userEvent.click((await openMenu('Block'))[4]);
  await expect.poll(() => document.querySelector('.h-dialog')?.getAttribute('aria-label')).toBe('Block Library');
  await userEvent.click(button('Close'));

  const view = await openMenu('View');
  expect(labels(view)).toEqual(['Factory', 'Track', 'Song']);
  expect(view.map((el) => el.querySelector('.h-menu-shortcut')!.textContent)).toEqual(['Ctrl+1', 'Ctrl+2', 'Ctrl+3']);
  await userEvent.click(view[2]);
  expect(state().view).toBe('song');
  expect($('.h-tab.is-selected').textContent).toBe('Song');
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
  expect(state().scope).toBe('pattern');
  press('3', { ctrlKey: true, code: 'Digit3' });
  expect(state().view).toBe('song');
  expect(state().scope).toBe('song');
  expect(SHORTCUT_GROUPS[0].keys).toContainEqual(['Ctrl+1, Ctrl+2, Ctrl+3', 'Factory, Track, Song']);
});

test('the transport and the status bar say what Play plays, the block or the song', async () => {
  renderApp();
  const where = () => $$('.h-statusfield')[1].textContent;
  expect($$('.h-app-joined .h-button').map((b) => b.textContent)).toEqual(['Block', 'Song']);
  expect(where()).toBe('Block Beat · 2 bars');
  await userEvent.click(button('Song'));
  expect(state().scope).toBe('song');
  await expect.poll(where).toBe('Song · 16 bars');
  flushSync(() => store.openProject({ ...demoProject(), song: [] }, null));
  flushSync(() => store.setScope('song'));
  expect(where()).toBe('The song is empty');
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

test('the Block Library lists factory and saved blocks, auditions them and adds one with its sounds', async () => {
  vi.spyOn(platform.blocks, 'list').mockResolvedValue(['My Groove']);
  const read = vi.spyOn(platform.blocks, 'read').mockResolvedValue(blockFile('Bass up'));
  store.openProject(emptyProject(), null);
  renderApp();
  commands.addBlock();
  await expect.poll(() => $$('.h-list-row').map((r) => r.textContent)).toContain('My Groove');
  expect($('.h-dialog').getAttribute('aria-label')).toBe('Block Library');
  expect($$('.h-list-header').map((h) => h.textContent)).toEqual(['Factory', 'My Blocks']);
  expect(factoryBlocks().map((b) => b.name)).toEqual([
    'Beat', 'Bass', 'Keys', 'Pads', 'Break', 'Bass up', 'Keys up', 'Pads up',
  ]);
  expect($$('.h-list-row').map((r) => r.textContent)).toEqual([...factoryBlocks().map((b) => b.name), 'My Groove']);
  expect(row('Pads').querySelector('.h-chip')!.getAttribute('style')).toContain('--c5');
  expect((button('Delete') as HTMLButtonElement).disabled).toBe(true);

  await userEvent.dblClick(row('Pads'));
  await expect.poll(() => vi.mocked(audio.auditionBlock).mock.calls.length).toBe(1);
  const auditioned = vi.mocked(audio.auditionBlock).mock.lastCall![0];
  expect(auditioned.name).toBe('Pads');
  expect(auditioned.tracks.map((t) => t.sound.name)).toEqual(['Warm Pad', 'Glass Pad']);
  await userEvent.click(button('Add to Project'));
  await expect.poll(() => state().project.patterns.length).toBe(2);
  expect(current().name).toBe('Pads');
  expect(current().bars).toBe(2);
  expect(state().project.channels.map((c) => c.sound.name)).toEqual(['Warm Pad', 'Glass Pad']);
  expect(document.querySelector('.h-dialog')).toBeNull();

  commands.addBlock();
  await expect.poll(() => document.querySelector('.h-list-row')).not.toBeNull();
  await expect.poll(() => row('My Groove')).toBeDefined();
  await userEvent.click(row('My Groove'));
  expect((button('Delete') as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(button('Audition'));
  await expect.poll(() => vi.mocked(audio.auditionBlock).mock.calls.length).toBe(2);
  expect(read).toHaveBeenCalledWith('My Groove');
  await userEvent.click(button('Add to Project'));
  await expect.poll(() => current().name).toBe('Bass up');
  expect(state().project.channels.map((c) => c.sound.name)).toEqual(['Warm Pad', 'Glass Pad', 'Sub Bass']);
});

test('a saved block can be deleted from the Block Library', async () => {
  const list = vi.spyOn(platform.blocks, 'list').mockResolvedValue(['My Groove']);
  const remove = vi.spyOn(platform.blocks, 'remove').mockResolvedValue();
  renderApp();
  commands.addBlock();
  await expect.poll(() => row('My Groove')).toBeDefined();
  expect($('.h-app-library-note').textContent).toBe('Double-click a block to hear it.');
  await userEvent.click(row('My Groove'));
  list.mockResolvedValue([]);
  await userEvent.click(button('Delete'));
  expect(await messageText()).toBe('Delete My Groove from your library? This cannot be undone.');
  expect($$('.h-dialog')[1].getAttribute('aria-label')).toBe('Delete Block');
  await userEvent.click(messageButton('Delete'));
  await expect.poll(() => remove.mock.calls).toEqual([['My Groove']]);
  await expect.poll(() => $$('.h-list-row').map((r) => r.textContent)).not.toContain('My Groove');
  expect($('.h-app-library-note').textContent).toBe('Blocks you save to the library are listed under My Blocks.');
});

test('a block saves to the library, asking before it replaces one, and as a .h3b file', async () => {
  const list = vi.spyOn(platform.blocks, 'list').mockResolvedValue(['Beat']);
  const write = vi.spyOn(platform.blocks, 'write').mockResolvedValue();
  renderApp();
  const beat = state().patternId;
  let done = commands.saveBlockToLibrary(beat);
  expect(await messageText()).toBe('Your library already has a block called Beat. Replace it?');
  await userEvent.click(button('Cancel'));
  await done;
  expect(write).not.toHaveBeenCalled();

  done = commands.saveBlockToLibrary(beat);
  await messageText();
  await userEvent.click(button('Replace'));
  await done;
  expect(write).toHaveBeenCalledOnce();
  expect(write.mock.lastCall![0]).toBe('Beat');
  const saved = parseBlock(new TextDecoder().decode(write.mock.lastCall![1]));
  expect(saved.tracks.map((t) => t.sound.name)).toEqual(['Kick', 'Clap', 'Hat']);
  expect(saved.bars).toBe(2);

  list.mockResolvedValue([]);
  write.mockRejectedValue(new Error('Invalid library name'));
  done = commands.saveBlockToLibrary(beat);
  expect(await messageText()).toBe('"Beat" cannot be used as a file name. Rename the block and try again.');
  await userEvent.click(button('OK'));
  await done;
  write.mockRejectedValue(new Error('disk full'));
  done = commands.saveBlockToLibrary(beat);
  expect(await messageText()).toBe('The block could not be saved to your library (disk full).');
  await userEvent.click(button('OK'));
  await done;

  const saveFile = vi.spyOn(platform, 'saveFile').mockResolvedValue({ name: 'Beat.h3b', path: null });
  await commands.saveBlockAs(beat);
  expect(saveFile).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Save Block', defaultName: 'Beat.h3b', filters: [{ name: 'Hadjitron 3000 blocks', extensions: ['h3b'] }],
  }));
  expect(parseBlock(new TextDecoder().decode(saveFile.mock.lastCall![0].bytes)).name).toBe('Beat');
});

test('opening or dropping a .h3b file adds its block, and a broken file or a full project is refused', async () => {
  renderApp();
  const count = state().project.patterns.length;
  await commands.openFile({ name: 'Pads.h3b', path: '/blocks/Pads.h3b', bytes: blockFile('Pads') });
  expect(state().project.patterns).toHaveLength(count + 1);
  expect(current().name).toBe('Pads');
  await commands.dropFiles([new File([blockFile('Break')], 'Break.h3b')]);
  expect(state().project.patterns).toHaveLength(count + 2);
  expect(current().name).toBe('Break');
  expect(Object.keys(current().cells)).toHaveLength(3);

  void commands.dropFiles([new File(['nonsense'], 'broken.h3b')]);
  expect(await messageText()).toBe('broken.h3b could not be opened. This is not a Hadjitron 3000 block file.');
  await userEvent.click(button('OK'));

  flushSync(() => {
    while (state().project.patterns.length < 26) store.addPattern();
  });
  void commands.openFile({ name: 'Beat.h3b', path: null, bytes: blockFile('Beat') });
  expect(await messageText())
    .toBe('Beat could not be added. A project holds at most 26 blocks; delete one and try again.');
  await userEvent.click(button('OK'));
  expect(state().project.patterns).toHaveLength(26);
});

test('Rename asks for a new name for the block', async () => {
  renderApp();
  const id = state().patternId;
  commands.renameBlock(id);
  await expect.poll(() => document.activeElement?.tagName).toBe('INPUT');
  const input = document.activeElement as HTMLInputElement;
  expect($('.h-dialog').getAttribute('aria-label')).toBe('Rename Block');
  expect(input.value).toBe('Beat');
  expect(input.selectionEnd! - input.selectionStart!).toBe(4);
  expect(input.maxLength).toBe(24);
  await userEvent.keyboard('Four on the floor{Enter}');
  expect(state().project.patterns.find((p) => p.id === id)!.name).toBe('Four on the floor');
  await expect.poll(() => document.querySelector('.h-dialog')).toBeNull();

  commands.renameBlock(id);
  await expect.poll(() => document.activeElement?.tagName).toBe('INPUT');
  await userEvent.keyboard('{Backspace}');
  expect((button('OK') as HTMLButtonElement).disabled).toBe(true);
  await userEvent.keyboard('{Enter}');
  expect(document.querySelector('.h-dialog')).not.toBeNull();
  await userEvent.keyboard('Nope{Escape}');
  await expect.poll(() => document.querySelector('.h-dialog')).toBeNull();
  expect(state().project.patterns.find((p) => p.id === id)!.name).toBe('Four on the floor');
});

test('the export dialog offers the song or the current block by name and refuses one without notes', async () => {
  renderApp();
  commands.exportAudio();
  await expect.poll(() => document.querySelector('.h-dialog .h-select')).not.toBeNull();
  const what = $('.h-dialog .h-select');
  expect(what.textContent).toBe('Block: Beat');
  await userEvent.click(what);
  expect($$('.h-select-option').map((o) => o.textContent)).toEqual(['The song', 'Block: Beat']);
  await userEvent.keyboard('{Escape}');
  await userEvent.click(button('Cancel'));

  flushSync(() => store.clearPattern(state().patternId));
  commands.exportAudio();
  await expect.poll(() => document.querySelector('.h-dialog')).not.toBeNull();
  await userEvent.click(button('Export'));
  expect(await messageText()).toBe('The block Beat has no notes to export. Add some steps first.');
  await userEvent.click(messageButton('OK'));
  await userEvent.click(button('Cancel'));

  flushSync(() => store.openProject({ ...demoProject(), song: [] }, null));
  flushSync(() => store.setScope('song'));
  commands.exportAudio();
  await expect.poll(() => document.querySelector('.h-dialog .h-select')?.textContent).toBe('The song');
  await userEvent.click(button('Export'));
  expect(await messageText()).toBe('The song has no notes to export. Place blocks with notes in the Song view first.');
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
  expect(state().view).toBe('song');

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

test('the first launch opens the demo in the Song view, and later launches restore the view', async () => {
  await clear(sessionStore);
  await restoreSession();
  expect(state().view).toBe('song');
  expect(state().scope).toBe('song');
  renderApp();
  expect($('.h-tab.is-selected').textContent).toBe('Song');

  for (const view of ['factory', 'track', 'song'] as const) {
    store.setView(view);
    await saveSession();
    store.setView(view === 'track' ? 'factory' : 'track');
    await restoreSession();
    expect(state().view).toBe(view);
    expect(state().scope).toBe(view === 'song' ? 'song' : 'pattern');
  }
});

test('a session stored before blocks existed still opens', async () => {
  const sound = starterProject().channels[0].sound;
  const project = {
    name: 'Old', bpm: 100, swing: 0, master: 0,
    channels: [{ id: 'c1', sound, color: 2, mute: false, solo: false }],
    patterns: [
      { id: 'p1', name: 'A', bars: 1, cells: { c1: { 0: { note: 60, vel: 0.8, len: 1 } } } },
      { id: 'p2', name: 'B', bars: 2, cells: {} },
    ],
    song: ['p1', 'p2', 'p1'],
  };
  await set('doc', { project, samples: [], file: null, dirty: false }, sessionStore);
  await restoreSession();
  expect(state().project.name).toBe('Old');
  expect(state().view).toBe('track');
  expect(state().project.patterns.map((p) => [p.name, p.color])).toEqual([['A', 0], ['B', 0]]);
  expect(state().project.song.map((p) => [p.pattern, p.lane, p.bar, p.bars])).toEqual([
    ['p1', 0, 0, 1], ['p2', 0, 1, 2], ['p1', 0, 3, 1],
  ]);
  renderApp();
  expect($$('.h-statusfield')[1].textContent).toBe('Block A · 1 bar');
});
