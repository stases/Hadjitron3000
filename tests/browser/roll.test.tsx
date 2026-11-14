import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { position, tap } from '../../src/app/audio';
import { installKeys } from '../../src/app/keys';
import { IS_MAC, modKey } from '../../src/app/shortcuts';
import { barOf } from '../../src/core/meter';
import type { Note } from '../../src/core/types';
import { openProject, redo, setPatternBars, setPlaying, undo, useApp } from '../../src/state/store';
import { useHintText } from '../../src/ui/kit';
import { TrackView } from '../../src/ui/track';
import { noteY, tickX } from '../../src/ui/track/roll';
import { closeRoll, useRoll } from '../../src/ui/track/rollState';
import { cellX, laneWidth } from '../../src/ui/track/steps';
import { loopProject } from '../support/loopProject';

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  tap: vi.fn(),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  position: vi.fn(() => -1),
}));
vi.mock('../../src/app/commands', () => ({
  addSound: vi.fn(), dropFiles: vi.fn(async () => {}), renameBlock: vi.fn(), exportAudio: vi.fn(), newProject: vi.fn(),
  openProject: vi.fn(), saveProject: vi.fn(), saveProjectAs: vi.fn(),
}));

// Rows of the test loop: 0 Kick, 1 Clap, 2 Hat, 3 Sub Bass, 4 Kalimba, 5 Warm Pad, 6 Glass Pad, 7 Bell.
// The shortcuts take Cmd on a Mac and Ctrl elsewhere.
const MOD = IS_MAC ? 'Meta' : 'Control';
const SUB = 3;
const KALIMBA = 4;
const BLOCK = 2 * 16 * 24;
const B = barOf([4, 4]);

let root: Root;
let host: HTMLElement;
let uninstall: () => void;

function Hint() {
  return <span className="test-hint">{useHintText()}</span>;
}

beforeEach(async () => {
  await page.viewport(1400, 800);
  openProject(loopProject(), null);
  closeRoll();
  useRoll.setState({ snap: 24, mark: 0, length: 24 });
  vi.clearAllMocks();
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; display: flex; flex-direction: column; width: 1300px; height: 640px';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<><TrackView /><Hint /></>));
  uninstall = installKeys();
  await document.fonts.ready;
});

afterEach(async () => {
  await userEvent.cleanup();
  uninstall();
  flushSync(() => setPlaying(false));
  root.unmount();
  host.remove();
});

const state = () => useApp.getState();
const pattern = () => state().project.patterns.find((p) => p.id === state().patternId)!;
const channelId = (row: number) => state().project.channels[row].id;
const notesOf = (row: number) => pattern().notes[channelId(row)] ?? [];
const plain = (row: number) => notesOf(row).map((n) => [n.start, n.len, n.note]);
const idsAt = (row: number, ...starts: number[]) =>
  notesOf(row).filter((n) => starts.includes(n.start)).map((n) => n.id);
const selected = () => [...useRoll.getState().selected].sort();
const roll = () => host.querySelector('.h-roll');
const scroller = () => host.querySelector<HTMLElement>('.h-roll-scroll')!;
const sheet = () => host.querySelector<HTMLElement>('.h-roll-notes')!;
const hint = () => host.querySelector('.test-hint')!.textContent;
const lanes = () => [...host.querySelectorAll<HTMLElement>('.h-track-lane')];
const cell = (row: number, col: number) => lanes()[row].querySelectorAll<HTMLElement>('.h-track-cell')[col];
const rollButton = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.h-roll-bar button')].find((b) => b.textContent === label)!;
const steppers = () => [...host.querySelectorAll<HTMLElement>('.h-track-inspector .h-stepper')];
const which = () => host.querySelector('.h-track-which')!.textContent;

type Point = { x: number; y: number };

