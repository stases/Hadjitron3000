import { clear, createStore } from 'idb-keyval';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { App } from '../../src/app/App';
import { exportAudio } from '../../src/app/commands';
import { closeDialog, openDialog, useDialogs } from '../../src/app/dialogStore';
import { restoreSession, saveSession } from '../../src/app/session';
import { LESSONS } from '../../src/app/tour/lessons';
import { closeTour, startLesson, useTour } from '../../src/app/tour/tourStore';
import { platform } from '../../src/platform';
import { demoProject } from '../../src/presets/projects';
import { newNote, TICKS_PER_STEP } from '../../src/core/defaults';
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

function renderApp(): void {
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  flushSync(() => r.render(<App />));
  root = { root: r, host };
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  store.openProject(demoProject(), null);
  store.setView('song');
  vi.spyOn(platform.library, 'list').mockResolvedValue([]);
});

afterEach(async () => {
  await userEvent.cleanup();
  flushSync(() => {
    closeTour();
    useDialogs.setState({ dialog: null, messages: [] });
  });
  store.setPlaying(false);
  root?.root.unmount();
  root?.host.remove();
  root = null;
  vi.restoreAllMocks();
});

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const coachButton = (label: string) => $$('.h-tour .h-button').find((b) => b.textContent === label) as HTMLButtonElement;
const dialogButton = (label: string) => $$('.h-dialog .h-button').find((b) => b.textContent === label)!;
const target = (name: string) => $(`[data-tour="${name}"]`)!;
const count = () => $('.h-tour-count')?.textContent;
const ticked = () => !!$('.h-tour-done');
const nextIsPrimary = () => coachButton('Next').classList.contains('is-primary');

async function next(): Promise<void> {
  const step = useTour.getState().index;
  await userEvent.click(coachButton(step === LESSONS[useTour.getState().lesson!].steps.length - 1 ? 'Finish' : 'Next'));
}

/** Waits for the step to say it is done, then goes on. */
async function doneThenNext(): Promise<void> {
  await expect.poll(ticked).toBe(true);
  expect(nextIsPrimary()).toBe(true);
  await next();
}

/**
 * The frame sits three pixels outside the target, and the coach does not cover the target, or sits inside it when
 * the target is too big to go beside.
 */
async function pointsAt(name: string, inside = false): Promise<void> {
  await expect.poll(() => {
    const t = target(name)?.getBoundingClientRect();
    const f = $('.h-tour-frame')?.getBoundingClientRect();
    return !!t && !!f && [f.left, f.top, f.right, f.bottom].join() === [
      Math.round(t.left) - 3, Math.round(t.top) - 3, Math.round(t.left) + Math.round(t.width) + 3,
      Math.round(t.top) + Math.round(t.height) + 3].join();
  }).toBe(true);
  const t = target(name).getBoundingClientRect();
  const c = $('.h-tour')!.getBoundingClientRect();
  expect(inside
    ? c.left >= t.left && c.right <= t.right && c.top >= t.top && c.bottom <= t.bottom
    : c.right <= t.left || c.left >= t.right || c.bottom <= t.top || c.top >= t.bottom).toBe(true);
  expect(c.left).toBeGreaterThanOrEqual(0);
  expect(c.top).toBeGreaterThanOrEqual(0);
  expect(c.right).toBeLessThanOrEqual(innerWidth);
  expect(c.bottom).toBeLessThanOrEqual(innerHeight);
}

test('the first launch offers the tutorials once, and never again by itself', async () => {
  await clear(sessionStore);
  expect(await restoreSession()).toBe(true);
  expect(state().project.name).toBe('Welcome');
  expect(await restoreSession()).toBe(false);
  await saveSession();
  expect(await restoreSession()).toBe(false);

  openDialog({ kind: 'welcome' });
  renderApp();
  expect($('.h-dialog .h-titlebar-text')!.textContent).toBe('Welcome to Hadjitron 3000');
  expect($$('.h-dialog .h-button').map((b) => b.textContent)).toEqual(['Listen to the Demo', 'Make a Sound', 'Make a Song']);
  await userEvent.click(dialogButton('Listen to the Demo'));
  expect($('.h-dialog')).toBeNull();
  expect($('.h-tour')).toBeNull();
  expect(state().project.name).toBe('Welcome');

  openDialog({ kind: 'welcome' });
  await expect.poll(() => $('.h-dialog')).not.toBeNull();
  await userEvent.click(dialogButton('Make a Song'));
  await expect.poll(count).toBe('Step 1 of 14');
  expect($('.h-tour .h-titlebar-text')!.textContent).toBe('Tutorial: Make a Song');
  expect(state().project.name).toBe('Untitled');
  expect(state().view).toBe('track');
});

