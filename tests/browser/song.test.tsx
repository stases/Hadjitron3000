import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { position } from '../../src/app/audio';
import { addBlock, dropFiles, saveBlockToLibrary } from '../../src/app/commands';
import { closeDialog, useDialogs } from '../../src/app/dialogStore';
import { setPrefs } from '../../src/app/prefs';
import { PATTERN_NAMES } from '../../src/core/defaults';
import type { Placement } from '../../src/core/types';
import { demoProject } from '../../src/presets/projects';
import {
  addPlacement, openProject, resizePlacement, selectPlacement, setPlacementFades, setPlacementMute, setPlaying,
  setScope, setView, undo, useApp,
} from '../../src/state/store';
import { useFolds } from '../../src/ui/factory/levels';
import { SongView } from '../../src/ui/song';
import { SoundsDialog } from '../../src/ui/song/SoundsDialog';

vi.mock('../../src/app/audio', () => ({ position: vi.fn(() => -1) }));
vi.mock('../../src/app/commands', () => ({
  addBlock: vi.fn(),
  saveBlockToLibrary: vi.fn(async () => {}),
  dropFiles: vi.fn(async () => {}),
}));

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  await page.viewport(1400, 800);
  openProject(demoProject(), null);
  setView('song');
  setPrefs({ beginner: true });
  useFolds.setState({}, true);
  closeDialog();
  vi.clearAllMocks();
  vi.mocked(position).mockReturnValue(-1);
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; display: flex; flex-direction: column; width: 1260px; height: 600px';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<SongView />));
  await document.fonts.ready;
});

afterEach(async () => {
  await userEvent.cleanup();
  flushSync(() => setPlaying(false));
  root.unmount();
  host.remove();
});

const state = () => useApp.getState();
const song = () => state().project.song;
const blockId = (name: string) => state().project.patterns.find((p) => p.name === name)!.id;
const current = () => state().project.patterns.find((p) => p.id === state().patternId)!;
/** The demo's placements of a block, in bar order. */
const placed = (name: string) => song().filter((p) => p.pattern === blockId(name)).sort((a, b) => a.bar - b.bar);
const find = (id: string) => song().find((p) => p.id === id)!;
const lanes = () => [...host.querySelectorAll<HTMLElement>('.h-song-lane')];
const cell = (lane: number, bar: number) => lanes()[lane].querySelectorAll<HTMLElement>('.h-song-cell')[bar];
const tile = (placement: Placement) => host.querySelector<HTMLElement>(`.h-song-tile[data-id="${placement.id}"]`)!;
const rows = () => [...host.querySelectorAll<HTMLElement>('.h-song-blocks .h-list-row')];
const row = (name: string) => rows().find((r) => r.querySelector('.h-list-label')!.textContent === name)!;
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.h-menu-item')].find((el) => el.textContent?.includes(label))!;
const rect = (el: Element) => el.getBoundingClientRect();

