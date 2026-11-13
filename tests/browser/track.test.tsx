import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { position, tap } from '../../src/app/audio';
import { addSound, dropFiles } from '../../src/app/commands';
import { OUT, paramSpec } from '../../src/core/modules';
import type { FloatSpec } from '../../src/core/modules';
import { fromNorm, toNorm } from '../../src/core/params';
import { loopProject as demoProject } from '../support/loopProject';
import {
  openProject, selectStep, setPatternBars, setPlaying, setScope, undo, useApp,
} from '../../src/state/store';
import { TrackView } from '../../src/ui/track';

vi.mock('../../src/app/audio', () => ({ tap: vi.fn(), position: vi.fn(() => -1) }));
vi.mock('../../src/app/commands', () => ({ addSound: vi.fn(), dropFiles: vi.fn(async () => {}) }));

// Demo rows: 0 Kick, 1 Clap, 2 Hat, 3 Sub Bass, 4 Kalimba, 5 Warm Pad, 6 Glass Pad, 7 Bell.
const KICK = 0;
const CLAP = 1;
const SUB = 3;
const KALIMBA = 4;

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  await page.viewport(1400, 800);
  openProject(demoProject(), null);
  vi.clearAllMocks();
  vi.mocked(position).mockReturnValue(-1);
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; display: flex; flex-direction: column; width: 1300px; height: 640px';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<TrackView />));
  await document.fonts.ready;
});

afterEach(async () => {
  await userEvent.cleanup();
  flushSync(() => setPlaying(false));
  root.unmount();
  host.remove();
});

const state = () => useApp.getState();
const pattern = () => state().project.patterns.find((p) => p.id === state().patternId)!;
const channelId = (row: number) => state().project.channels[row].id;
const cellsOf = (row: number) => pattern().cells[channelId(row)] ?? {};
const lanes = () => [...host.querySelectorAll<HTMLElement>('.h-track-lane')];
const cell = (row: number, col: number) => lanes()[row].querySelectorAll<HTMLElement>('.h-track-cell')[col];
const stepsIn = (row: number) => [...lanes()[row].querySelectorAll<HTMLElement>('.h-track-step')];
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.h-track-bar button')].find((b) => b.textContent === label)!;
const plusButtons = () => [...host.querySelectorAll<HTMLButtonElement>('.h-track-bar button.is-square')];

