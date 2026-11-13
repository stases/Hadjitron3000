import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { App } from '../../src/app/App';
import { setPrefs } from '../../src/app/prefs';
import { barOf } from '../../src/core/meter';
import { demoProject } from '../../src/presets/projects';
import * as store from '../../src/state/store';
import { useFolds } from '../../src/ui/factory/levels';
import { openRoll } from '../../src/ui/track/rollState';
import { cellX, laneWidth } from '../../src/ui/track/steps';

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  tap: vi.fn(),
}));

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  await page.viewport(1280, 800);
  store.openProject(demoProject(), null);
  store.setView('track');
  setPrefs({ beginner: true });
  useFolds.setState({}, true);
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; display: flex; width: 1280px; height: 800px';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<App />));
  await document.fonts.ready;
});

afterEach(async () => {
  await userEvent.cleanup();
  root.unmount();
  host.remove();
  setPrefs({ beginner: true });
});

const state = store.useApp.getState;
const project = () => state().project;
const block = (name: string) => project().patterns.find((p) => p.name === name)!;
const channel = (name: string) => project().channels.find((c) => c.sound.name === name)!.id;
const $$ = (sel: string, from: ParentNode = host) => [...from.querySelectorAll<HTMLElement>(sel)];
const inspector = () => host.querySelector<HTMLElement>('.h-track-inspector')!;
const labels = () => $$('.h-track-label', inspector()).map((l) => l.textContent);
const toggles = (where: Element = inspector()) => $$('.h-folds .h-button', where);
const lamps = (where?: Element) => toggles(where).map((t) => t.querySelector('.h-led')!.classList.contains('is-on'));
const checkbox = (label: string) => $$('.h-checkbox', inspector()).find((c) => c.textContent === label)!;
const status = () => host.querySelector('.h-statusfield')!.textContent;

async function choose(select: Element, label: string) {
  await userEvent.click(select);
  const options = [...document.querySelectorAll<HTMLElement>('.h-select-option')];
  await userEvent.click(options.find((o) => o.textContent === label)!);
}

/** Notes added to a row of a block with the store; returns their ids. */
function put(patternId: string, channelId: string, notes: [number, number][]): string[] {
  return notes.map(([start, note]) => store.addNote(patternId, channelId, { start, len: 24, note, vel: 0.8 })!);
}

test('in beginner mode the extras wait behind Shaping and Deep toggles whose lamps show what notes have', async () => {
  const beat = block('Beat');
  const kick = channel('Kick');
  flushSync(() => store.selectStep({ channelId: kick, index: 0 }));
  expect(labels()).toEqual(['Note', 'Velocity', 'Length']);
  expect(toggles().map((t) => t.textContent)).toEqual(['Shaping', 'Deep']);
  expect(lamps()).toEqual([false, false]);
  const [first] = beat.notes[kick];
  flushSync(() => store.setNotesExtras(beat.id, kick, [first.id], { chance: 60 }));
  expect(lamps()).toEqual([true, false]);
  flushSync(() => store.setNotesExtras(beat.id, kick, [first.id], { chance: 100, ratchet: 3 }));
  expect(lamps()).toEqual([false, true]);

  await userEvent.click(toggles()[0]);
  expect(labels()).toEqual(['Note', 'Velocity', 'Length', 'Chance']);
  expect($$('.h-checkbox', inspector()).map((c) => c.textContent)).toEqual(['Slide', 'Hold']);
  await userEvent.click(toggles()[1]);
  expect(labels()).toEqual(['Note', 'Velocity', 'Length', 'Chance', 'Ratchet']);
  expect(inspector().querySelector('[aria-label="Deep"] .h-select-text')!.textContent).toBe('3x');
  await userEvent.click(toggles()[0]);
  expect(labels()).toEqual(['Note', 'Velocity', 'Length', 'Ratchet']);

  // The roll's inspector folds the same way and adds Start to the Basics.
  flushSync(() => openRoll(kick, [first.id]));
  expect(labels()).toEqual(['Note', 'Velocity', 'Length', 'Start', 'Ratchet']);
  expect(lamps()).toEqual([false, true]);

  flushSync(() => setPrefs({ beginner: false }));
  expect(toggles()).toEqual([]);
  expect(labels()).toEqual(['Note', 'Velocity', 'Length', 'Start', 'Chance', 'Ratchet']);
});

