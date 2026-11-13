import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderProject, renderStems } from '../../src/audio';
import { App } from '../../src/app/App';
import * as audio from '../../src/app/audio';
import { exportAudio } from '../../src/app/commands';
import { useDialogs } from '../../src/app/dialogStore';
import { stemNames } from '../../src/app/ExportDialog';
import { installKeys } from '../../src/app/keys';
import { setPrefs, usePrefs } from '../../src/app/prefs';
import { initRecord, liveNote, recording, toggleRecord, useRecord } from '../../src/app/record';
import { SHORTCUT_GROUPS } from '../../src/app/shortcuts';
import type { Clock } from '../../src/core/record';
import type { Note, Project } from '../../src/core/types';
import { platform } from '../../src/platform';
import { demoProject } from '../../src/presets/projects';
import * as store from '../../src/state/store';
import { amplitudeAt, project, rms, sound } from './helpers';

const fake = vi.hoisted(() => ({
  clock: null as Clock | null, now: 0, heard: null as number | null,
}));

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  tap: vi.fn(),
  clock: () => fake.clock,
  latency: () => 0.02,
  contextTime: () => fake.now,
  heardNow: () => fake.heard,
  countIn: vi.fn(() => store.setPlaying(true)),
}));

const state = store.useApp.getState;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const button = (label: string) =>
  $$(document.querySelector('.h-dialog') ? '.h-dialog .h-button' : '.h-button').find((b) => b.textContent === label)!;
const channelOf = (name: string) => state().project.channels.find((c) => c.sound.name === name)!.id;
const notes = (channelId: string): Note[] =>
  state().project.patterns.find((p) => p.id === state().patternId)!.notes[channelId] ?? [];
const plain = (row: Note[]) => row.map(({ start, len, note, vel }) => ({ start, len, note, vel }));
let root: { root: Root; host: HTMLElement } | null = null;
let removeKeys: (() => void) | null = null;

function renderApp(): void {
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  flushSync(() => r.render(<App />));
  root = { root: r, host };
}

/** A note played by hand `heard` seconds after tick 0 as the listener heard it, and let go `held` seconds later. */
function play(channelId: string, note: number, heard: number, held: number, vel = 0.7): void {
  const origin = fake.clock!.origin + 0.02;
  liveNote({ channelId, note, vel, time: origin + heard });
  liveNote({ channelId, note, vel: null, time: origin + heard + held });
}

beforeAll(() => {
  initRecord();
});

beforeEach(() => {
  store.openProject(demoProject(), null);
  store.setView('track');
  setPrefs({ quantize: 24, metronome: false, beginner: true });
  fake.clock = { origin: 100, bpm: 120, swing: 0 };
  fake.heard = null;
  removeKeys = installKeys();
});