function centre(el: Element): Point {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

/** A point on the sheet `dx` pixels right of a tick, in the middle of a pitch's row. */
function at(tick: number, pitch: number, dx = 2): Point {
  const r = sheet().getBoundingClientRect();
  return { x: Math.round(r.left) + tickX(tick, B) + dx, y: Math.round(r.top) + noteY(pitch) + 6 };
}

/** A point on the velocity lane at a tick, `y` pixels from its top. */
function vel(tick: number, y: number): Point {
  const r = host.querySelector('.h-roll-vel-box')!.getBoundingClientRect();
  return { x: Math.round(r.left) + tickX(tick, B) + 2, y: Math.round(r.top) + y };
}

async function drag(from: Point, ...path: Point[]) {
  await userEvent.pointer([
    { coords: from }, { keys: '[MouseLeft>]' }, ...path.map((coords) => ({ coords })), { keys: '[/MouseLeft]' },
  ]);
}

const click = (p: Point) => drag(p);

async function rightDrag(from: Point, ...path: Point[]) {
  await userEvent.pointer([
    { coords: from }, { keys: '[MouseRight>]' }, ...path.map((coords) => ({ coords })), { keys: '[/MouseRight]' },
  ]);
}

/** With a key held down. */
async function holding(key: string, run: () => Promise<void>) {
  await userEvent.keyboard(`{${key}>}`);
  await run();
  await userEvent.keyboard(`{/${key}}`);
}

/** A row of the block set to these notes, before the roll is opened. */
function setRow(row: number, notes: Note[]) {
  flushSync(() => openProject({
    ...state().project,
    patterns: state().project.patterns.map((p) =>
      p.id === state().patternId ? { ...p, notes: { ...p.notes, [channelId(row)]: notes } } : p),
  }, null));
}

const note = (id: string, start: number, len: number, pitch: number, v = 0.8): Note =>
  ({ id, start, len, note: pitch, vel: v });

async function openRow(row: number) {
  await click(centre(host.querySelectorAll('.h-track-head')[row].querySelector('button')!));
}

async function chooseSnap(label: string) {
  await click(centre(host.querySelector('.h-roll-bar .h-select')!));
  await click(centre([...document.querySelectorAll('.h-select-option')].find((o) => o.textContent === label)!));
}

test('a row opens in the roll from its header or a double-click on a chord, and Grid or Esc go back', async () => {
  await openRow(KALIMBA);
  expect(roll()).not.toBeNull();
  expect(lanes()).toHaveLength(0);
  expect(state().channelId).toBe(channelId(KALIMBA));
  expect(host.querySelectorAll('.h-roll-note')).toHaveLength(12);
  expect(host.querySelector('.h-roll-mini.is-active')!.textContent).toBe('Kalimba');
  expect(which()).toBe('No note selected');
  // The roll opens on the row's notes: the lowest and highest are both in view.
  const view = scroller().getBoundingClientRect();
  for (const pitch of [70, 82]) {
    const y = at(0, pitch).y;
    expect(y).toBeGreaterThan(host.querySelector('.h-roll-head')!.getBoundingClientRect().bottom);
    expect(y).toBeLessThan(view.bottom - 60);
  }

  await click(centre(host.querySelectorAll('.h-roll-mini')[SUB]));
  expect(state().channelId).toBe(channelId(SUB));
  expect(host.querySelectorAll('.h-roll-note')).toHaveLength(8);
  await click(centre(rollButton('Grid')));
  expect(roll()).toBeNull();
  expect(lanes()).toHaveLength(8);

  setRow(KALIMBA, [note('c', 0, 24, 60), note('e', 0, 24, 64), note('g', 0, 24, 67), note('late', 52, 12, 70)]);
  const key = (i: number) => lanes()[KALIMBA].querySelectorAll('.h-track-step')[i];
  await userEvent.dblClick(key(0));
  expect(roll()).not.toBeNull();
  expect(selected()).toEqual(['c', 'e', 'g']);
  expect(which()).toBe('3 notes of Kalimba');
  await userEvent.keyboard('{Escape}');
  expect(selected()).toEqual([]);
  expect(roll()).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(roll()).toBeNull();
  await userEvent.dblClick(key(1));
  expect(selected()).toEqual(['late']);
  // Opening a project goes back to the grid.
  flushSync(() => openProject(loopProject(), null));
  expect(roll()).toBeNull();
});

test('a click on empty space adds a note on the snap, plays it, selects it, and a drag sets its length', async () => {
  setRow(KALIMBA, []);
  await openRow(KALIMBA);
  const past = state().past.length;
  await click(at(30, 60));
  expect(plain(KALIMBA)).toEqual([[24, 24, 60]]);
  expect(tap).toHaveBeenCalledWith(channelId(KALIMBA), 60, 0.8);
  expect(selected()).toEqual(idsAt(KALIMBA, 24));
  expect(state().past.length).toBe(past + 1);

  await userEvent.pointer([
    { coords: at(96, 62) }, { keys: '[MouseLeft>]' }, { coords: at(120, 62) }, { coords: at(150, 62) },
  ]);
  expect(hint()).toBe('D3 at 1.2.1, 3 steps');
  await userEvent.pointer({ keys: '[/MouseLeft]' });
  expect(plain(KALIMBA)).toContainEqual([96, 72, 62]);
  expect(state().past.length).toBe(past + 2);

  // The next note gets the length last drawn, and a second note on the same start makes a chord.
  await click(at(200, 64));
  await click(at(200, 67));
  expect(plain(KALIMBA).filter(([start]) => start === 192)).toEqual([[192, 72, 64], [192, 72, 67]]);
  undo();
  expect(plain(KALIMBA).filter(([start]) => start === 192)).toEqual([[192, 72, 64]]);
});

test('dragging a note moves it in time and pitch, its edges change its start or end, each in one undo step', async () => {
  setRow(KALIMBA, [note('x', 48, 24, 64)]);
  await openRow(KALIMBA);
  const past = state().past.length;
  await drag(at(52, 64), at(80, 65), at(102, 66));
  expect(plain(KALIMBA)).toEqual([[96, 24, 66]]);
  expect(vi.mocked(tap).mock.calls.map((c) => c[1])).toEqual([64, 65, 66]);
  expect(state().past.length).toBe(past + 1);
  undo();
  expect(plain(KALIMBA)).toEqual([[48, 24, 64]]);

  // The right edge goes to the nearest grid line, the left edge moves the start and keeps the end.
  await drag(at(70, 64, 0), at(120, 64, 0));
  expect(plain(KALIMBA)).toEqual([[48, 72, 64]]);
  await drag(at(48, 64, 1), at(25, 64, 0));
  expect(plain(KALIMBA)).toEqual([[24, 96, 64]]);
  expect(state().past.length).toBe(past + 2);

  // A note dragged onto another note's start and pitch stays where it was.
  setRow(KALIMBA, [note('x', 48, 24, 64), note('y', 96, 24, 64)]);
  await openRow(KALIMBA);
  await drag(at(52, 64), at(100, 64));
  expect(plain(KALIMBA)).toEqual([[48, 24, 64], [96, 24, 64]]);
  expect(hint()).toBe('A note is already there, so nothing moved.');
});

test('click, Shift-click, rubber bands and select all choose notes; moving and Delete act on the selection', async () => {
  setRow(KALIMBA, [note('a', 0, 24, 60), note('b', 48, 24, 62), note('c', 96, 24, 64), note('d', 144, 24, 65)]);
  await openRow(KALIMBA);
  await click(at(0, 60, 8));
  expect(selected()).toEqual(['a']);
  await holding('Shift', () => click(at(96, 64, 8)));
  expect(selected()).toEqual(['a', 'c']);
  await holding('Shift', () => click(at(0, 60, 8)));
  expect(selected()).toEqual(['c']);
  await holding('Shift', () => drag(at(30, 66), at(110, 61)));
  expect(selected()).toEqual(['b', 'c']);
  expect(host.querySelectorAll('.h-roll-note.is-selected')).toHaveLength(2);

  const before = structuredClone(notesOf(KALIMBA));
  await rightDrag(at(10, 59), at(60, 63));
  expect(selected()).toEqual(['a', 'b']);
  await rightDrag(at(144, 65, 8));
  expect(selected()).toEqual(['d']);
  await rightDrag(at(200, 65, 8));
  expect(selected()).toEqual([]);
  expect(notesOf(KALIMBA)).toEqual(before);

  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}`);
  expect(selected()).toEqual(['a', 'b', 'c', 'd']);
  // A click on one of several selected notes without moving it selects just that one; a drag moves them all.
  await drag(at(48, 62, 8), at(48 + 24, 63, 8));
  expect(plain(KALIMBA)).toEqual([[24, 24, 61], [72, 24, 63], [120, 24, 65], [168, 24, 66]]);
  await click(at(72, 63, 8));
  expect(selected()).toEqual(['b']);
  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}{Delete}`);
  expect(notesOf(KALIMBA)).toEqual([]);
  undo();
  expect(notesOf(KALIMBA)).toHaveLength(4);
});