function centre(el: Element) {
  const r = rect(el);
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

/** Presses the left button at `from`, moves through `path` and releases. */
async function drag(from: { x: number; y: number }, ...path: { x: number; y: number }[]) {
  await userEvent.pointer([
    { coords: from },
    { keys: '[MouseLeft>]' },
    ...path.map((coords) => ({ coords })),
    { keys: '[/MouseLeft]' },
  ]);
}

const click = (el: Element) => drag(centre(el));
const rightClick = (el: Element) => userEvent.pointer({ coords: centre(el), keys: '[MouseRight]' });

test('the list shows the blocks and their lengths, selects, and opens one in the Track on double-click', async () => {
  const names = ['Beat', 'Bass', 'Keys', 'Pads', 'Break', 'Bass up', 'Keys up', 'Pads up'];
  expect(rows().map((r) => r.querySelector('.h-list-label')!.textContent)).toEqual(names);
  expect(rows().map((r) => r.querySelector('.h-list-detail')!.textContent)).toEqual(names.map(() => '2'));
  expect(row('Beat').classList.contains('is-selected')).toBe(true);

  await click(row('Keys'));
  expect(state().patternId).toBe(blockId('Keys'));
  expect(row('Keys').classList.contains('is-selected')).toBe(true);

  await userEvent.dblClick(row('Bass up'));
  expect(state().view).toBe('track');
  expect(state().patternId).toBe(blockId('Bass up'));
});

test('the header renames the current block and steps through its colours', async () => {
  const field = host.querySelector<HTMLInputElement>('.h-song-header input')!;
  expect(field.value).toBe('Beat');
  await userEvent.clear(field);
  await userEvent.type(field, 'Big beat');
  expect(current().name).toBe('Big beat');
  expect(field.value).toBe('Big beat');
  await userEvent.keyboard('{Enter}');
  expect(row('Big beat')).toBeDefined();
  expect(tile(placed('Big beat')[0]).querySelector('.h-song-name')!.textContent).toBe('Big beat');

  const swatch = host.querySelector('.h-song-header button')!;
  await click(swatch);
  expect(current().color).toBe(1);
  expect(tile(placed('Big beat')[0]).style.getPropertyValue('--tile')).toBe('var(--c1)');
  for (let i = 0; i < 7; i++) await click(swatch);
  expect(current().color).toBe(0);
});

test('New, Copy, Delete and the library buttons, with their limits', async () => {
  await click(button('New'));
  expect(current().name).toBe('A');
  expect(current().notes).toEqual({});
  await click(row('Beat'));
  await click(button('Copy'));
  expect(current().name).toBe('B');
  expect(current().notes).toEqual(state().project.patterns[0].notes);
  await click(button('Delete'));
  expect(state().project.patterns.map((p) => p.name)).not.toContain('B');

  await click(button('Library...'));
  expect(addBlock).toHaveBeenCalledTimes(1);
  await click(button('Save to Library'));
  expect(saveBlockToLibrary).toHaveBeenCalledWith(state().patternId);

  while (state().project.patterns.length < PATTERN_NAMES.length) await click(button('New'));
  expect(button('New').disabled).toBe(true);
  expect(button('Copy').disabled).toBe(true);
  expect(rows()).toHaveLength(PATTERN_NAMES.length);

  while (state().project.patterns.length > 1) await click(button('Delete'));
  expect(button('Delete').disabled).toBe(true);
  expect(button('New').disabled).toBe(false);
  expect(song().every((p) => p.pattern === state().project.patterns[0].id)).toBe(true);
  expect(host.querySelectorAll('.h-song-tile')).toHaveLength(song().length);
});

test('tiles sit on their lane and bars, show their block, and mark its repeats', () => {
  expect(lanes()).toHaveLength(4);
  expect(host.querySelectorAll('.h-song-tile')).toHaveLength(song().length);
  for (const placement of song()) {
    const el = tile(placement);
    expect(el.closest('.h-song-lane')).toBe(lanes()[placement.lane]);
    expect(rect(el).left).toBe(rect(cell(placement.lane, placement.bar)).left);
    expect(rect(el).right).toBe(rect(cell(placement.lane, placement.bar + placement.bars - 1)).right);
    expect(rect(el).top).toBe(rect(cell(placement.lane, placement.bar)).top);
  }
  // Pads is two bars long and placed for eight: it starts again three times.
  const pads = tile(placed('Pads')[0]);
  expect(pads.querySelector('.h-song-name')!.textContent).toBe('Pads');
  expect(pads.querySelectorAll('.h-song-notch')).toHaveLength(3);

  // The miniature of Pads has one row per pad sound: ink where the notes are, nothing in between.
  const mini = pads.querySelector<HTMLCanvasElement>('.h-song-mini')!;
  const pixels = mini.getContext('2d')!.getImageData(0, 0, mini.width, mini.height).data;
  const inked = (x: number) =>
    Array.from({ length: mini.height }, (_, y) => pixels[(y * mini.width + x) * 4 + 3] > 0).filter(Boolean).length;
  expect(inked(0)).toBe(6);
  expect(inked(28)).toBe(0);
  expect(inked(30)).toBe(6);

  // Tiles of the block being edited stand out a little.
  expect(tile(placed('Beat')[0]).classList.contains('is-current')).toBe(true);
  expect(tile(placed('Bass')[0]).classList.contains('is-current')).toBe(false);
});

test('a click on an empty bar places the current block; a click on a tile only selects it', async () => {
  await click(row('Break'));
  const before = song().length;
  await click(cell(0, 0));
  expect(song()).toHaveLength(before + 1);
  const added = find(state().placementId!);
  expect(added).toMatchObject({ pattern: blockId('Break'), lane: 0, bar: 0, bars: 2 });
  expect(tile(added).classList.contains('is-selected')).toBe(true);

  await click(cell(0, 1));
  expect(song()).toHaveLength(before + 1);
  expect(state().placementId).toBe(added.id);

  const pads = placed('Pads')[0];
  await click(tile(pads));
  expect(song()).toHaveLength(before + 1);
  expect(state().placementId).toBe(pads.id);
  expect(state().patternId).toBe(blockId('Pads'));
  expect(tile(pads).classList.contains('is-selected')).toBe(true);
});

test('dragging a tile moves it by bars and lanes as one undo step, and stops where it cannot go', async () => {
  const beat = placed('Beat')[1];
  const past = state().past.length;
  const from = centre(tile(beat));
  const lane1 = centre(lanes()[1]).y;
  // Each move lands a second after the last, as when the drag pauses: still one undo step.
  let time = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => (time += 1000));
  await drag(from, { x: from.x + 40, y: from.y }, { x: from.x + 185, y: from.y }, { x: from.x + 185, y: lane1 });
  clock.mockRestore();
  expect(find(beat.id)).toMatchObject({ lane: 1, bar: 19, bars: 4 });
  expect(state().past.length).toBe(past + 1);
  undo();
  expect(find(beat.id)).toMatchObject({ lane: 0, bar: 12 });

  // Lane 1 is taken from bar 4 on, so the tile stays at the last place it fitted.
  const first = placed('Beat')[0];
  const start = centre(tile(first));
  await drag(start, { x: start.x - 30, y: start.y }, { x: start.x - 30, y: lane1 }, { x: start.x - 32, y: lane1 + 4 });
  expect(find(first.id)).toMatchObject({ lane: 0, bar: 3 });
});