test('the grid sets extras on all the notes of the selected step, one undo step each, and marks them', async () => {
  flushSync(() => setPrefs({ beginner: false }));
  const keys = block('Keys');
  flushSync(() => store.selectPattern(keys.id));
  const kalimba = channel('Kalimba');
  const ids = put(keys.id, kalimba, [[48, 60], [48, 64]]);
  flushSync(() => store.selectStep({ channelId: kalimba, index: 2 }));
  const chord = () => block('Keys').notes[kalimba].filter((n) => ids.includes(n.id));
  const key = () => $$('.h-track-lane')[project().channels.findIndex((c) => c.id === kalimba)]
    .querySelectorAll<HTMLElement>('.h-track-step')[1];
  expect(key().textContent).toContain('+1');
  const steps = state().past.length;

  await userEvent.click(checkbox('Slide'));
  expect(chord().map((n) => n.slide)).toEqual([true, true]);
  expect(key().querySelector('.h-mark-slide')).not.toBeNull();
  await userEvent.click(checkbox('Hold'));
  expect(chord().map((n) => n.hold)).toEqual([true, true]);
  expect(key().querySelector('.h-mark-hold')).not.toBeNull();
  const lane = key().parentElement!;
  const tail = lane.querySelector<HTMLElement>('.h-track-hold')!;
  expect(tail.offsetLeft + tail.offsetWidth).toBe(lane.offsetWidth);

  await choose(inspector().querySelector('[aria-label="Deep"] .h-select')!, '4x');
  expect(chord().map((n) => n.ratchet)).toEqual([4, 4]);
  expect(key().querySelectorAll('.h-mark-ratchet')).toHaveLength(3);

  inspector().querySelectorAll<HTMLElement>('[role="slider"]')[1].focus();
  await userEvent.keyboard('{PageDown}{PageDown}');
  expect(chord().map((n) => n.chance)).toEqual([80, 80]);
  expect(key().classList.contains('is-maybe')).toBe(true);
  expect(state().past.length).toBe(steps + 4);

  store.undo();
  expect(chord().map((n) => n.chance)).toEqual([undefined, undefined]);
  await userEvent.click(checkbox('Slide'));
  expect(chord().map((n) => n.slide)).toEqual([undefined, undefined]);
  expect(key().querySelector('.h-mark-slide')).toBeNull();
});

test('the roll sets extras on the selected notes and marks them, with hints in the status bar', async () => {
  flushSync(() => setPrefs({ beginner: false }));
  const keys = block('Keys');
  flushSync(() => store.selectPattern(keys.id));
  const kalimba = channel('Kalimba');
  const row = () => block('Keys').notes[kalimba];
  const chosen = row().slice(0, 3).map((n) => n.id);
  flushSync(() => openRoll(kalimba, chosen));
  expect(host.querySelector('.h-track-which')!.textContent).toBe('3 notes of Kalimba');
  const steps = state().past.length;

  await choose(inspector().querySelector('[aria-label="Deep"] .h-select')!, '8x');
  await userEvent.click(checkbox('Slide'));
  await userEvent.click(checkbox('Hold'));
  inspector().querySelectorAll<HTMLElement>('[role="slider"]')[1].focus();
  await userEvent.keyboard('{PageDown}');
  expect(state().past.length).toBe(steps + 4);
  const extras = row().filter((n) => chosen.includes(n.id)).map((n) => [n.chance, n.ratchet, n.slide, n.hold]);
  expect(extras).toEqual(chosen.map(() => [90, 8, true, true]));
  expect(row().filter((n) => !chosen.includes(n.id)).every((n) => !n.ratchet && !n.hold)).toBe(true);

  const notes = $$('.h-roll-note');
  expect(notes.filter((n) => n.classList.contains('is-maybe'))).toHaveLength(3);
  expect(notes.filter((n) => n.querySelector('.h-mark-slide') && n.querySelector('.h-mark-hold'))).toHaveLength(3);
  expect(notes.reduce((sum, n) => sum + n.querySelectorAll('.h-mark-ratchet').length, 0)).toBe(3 * 7);
  expect($$('.h-roll-hold')).toHaveLength(3);
  for (const tail of $$('.h-roll-hold')) {
    expect(tail.offsetLeft + tail.offsetWidth).toBe(tail.parentElement!.offsetWidth);
  }

  await userEvent.hover(checkbox('Hold'));
  expect(status()).toContain('drone');
  await userEvent.hover(inspector().querySelector('[aria-label="Deep"] .h-select')!);
  expect(status()).toContain('Ratchet');
});

