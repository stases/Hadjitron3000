// Automation in the Song, automated knobs in the Factory and the Mixer, and the locks of the Track's inspector.

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { position } from '../../src/app/audio';
import { App } from '../../src/app/App';
import { setPrefs } from '../../src/app/prefs';
import { refSpec } from '../../src/core/automation';
import { fromNorm, toNorm } from '../../src/core/params';
import type { ParamRef } from '../../src/core/types';
import { demoProject } from '../../src/presets/projects';
import * as store from '../../src/state/store';
import { useFolds } from '../../src/ui/factory/levels';
import { openRoll } from '../../src/ui/track/rollState';

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  position: vi.fn(() => -1),
  tap: vi.fn(),
}));

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  await page.viewport(1280, 800);
  store.openProject(demoProject(), null);
  store.setView('song');
  setPrefs({ beginner: false });
  useFolds.setState({}, true);
  vi.mocked(position).mockReturnValue(-1);
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; display: flex; width: 1280px; height: 800px';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<App />));
  await document.fonts.ready;
});

afterEach(async () => {
  await userEvent.cleanup();
  flushSync(() => store.setPlaying(false));
  root.unmount();
  host.remove();
});

const state = store.useApp.getState;
const project = () => state().project;
const channel = (name: string) => project().channels.find((c) => c.sound.name === name)!.id;
const $$ = (sel: string, from: ParentNode = host) => [...from.querySelectorAll<HTMLElement>(sel)];
const button = (label: string, from: ParentNode = host) => $$('.h-button', from).find((b) => b.textContent === label)!;
const rows = () => $$('.h-song-autorow:not(.is-add)');
const adds = () => host.querySelector<HTMLElement>('.h-song-adds')!;
const status = () => host.querySelector('.h-statusfield')!.textContent;
/** The menu opened last, and an item of it by its label. */
const menu = () => [...document.querySelectorAll<HTMLElement>('.h-menu')].at(-1)!;
const menuItem = (label: string) =>
  $$('.h-menu-item', menu()).find((i) => i.querySelector('.h-menu-label')!.textContent === label)!;
async function choose(select: Element, label: string) {
  await userEvent.click(select);
  await userEvent.click($$('.h-select-option', document.body).find((o) => o.textContent === label)!);
}

const cutoff = (): ParamRef => ({ owner: channel('Warm Pad'), module: 'filter', param: 'cutoff' });