test('the Help menu starts either tutorial', async () => {
  renderApp();
  await userEvent.click($$('.h-menubar-item').find((el) => el.textContent === 'Help')!);
  const items = $$('.h-menu-item .h-menu-label').map((el) => el.textContent);
  expect(items.slice(0, 2)).toEqual(['Tutorial: Make a Sound', 'Tutorial: Make a Song']);
  await userEvent.click($$('.h-menu-item').find((el) => el.textContent === 'Tutorial: Make a Sound')!);
  await expect.poll(count).toBe('Step 1 of 13');
  expect(state().view).toBe('factory');
});

test('Make a Sound can be walked from the first step to the last by doing each thing', async () => {
  const write = vi.spyOn(platform.library, 'write').mockResolvedValue();
  renderApp();
  await startLesson('sound');
  const channel = () => state().channelId!;
  const filter = () => state().project.channels.find((c) => c.id === channel())!.sound.chain[0].id;

  await expect.poll(count).toBe('Step 1 of 13');
  expect($('.h-tour-frame')).toBeNull();
  expect(nextIsPrimary()).toBe(true);
  expect(coachButton('Back').disabled).toBe(true);
  await next();

  await pointsAt('new-sound');
  expect(ticked()).toBe(false);
  expect(nextIsPrimary()).toBe(false);
  await userEvent.click(target('new-sound'));
  await expect.poll(() => $$('.h-list-row').length).toBeGreaterThan(0);
  await userEvent.click(dialogButton('Add to Track'));
  await doneThenNext();

  await pointsAt('keyboard');
  await userEvent.click($('[data-tour="keyboard"] .h-factory-key.is-white')!);
  await doneThenNext();

  await pointsAt('unit-source');
  await userEvent.click($$('[data-tour="unit-source"] [aria-label="Wave"] .h-button').at(-1)!);
  await doneThenNext();

  await pointsAt('unit-amp');
  store.setParam(channel(), 'amp', 'sustain', 0);
  await doneThenNext();

  await pointsAt('add-effect');
  store.addEffect(channel(), 'filter');
  await doneThenNext();

  await pointsAt('unit-filter');
  store.setParam(channel(), filter(), 'cutoff', 300);
  await doneThenNext();

  await pointsAt('add-modulator');
  const env = store.addMod(channel(), 'env')!;
  await doneThenNext();

  await pointsAt('unit-mod');
  store.setModTarget(channel(), env, { module: filter(), param: 'cutoff' });
  await doneThenNext();

  store.addEffect(channel(), 'delay');
  await doneThenNext();

  await pointsAt('sound-name');
  await userEvent.fill(target('sound-name'), 'Pluck Bass');
  await doneThenNext();

  await pointsAt('save-sound');
  await userEvent.click(target('save-sound'));
  await expect.poll(() => write.mock.calls.length).toBe(1);
  expect(write.mock.lastCall![0]).toBe('Pluck Bass');
  await doneThenNext();

  expect(count()).toBe('Step 13 of 13');
  await next();
  expect($('.h-tour')).toBeNull();
  expect($('.h-tour-frame')).toBeNull();
  expect(state().project.channels.at(-1)!.sound.name).toBe('Pluck Bass');
});