test('dragging the right edge changes the length in whole bars, up to the next tile and down to one bar', async () => {
  const beat = placed('Beat')[0];
  const edge = () => {
    const r = rect(tile(find(beat.id)));
    return { x: Math.round(r.right) - 2, y: Math.round(r.top + r.height / 2) };
  };
  expect(getComputedStyle(tile(beat).querySelector('.h-song-edge')!).cursor).toBe('ew-resize');
  await drag(edge(), { x: edge().x - 60, y: edge().y });
  expect(find(beat.id).bars).toBe(2);
  await drag(edge(), { x: edge().x + 200, y: edge().y });
  expect(find(beat.id).bars).toBe(4);
  await drag(edge(), { x: edge().x - 300, y: edge().y });
  expect(find(beat.id).bars).toBe(1);

  const last = placed('Beat')[1];
  const r = rect(tile(last));
  const y = Math.round(r.top + 20);
  await drag({ x: Math.round(r.right) - 2, y }, { x: Math.round(r.right) + 150, y });
  expect(find(last.id).bars).toBe(9);
  expect(rect(tile(find(last.id))).right).toBe(rect(cell(0, 20)).right);
});

test('double-clicking a tile opens its block in the Track; double-clicking an empty bar only places', async () => {
  await userEvent.dblClick(cell(2, 0));
  expect(state().view).toBe('song');
  expect(song().some((p) => p.lane === 2 && p.bar === 0)).toBe(true);

  await userEvent.dblClick(tile(placed('Keys up')[0]));
  expect(state().view).toBe('track');
  expect(state().patternId).toBe(blockId('Keys up'));
});