test('in beginner mode the rows and the button wait behind a Deep toggle, lit when the song has automation', async () => {
  flushSync(() => setPrefs({ beginner: true }));
  const toggle = () => $$('.h-folds .h-button', adds())[0];
  expect(toggle().textContent).toBe('Deep');
  expect(toggle().querySelector('.h-led')!.classList.contains('is-on')).toBe(false);
  expect(button('Automation', adds())).toBeUndefined();
  flushSync(() => store.addAutomation(cutoff()));
  expect(toggle().querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
  expect(rows()).toEqual([]);
  await userEvent.click(toggle());
  expect(rows()).toHaveLength(1);
  expect(button('Automation', adds())).toBeDefined();
  flushSync(() => setPrefs({ beginner: false }));
  expect($$('.h-folds', adds())).toEqual([]);
  expect(rows()).toHaveLength(1);
});

test('the picker goes from a sound, bus or master to a parameter, adds its row and ticks it after', async () => {
  await userEvent.click(button('Automation', adds()));
  const groups = $$('.h-menu-item .h-menu-label', document.body).map((l) => l.textContent);
  expect(groups).toEqual([...project().channels.map((c) => c.sound.name), 'Room', 'Echo', 'Master']);
  await userEvent.hover(menuItem('Warm Pad'));
  await userEvent.hover(menuItem('Filter'));
  expect($$('.h-menu-label', menu()).map((l) => l.textContent)).toEqual(['Cutoff', 'Reso', 'Drive', 'Key', 'Velocity']);
  await userEvent.click(menuItem('Cutoff'));
  expect(project().automation.map((r) => [r.target, r.points])).toEqual([[cutoff(), []]]);
  expect(rows()[0].querySelector('.h-song-autoname')!.textContent).toBe('Warm Pad · Filter · Cutoff');

  await userEvent.click(button('Automation', adds()));
  await userEvent.click(menuItem('Room'));
  await userEvent.click(menuItem('Level'));
  expect(project().automation[1].target).toEqual({ owner: { rack: 0 }, module: 'out', param: 'level' });
  expect(rows()[1].querySelector('.h-song-autoname')!.textContent).toBe('Room · Level');

  await userEvent.click(button('Automation', adds()));
  const ticked = (label: string) => menuItem(label).querySelector('.h-menu-check')!.childElementCount === 1;
  expect([ticked('Warm Pad'), ticked('Room'), ticked('Kick')]).toEqual([true, true, false]);
  await userEvent.hover(menuItem('Warm Pad'));
  expect(menuItem('Filter').querySelector('.h-menu-check')!.childElementCount).toBe(1);
  await userEvent.hover(menuItem('Filter'));
  expect(menuItem('Cutoff').getAttribute('aria-disabled')).toBe('true');
  await userEvent.keyboard('{Escape}{Escape}{Escape}');

  await userEvent.click(rows()[0].querySelector('.h-song-head .h-button')!);
  expect(project().automation.map((r) => r.target.module)).toEqual(['out']);
  store.undo();
  expect(project().automation).toHaveLength(2);
});

/** The canvas of a row and where a tick and a value 0..1 are on the screen, in 4/4 with 30 pixels to the bar. */
function display(index = 0) {
  const canvas = rows()[index].querySelector('canvas')!;
  const r = canvas.getBoundingClientRect();
  return {
    canvas,
    at: (tick: number, v: number) => ({
      x: Math.round(r.left + (tick * 30) / 384 - 2),
      y: Math.round(r.top + 2 + (1 - v) * 31),
    }),
  };
}

async function drag(from: { x: number; y: number }, ...path: { x: number; y: number }[]) {
  await userEvent.pointer([
    { coords: from }, { keys: '[MouseLeft>]' }, ...path.map((coords) => ({ coords })), { keys: '[/MouseLeft]' },
  ]);
}

test('a click adds a point on the nearest beat, a drag moves it, Alt frees it, and each is one undo step', async () => {
  const id = flushSync(() => store.addAutomation(cutoff()))!;
  const points = () => project().automation.find((r) => r.id === id)!.points;
  const { at } = display();
  // Between the first and the second beat of bar 3, nearer the second.
  await drag({ ...at(2 * 384 + 70, 0.5) });
  expect(points().map(([t]) => t)).toEqual([2 * 384 + 96]);
  expect(points()[0][1]).toBeCloseTo(0.5, 1);
  await drag(at(400, 0.25));
  expect(points().map(([t]) => t)).toEqual([384, 864]);

  // Drag the second point up and to bar 5, showing its value as it goes; it stays after the first.
  const spec = refSpec(project(), cutoff())!;
  await drag(at(864, points()[1][1]), at(4 * 384 + 10, 0.9), at(4 * 384 + 10, 1));
  expect(points()[1][0]).toBe(4 * 384);
  expect(points()[1][1]).toBe(1);
  expect(status()).toBe(`Warm Pad · Filter · Cutoff: 20.0 kHz at 5.1.1`);
  expect(fromNorm(spec, points()[1][1])).toBe(20000);
  store.undo();
  expect(points()[1][0]).toBe(864);

  // With Alt the point goes where the pointer is, between the beats; it cannot pass the point before it.
  await userEvent.keyboard('{Alt>}');
  await drag(at(864, points()[1][1]), at(1000, points()[1][1]));
  await userEvent.keyboard('{/Alt}');
  expect(points()[1][0]).not.toBe(960);
  expect(Math.abs(points()[1][0] - 1000)).toBeLessThan(14);
  await drag(at(points()[1][0], points()[1][1]), at(100, 0.5));
  expect(points()[1][0]).toBe(384);
  expect(points().length).toBe(2);
  expect(state().past.length).toBeGreaterThan(0);
});

test('right-click or Delete removes a point', async () => {
  const id = flushSync(() => store.addAutomation(cutoff()))!;
  flushSync(() => store.setAutomationPoints(id, [[0, 0.2], [384, 0.8], [768, 0.4]]));
  const points = () => project().automation.find((r) => r.id === id)!.points;
  const song = project().song;
  const { at, canvas } = display();
  await userEvent.pointer({ coords: at(384, 0.8), keys: '[MouseRight]' });
  expect(points()).toEqual([[0, 0.2], [768, 0.4]]);
  await drag(at(768, 0.4));
  expect(document.activeElement).toBe(canvas);
  await userEvent.keyboard('{Delete}');
  expect(points()).toEqual([[0, 0.2]]);
  // The placements of the song are untouched.
  expect(project().song).toBe(song);
});

test('an automated knob is marked, follows its row while the song plays, and turning it then changes nothing', async () => {
  const id = store.addAutomation(cutoff())!;
  const spec = refSpec(project(), cutoff())!;
  // 200 Hz at the start of the song, 2 kHz at bar 5 and after.
  flushSync(() => store.setAutomationPoints(id, [[0, toNorm(spec, 200)], [4 * 384, toNorm(spec, 2000)]]));
  flushSync(() => store.selectChannel(channel('Warm Pad')));
  flushSync(() => store.setView('factory'));
  const filter = (label: string) =>
    host.querySelector<HTMLElement>(`.h-rack[aria-label^="Filter"] [aria-label="${label}"]`)!;
  const knob = () => filter('Cutoff');
  const reso = () => filter('Reso');
  expect(knob().classList.contains('is-automated')).toBe(true);
  expect(reso().classList.contains('is-automated')).toBe(false);
  // Stopped, it shows and sets its own value.
  expect(knob().getAttribute('aria-valuetext')).toBe('2.00 kHz');

  flushSync(() => store.useApp.setState({ playing: true, scope: 'song' }));
  // Two bars in (32 steps): half way along the row, 632 Hz.
  vi.mocked(position).mockReturnValue(32);
  await expect.poll(() => knob().getAttribute('aria-valuetext')).toBe('632 Hz');
  vi.mocked(position).mockReturnValue(64 + 16 * 16);
  await expect.poll(() => knob().getAttribute('aria-valuetext')).toBe('2.00 kHz');
  const before = project();
  knob().focus();
  await userEvent.keyboard('{ArrowUp}{End}');
  expect(project()).toBe(before);
  expect(status()).toContain('follows its automation in the Song');

  // A block on repeat plays without automation: the knob shows its own value and works again.
  flushSync(() => store.useApp.setState({ scope: 'pattern' }));
  await expect.poll(() => knob().getAttribute('aria-valuetext')).toBe('2.00 kHz');
  await userEvent.keyboard('{End}');
  expect(knob().getAttribute('aria-valuetext')).toBe('20.0 kHz');
});

test('the Mixer marks automated faders and pan knobs', async () => {
  const automate = (ref: ParamRef) => flushSync(() => store.setAutomationPoints(store.addAutomation(ref)!, [[0, 0.5]]));
  automate({ owner: { rack: 'master' }, module: 'out', param: 'level' });
  automate({ owner: channel('Bell'), module: 'out', param: 'pan' });
  // A row without points moves nothing and marks nothing.
  flushSync(() => store.addAutomation({ owner: channel('Kick'), module: 'out', param: 'pan' }));
  flushSync(() => store.setView('mixer'));
  const strip = (name: string) => host.querySelector<HTMLElement>(`.h-mixer-strip[aria-label="${name}"]`)!;
  expect(strip('Master').querySelector('.h-slider')!.classList.contains('is-automated')).toBe(true);
  expect(strip('Bell').querySelector('.h-knob[aria-label="Pan"]')!.classList.contains('is-automated')).toBe(true);
  expect(strip('Kick').querySelector('.h-knob[aria-label="Pan"]')!.classList.contains('is-automated')).toBe(false);
  expect(strip('Bell').querySelector('.h-slider')!.classList.contains('is-automated')).toBe(false);
});

test('the inspector locks a control for the selected notes, in its units, and the grid and roll mark them', async () => {
  flushSync(() => setPrefs({ beginner: true }));
  flushSync(() => store.setView('track'));
  const keys = project().patterns.find((p) => p.name === 'Keys')!;
  const kalimba = channel('Kalimba');
  flushSync(() => store.selectPattern(keys.id));
  const [first] = keys.notes[kalimba];
  flushSync(() => store.selectStep({ channelId: kalimba, index: first.start / 24 }));
  const inspector = () => host.querySelector<HTMLElement>('.h-track-inspector')!;
  await userEvent.click(button('Deep', inspector()));
  const labels = $$('.h-track-label', inspector()).map((l) => l.textContent);
  expect(labels.slice(-3)).toEqual(['Ratchet', 'Lock 1', 'Lock 2']);
  const selects = () => $$('.h-select', inspector()).slice(-2);
  expect(selects()[1].getAttribute('aria-disabled')).toBe('true');

  await choose(selects()[0], 'Filter · Cutoff');
  const notes = () => project().patterns.find((p) => p.id === keys.id)!.notes[kalimba];
  const spec = refSpec(project(), { owner: kalimba, module: 'filter', param: 'cutoff' })!;
  // A new lock starts at the sound's own value.
  const own = toNorm(spec, project().channels.find((c) => c.id === kalimba)!.sound.filter.cutoff as number);
  expect(notes()[0].locks).toEqual([{ target: { module: 'filter', param: 'cutoff' }, value: own }]);
  const knob = $$('.h-knob', inspector()).find((k) => k.getAttribute('aria-label') === 'Cutoff')!;
  expect(knob.getAttribute('aria-valuetext')).toBe('2.00 kHz');
  knob.focus();
  await userEvent.keyboard('{End}');
  expect(notes()[0].locks![0].value).toBe(1);
  expect(knob.getAttribute('aria-valuetext')).toBe('20.0 kHz');
  expect(lockMarks()).toBe(1);
  expect(button('Deep', inspector()).querySelector('.h-led')!.classList.contains('is-on')).toBe(true);

  // The second lock, then None takes the first away and the second moves up.
  await choose(selects()[1], 'Output · Pan');
  expect(notes()[0].locks!.map((l) => l.target.param)).toEqual(['cutoff', 'pan']);
  await choose(selects()[0], 'None');
  expect(notes()[0].locks!.map((l) => l.target.param)).toEqual(['pan']);
  store.undo();
  expect(notes()[0].locks!.map((l) => l.target.param)).toEqual(['cutoff', 'pan']);

  flushSync(() => openRoll(kalimba, [first.id]));
  expect($$('.h-roll-note .h-mark-lock')).toHaveLength(1);
});

const lockMarks = () => $$('.h-track-step .h-mark-lock').length;
