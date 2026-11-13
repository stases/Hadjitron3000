import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LiveArp } from '../../src/app/arp';
import { noteOn } from '../../src/app/audio';
import type { ArpHost } from '../../src/app/arp';
import { Dialogs } from '../../src/app/Dialogs';
import { useDialogs } from '../../src/app/dialogStore';
import { installKeys } from '../../src/app/keys';
import { setPrefs } from '../../src/app/prefs';
import { arpOf } from '../../src/core/arp';
import { barOf } from '../../src/core/meter';
import { tickTime } from '../../src/core/sequencer';
import type { Note } from '../../src/core/types';
import {
  openProject, selectChannel, selectStep, setParam, setPlaying, setRowLoop, setScale, setView, undo, useApp,
} from '../../src/state/store';
import { FactoryView } from '../../src/ui/factory';
import { useFolds } from '../../src/ui/factory/levels';
import { useHintText } from '../../src/ui/kit';
import { TrackView } from '../../src/ui/track';
import { noteY, tickX } from '../../src/ui/track/roll';
import { closeRoll, openRoll, useRoll } from '../../src/ui/track/rollState';
import { cellX } from '../../src/ui/track/steps';
import { fitSelectionToScale } from '../../src/ui/track/tools';
import { loopProject } from '../support/loopProject';

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  tap: vi.fn(),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  position: vi.fn(() => -1),
  channelScope: vi.fn((_: string, out: Float32Array) => out.fill(0)),
}));
vi.mock('../../src/app/commands', () => ({
  addSound: vi.fn(), dropFiles: vi.fn(async () => {}), renameBlock: vi.fn(), exportAudio: vi.fn(), newProject: vi.fn(),
  openProject: vi.fn(), saveProject: vi.fn(), saveProjectAs: vi.fn(),
}));

// Rows of the test loop: 0 Kick, 1 Clap, 2 Hat, 3 Sub Bass, 4 Kalimba, 5 Warm Pad, 6 Glass Pad, 7 Bell.
const CLAP = 1;
const HAT = 2;
const KALIMBA = 4;
const B = barOf([4, 4]);

let root: Root | null = null;
let host: HTMLElement;
let uninstall: () => void;

function Hint() {
  return <span className="test-hint">{useHintText()}</span>;
}

function mount(view: 'track' | 'factory') {
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; display: flex; flex-direction: column; width: 1300px; height: 640px';
  document.body.append(host);
  root = createRoot(host);
  setView(view);
  flushSync(() => root!.render(<>{view === 'track' ? <TrackView /> : <FactoryView />}<Dialogs /><Hint /></>));
}

beforeEach(async () => {
  await page.viewport(1400, 800);
  setPrefs({ beginner: true, scaleSnap: false });
  useFolds.setState({}, true);
  openProject(loopProject(), null);
  closeRoll();
  useRoll.setState({ snap: 24, mark: 0, length: 24, range: null });
  vi.clearAllMocks();
  uninstall = installKeys();
  await document.fonts.ready;
});

afterEach(async () => {
  await userEvent.cleanup();
  uninstall();
  flushSync(() => useDialogs.setState({ dialog: null, messages: [] }));
  flushSync(() => setPlaying(false));
  root?.unmount();
  root = null;
  host.remove();
});

const state = () => useApp.getState();
const pattern = () => state().project.patterns.find((p) => p.id === state().patternId)!;
const channelId = (row: number) => state().project.channels[row].id;
const notesOf = (row: number) => pattern().notes[channelId(row)] ?? [];
const plain = (row: number) => notesOf(row).map((n) => [n.start, n.note]);
const hint = () => host.querySelector('.test-hint')!.textContent;
const lanes = () => [...host.querySelectorAll<HTMLElement>('.h-track-lane')];
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
const sheet = () => host.querySelector<HTMLElement>('.h-roll-notes')!;
const note = (id: string, start: number, len: number, pitch: number): Note => ({
  id, start, len, note: pitch, vel: 0.8,
});