afterEach(async () => {
  removeKeys?.();
  store.setPlaying(false);
  useRecord.setState({ on: false });
  await userEvent.cleanup();
  flushSync(() => useDialogs.setState({ dialog: null, messages: [] }));
  root?.root.unmount();
  root?.host.remove();
  root = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

test('a recording pass writes what was heard into the block, quantized and cut at the loop end', () => {
  const bell = channelOf('Bell');
  store.selectChannel(bell);
  const before = state().past.length;
  store.setPlaying(true);
  toggleRecord();
  expect(useRecord.getState().on).toBe(true);
  expect(recording()).toBe(true);
  expect(audio.countIn).not.toHaveBeenCalled();
  // At 120 BPM a sixteenth is 0.125 s and the block Beat is two bars, 4 s.
  play(bell, 72, 0.13, 0.25);
  play(bell, 76, 0.13, 0.05, 1);
  // Held across the loop end: cut at the end of the block.
  play(bell, 79, 3.9, 0.4);
  // In the second pass, nearest the second sixteenth.
  play(bell, 74, 4.12, 0.1);
  // The same start and pitch as a note already written: dropped.
  play(bell, 72, 4.14, 1);
  expect(plain(notes(bell))).toEqual([
    { start: 24, len: 48, note: 72, vel: 0.7 },
    { start: 24, len: 24, note: 74, vel: 0.7 },
    { start: 24, len: 24, note: 76, vel: 1 },
    { start: 744, len: 24, note: 79, vel: 0.7 },
  ]);
  expect(state().past.length).toBe(before + 1);
  toggleRecord();
  expect(recording()).toBe(false);
  // Notes played after Record went off are not written.
  play(bell, 60, 1, 0.5);
  expect(notes(bell)).toHaveLength(4);

  // A second pass is its own undo step; a key still down when playing stops is written up to that moment.
  toggleRecord();
  setPrefs({ quantize: 0 });
  liveNote({ channelId: bell, note: 67, vel: 0.5, time: 100.02 + 2.003 });
  fake.now = 100.02 + 2.5;
  store.setPlaying(false);
  expect(useRecord.getState().on).toBe(false);
  expect(plain(notes(bell)).find((n) => n.note === 67)).toEqual({ start: 385, len: 95, note: 67, vel: 0.5 });
  expect(state().past.length).toBe(before + 2);
  store.undo();
  expect(notes(bell)).toHaveLength(4);
  store.undo();
  expect(notes(bell)).toEqual([]);
});

test('an edit in the middle of a pass starts a new undo step for the notes after it', () => {
  const bell = channelOf('Bell');
  const before = state().past.length;
  store.setPlaying(true);
  toggleRecord();
  play(bell, 72, 0, 0.1);
  store.setBpm(100);
  play(bell, 74, 0.5, 0.1);
  expect(state().past.length).toBe(before + 3);
  store.undo();
  expect(notes(bell).map((n) => n.note)).toEqual([72]);
});

test('with swing the pass quantizes to where the grid lines sound', () => {
  const bell = channelOf('Bell');
  fake.clock = { origin: 100, bpm: 120, swing: 1 };
  setPrefs({ quantize: 16 });
  store.setPlaying(true);
  toggleRecord();
  // Fully swung, the triplet lines at 16 and 32 ticks sound 0.125 and 0.208 s in; 0.18 s is heard nearer 32.
  play(bell, 72, 0.18, 0.1);
  play(bell, 74, 0.16, 0.1);
  expect(plain(notes(bell)).map((n) => [n.start, n.note])).toEqual([[16, 74], [32, 72]]);
});

test('Record is off and disabled while the song plays, and says why', async () => {
  renderApp();
  const rec = button('Rec');
  expect(rec.hasAttribute('disabled')).toBe(false);
  store.setPlaying(true);
  toggleRecord();
  await expect.poll(() => rec.getAttribute('aria-pressed')).toBe('true');
  flushSync(() => store.setView('song'));
  expect(useRecord.getState().on).toBe(false);
  expect(recording()).toBe(false);
  expect(button('Rec').hasAttribute('disabled')).toBe(true);
  toggleRecord();
  expect(useRecord.getState().on).toBe(false);
  // The test page is narrower than the transport bar, so the pointer is sent to the button directly.
  button('Rec').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await expect.poll(() => $$('.h-statusfield')[0].textContent)
    .toBe('Recording works while a block plays on repeat; press Block to record into it.');
});

test('R while stopped counts in a bar, the lamp blinks on its beats, and stopping ends the pass', async () => {
  renderApp();
  const lamp = () => button('Rec').querySelector('.h-led')!.classList.contains('is-on');
  const where = () => $$('.h-statusfield')[1].textContent;
  expect(lamp()).toBe(false);
  fake.heard = -250; // the second beat of the count-in, early in it
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
  expect(audio.countIn).toHaveBeenCalledOnce();
  expect(state().playing).toBe(true);
  expect(useRecord.getState().on).toBe(true);
  await expect.poll(where).toBe('Block Beat · count-in 2');
  expect(lamp()).toBe(true);
  fake.heard = -300;
  await expect.poll(lamp).toBe(false);
  fake.heard = 10;
  await expect.poll(lamp).toBe(true);
  await expect.poll(where).toBe('Block Beat · 1.1');
  // A note played early in the count-in lands nowhere; one just before the downbeat lands on it.
  const bell = channelOf('Bell');
  play(bell, 60, -1, 0.1);
  play(bell, 62, -0.03, 0.1);
  expect(plain(notes(bell)).map((n) => [n.start, n.note])).toEqual([[0, 62]]);
  flushSync(() => store.setPlaying(false));
  expect(useRecord.getState().on).toBe(false);
  expect(lamp()).toBe(false);
});

test('piano keys only play while recording, instead of writing into the selected step', () => {
  const bell = channelOf('Bell');
  store.selectStep({ channelId: bell, index: 3 });
  store.setPlaying(true);
  toggleRecord();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }));
  expect(audio.noteOn).toHaveBeenCalledWith(bell, 60);
  expect(notes(bell)).toEqual([]);
  expect(state().step?.index).toBe(3);
});