test('the snap places notes on sixteenths, thirty-seconds, triplets or anywhere, and Alt skips it', async () => {
  setRow(KALIMBA, []);
  await openRow(KALIMBA);
  expect(sheet().style.backgroundImage).not.toContain('--face-hi');
  const startAt = async (pitch: number) => {
    await click(at(40, pitch));
    return notesOf(KALIMBA).find((n) => n.note === pitch)!.start;
  };
  expect(await startAt(60)).toBe(24);
  await chooseSnap('1/32');
  expect(useRoll.getState().snap).toBe(12);
  expect(sheet().style.backgroundImage).toContain('--face-hi');
  expect(await startAt(61)).toBe(36);
  await chooseSnap('1/16 triplet');
  expect(await startAt(62)).toBe(32);
  await chooseSnap('1/8 triplet');
  expect(await startAt(63)).toBe(32);
  await chooseSnap('Off');
  expect(await startAt(64)).toBe(42);
  expect(sheet().style.backgroundImage).not.toContain('--face-hi');

  await chooseSnap('1/16');
  await holding('Alt', async () => {
    await click(at(40, 65));
  });
  expect(notesOf(KALIMBA).find((n) => n.note === 65)!.start).toBe(42);
  // Alt while moving: the note goes by single ticks.
  await holding('Alt', () => drag(at(48, 65, 4), at(53, 65, 4)));
  expect(notesOf(KALIMBA).find((n) => n.note === 65)!.start).toBe(47);
});