test('the context menu of a tile edits, duplicates and removes it', async () => {
  const last = placed('Beat')[1];
  await rightClick(tile(last));
  expect(state().placementId).toBe(last.id);
  const labels = [...document.querySelectorAll('.h-menu-item')].map((el) => el.textContent);
  expect(labels).toEqual(['Edit in Track', 'Sounds...', 'Duplicate', 'Remove']);
  const past = state().past.length;
  await click(menuItem('Duplicate'));
  const copy = find(state().placementId!);
  expect(copy).toMatchObject({ pattern: last.pattern, lane: 0, bar: 16, bars: 4 });
  expect(state().past.length).toBe(past + 1);
  undo();
  expect(song().some((p) => p.id === copy.id)).toBe(false);
  await rightClick(tile(last));
  await click(menuItem('Duplicate'));

  // The first Beat runs into Break, so there is no room for a copy.
  const first = placed('Beat')[0];
  await rightClick(tile(first));
  expect(menuItem('Duplicate').getAttribute('aria-disabled')).toBe('true');
  await click(menuItem('Remove'));
  expect(song().some((p) => p.id === first.id)).toBe(false);

  await rightClick(tile(placed('Pads up')[0]));
  await click(menuItem('Edit in Track'));
  expect(state().view).toBe('track');
  expect(state().patternId).toBe(blockId('Pads up'));
});

test('with the keyboard, arrows move the selected tile, Delete and Backspace remove it, Escape lets go', async () => {
  const beat = placed('Beat')[1];
  await click(tile(beat));
  const scroller = host.querySelector('.h-song-scroll')!;
  expect(document.activeElement).toBe(scroller);
  await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}');
  expect(find(beat.id)).toMatchObject({ lane: 0, bar: 13 });
  await userEvent.keyboard('{ArrowDown}');
  expect(find(beat.id)).toMatchObject({ lane: 0, bar: 13 });
  await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowDown}{ArrowDown}');
  expect(find(beat.id)).toMatchObject({ lane: 2, bar: 16 });
  await userEvent.keyboard('{ArrowUp}');
  expect(find(beat.id)).toMatchObject({ lane: 1, bar: 16 });

  await userEvent.keyboard('{Escape}');
  expect(state().placementId).toBeNull();
  await userEvent.keyboard('{Delete}');
  expect(song().some((p) => p.id === beat.id)).toBe(true);

  await click(tile(find(beat.id)));
  await userEvent.keyboard('{Delete}');
  expect(song().some((p) => p.id === beat.id)).toBe(false);
  const pads = placed('Pads')[0];
  await click(tile(pads));
  await userEvent.keyboard('{Backspace}');
  expect(song().some((p) => p.id === pads.id)).toBe(false);
});

test('the bottom bar shows the selected placement, sets its length and removes it', async () => {
  const which = () => host.querySelector('.h-song-which')!.textContent;
  const stepper = () => host.querySelector('.h-song-bar [role="spinbutton"]')!;
  const spin = (dir: 'up' | 'down') => click(host.querySelector(`.h-song-bar .h-spin.is-${dir}`)!);
  expect(which()).toBe('No block selected on the timeline');
  expect(stepper().getAttribute('aria-disabled')).toBe('true');
  expect(button('Edit in Track').disabled).toBe(true);
  expect(button('Remove').disabled).toBe(true);
  expect(host.querySelector('.h-song-help')).not.toBeNull();

  const pads = placed('Pads')[0];
  flushSync(() => selectPlacement(pads.id));
  expect(which()).toBe('Pads · bars 1 to 8');
  expect(host.querySelector('.h-song-help')).toBeNull();
  await spin('up');
  expect(find(pads.id).bars).toBe(8);
  await spin('down');
  expect(find(pads.id).bars).toBe(7);
  expect(which()).toBe('Pads · bars 1 to 7');
  expect(stepper().getAttribute('aria-valuenow')).toBe('7');

  flushSync(() => resizePlacement(pads.id, 1));
  expect(which()).toBe('Pads · bar 1');
  await click(button('Remove'));
  expect(song().some((p) => p.id === pads.id)).toBe(false);
  expect(which()).toBe('No block selected on the timeline');

  flushSync(() => selectPlacement(placed('Keys')[0].id));
  await click(button('Edit in Track'));
  expect(state().view).toBe('track');
  expect(state().patternId).toBe(blockId('Keys'));
});