test('the metronome key, the Track menu and the shortcuts list the new controls', async () => {
  renderApp();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }));
  expect(usePrefs.getState().metronome).toBe(true);
  await expect.poll(() => document.querySelector('[aria-pressed="true"] .h-icon')).not.toBeNull();
  await userEvent.click($$('.h-menubar-item').find((el) => el.textContent === 'Track')!);
  await expect.poll(() => $$('.h-menu-item').length).toBeGreaterThan(0);
  const items = $$('.h-menu-item');
  expect(items.map((el) => el.querySelector('.h-menu-label')!.textContent))
    .toEqual(['Play / Stop', 'Record', 'Metronome']);
  expect(items.map((el) => el.querySelector('.h-menu-shortcut')!.textContent)).toEqual(['Space', 'R', 'C']);
  expect(items[2].querySelector('.h-menu-check svg')).not.toBeNull();
  await userEvent.click(items[1]);
  expect(useRecord.getState().on).toBe(true);
  expect(audio.countIn).toHaveBeenCalledOnce();
  const playing = SHORTCUT_GROUPS.find((g) => g.label === 'Playing')!.keys;
  expect(playing.map(([key]) => key)).toEqual(expect.arrayContaining(['R', 'C']));
});

test('stems are named after the export and the sound, safely and without clashes', () => {
  expect(stemNames('Night', ['Kick', 'Bass/Sub', 'kick', 'Kick', '.Pad: one'], 'wav')).toEqual([
    'Night - Kick.wav', 'Night - Bass-Sub.wav', 'Night - kick 2.wav', 'Night - Kick 3.wav', 'Night - .Pad- one.wav',
  ]);
  expect(stemNames('.hidden', ['A'], 'mp3')).toEqual(['hidden - A.mp3']);
});