test('arrow keys nudge the selection by the snap or a bar, a semitone or an octave, inside the block', async () => {
  setRow(KALIMBA, [note('a', 0, 24, 60), note('b', 30, 24, 64)]);
  await openRow(KALIMBA);
  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}`);
  await userEvent.keyboard('{ArrowRight}');
  expect(plain(KALIMBA)).toEqual([[24, 24, 60], [54, 24, 64]]);
  await userEvent.keyboard('{ArrowUp}');
  expect(plain(KALIMBA).map((n) => n[2])).toEqual([61, 65]);
  expect(tap).toHaveBeenLastCalledWith(channelId(KALIMBA), 61, 0.8);
  await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(plain(KALIMBA).map((n) => n[2])).toEqual([49, 53]);
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
  expect(plain(KALIMBA).map((n) => n[0])).toEqual([408, 438]);
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
  expect(plain(KALIMBA).map((n) => n[0] + n[1])).toEqual([BLOCK - 30, BLOCK]);
  useRoll.setState({ snap: 12 });
  await userEvent.keyboard('{ArrowLeft}');
  expect(plain(KALIMBA).map((n) => n[0])).toEqual([702, 732]);
  // With the roll closed the arrows go back to the grid's step.
  await userEvent.keyboard('{Escape}{Escape}');
  expect(roll()).toBeNull();
  await userEvent.keyboard('{ArrowLeft}');
  expect(plain(KALIMBA).map((n) => n[0])).toEqual([702, 732]);
});

test('copy and paste put notes at the paste mark, cut takes them out, and repeat lays copies end to end', async () => {
  setRow(KALIMBA, [note('a', 0, 24, 60), note('b', 30, 12, 64)]);
  await openRow(KALIMBA);
  const mark = () => host.querySelector('.h-roll-bar .h-track-used')!.textContent;
  await userEvent.keyboard(`{${MOD}>}ac{/${MOD}}`);
  expect(mark()).toBe('Paste at 1.1.3');
  const past = state().past.length;
  await userEvent.keyboard(`{${MOD}>}v{/${MOD}}`);
  expect(plain(KALIMBA)).toEqual([[0, 24, 60], [30, 12, 64], [48, 24, 60], [78, 12, 64]]);
  expect(selected()).toEqual(idsAt(KALIMBA, 48, 78).sort());
  expect(state().past.length).toBe(past + 1);
  await userEvent.keyboard(`{${MOD}>}v{/${MOD}}`);
  expect(plain(KALIMBA).map((n) => n[0])).toEqual([0, 30, 48, 78, 96, 126]);

  // A click on the ruler moves the mark; Paste goes there.
  const ruler = host.querySelector('.h-roll-head .h-track-ticks .h-track-box')!.getBoundingClientRect();
  await click({ x: Math.round(ruler.left) + tickX(384, B) + 5, y: Math.round(ruler.top) + 8 });
  expect(mark()).toBe('Paste at 2.1.1');
  await userEvent.keyboard(`{${MOD}>}v{/${MOD}}`);
  expect(plain(KALIMBA).slice(-2)).toEqual([[384, 24, 60], [414, 12, 64]]);
  await userEvent.keyboard(`{${MOD}>}x{/${MOD}}`);
  expect(plain(KALIMBA).map((n) => n[0])).toEqual([0, 30, 48, 78, 96, 126]);
  await userEvent.keyboard(`{${MOD}>}v{/${MOD}}`);
  expect(plain(KALIMBA).slice(-2).map((n) => n[0])).toEqual([432, 462]);
  // Notes that would land past the end of the block are left out.
  await click({ x: Math.round(ruler.left) + tickX(BLOCK - 24, B) + 5, y: Math.round(ruler.top) + 8 });
  await userEvent.keyboard(`{${MOD}>}v{/${MOD}}`);
  expect(plain(KALIMBA).slice(-1)).toEqual([[BLOCK - 24, 24, 60]]);
  undo();

  setRow(KALIMBA, [note('c', 0, 24, 60), note('e', 0, 18, 64)]);
  await openRow(KALIMBA);
  await userEvent.keyboard(`{${MOD}>}ad{/${MOD}}`);
  await userEvent.keyboard(`{${MOD}>}d{/${MOD}}`);
  expect(plain(KALIMBA)).toEqual([[0, 24, 60], [0, 18, 64], [24, 24, 60], [24, 18, 64], [48, 24, 60], [48, 18, 64]]);
  undo();
  expect(plain(KALIMBA)).toHaveLength(4);
  redo();
});

test('the velocity lane sets a chord together, or only its selected notes, and paints across bars', async () => {
  setRow(KALIMBA, [note('c', 0, 24, 60), note('e', 0, 24, 64, 0.6), note('x', 48, 24, 62, 0.5)]);
  await openRow(KALIMBA);
  const vels = () => notesOf(KALIMBA).map((n) => n.vel);
  expect(host.querySelectorAll('.h-roll-vel')).toHaveLength(3);
  const past = state().past.length;
  await drag(vel(0, 30), vel(0, 4));
  expect(vels()).toEqual([1, 1, 0.5]);
  expect(state().past.length).toBe(past + 1);
  await click(at(0, 64, 8));
  await drag(vel(0, 32));
  expect(vels()).toEqual([1, 0.2, 0.5]);
  await drag(vel(0, 39), vel(24, 39), vel(48, 39));
  expect(vels()).toEqual([1, 0, 0]);
  expect(state().past.length).toBe(past + 3);
  undo();
  expect(vels()).toEqual([1, 0.2, 0.5]);
});

test('the inspector shows and edits one selected note or several together', async () => {
  setRow(KALIMBA, [note('a', 0, 24, 60), note('b', 30, 12, 64, 0.5)]);
  await openRow(KALIMBA);
  const spin = (field: number, dir: 'up' | 'down') => centre(steppers()[field].querySelector(`.h-spin.is-${dir}`)!);
  expect(steppers()[0].getAttribute('aria-disabled')).toBe('true');
  expect(host.querySelector('.h-track-help')!.textContent).toContain(modKey('V'));

  await click(at(30, 64, 4));
  expect(which()).toBe('E3 of Kalimba');
  expect(steppers().map((s) => s.getAttribute('aria-valuetext'))).toEqual(['E3', '0.5', '1.1.2+6']);
  expect(host.querySelector('.h-track-value')!.textContent).toBe('50 %');
  await click(spin(1, 'up'));
  expect(plain(KALIMBA)[1]).toEqual([30, 36, 64]);
  await click(spin(2, 'up'));
  expect(plain(KALIMBA)[1]).toEqual([54, 36, 64]);

  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}`);
  expect(which()).toBe('2 notes of Kalimba');
  await click(spin(0, 'up'));
  expect(plain(KALIMBA).map((n) => n[2])).toEqual([61, 65]);
  host.querySelector<HTMLElement>('.h-track-inspector [role="slider"]')!.focus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(notesOf(KALIMBA).map((n) => n.vel)).toEqual([0.78, 0.78]);
  await click(spin(2, 'up'));
  expect(plain(KALIMBA).map((n) => n[0])).toEqual([24, 78]);

  // Typed values: a length in steps (following a 1/32 snap) and a start as bar.beat.sixteenth.
  useRoll.setState({ snap: 12 });
  await userEvent.dblClick(steppers()[1].querySelector('.h-stepper-readout')!);
  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}1.5{Enter}`);
  expect(plain(KALIMBA).map((n) => n[1])).toEqual([36, 48]);
  await userEvent.dblClick(steppers()[2].querySelector('.h-stepper-readout')!);
  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}1.2.1{Enter}`);
  expect(plain(KALIMBA).map((n) => n[0])).toEqual([96, 150]);
});