test('the play marker follows the song in song scope and is gone while a block plays', async () => {
  const scroller = host.querySelector<HTMLElement>('.h-song-scroll')!;
  const marker = host.querySelector<HTMLElement>('.h-song-marker')!;
  const line = lanes()[1].querySelector<HTMLElement>('.h-song-now')!;
  expect(getComputedStyle(marker).display).toBe('none');

  // Step 88 is half way through bar 6; the line glides by whole pixels, 30 to a bar.
  vi.mocked(position).mockReturnValue(88.3);
  flushSync(() => setPlaying(true));
  await expect.poll(() => getComputedStyle(line).display).toBe('block');
  expect(rect(line).left).toBe(rect(cell(1, 5)).left + 15);
  expect(rect(line).height).toBe(rect(cell(1, 5)).height);
  const middle = rect(marker).left + rect(marker).width / 2;
  expect(Math.abs(middle - (rect(line).left + 1))).toBeLessThanOrEqual(1);

  // The song is sixteen bars and loops.
  vi.mocked(position).mockReturnValue(16 * 16 * 3 + 16);
  await expect.poll(() => rect(line).left).toBe(rect(cell(1, 1)).left);

  flushSync(() => setScope('pattern'));
  await expect.poll(() => scroller.dataset.now).toBeUndefined();
  expect(getComputedStyle(marker).display).toBe('none');
  expect(getComputedStyle(line).display).toBe('none');
});

test('a long song turns the page to follow the play position', async () => {
  const id = addPlacement(blockId('Beat'), 0, 100)!;
  flushSync(() => resizePlacement(id, 20));
  const scroller = host.querySelector<HTMLElement>('.h-song-scroll')!;
  expect(scroller.scrollLeft).toBe(0);
  vi.mocked(position).mockReturnValue(16 * 60 + 4);
  flushSync(() => setPlaying(true));
  await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(0);
  const line = lanes()[0].querySelector<HTMLElement>('.h-song-now')!;
  const head = rect(host.querySelector('.h-song-head')!).right;
  expect(rect(line).left).toBeGreaterThanOrEqual(head);
  expect(rect(line).right).toBeLessThanOrEqual(rect(scroller).right);
  expect(rect(cell(0, 60)).left - head).toBe(4);
});

test('the timeline runs on past the end of the song but not past the longest song', () => {
  const cells = () => lanes()[0].querySelectorAll('.h-song-cell').length;
  expect(cells()).toBeGreaterThanOrEqual(32);
  const id = addPlacement(blockId('Beat'), 0, 240)!;
  flushSync(() => resizePlacement(id, 16));
  expect(cells()).toBe(256);
});

test('an empty song says how to start, and files dropped on the view go to the shell', async () => {
  flushSync(() => openProject({ ...demoProject(), song: [] }, null));
  expect(host.querySelectorAll('.h-song-tile')).toHaveLength(0);
  expect(host.querySelector('.h-song-empty')!.textContent).toContain('click a bar');
  await click(cell(1, 3));
  expect(song()).toHaveLength(1);
  expect(host.querySelector('.h-song-empty')).toBeNull();

  const file = new File(['RIFF'], 'loop.wav', { type: 'audio/wav' });
  const data = new DataTransfer();
  data.items.add(file);
  cell(2, 2).dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  expect(dropFiles).toHaveBeenCalledWith([file]);
});