test('each stem is its sound soloed through the mix, and all stems have one length', async () => {
  const sine = (release: number) => sound('osc', { wave: 'sine' }, { amp: { attack: 0.005, release } });
  const notes = (note: number) => ({ 0: { note, vel: 1, len: 2 }, 8: { note, vel: 1, len: 2 } });
  const p: Project = project(
    [
      { id: 'a', sound: { ...sine(0.05), name: 'Low' } },
      { id: 'b', sound: { ...sine(1.5), name: 'High' } },
      { id: 'c', sound: sine(0.1), mute: true },
      { id: 'd', sound: sine(0.1) },
    ],
    { a: notes(69), b: notes(81), c: notes(76) },
    { bpm: 120 },
  );
  const scope = { kind: 'pattern' as const, patternId: p.patterns[0].id };
  const seen: string[] = [];
  const stems = await renderStems(p, scope, { onProgress: (_, channel) => seen.push(channel.id) });
  expect(stems.map((s) => s.channel.id)).toEqual(['a', 'b']);
  expect([...new Set(seen)]).toEqual(['a', 'b']);
  const [low, high] = stems.map((s) => s.pcm.channels[0]);
  expect(low.length).toBe(high.length);
  for (const { channel, pcm } of stems) {
    const alone = { ...p, channels: p.channels.map((c) => ({ ...c, solo: c.id === channel.id })) };
    const solo = await renderProject(alone, scope);
    const data = pcm.channels[0];
    expect(data.subarray(0, solo.channels[0].length)).toEqual(solo.channels[0]);
    expect(rms(data.subarray(solo.channels[0].length))).toBe(0);
  }
  const part = (d: Float32Array) => d.subarray(4410, 4410 + 8192);
  expect(amplitudeAt(part(low), 440)).toBeGreaterThan(100 * amplitudeAt(part(low), 880));
  expect(amplitudeAt(part(high), 880)).toBeGreaterThan(100 * amplitudeAt(part(high), 440));
  // A soloed sound in the mix makes the stems of only the soloed sounds.
  const soloed = { ...p, channels: p.channels.map((c) => ({ ...c, solo: c.id === 'b' })) };
  expect((await renderStems(soloed, scope, { tail: 0 })).map((s) => s.channel.id)).toEqual(['b']);
});

test('the export dialog writes a file for each sound into the chosen folder and says which it renders', async () => {
  const written: { name: string; bytes: Uint8Array }[] = [];
  const chooseFolder = vi.spyOn(platform, 'chooseFolder').mockResolvedValue({
    write: async (name, bytes) => {
      written.push({ name, bytes });
    },
  });
  renderApp();
  exportAudio();
  await expect.poll(() => document.querySelector('.h-dialog')).not.toBeNull();
  // In beginner mode the choice waits behind the Shaping toggle.
  expect($$('.h-dialog .h-checkbox').map((c) => c.textContent)).toEqual(['Let the end ring out']);
  await userEvent.click(button('Shaping'));
  const stems = $$('.h-dialog .h-checkbox').find((c) => c.textContent === 'Separate file for each sound')!;
  await userEvent.click(stems);
  // Without the ring-out every file is exactly the length of the block.
  await userEvent.click($$('.h-dialog .h-checkbox').find((c) => c.textContent === 'Let the end ring out')!);
  expect(button('Shaping').querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
  const labels = new Set<string>();
  const observer = new MutationObserver(() => labels.add($('.h-app-export-progress span').textContent ?? ''));
  observer.observe($('.h-app-export-progress'), { subtree: true, childList: true, characterData: true });
  await userEvent.click(button('Export'));
  await expect.poll(() => document.querySelector('.h-dialog'), { timeout: 20000 }).toBeNull();
  observer.disconnect();
  expect(chooseFolder).toHaveBeenCalledOnce();
  expect(written.map((w) => w.name)).toEqual([
    'Welcome - Beat - Kick.wav', 'Welcome - Beat - Clap.wav', 'Welcome - Beat - Hat.wav',
  ]);
  // Two bars at 126 BPM, 16-bit stereo, after a 44-byte header.
  expect(written.map((w) => w.bytes.length)).toEqual(Array(3).fill(44 + 4 * Math.round(((32 * 15) / 126) * 44100)));
  expect([...labels].filter((l) => l.startsWith('Rendering'))).toEqual(
    expect.arrayContaining(['Rendering Kick…', 'Rendering Clap…', 'Rendering Hat…']),
  );

  // Cancelling the folder leaves the dialog open and writes nothing.
  chooseFolder.mockResolvedValueOnce(null);
  exportAudio();
  await expect.poll(() => document.querySelector('.h-dialog')).not.toBeNull();
  await userEvent.click($$('.h-dialog .h-checkbox').find((c) => c.textContent === 'Separate file for each sound')!);
  await userEvent.click(button('Export'));
  await expect.poll(() => chooseFolder.mock.calls.length).toBe(2);
  expect(document.querySelector('.h-dialog')).not.toBeNull();
  expect(written).toHaveLength(3);
}, 60000);