test('the roll and the grid show the same notes, whichever edits them', async () => {
  setRow(KALIMBA, []);
  await click(centre(cell(KALIMBA, 3)));
  await openRow(KALIMBA);
  expect(host.querySelectorAll('.h-roll-note')).toHaveLength(1);
  const key = host.querySelector('.h-roll-note')!.getBoundingClientRect();
  expect(Math.round(key.left - sheet().getBoundingClientRect().left)).toBe(cellX(3, B));
  await click(at(4 * 24 + 12, 64));
  expect(host.querySelector('.h-roll-mini.is-active')!.querySelectorAll('.h-roll-mini-note')).toHaveLength(2);
  await click(centre(rollButton('Grid')));
  const steps = lanes()[KALIMBA].querySelectorAll('.h-track-step');
  expect(steps).toHaveLength(2);
  expect(steps[1].getBoundingClientRect().left).toBe(cell(KALIMBA, 4).getBoundingClientRect().left);
  expect(steps[1].textContent).toBe('E3');
});

test('notes cannot leave the block, and a note drawn at its end is cut there', async () => {
  setRow(KALIMBA, [note('a', BLOCK - 48, 24, 60)]);
  await openRow(KALIMBA);
  scroller().scrollLeft = scroller().scrollWidth;
  await new Promise(requestAnimationFrame);
  await drag(at(BLOCK - 48, 60, 8), at(BLOCK - 1, 60, 0));
  expect(plain(KALIMBA)).toEqual([[BLOCK - 24, 24, 60]]);
  await drag(at(BLOCK - 1, 60, 0), at(BLOCK - 1, 60, 30));
  expect(plain(KALIMBA)).toEqual([[BLOCK - 24, 24, 60]]);
  useRoll.setState({ length: 96 });
  await click(at(BLOCK - 24, 62));
  expect(plain(KALIMBA)).toContainEqual([BLOCK - 24, 24, 62]);
  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}{ArrowRight}`);
  expect(plain(KALIMBA).map((n) => n[0] + n[1])).toEqual([BLOCK, BLOCK]);
});

test('the play position runs through the roll as a column under the marker', async () => {
  await openRow(KALIMBA);
  const now = host.querySelector<HTMLElement>('.h-roll-now')!;
  expect(getComputedStyle(now).display).toBe('none');
  vi.mocked(position).mockReturnValue(5.6);
  flushSync(() => setPlaying(true));
  await expect.poll(() => getComputedStyle(now).display).toBe('block');
  expect(Math.round(now.getBoundingClientRect().left - sheet().getBoundingClientRect().left)).toBe(cellX(5, B));
  expect(host.querySelector('.h-roll .h-track-marker')!.getBoundingClientRect().left)
    .toBe(now.getBoundingClientRect().left);
});

test('a block of 32 bars with 300 notes opens, scrolls and edits quickly', async () => {
  flushSync(() => setPatternBars(pattern().id, 32));
  const notes = Array.from({ length: 300 }, (_, i) =>
    note(`n${i}`, i * 40 + (i % 3) * 5, 30 + (i % 4) * 20, 48 + ((i * 7) % 36)));
  setRow(KALIMBA, notes);
  const started = performance.now();
  await openRow(KALIMBA);
  expect(host.querySelectorAll('.h-roll-note')).toHaveLength(300);
  expect(sheet().getBoundingClientRect().width).toBe(laneWidth(512, B));
  scroller().scrollLeft = scroller().scrollWidth;
  scroller().scrollTop = 0;
  await new Promise(requestAnimationFrame);
  await userEvent.keyboard(`{${MOD}>}a{/${MOD}}{ArrowUp}`);
  expect(notesOf(KALIMBA).every((n, i) => n.note === notes[i].note + 1)).toBe(true);
  expect(performance.now() - started).toBeLessThan(3000);
});