/** The bar under the timeline: its steppers by label, and whether a control is on screen. */
const bar = () => host.querySelector<HTMLElement>('.h-song-bar')!;
const stepperAfter = (label: string) =>
  [...bar().querySelectorAll('.h-song-label')].find((l) => l.textContent === label)?.nextElementSibling as HTMLElement;
const spin = (label: string, dir: 'up' | 'down') => click(stepperAfter(label).querySelector(`.h-spin.is-${dir}`)!);
const toggle = () => [...bar().querySelectorAll<HTMLButtonElement>('.h-folds button')].find((b) =>
  b.textContent === 'Shaping');
const handles = (placement: Placement) => tile(placement).querySelectorAll('.h-song-fade');

test('each lane head mutes its lane and sets its level, each one undo step', async () => {
  const head = lanes()[1].previousElementSibling as HTMLElement;
  expect(head.querySelector('.h-song-number')!.textContent).toBe('2');
  const mute = [...head.querySelectorAll('button')].find((b) => b.textContent === 'M')!;
  await click(mute);
  expect(state().project.lanes[1]).toEqual({ level: 0, mute: true });
  expect(mute.getAttribute('aria-pressed')).toBe('true');
  const slider = head.querySelector<HTMLElement>('[role="slider"]')!;
  const r = rect(slider);
  const y = Math.round(r.top + r.height / 2);
  await drag({ x: Math.round(r.right) - 3, y }, { x: Math.round(r.left), y });
  expect(state().project.lanes[1]).toEqual({ level: -48, mute: true });
  const past = state().past.length;
  undo();
  expect(state().project.lanes[1]).toEqual({ level: 0, mute: true });
  expect(state().past.length).toBe(past - 1);
  flushSync(() => undo());
  expect(state().project.lanes[1].mute).toBe(false);
  expect(mute.getAttribute('aria-pressed')).toBe('false');
  // The other lanes are untouched, and the lane heads keep their place when the timeline scrolls.
  expect(state().project.lanes.filter((l) => l.level === 0 && !l.mute)).toHaveLength(4);
  expect(getComputedStyle(head).position).toBe('sticky');
});

test('in pro mode the bar shows the fades, kept inside the tile, and the Sounds button', async () => {
  flushSync(() => setPrefs({ beginner: false }));
  expect(toggle()).toBeUndefined();
  expect(stepperAfter('Fade in').getAttribute('aria-disabled')).toBe('true');
  expect(button('Sounds...').disabled).toBe(true);
  const pads = placed('Pads')[0];
  flushSync(() => selectPlacement(pads.id));
  await spin('Fade in', 'up');
  await spin('Fade in', 'up');
  await spin('Fade out', 'up');
  expect(find(pads.id)).toMatchObject({ fadeIn: 2, fadeOut: 1 });
  expect(stepperAfter('Fade in').getAttribute('aria-valuemax')).toBe('7');
  expect(stepperAfter('Fade out').getAttribute('aria-valuemax')).toBe('6');
  flushSync(() => setPlacementFades(pads.id, 2, 6));
  await spin('Fade in', 'up');
  expect(find(pads.id)).toMatchObject({ fadeIn: 2, fadeOut: 6 });
  await spin('Fade out', 'down');
  await spin('Fade in', 'down');
  await spin('Fade in', 'down');
  expect(find(pads.id)).toMatchObject({ fadeOut: 5 });
  expect(find(pads.id)).not.toHaveProperty('fadeIn');
  await click(button('Sounds...'));
  expect(useDialogs.getState().dialog).toEqual({ kind: 'sounds', placementId: pads.id });
  // Every tile carries its fade handles in pro mode.
  for (const p of song()) expect(handles(p)).toHaveLength(2);
});