type Point = { x: number; y: number };

function centre(el: Element): Point {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

function at(tick: number, pitch: number, dx = 2): Point {
  const r = sheet().getBoundingClientRect();
  return { x: Math.round(r.left) + tickX(tick, B) + dx, y: Math.round(r.top) + noteY(pitch) + 6 };
}

async function drag(from: Point, ...path: Point[]) {
  await userEvent.pointer([
    { coords: from }, { keys: '[MouseLeft>]' }, ...path.map((coords) => ({ coords })), { keys: '[/MouseLeft]' },
  ]);
}

/** A row of the block set to these notes. */
function setRow(row: number, notes: Note[]) {
  flushSync(() => openProject({
    ...state().project,
    patterns: state().project.patterns.map((p) =>
      p.id === state().patternId ? { ...p, notes: { ...p.notes, [channelId(row)]: notes } } : p),
  }, null));
}

test('the roll shades the rows outside the scale, marks the root, keeps its tools behind Shaping', async () => {
  mount('track');
  flushSync(() => openRoll(channelId(KALIMBA)));
  const bar = () => host.querySelector('.h-roll-bar')!;
  expect(sheet().style.backgroundImage).not.toContain('--face-hi');
  expect(host.querySelectorAll('.h-roll-key.is-root')).toHaveLength(0);
  // In beginner mode the scale waits behind the Shaping toggle, whose lamp lights once there is a scale.
  expect(button(bar(), 'Randomise…')).toBeUndefined();
  const shaping = button(bar(), 'Shaping');
  expect(shaping.querySelector('.h-led')!.classList.contains('is-on')).toBe(false);
  await userEvent.click(shaping);
  expect(button(bar(), 'Randomise…')).toBeDefined();
  expect(button(bar(), 'Snap to scale').disabled).toBe(true);

  flushSync(() => setScale({ root: 3, type: 'minor' }));
  expect(shaping.querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
  // E flat in every octave from C-1 to C7: the root keys are marked and its rows are the light ones.
  expect([...host.querySelectorAll('.h-roll-key.is-root')].length).toBe(8);
  const bg = sheet().style.backgroundImage;
  expect(bg).toContain('var(--face-hi)');
  const rows = bg.slice(bg.lastIndexOf('linear-gradient(to bottom'));
  expect(rows.match(/var\(--face-lo\)/g)!.length).toBeGreaterThanOrEqual(5);
  expect(button(bar(), 'Snap to scale').disabled).toBe(false);

  setPrefs({ beginner: false });
  await expect.poll(() => button(bar(), 'Shaping')).toBeUndefined();
  expect(button(bar(), 'Randomise…')).toBeDefined();
});

test('with Snap to Scale new and dragged notes in the roll land on the scale; without it they stay put', async () => {
  setRow(KALIMBA, [note('e', 0, 24, 64), note('out', 96, 24, 66)]);
  flushSync(() => setScale({ root: 0, type: 'major' }));
  mount('track');
  flushSync(() => openRoll(channelId(KALIMBA)));
  await drag(at(48, 61));
  expect(plain(KALIMBA)).toContainEqual([48, 61]);
  undo();
  setPrefs({ scaleSnap: true });
  await expect.poll(() => button(host.querySelector('.h-roll-bar')!, 'Shaping')).toBeDefined();
  // C sharp is between C and D: the lower wins.
  await drag(at(48, 61));
  expect(plain(KALIMBA)).toContainEqual([48, 60]);
  // E dragged up a row lands on F; F sharp, out of the scale, is not changed by being near.
  await drag(at(0, 64, 8), at(0, 65, 8));
  expect(plain(KALIMBA)).toEqual([[0, 65], [48, 60], [96, 66]]);
  // Dragged in time only it keeps its pitch, even out of the scale.
  await drag(at(96, 66, 8), at(120, 66, 8));
  expect(plain(KALIMBA)).toContainEqual([120, 66]);
});

test('with Snap to Scale a step dragged up in the grid moves through the scale only', async () => {
  setRow(KALIMBA, [note('c', 0, 24, 60)]);
  flushSync(() => setScale({ root: 0, type: 'majpent' }));
  setPrefs({ scaleSnap: true });
  mount('track');
  const key = () => lanes()[KALIMBA].querySelector('.h-track-step')!;
  const from = centre(key());
  // Three semitones up is D sharp, half way between D and E: D.
  await drag(from, { x: from.x, y: from.y - 6 }, { x: from.x, y: from.y - 12 });
  expect(plain(KALIMBA)).toEqual([[0, 62]]);
  setPrefs({ scaleSnap: false });
  const again = centre(key());
  await drag(again, { x: again.x, y: again.y - 6 }, { x: again.x, y: again.y - 12 });
  expect(plain(KALIMBA)).toEqual([[0, 65]]);
});

test('with Snap to Scale a note typed into a selected step lands on the scale and plays as written', async () => {
  setRow(KALIMBA, []);
  flushSync(() => setScale({ root: 0, type: 'major' }));
  setPrefs({ scaleSnap: true });
  mount('track');
  flushSync(() => selectStep({ channelId: channelId(KALIMBA), index: 2 }));
  // W is C sharp in the octave of C3: it is written as C3, and the step after is selected.
  await userEvent.keyboard('w');
  expect(plain(KALIMBA)).toEqual([[48, 60]]);
  expect(noteOn).toHaveBeenCalledWith(channelId(KALIMBA), 60);
  expect(state().step!.index).toBe(3);
});

test('Fit to Scale moves the selected notes in the roll, or the whole row, in one undo step', () => {
  setRow(KALIMBA, [note('a', 0, 24, 61), note('b', 24, 24, 63), note('c', 48, 24, 66)]);
  flushSync(() => setScale({ root: 0, type: 'major' }));
  selectChannel(channelId(KALIMBA));
  flushSync(() => openRoll(channelId(KALIMBA), ['b']));
  const past = state().past.length;
  fitSelectionToScale();
  expect(plain(KALIMBA)).toEqual([[0, 61], [24, 62], [48, 66]]);
  closeRoll();
  fitSelectionToScale();
  expect(plain(KALIMBA)).toEqual([[0, 60], [24, 62], [48, 65]]);
  expect(state().past.length).toBe(past + 2);
});

test('Randomise fills the stretch chosen on the ruler, rerolls in one undo step, Add keeps the rest', async () => {
  setRow(KALIMBA, [note('keep', 0, 24, 60), note('gone', 120, 24, 61), note('after', 400, 24, 62)]);
  flushSync(() => setScale({ root: 2, type: 'minpent' }));
  mount('track');
  flushSync(() => openRoll(channelId(KALIMBA)));
  // Drag along the ruler from the second beat to the end of the bar.
  const ruler = host.querySelector('.h-roll-head .h-track-box')!.getBoundingClientRect();
  const y = Math.round(ruler.top + 8);
  await drag({ x: Math.round(ruler.left) + tickX(100, B), y }, { x: Math.round(ruler.left) + tickX(370, B), y });
  expect(useRoll.getState().range).toEqual({ from: 96, to: 384 });
  await userEvent.click(button(host.querySelector('.h-roll-bar')!, 'Shaping'));
  await userEvent.click(button(host.querySelector('.h-roll-bar')!, 'Randomise…'));
  const dialog = () => document.querySelector('.h-dialog')!;
  await expect.poll(() => document.querySelector('.h-dialog')).not.toBeNull();
  expect(dialog().textContent).toContain('Fills Kalimba from 1.2.1 to 2.1.1 in D Minor pentatonic.');
  const past = state().past.length;
  await userEvent.click(button(dialog(), 'Apply'));
  const first = notesOf(KALIMBA).map((n) => `${n.start}:${n.note}`);
  const fresh = notesOf(KALIMBA).filter((n) => !['keep', 'after'].includes(n.id));
  // Half the twelve sixteenths, in D minor pentatonic around C3; the note in the stretch is replaced.
  expect(fresh).toHaveLength(6);
  expect(fresh.every((n) => n.start >= 96 && n.start < 384 && [0, 3, 5, 7, 10].includes(((n.note - 2) % 12 + 12) % 12)))
    .toBe(true);
  expect(notesOf(KALIMBA).map((n) => n.id)).toEqual(expect.arrayContaining(['keep', 'after']));
  expect(notesOf(KALIMBA).some((n) => n.id === 'gone')).toBe(false);
  // New draws another seed and puts its notes in place of the last ones, in the same undo step.
  await userEvent.click(button(dialog(), 'New'));
  expect(notesOf(KALIMBA).map((n) => `${n.start}:${n.note}`)).not.toEqual(first);
  expect(notesOf(KALIMBA).filter((n) => !['keep', 'after'].includes(n.id))).toHaveLength(6);
  await userEvent.click(button(dialog(), 'Add'));
  await userEvent.click(button(dialog(), 'Apply'));
  expect(notesOf(KALIMBA).some((n) => n.id === 'gone')).toBe(true);
  expect(state().past.length).toBe(past + 1);
  await userEvent.click(button(dialog(), 'Close'));
  undo();
  expect(notesOf(KALIMBA).map((n) => n.id)).toEqual(['keep', 'gone', 'after']);
});

test('the same seed gives the same notes when the dialog opens again', async () => {
  setRow(KALIMBA, []);
  mount('track');
  selectChannel(channelId(KALIMBA));
  flushSync(() => useDialogs.setState({ dialog: { kind: 'randomise' } }));
  const dialog = () => document.querySelector('.h-dialog')!;
  await userEvent.click(button(dialog(), 'Apply'));
  const once = plain(KALIMBA);
  expect(once.length).toBe(16);
  await userEvent.click(button(dialog(), 'Close'));
  undo();
  flushSync(() => useDialogs.setState({ dialog: { kind: 'randomise' } }));
  await userEvent.click(button(dialog(), 'Apply'));
  expect(plain(KALIMBA)).toEqual(once);
});

test('a row of its own length: the end marker sets it, the steps after are dimmed repeats that lead back', async () => {
  mount('track');
  // In beginner mode the markers wait for the Deep toggle of the block bar while no row has a length of its own.
  expect(host.querySelectorAll('.h-track-loop')).toHaveLength(0);
  const deep = button(host.querySelector('.h-track-bar')!, 'Deep');
  await userEvent.click(deep);
  expect(host.querySelectorAll('.h-track-loop')).toHaveLength(8);
  const hat = lanes()[HAT];
  const marker = hat.querySelector('.h-track-loop')!;
  const box = hat.querySelector('.h-track-box')!.getBoundingClientRect();
  const past = state().past.length;
  await drag(centre(marker), { x: Math.round(box.left + cellX(7, B) + 20), y: centre(marker).y },
    { x: Math.round(box.left + cellX(4, B) + 20), y: centre(marker).y });
  expect(pattern().loops).toEqual({ [channelId(HAT)]: 5 });
  expect(state().past.length).toBe(past + 1);
  expect(deep.querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
  // Twenty-seven of the thirty-two steps are after the loop; the hat's steps 0, 2 and 4 come again in each copy.
  expect(hat.querySelectorAll('.h-track-cell.is-beyond')).toHaveLength(27);
  expect(hat.querySelectorAll('.h-track-step.is-repeat')).toHaveLength(5 * 3 + 1);
  const silent = notesOf(HAT).filter((n) => n.start >= 120).length;
  expect(hat.querySelectorAll('.h-track-step.is-silent').length).toBe(silent);
  // A repeat is not edited: a click goes to the step it repeats.
  const notes = notesOf(HAT).length;
  await drag(centre(hat.querySelectorAll('.h-track-cell')[12]));
  expect(notesOf(HAT)).toHaveLength(notes);
  expect(state().step).toEqual({ channelId: channelId(HAT), index: 2 });
  await userEvent.hover(hat.querySelectorAll('.h-track-cell')[13]);
  expect(hint()).toBe('This row starts again every 5 steps, so this is step 4 once more. Click to go to it.');
  // With a row looped, the markers stay when the Deep toggle closes; pro mode always shows them.
  await userEvent.click(deep);
  expect(host.querySelectorAll('.h-track-loop')).toHaveLength(8);
  flushSync(() => setRowLoop(pattern().id, channelId(HAT), null));
  expect(host.querySelectorAll('.h-track-loop')).toHaveLength(0);
  setPrefs({ beginner: false });
  await expect.poll(() => host.querySelectorAll('.h-track-loop').length).toBe(8);
  expect(button(host.querySelector('.h-track-bar')!, 'Deep')).toBeUndefined();
});

test('a five-step and a seven-step row; the roll shows its row alike, a repeat leads to its note', async () => {
  flushSync(() => setRowLoop(pattern().id, channelId(HAT), 5));
  flushSync(() => setRowLoop(pattern().id, channelId(CLAP), 7));
  setRow(KALIMBA, [note('a', 0, 24, 72), note('b', 48, 24, 74), note('late', 200, 24, 76)]);
  flushSync(() => setRowLoop(pattern().id, channelId(KALIMBA), 7));
  mount('track');
  expect(lanes()[CLAP].querySelectorAll('.h-track-cell.is-beyond')).toHaveLength(25);
  flushSync(() => openRoll(channelId(KALIMBA)));
  // Two notes in the loop of seven steps come again three more times and once more for the first in the last copy.
  expect(host.querySelectorAll('.h-roll-note.is-repeat')).toHaveLength(8);
  expect(host.querySelectorAll('.h-roll-note.is-silent')).toHaveLength(1);
  expect(host.querySelector('.h-roll-beyond')).not.toBeNull();
  await drag(at(7 * 24 + 48, 74, 6));
  expect(useRoll.getState().selected).toEqual(['b']);
  expect(plain(KALIMBA)).toEqual([[0, 72], [48, 74], [200, 76]]);
  // The end marker in the ruler sets the row's length too.
  const marker = host.querySelector('.h-roll-loop')!;
  const ruler = host.querySelector('.h-roll-head .h-track-box')!.getBoundingClientRect();
  await drag(centre(marker), { x: Math.round(ruler.left + cellX(10, B) + 22), y: centre(marker).y });
  expect(pattern().loops![channelId(KALIMBA)]).toBe(11);
  expect(host.querySelectorAll('.h-roll-note.is-silent')).toHaveLength(0);
});

test('the Play group holds the arpeggiator, its rate, octaves and gate idle while it is off', async () => {
  setPrefs({ beginner: false });
  mount('factory');
  const id = channelId(KALIMBA);
  flushSync(() => selectChannel(id));
  const play = () => host.querySelector('.h-rack[aria-label="Source"] [role="group"][aria-label="Play"]')!;
  expect(play().textContent).toContain('Arp');
  expect(play().textContent).toContain('Rate');
  const knob = (label: string) => play().querySelector(`[role="slider"][aria-label="${label}"]`)!;
  expect(knob('Octaves').getAttribute('aria-disabled')).toBe('true');
  expect(knob('Gate').getAttribute('aria-disabled')).toBe('true');
  flushSync(() => setParam(id, 'play', 'arp', 'updown'));
  expect(knob('Gate').getAttribute('aria-disabled')).not.toBe('true');
  await userEvent.hover(knob('Gate'));
  expect(hint()).toContain('How long each note of the arpeggio sounds');
  expect(arpOf(state().project.channels.find((c) => c.id === id)!.sound.play)).toMatchObject({ mode: 'updown' });
});

test('in beginner mode the arpeggiator waits in the Source unit\'s Shaping section, lit when on', async () => {
  mount('factory');
  const id = channelId(KALIMBA);
  flushSync(() => selectChannel(id));
  const unit = () => host.querySelector('.h-rack[aria-label="Source"]')!;
  expect(unit().textContent).not.toContain('Arp');
  const shaping = button(unit(), 'Shaping');
  expect(shaping.querySelector('.h-led')!.classList.contains('is-on')).toBe(false);
  flushSync(() => setParam(id, 'play', 'arp', 'up'));
  expect(shaping.querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
  await userEvent.click(shaping);
  expect(unit().querySelector('.h-rack-section')!.textContent).toContain('Arp');
});

/** A live arpeggiator over a fake clock: the time is set by hand, the engine only records what it is given. */
function fakeArp(settings = { mode: 'up', rate: 24, octaves: 1, gate: 0.5 }, clock: ArpHost['clock'] = () => null) {
  const played: { note: number; time: number; dur: number; vel: number }[] = [];
  const host = { now: 10 };
  const arp = new LiveArp({
    now: () => host.now,
    clock,
    tempo: () => ({ bpm: 120, swing: 0 }),
    settings: () => settings,
    play: (_, note, vel, time, dur) => played.push({ note, time, dur, vel }),
  });
  return { arp, played, host };
}

test('keys held by hand are arpeggiated on a clock of their own at the tempo, and restart with every change', () => {
  vi.useFakeTimers();
  try {
    const { arp, played, host: clock } = fakeArp();
    arp.down('k', 64, 0.5);
    arp.down('k', 60, 0.9);
    // At 120 BPM a sixteenth is 0.125 s; the clock started with the first key, the order with the second.
    for (let t = 10; t <= 10.5; t += 0.01) {
      clock.now = t;
      arp.pump();
    }
    expect(played.map((p) => [p.note, Math.round((p.time - 10) * 1000)])).toEqual([
      [64, 0], [60, 0], [64, 125], [60, 250], [64, 375], [60, 500],
    ]);
    expect(played.every((p) => Math.abs(p.dur - 0.0625) < 1e-9)).toBe(true);
    expect(played[1].vel).toBe(0.9);
    // Letting go of C starts the order again at once with E alone.
    played.length = 0;
    clock.now = 10.56;
    arp.up('k', 60);
    for (let t = 10.56; t <= 10.83; t += 0.01) {
      clock.now = t;
      arp.pump();
    }
    expect(played.map((p) => [p.note, Math.round((p.time - 10.56) * 1000)])).toEqual([[64, 0], [64, 125], [64, 250]]);
    arp.up('k', 64);
    played.length = 0;
    clock.now = 11;
    arp.pump();
    expect(played).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test('while the transport runs, live arpeggios count on its clock with its swing', () => {
  vi.useFakeTimers();
  try {
    const transport = { origin: 4, bpm: 120, swing: 0.5 };
    const { arp, played, host: clock } = fakeArp({ mode: 'down', rate: 24, octaves: 2, gate: 1 }, () => transport);
    clock.now = 4 + tickTime(48, 120, 0.5);
    arp.down('k', 60, 0.8);
    for (let t = clock.now; t < 4 + tickTime(48 + 4 * 24, 120, 0.5) - 0.031; t += 0.005) {
      clock.now = t;
      arp.pump();
    }
    expect(played.map((p) => p.note)).toEqual([72, 60, 72, 60]);
    played.forEach((p, k) => expect(p.time).toBeCloseTo(4 + tickTime(48 + 24 * k, 120, 0.5), 9));
    const dur = (k: number) => tickTime(72 + 24 * k, 120, 0.5) - tickTime(48 + 24 * k, 120, 0.5);
    played.forEach((p, k) => expect(p.dur).toBeCloseTo(dur(k), 9));
  } finally {
    vi.useRealTimers();
  }
});