function centre(el: Element) {
  const r = el.getBoundingClientRect();
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

test('the grid shows the rows and steps of the pattern and follows pattern switches and the bar count', async () => {
  expect(lanes()).toHaveLength(8);
  expect(host.querySelector('.h-track-head .h-track-name')!.textContent).toBe('Kick');
  expect(stepsIn(KICK)).toHaveLength(Object.keys(cellsOf(KICK)).length);
  expect(lanes()[KICK].querySelectorAll('.h-track-cell')).toHaveLength(32);

  // Every step sits exactly over its cells.
  const rect = (el: Element) => el.getBoundingClientRect();
  for (const [key, step] of Object.entries(cellsOf(SUB))) {
    const index = Number(key);
    const el = stepsIn(SUB).find((s) => rect(s).left === rect(cell(SUB, index)).left);
    expect(el).toBeDefined();
    expect(rect(el!).right).toBe(rect(cell(SUB, index + step.len - 1)).right);
  }

  await click(button('B'));
  expect(pattern().name).toBe('B');
  expect(stepsIn(KICK)).toHaveLength(Object.keys(cellsOf(KICK)).length);
  expect(stepsIn(KICK)).toHaveLength(5);

  flushSync(() => setPatternBars(pattern().id, 3));
  expect(lanes()[KICK].querySelectorAll('.h-track-cell')).toHaveLength(48);
  await click(host.querySelector('.h-track-bar .h-spin.is-down')!);
  expect(pattern().bars).toBe(2);
  expect(lanes()[KICK].querySelectorAll('.h-track-cell')).toHaveLength(32);
});

test('clicking an empty cell adds a step, plays it and selects it; clicking it again takes it out', async () => {
  await click(cell(CLAP, 1));
  expect(cellsOf(CLAP)[1]).toEqual({ note: 60, vel: 0.8, len: 1 });
  expect(tap).toHaveBeenCalledWith(channelId(CLAP), 60, 0.8);
  expect(state().step).toEqual({ channelId: channelId(CLAP), index: 1 });
  expect(state().channelId).toBe(channelId(CLAP));

  await click(cell(CLAP, 1));
  expect(cellsOf(CLAP)[1]).toBeUndefined();
  expect(state().step).toBeNull();
});

test('dragging sideways from an empty cell paints steps on the empty cells it passes', async () => {
  const before = Object.keys(cellsOf(CLAP)).length;
  await drag(centre(cell(CLAP, 0)), centre(cell(CLAP, 1)), centre(cell(CLAP, 3)), centre(cell(CLAP, 6)));
  for (const i of [0, 1, 2, 3, 5, 6]) expect(cellsOf(CLAP)[i]).toEqual({ note: 60, vel: 0.8, len: 1 });
  expect(Object.keys(cellsOf(CLAP))).toHaveLength(before + 6);
});

test('dragging a step up changes its note, plays each note, and is one undo step', async () => {
  const past = state().past.length;
  const { x, y } = centre(cell(KICK, 0));
  await drag({ x, y }, { x, y: y - 4 }, { x, y: y - 8 }, { x, y: y - 12 });
  expect(cellsOf(KICK)[0].note).toBe(63);
  expect(vi.mocked(tap).mock.calls.map((c) => c[1])).toEqual([61, 62, 63]);
  expect(state().past.length).toBe(past + 1);
  undo();
  expect(cellsOf(KICK)[0].note).toBe(60);

  // A step created by the same press is one undo step too, and the row remembers the note.
  await drag(centre(cell(CLAP, 1)), { x: centre(cell(CLAP, 1)).x, y: centre(cell(CLAP, 1)).y + 8 });
  expect(cellsOf(CLAP)[1].note).toBe(58);
  expect(state().past.length).toBe(past + 1);
  undo();
  expect(cellsOf(CLAP)[1]).toBeUndefined();
  await click(cell(CLAP, 2));
  expect(cellsOf(CLAP)[2].note).toBe(58);
});

test('dragging the right edge changes the length up to the next step and down to one cell', async () => {
  expect(cellsOf(SUB)[0].len).toBe(3);
  const edge = () => {
    const r = stepsIn(SUB)[0].getBoundingClientRect();
    return { x: Math.round(r.right) - 2, y: Math.round(r.top + r.height / 2) };
  };
  await drag(edge(), { x: centre(cell(SUB, 4)).x, y: edge().y });
  expect(cellsOf(SUB)[0].len).toBe(5);
  await drag(edge(), { x: centre(cell(SUB, 12)).x, y: edge().y });
  expect(cellsOf(SUB)[0].len).toBe(6);
  await drag(edge(), { x: centre(cell(SUB, 0)).x - 40, y: edge().y });
  expect(cellsOf(SUB)[0].len).toBe(1);
});

test('right-click selects a step without changing it', async () => {
  const before = structuredClone(cellsOf(KALIMBA));
  await userEvent.pointer({ coords: centre(cell(KALIMBA, 3)), keys: '[MouseRight]' });
  expect(state().step).toEqual({ channelId: channelId(KALIMBA), index: 3 });
  expect(cellsOf(KALIMBA)).toEqual(before);
  expect(lanes()[KALIMBA].querySelector('.h-track-sel')).not.toBeNull();
});

test('the wheel over a step changes its velocity in small amounts', () => {
  const wheel = (deltaY: number) => {
    const { x, y } = centre(cell(KICK, 4));
    const target = document.elementFromPoint(x, y)!;
    target.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  };
  wheel(-100);
  expect(cellsOf(KICK)[4].vel).toBeCloseTo(0.85, 5);
  wheel(100);
  wheel(100);
  expect(cellsOf(KICK)[4].vel).toBeCloseTo(0.75, 5);
});

test('mute, solo and the level slider call through', async () => {
  const head = host.querySelectorAll('.h-track-head')[CLAP];
  const [mute, solo] = head.querySelectorAll('button');
  await click(mute);
  expect(state().project.channels[CLAP].mute).toBe(true);
  await click(solo);
  expect(state().project.channels[CLAP].solo).toBe(true);
  await click(mute);
  expect(state().project.channels[CLAP].mute).toBe(false);

  const level = paramSpec(OUT, 'level') as FloatSpec;
  const before = state().project.channels[CLAP].sound.out.level as number;
  head.querySelector<HTMLElement>('[role="slider"]')!.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(state().project.channels[CLAP].sound.out.level).toBeCloseTo(fromNorm(level, toNorm(level, before) + 0.02), 5);
  expect(state().channelId).toBe(channelId(CLAP));
});

test('the pattern bar selects, adds, copies, clears and deletes patterns', async () => {
  const [add] = plusButtons();
  expect(button('Delete').disabled).toBe(false);
  await click(button('A'));
  await click(button('Copy'));
  expect(pattern().name).toBe('C');
  expect(pattern().cells).toEqual(state().project.patterns[0].cells);
  await click(button('Clear'));
  expect(pattern().cells).toEqual({});
  expect(stepsIn(KICK)).toHaveLength(0);
  await click(add);
  expect(pattern().name).toBe('D');
  await click(button('Delete'));
  expect(state().project.patterns.map((p) => p.name)).toEqual(['A', 'B', 'C']);

  for (let i = 0; i < 5; i++) await click(add);
  expect(state().project.patterns).toHaveLength(8);
  expect(add.disabled).toBe(true);
  expect(button('Copy').disabled).toBe(true);

  for (let i = 0; i < 7; i++) await click(button('Delete'));
  expect(state().project.patterns).toHaveLength(1);
  expect(button('Delete').disabled).toBe(true);
  expect(add.disabled).toBe(false);
});

test('the inspector edits the selected step', async () => {
  const spin = (field: number, dir: 'up' | 'down') =>
    host.querySelectorAll('.h-track-inspector .h-stepper')[field].querySelector(`.h-spin.is-${dir}`)!;
  expect(host.querySelector('.h-track-help')).not.toBeNull();
  expect(host.querySelector('.h-track-inspector [role="spinbutton"]')!.getAttribute('aria-disabled')).toBe('true');

  flushSync(() => selectStep({ channelId: channelId(SUB), index: 0 }));
  expect(host.querySelector('.h-track-which')!.textContent).toBe('Step 1 of Sub Bass');
  expect(host.querySelector('.h-track-help')).toBeNull();
  await click(spin(0, 'up'));
  expect(cellsOf(SUB)[0].note).toBe(64);
  expect(tap).toHaveBeenLastCalledWith(channelId(SUB), 64, 0.8);
  expect(host.querySelector('.h-track-inspector [role="spinbutton"]')!.textContent).toContain('E3');

  host.querySelector<HTMLElement>('.h-track-inspector [role="slider"]')!.focus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(cellsOf(SUB)[0].vel).toBeCloseTo(0.78, 5);
  expect(host.querySelector('.h-track-value')!.textContent).toBe('78 %');

  for (let i = 0; i < 5; i++) await click(spin(1, 'up'));
  expect(cellsOf(SUB)[0].len).toBe(6);
});

test('the play marker sits on the column being heard and hides while another pattern plays', async () => {
  const scroller = host.querySelector<HTMLElement>('.h-track-scroll')!;
  const marker = host.querySelector<HTMLElement>('.h-track-marker')!;
  const now = lanes()[CLAP].querySelector<HTMLElement>('.h-track-now')!;
  expect(getComputedStyle(marker).display).toBe('none');

  vi.mocked(position).mockReturnValue(5.6);
  flushSync(() => setPlaying(true));
  await expect.poll(() => getComputedStyle(marker).display).toBe('block');
  expect(marker.getBoundingClientRect().left).toBe(cell(CLAP, 5).getBoundingClientRect().left);
  expect(now.getBoundingClientRect().left).toBe(cell(CLAP, 5).getBoundingClientRect().left);
  expect(now.getBoundingClientRect().width).toBe(cell(CLAP, 5).getBoundingClientRect().width);
  // The kick plays on step 4 only; step 5 is silent, while the warm pad is held.
  const lamp = (row: number) => host.querySelectorAll('.h-track-head .h-led')[row];
  expect(lamp(KICK).classList.contains('is-on')).toBe(false);
  expect(lamp(5).classList.contains('is-on')).toBe(true);

  // The song is A A B A, 32 steps each: step 70 is in the third entry, pattern B.
  vi.mocked(position).mockReturnValue(70.2);
  flushSync(() => setScope('song'));
  await expect.poll(() => scroller.dataset.now).toBeUndefined();
  expect(getComputedStyle(marker).display).toBe('none');
  await expect.poll(() => host.querySelectorAll('.h-track-slot')[2].classList.contains('is-now')).toBe(true);

  await click(button('B'));
  await expect.poll(() => getComputedStyle(marker).display).toBe('block');
  expect(marker.getBoundingClientRect().left).toBe(cell(CLAP, 6).getBoundingClientRect().left);
});

test('a long pattern turns the page to follow the play position', async () => {
  flushSync(() => setPatternBars(pattern().id, 8));
  const scroller = host.querySelector<HTMLElement>('.h-track-scroll')!;
  expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
  vi.mocked(position).mockReturnValue(16 * 5 + 2);
  flushSync(() => setPlaying(true));
  await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(0);
  const head = host.querySelector('.h-track-head')!.getBoundingClientRect().right;
  expect(cell(KICK, 80).getBoundingClientRect().left).toBeGreaterThanOrEqual(head);
  expect(cell(KICK, 82).getBoundingClientRect().right).toBeLessThanOrEqual(scroller.getBoundingClientRect().right);
});

test('with no sounds the grid says how to add one', async () => {
  flushSync(() => openProject({ ...demoProject(), channels: [] }, null));
  expect(lanes()).toHaveLength(0);
  expect(host.querySelector('.h-track-empty')!.textContent).toContain('Add');
  expect(host.querySelector('.h-track-add button')).not.toBeNull();
});

test('the channel header opens its sound, and its menu moves, copies and removes the channel', async () => {
  const names = () => state().project.channels.map((c) => c.sound.name);
  const item = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('.h-menu-item')].find((el) => el.textContent?.includes(label))!;
  const head = (row: number) => host.querySelectorAll<HTMLElement>('.h-track-head')[row];
  const menu = (row: number) =>
    userEvent.pointer({ coords: centre(head(row).querySelector('.h-track-name')!), keys: '[MouseRight]' });

  await menu(CLAP);
  expect(state().channelId).toBe(channelId(CLAP));
  await click(item('Move Down'));
  expect(names().slice(0, 3)).toEqual(['Kick', 'Hat', 'Clap']);
  await menu(0);
  expect(item('Move Up').getAttribute('aria-disabled')).toBe('true');
  await click(item('Duplicate'));
  expect(names().slice(0, 2)).toEqual(['Kick', 'Kick 2']);
  await menu(1);
  await click(item('Remove'));
  expect(names()).toHaveLength(8);
  expect(host.querySelectorAll('.h-track-head')).toHaveLength(8);

  await userEvent.dblClick(head(SUB).querySelector('.h-track-name')!);
  expect(state().view).toBe('factory');
  expect(state().channelId).toBe(channelId(SUB));
});

test('Add sound asks the shell, and files dropped on the view are handed to it', async () => {
  await click(host.querySelector('.h-track-add button')!);
  expect(addSound).toHaveBeenCalledTimes(1);
  const file = new File(['RIFF'], 'loop.wav', { type: 'audio/wav' });
  const data = new DataTransfer();
  data.items.add(file);
  cell(KICK, 2).dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  expect(dropFiles).toHaveBeenCalledWith([file]);
});