test('in beginner mode fades and Sounds wait behind Shaping, whose lamp lights for a fade or a mute', async () => {
  const beat = placed('Beat')[1];
  flushSync(() => selectPlacement(beat.id));
  expect(stepperAfter('Fade in')).toBeUndefined();
  expect(button('Sounds...')).toBeUndefined();
  const lamp = () => toggle()!.querySelector('.h-led')!.classList.contains('is-on');
  expect(lamp()).toBe(false);
  // Without a fade the tiles have no handles until Shaping is open.
  expect(host.querySelectorAll('.h-song-fade')).toHaveLength(0);
  flushSync(() => setPlacementMute(beat.id, state().project.channels[2].id, true));
  expect(lamp()).toBe(true);
  flushSync(() => setPlacementMute(beat.id, state().project.channels[2].id, false));
  flushSync(() => setPlacementFades(placed('Keys')[0].id, 0, 2));
  expect(lamp()).toBe(false);
  expect(handles(placed('Keys')[0])).toHaveLength(2);
  expect(host.querySelectorAll('.h-song-fade')).toHaveLength(2);
  flushSync(() => setPlacementFades(beat.id, 1, 0));
  expect(lamp()).toBe(true);

  await click(toggle()!);
  expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
  expect(stepperAfter('Fade in').getAttribute('aria-valuenow')).toBe('1');
  expect(button('Sounds...').disabled).toBe(false);
  expect(host.querySelectorAll('.h-song-fade')).toHaveLength(2 * song().length);
  await click(toggle()!);
  expect(stepperAfter('Fade in')).toBeUndefined();
});

test('dragging the top corners pulls fades into a tile in whole bars, each drag one undo step', async () => {
  flushSync(() => setPrefs({ beginner: false }));
  const pads = placed('Pads')[0];
  const corner = (side: 'in' | 'out') => centre(tile(find(pads.id)).querySelector(`.h-song-fade.is-${side}`)!);
  expect(getComputedStyle(tile(pads).querySelector('.h-song-fade')!).cursor).toBe('ew-resize');
  const past = state().past.length;
  const start = corner('in');
  await drag(start, { x: start.x + 40, y: start.y + 10 }, { x: start.x + 92, y: start.y + 20 });
  expect(find(pads.id)).toMatchObject({ fadeIn: 3 });
  expect(state().past.length).toBe(past + 1);
  const end = corner('out');
  await drag(end, { x: end.x - 200, y: end.y });
  expect(find(pads.id)).toMatchObject({ fadeIn: 3, fadeOut: 5 });
  // The fade-in stops where the fade-out begins, and back to the corner is no fade at all.
  const now = corner('in');
  await drag(now, { x: now.x + 150, y: now.y });
  expect(find(pads.id).fadeIn).toBe(3);
  await drag(corner('out'), { x: rect(tile(pads)).right + 40, y: end.y });
  expect(find(pads.id)).not.toHaveProperty('fadeOut');
  expect(state().placementId).toBe(pads.id);
  undo();
  expect(find(pads.id)).toMatchObject({ fadeIn: 3, fadeOut: 5 });
  undo();
  undo();
  expect(find(pads.id)).not.toHaveProperty('fadeIn');
});

test('dragging the edge keeps the fades inside the tile and gives them back when it grows again', async () => {
  flushSync(() => setPrefs({ beginner: false }));
  const pads = placed('Pads')[0];
  flushSync(() => setPlacementFades(pads.id, 3, 4));
  const r = rect(tile(pads));
  const y = Math.round(r.top + r.height / 2);
  const x = Math.round(r.right) - 2;
  await drag({ x, y }, { x: x - 150, y }, { x: x - 210, y }, { x, y });
  expect(find(pads.id)).toMatchObject({ bars: 8, fadeIn: 3, fadeOut: 4 });
  await drag({ x, y }, { x: x - 150, y });
  expect(find(pads.id)).toMatchObject({ bars: 3, fadeIn: 3 });
  expect(find(pads.id)).not.toHaveProperty('fadeOut');
});