test('Make a Song can be walked from the first step to the last by doing each thing', async () => {
  renderApp();
  await startLesson('song');
  const block = () => state().patternId;
  const row = (name: string) => state().project.channels.find((c) => c.sound.name === name)!.id;
  const put = (pattern: string, name: string, step: number, note = 60) =>
    store.addNote(pattern, row(name), newNote(step * TICKS_PER_STEP, note));

  await pointsAt('grid', true);
  await next();

  await pointsAt('row-Kick');
  for (const column of [0, 4, 8, 12]) {
    await userEvent.click($$(`[data-tour="row-Kick"] .h-track-cell`)[column]);
  }
  await doneThenNext();

  put(block(), 'Snare', 4);
  put(block(), 'Hat', 2);
  await doneThenNext();

  await pointsAt('row-Sub Bass');
  const bass = put(block(), 'Sub Bass', 0, 63)!;
  await doneThenNext();

  store.resizeNotes(block(), row('Sub Bass'), [bass], 3 * TICKS_PER_STEP);
  await doneThenNext();

  await pointsAt('copy-block');
  const a = block();
  await userEvent.click(target('copy-block'));
  await doneThenNext();

  const b = block();
  expect(b).not.toBe(a);
  expect(ticked()).toBe(false);
  put(b, 'Hat', 10);
  await doneThenNext();

  await pointsAt('tab-song');
  await userEvent.click(target('tab-song'));
  await doneThenNext();

  await pointsAt('timeline', true);
  store.addPlacement(a, 0, 0);
  store.addPlacement(b, 0, 1);
  await doneThenNext();

  store.resizePlacement(state().placementId!, 3);
  await doneThenNext();

  store.addPlacement(a, 1, 2);
  await doneThenNext();

  await pointsAt('play');
  await userEvent.click(target('play'));
  await doneThenNext();

  await pointsAt('menu-file');
  exportAudio();
  await expect.poll(ticked).toBe(true);
  flushSync(closeDialog);
  await next();

  expect(count()).toBe('Step 14 of 14');
  await next();
  expect($('.h-tour')).toBeNull();
  expect(state().project.song).toHaveLength(3);
});

test('Back and Next move through the steps and switch the view, and the close box ends the tutorial', async () => {
  renderApp();
  await startLesson('song');
  for (let i = 0; i < 8; i++) await next();
  await expect.poll(count).toBe('Step 9 of 14');
  expect(state().view).toBe('song');
  await userEvent.click(coachButton('Back'));
  expect(count()).toBe('Step 8 of 14');
  expect(state().view).toBe('track');
  await next();
  expect(state().view).toBe('song');

  await userEvent.click($('.h-tour [aria-label="Close"]')!);
  expect($('.h-tour')).toBeNull();
  expect($('.h-tour-frame')).toBeNull();
  store.setBpm(99);
  expect(state().project.bpm).toBe(99);
  expect(state().view).toBe('song');
});

test('a done step stays done until the step changes, and a step done beforehand says so at once', async () => {
  renderApp();
  await startLesson('song');
  for (let i = 0; i < 11; i++) await next();
  await expect.poll(count).toBe('Step 12 of 14');
  expect(ticked()).toBe(false);
  store.setPlaying(true);
  await expect.poll(ticked).toBe(true);
  store.setPlaying(false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(ticked()).toBe(true);
  await userEvent.click(coachButton('Back'));
  expect(ticked()).toBe(false);
  await next();
  expect(ticked()).toBe(false);
  await userEvent.click(coachButton('Back'));
  store.setPlaying(true);
  await next();
  expect(ticked()).toBe(true);
  expect(nextIsPrimary()).toBe(true);
});

test('starting a tutorial offers to save the project first and leaves it alone when cancelled', async () => {
  renderApp();
  store.setBpm(101);
  const started = startLesson('sound');
  await expect.poll(() => $('.h-message-text')?.textContent).toBe('Save changes to Welcome?');
  await userEvent.click($$('.h-message-buttons .h-button').find((b) => b.textContent === 'Cancel')!);
  await started;
  expect($('.h-tour')).toBeNull();
  expect(state().project.bpm).toBe(101);

  const again = startLesson('sound');
  await expect.poll(() => $('.h-message-text')).not.toBeNull();
  await userEvent.click($$('.h-message-buttons .h-button').find((b) => b.textContent === "Don't Save")!);
  await again;
  await expect.poll(count).toBe('Step 1 of 13');
  expect(state().project.name).toBe('Untitled');
});

test('the frame follows its target when the target appears and when it scrolls', async () => {
  await page.viewport(1024, 680);
  renderApp();
  await startLesson('sound');
  for (let i = 0; i < 6; i++) await next();
  await expect.poll(count).toBe('Step 7 of 13');
  const channel = state().channelId!;
  expect($('.h-tour-frame')).toBeNull();
  store.addEffect(channel, 'filter');
  await pointsAt('unit-filter');

  for (const type of ['drive', 'delay', 'reverb']) store.addEffect(channel, type, 0);
  store.addMod(channel, 'lfo');
  await pointsAt('unit-filter');
  const scroller = $('.h-factory-scroll')!;
  const before = $('.h-tour-frame')!.getBoundingClientRect().top;
  scroller.scrollTop += 40;
  await expect.poll(() => $('.h-tour-frame')!.getBoundingClientRect().top).toBe(before - 40);
  await pointsAt('unit-filter');
});