test('the time signature redraws the grid, the roll and the song, and changes in one undo step', async () => {
  flushSync(() => setPrefs({ beginner: false }));
  const meter = () => host.querySelector<HTMLElement>('.h-app-transport .h-select')!;
  expect(meter().textContent).toBe('4/4');
  const beat = block('Beat');
  const song = project().song;
  expect(beat.bars).toBe(2);
  await choose(meter(), '7/8');
  expect(project().meter).toEqual([7, 8]);
  const bar = barOf([7, 8]);
  // Two bars of 4/4 need three of 7/8.
  expect(block('Beat').bars).toBe(3);
  expect(block('Beat').notes).toEqual(beat.notes);
  expect($$('.h-track-lane')[0].querySelectorAll('.h-track-cell')).toHaveLength(42);
  const ticks = $$('.h-track-ruler .h-track-tick');
  expect(ticks.filter((t) => t.classList.contains('is-bar')).map((t) => t.textContent)).toEqual(['1', '2', '3']);
  expect(ticks.filter((t) => t.classList.contains('is-beat'))).toHaveLength(6);
  expect(ticks[14].offsetLeft - ticks[0].offsetLeft).toBe(cellX(14, bar));
  expect($$('.h-statusfield')[1].textContent).toBe('Block Beat · 3 bars');

  flushSync(() => openRoll(channel('Kalimba')));
  expect(host.querySelector<HTMLElement>('.h-roll-notes')!.offsetWidth).toBe(laneWidth(42, bar));
  expect(host.querySelector<HTMLElement>('.h-roll-notes')!.style.backgroundSize).toContain(`${cellX(14, bar)}px`);

  flushSync(() => store.setView('song'));
  // A bar of 7/8 is 25 pixels plus its line on the timeline; placements keep their bars.
  expect(host.querySelector<HTMLElement>('.h-song-cell')!.offsetWidth).toBe(25);
  const tile = host.querySelector<HTMLElement>('.h-song-tile')!;
  const placement = project().song.find((p) => p.id === tile.dataset.id)!;
  expect(tile.offsetLeft).toBe(placement.bar * 27);
  expect(project().song).toEqual(song);

  flushSync(() => store.undo());
  expect(project().meter).toEqual([4, 4]);
  expect(block('Beat').bars).toBe(2);
  expect(host.querySelector<HTMLElement>('.h-song-cell')!.offsetWidth).toBe(28);
});

test('in beginner mode the time signature waits behind a Deep toggle, lit when the song is not in 4/4', async () => {
  const transport = host.querySelector<HTMLElement>('.h-app-transport')!;
  expect(transport.querySelector('.h-select')).toBeNull();
  expect(toggles(transport).map((t) => t.textContent)).toEqual(['Deep']);
  expect(lamps(transport)).toEqual([false]);
  flushSync(() => store.setMeter([6, 8]));
  expect(lamps(transport)).toEqual([true]);
  await userEvent.click(toggles(transport)[0]);
  expect(transport.querySelector('.h-select')!.textContent).toBe('6/8');
  flushSync(() => setPrefs({ beginner: false }));
  expect(toggles(transport)).toEqual([]);
  expect(transport.querySelector('.h-select')!.textContent).toBe('6/8');
});