test('a tile draws its fades as ramps and the sounds it mutes dimmed; its menu opens Sounds', async () => {
  const pads = placed('Pads')[0];
  const fades = () => tile(find(pads.id)).querySelector<HTMLCanvasElement>('.h-song-fades')!;
  const inked = (canvas: HTMLCanvasElement, x: number) => {
    const data = canvas.getContext('2d')!.getImageData(x, 0, 1, canvas.height).data;
    return Array.from({ length: canvas.height }, (_, y) => data[y * 4 + 3] > 0);
  };
  expect(inked(fades(), 0).some(Boolean)).toBe(false);
  flushSync(() => setPlacementFades(pads.id, 4, 2));
  // Near the start of the fade-in the ink is dithered from the top almost to the bottom, then the line.
  const first = inked(fades(), 1);
  expect(first.filter(Boolean).length).toBeGreaterThan(20);
  expect(first.slice(0, 20).filter(Boolean).length).toBe(10);
  // Past the fade-in the colour is clear; at the end of the fade-out the curve is back at the bottom.
  expect(inked(fades(), 4 * 30 + 10).some(Boolean)).toBe(false);
  expect(inked(fades(), fades().width - 1).at(-1)).toBe(true);

  const keys = placed('Keys')[0];
  const mini = () => tile(find(keys.id)).querySelector<HTMLCanvasElement>('.h-song-mini')!;
  const pixels = () => mini().getContext('2d')!.getImageData(0, 0, mini().width, mini().height).data;
  const before = pixels().filter((_, i) => i % 4 === 3 && _ > 0).length;
  const kalimba = state().project.channels.find((c) => state().project.patterns.find((p) => p.id === keys.pattern)!
    .notes[c.id]?.length)!;
  flushSync(() => setPlacementMute(keys.id, kalimba.id, true));
  const after = pixels().filter((_, i) => i % 4 === 3 && _ > 0).length;
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);

  await rightClick(tile(placed('Pads')[1]));
  await click(menuItem('Sounds...'));
  expect(useDialogs.getState().dialog).toEqual({ kind: 'sounds', placementId: placed('Pads')[1].id });
});

test('the Sounds checklist lists the sounds of the block and silences one in this tile only', async () => {
  const beat = placed('Beat')[1];
  const dialogHost = document.createElement('div');
  document.body.append(dialogHost);
  const dialogRoot = createRoot(dialogHost);
  flushSync(() => dialogRoot.render(<SoundsDialog placementId={beat.id} />));
  const boxes = () => [...document.querySelectorAll<HTMLElement>('.h-song-sounds [role="checkbox"]')];
  expect(boxes().map((b) => b.textContent)).toEqual(['Kick', 'Clap', 'Hat']);
  expect(boxes().every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
  expect(document.querySelector('.h-song-sounds-text')!.textContent)
    .toBe('Beat · bars 13 to 16. The ticked sounds play here.');
  await click(boxes()[2]);
  const hat = state().project.channels.find((c) => c.sound.name === 'Hat')!.id;
  expect(find(beat.id).mutes).toEqual([hat]);
  expect(placed('Beat')[0]).not.toHaveProperty('mutes');
  expect(boxes()[2].getAttribute('aria-checked')).toBe('false');
  await click(boxes()[2]);
  expect(find(beat.id)).not.toHaveProperty('mutes');
  undo();
  expect(find(beat.id).mutes).toEqual([hat]);
  flushSync(() => useDialogs.setState({ dialog: { kind: 'sounds', placementId: beat.id } }));
  const ok = [...document.querySelectorAll<HTMLButtonElement>('.h-dialog button')].find((b) => b.textContent === 'OK');
  await click(ok!);
  expect(useDialogs.getState().dialog).toBeNull();
  dialogRoot.unmount();
  dialogHost.remove();
});
