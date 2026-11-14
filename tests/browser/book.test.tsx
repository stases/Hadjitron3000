import { clear, createStore } from 'idb-keyval';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { App } from '../../src/app/App';
import * as audio from '../../src/app/audio';
import { closeDialog, openDialog, useDialogs } from '../../src/app/dialogStore';
import { closeBook, finishWorked, openBook, startWorked, turnTo, useBook } from '../../src/app/book/bookStore';
import { MAKE_A_SONG, MAKE_A_SOUND } from '../../src/app/book/chapters/01-first-steps';
import { CHAPTERS, pageKey } from '../../src/app/book/pages';
import type { Example, WorkedPiece } from '../../src/app/book/pages';
import { installKeys } from '../../src/app/keys';
import { setPrefs, usePrefs } from '../../src/app/prefs';
import { restoreSession, saveSession } from '../../src/app/session';
import { closeTour, showStep, useTour } from '../../src/app/tour/tourStore';
import { platform } from '../../src/platform';
import { demoProject } from '../../src/presets/projects';
import { useFolds } from '../../src/ui/factory/levels';
import { extractBlock } from '../../src/core/block';
import { newSound } from '../../src/core/defaults';
import * as store from '../../src/state/store';

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  tap: vi.fn(),
  audition: vi.fn(async () => {}),
  playRendered: vi.fn(async () => true),
  stopRendered: vi.fn(),
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
  usePrefs.setState({
    beginner: true, bookPage: '', bookContents: true, bookDetached: false, bookWindow: { width: 440, height: 640 },
  });
  useFolds.setState({}, true);
  vi.spyOn(platform.library, 'list').mockResolvedValue([]);
});

afterEach(async () => {
  await userEvent.cleanup();
  flushSync(() => {
    closeBook();
    useDialogs.setState({ dialog: null, messages: [] });
  });
  store.setPlaying(false);
  root?.root.unmount();
  root?.host.remove();
  root = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const bookButton = (label: string) => $$('.h-book .h-button').find((b) => b.textContent === label) as HTMLButtonElement;
const stepButton = (label: string) =>
  $$('.h-book-step.is-current .h-button').find((b) => b.textContent === label) as HTMLButtonElement;
const dialogButton = (label: string) => $$('.h-dialog .h-button').find((b) => b.textContent === label)!;
const target = (name: string) => $(`[data-tour="${name}"]`)!;
const count = () => $('.h-book-step.is-current .h-book-count')?.textContent;
const ticked = () => !!$('.h-book-step.is-current .h-book-done');
const nextIsPrimary = () => stepButton(useTour.getState().index === useTour.getState().steps!.length - 1
  ? 'Finish' : 'Next').classList.contains('is-primary');
const pageTitle = () => $('.h-book-title')?.textContent;

async function next(): Promise<void> {
  const { index, steps } = useTour.getState();
  await userEvent.click(stepButton(index === steps!.length - 1 ? 'Finish' : 'Next'));
}

/** Waits for the step to say it is done, then goes on. */
async function doneThenNext(): Promise<void> {
  await expect.poll(ticked).toBe(true);
  expect(nextIsPrimary()).toBe(true);
  await next();
}

/** The frame sits three pixels outside the target, and the book never covers the target. */
async function pointsAt(name: string): Promise<void> {
  await expect.poll(() => {
    const t = target(name)?.getBoundingClientRect();
    const f = $('.h-tour-frame')?.getBoundingClientRect();
    return !!t && !!f && [f.left, f.top, f.right, f.bottom].join() === [
      Math.round(t.left) - 3, Math.round(t.top) - 3, Math.round(t.left) + Math.round(t.width) + 3,
      Math.round(t.top) + Math.round(t.height) + 3].join();
  }).toBe(true);
  const t = target(name).getBoundingClientRect();
  const b = $('.h-book')!.getBoundingClientRect();
  expect(t.right <= b.left || t.left >= b.right || t.bottom <= b.top || t.top >= b.bottom).toBe(true);
}

/** Opens the book at a lesson of the first chapter and starts it, as the Welcome window does. */
async function lesson(piece: WorkedPiece): Promise<void> {
  flushSync(() => openBook('first-steps', piece === MAKE_A_SOUND ? 2 : 3));
  await startWorked(piece);
}

test('the first launch offers the lessons and the book once, and never again by itself', async () => {
  await clear(sessionStore);
  expect(await restoreSession()).toBe(true);
  expect(state().project.name).toBe('Welcome');
  expect(await restoreSession()).toBe(false);
  await saveSession();
  expect(await restoreSession()).toBe(false);

  openDialog({ kind: 'welcome' });
  renderApp();
  expect($('.h-dialog .h-titlebar-text')!.textContent).toBe('Welcome to Hadjitron 3000');
  expect($$('.h-dialog .h-button').map((b) => b.textContent))
    .toEqual(['Listen to the Demo', 'Make a Sound', 'Make a Song', 'Guide Book']);
  await userEvent.click(dialogButton('Listen to the Demo'));
  expect($('.h-dialog')).toBeNull();
  expect($('.h-book')).toBeNull();
  expect(state().project.name).toBe('Welcome');

  openDialog({ kind: 'welcome' });
  await expect.poll(() => $('.h-dialog')).not.toBeNull();
  await userEvent.click(dialogButton('Make a Song'));
  await expect.poll(count).toBe('Step 1 of 14');
  expect(pageTitle()).toBe('Lesson: make a song');
  expect(state().project.name).toBe('Untitled');
  expect(state().view).toBe('track');

  flushSync(closeBook);
  openDialog({ kind: 'welcome' });
  await expect.poll(() => $('.h-dialog')).not.toBeNull();
  await userEvent.click(dialogButton('Guide Book'));
  expect($('.h-dialog')).toBeNull();
  expect(pageTitle()).toBe('Lesson: make a song');
});

test('the Help menu opens the book, which turns its pages and remembers where the reader stopped', async () => {
  renderApp();
  await userEvent.click($$('.h-menubar-item').find((el) => el.textContent === 'Help')!);
  await userEvent.click($$('.h-menu-item').find((el) => el.textContent === 'Guide Book…')!);
  expect(pageTitle()).toBe(CHAPTERS[0].pages[0].title);
  expect(bookButton('Previous').disabled).toBe(true);
  await userEvent.click(bookButton('Next'));
  expect(pageTitle()).toBe(CHAPTERS[0].pages[1].title);
  expect(JSON.parse(localStorage.getItem('hadjitron-prefs')!).bookPage).toBe(pageKey(CHAPTERS[0], 1));

  const last = CHAPTERS[0].pages.length - 1;
  flushSync(() => turnTo(pageKey(CHAPTERS[0], last)));
  await userEvent.click(bookButton('Next'));
  expect(pageTitle()).toBe(CHAPTERS[1].pages[0].title);
  expect($('.h-book-chapter')!.textContent).toBe(`Chapter 2 · ${CHAPTERS[1].title}`);
  await userEvent.click(bookButton('Previous'));
  expect(pageTitle()).toBe(CHAPTERS[0].pages[last].title);

  const rows = $$('.h-book-contents .h-list-row');
  expect(rows.map((r) => r.textContent)).toEqual([
    `1. ${CHAPTERS[0].title}`, ...CHAPTERS[0].pages.slice(1).map((p) => p.title),
    ...CHAPTERS.slice(1).map((c, i) => `${i + 2}. ${c.title}`),
  ]);
  const second = rows.find((r) => r.textContent === `2. ${CHAPTERS[1].title}`)!;
  second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await expect.poll(pageTitle).toBe(CHAPTERS[1].pages[0].title);

  await userEvent.click(bookButton('Contents'));
  expect($('.h-book-contents')).toBeNull();
  await userEvent.click($('.h-book [aria-label="Close"]')!);
  expect($('.h-book')).toBeNull();
  flushSync(() => openBook());
  expect(pageTitle()).toBe(CHAPTERS[1].pages[0].title);
  expect($('.h-book-contents')).toBeNull();
});

test('Make a Sound can be walked from the first step to the last by doing each thing', async () => {
  const write = vi.spyOn(platform.library, 'write').mockResolvedValue();
  renderApp();
  await lesson(MAKE_A_SOUND);
  const channel = () => state().channelId!;

  await expect.poll(count).toBe('Step 1 of 13');
  expect($('.h-tour-frame')).toBeNull();
  expect(nextIsPrimary()).toBe(true);
  expect(stepButton('Back').disabled).toBe(true);
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

  await pointsAt('unit-filter');
  expect(ticked()).toBe(false);
  await userEvent.click($('[data-tour="unit-filter"] .h-led')!);
  await doneThenNext();

  await pointsAt('unit-filter');
  store.setParam(channel(), 'filter', 'cutoff', 300);
  await doneThenNext();

  await pointsAt('add-modulator');
  const env = store.addMod(channel(), 'env')!;
  await doneThenNext();

  await pointsAt('mod-env');
  store.setModTarget(channel(), env, { module: 'filter', param: 'cutoff' });
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
  expect($('.h-book-step.is-current')).toBeNull();
  expect($('.h-tour-frame')).toBeNull();
  expect($('.h-book')).not.toBeNull();
  expect(state().project.channels.at(-1)!.sound.name).toBe('Pluck Bass');
});

test('Make a Song can be walked from the first step to the last by doing each thing', async () => {
  renderApp();
  await lesson(MAKE_A_SONG);
  const block = () => state().patternId;

  await pointsAt('grid');
  await next();

  await pointsAt('row-Kick');
  for (const column of [0, 4, 8, 12]) {
    await userEvent.click($$(`[data-tour="row-Kick"] .h-track-cell`)[column]);
  }
  await doneThenNext();
  for (const step of MAKE_A_SONG.steps.slice(2, 5)) step.act!(state());
  await doneThenNext();
  await doneThenNext();
  await doneThenNext();

  await pointsAt('copy-block');
  const a = block();
  await userEvent.click(target('copy-block'));
  await doneThenNext();
  expect(block()).not.toBe(a);
  expect(ticked()).toBe(false);
  MAKE_A_SONG.steps[6].act!(state());
  await doneThenNext();

  await pointsAt('tab-song');
  await userEvent.click(target('tab-song'));
  await doneThenNext();

  await pointsAt('timeline');
  for (const step of MAKE_A_SONG.steps.slice(8, 11)) {
    step.act!(state());
    await doneThenNext();
  }

  await pointsAt('play');
  await userEvent.click(target('play'));
  await doneThenNext();

  await pointsAt('menu-file');
  MAKE_A_SONG.steps[12].act!(state());
  await expect.poll(ticked).toBe(true);
  flushSync(closeDialog);
  await next();

  expect(count()).toBe('Step 14 of 14');
  await next();
  expect($('.h-book-step.is-current')).toBeNull();
  expect(state().project.song).toHaveLength(3);
});

test('Back and Next move through the steps and switch the view, and the close box ends them', async () => {
  renderApp();
  await lesson(MAKE_A_SONG);
  for (let i = 0; i < 8; i++) await next();
  await expect.poll(count).toBe('Step 9 of 14');
  expect(state().view).toBe('song');
  await userEvent.click(stepButton('Back'));
  expect(count()).toBe('Step 8 of 14');
  expect(state().view).toBe('track');
  await next();
  expect(state().view).toBe('song');

  await userEvent.click($('.h-book [aria-label="Close"]')!);
  expect($('.h-book')).toBeNull();
  expect($('.h-tour-frame')).toBeNull();
  expect(useTour.getState().steps).toBeNull();
  store.setBpm(99);
  expect(state().project.bpm).toBe(99);
  expect(state().view).toBe('song');
});

test('turning the page ends the steps under way', async () => {
  renderApp();
  await lesson(MAKE_A_SONG);
  await expect.poll(count).toBe('Step 1 of 14');
  await userEvent.click(bookButton('Previous'));
  expect(useTour.getState().steps).toBeNull();
  expect($('.h-tour-frame')).toBeNull();
});

test('a done step stays done until the step changes, and a step done beforehand says so at once', async () => {
  renderApp();
  await lesson(MAKE_A_SONG);
  for (let i = 0; i < 11; i++) await next();
  await expect.poll(count).toBe('Step 12 of 14');
  expect(ticked()).toBe(false);
  store.setPlaying(true);
  await expect.poll(ticked).toBe(true);
  store.setPlaying(false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(ticked()).toBe(true);
  await userEvent.click(stepButton('Back'));
  expect(ticked()).toBe(false);
  await next();
  expect(ticked()).toBe(false);
  await userEvent.click(stepButton('Back'));
  store.setPlaying(true);
  await next();
  expect(ticked()).toBe(true);
  expect(nextIsPrimary()).toBe(true);
  expect($$('.h-book-step-mark .h-icon').length).toBeGreaterThanOrEqual(1);
});

test('a lesson and a whole project offer to save the project first and leave it alone when cancelled', async () => {
  renderApp();
  store.setBpm(101);
  const started = lesson(MAKE_A_SOUND);
  await expect.poll(() => $('.h-message-text')?.textContent).toBe('Save changes to Welcome?');
  await userEvent.click($$('.h-message-buttons .h-button').find((b) => b.textContent === 'Cancel')!);
  await started;
  expect(useTour.getState().steps).toBeNull();
  expect(state().project.bpm).toBe(101);

  flushSync(() => turnTo(pageKey(CHAPTERS[0], 1)));
  await userEvent.click(bookButton('Load this example'));
  await expect.poll(() => $('.h-message-text')?.textContent).toBe('Save changes to Welcome?');
  await userEvent.click($$('.h-message-buttons .h-button').find((b) => b.textContent === "Don't Save")!);
  await expect.poll(() => state().project.bpm).toBe(126);
  expect(state().dirty).toBe(false);
});

test('a sound or a block joins the project without asking, as one step of Undo with its finished steps', async () => {
  renderApp();
  store.setBpm(101);
  const comb = CHAPTERS.find((c) => c.id === 'effects')!.pages.find((p) => p.title === 'Comb')!;
  const piece = comb.pieces.find((p) => typeof p !== 'string' && p.kind === 'worked') as WorkedPiece;
  const before = state().project.channels.length;
  await finishWorked(piece);
  expect($('.h-message-text')).toBeNull();
  expect(state().project.channels).toHaveLength(before + 1);
  const sound = state().project.channels.at(-1)!.sound;
  expect(sound.chain.map((m) => m.type)).toEqual(['crusher', 'comb']);
  expect(sound.mods[0].target?.param).toBe('freq');
  expect(state().view).toBe('factory');
  store.undo();
  expect(state().project.channels).toHaveLength(before);
  expect(state().project.bpm).toBe(101);
});

test('a checkpoint loads the steps before it done and goes on from there', async () => {
  renderApp();
  const comb = CHAPTERS.find((c) => c.id === 'effects')!.pages.find((p) => p.title === 'Comb')!;
  const piece = comb.pieces.find((p) => typeof p !== 'string' && p.kind === 'worked') as WorkedPiece;
  await startWorked(piece, 2);
  expect(useTour.getState().index).toBe(2);
  expect(useTour.getState().ticked).toEqual([0, 1]);
  expect(state().project.channels.at(-1)!.sound.chain.map((m) => m.type)).toEqual(['crusher']);
});

test('Hear plays an example without loading it, and stops it when pressed again or when it ends', async () => {
  renderApp();
  flushSync(() => openBook('effects', 1));
  const before = state().project;
  const hear = () => $$('.h-book-side .h-button').find((b) => /Hear it|Stop/.test(b.textContent!))!;
  await userEvent.click(hear());
  await expect.poll(() => vi.mocked(audio.playRendered).mock.calls.length).toBe(1);
  const [project, scope] = vi.mocked(audio.playRendered).mock.lastCall!;
  expect(project.channels[0].sound.name).toBe('Saw Chord');
  expect(scope).toEqual({ kind: 'pattern', patternId: project.patterns[0].id });
  expect(hear().textContent).toBe('Stop');
  expect(useBook.getState().hearing).not.toBeNull();
  await userEvent.click(hear());
  expect(audio.stopRendered).toHaveBeenCalled();
  await expect.poll(() => hear().textContent).toBe('Hear it');

  await userEvent.click(hear());
  const ended = vi.mocked(audio.playRendered).mock.lastCall![3]!.onEnd!;
  flushSync(ended);
  expect(hear().textContent).toBe('Hear it');
  expect(state().project).toBe(before);
});

test('Hear says how far it has got while it gets an example ready, and Stop gives up on it', async () => {
  renderApp();
  flushSync(() => openBook('effects', 1));
  let progress: (fraction: number) => void = () => {};
  vi.mocked(audio.playRendered).mockImplementationOnce(async (_p, _s, _t, opts) => {
    progress = opts!.onProgress!;
    return new Promise<boolean>(() => {});
  });
  const hear = () => $$('.h-book-side .h-button').find((b) => /Hear it|Stop/.test(b.textContent!))!;
  const note = () => document.querySelector('.h-book-rendering')?.textContent;
  await userEvent.click(hear());
  await expect.poll(note).toBe('Getting it ready... 0 %');
  flushSync(() => progress(0.4));
  expect(note()).toBe('Getting it ready... 40 %');
  await userEvent.click(hear());
  expect(audio.stopRendered).toHaveBeenCalled();
  await expect.poll(note).toBeUndefined();
  flushSync(() => progress(0.8));
  expect(note()).toBeUndefined();
  expect(hear().textContent).toBe('Hear it');
});

test('the frame follows its target when the target appears and when it scrolls', async () => {
  await page.viewport(1024, 680);
  renderApp();
  await lesson(MAKE_A_SOUND);
  store.addChannel(newSound('osc', 'Oscillator'));
  for (let i = 0; i < 8; i++) await next();
  await expect.poll(count).toBe('Step 9 of 13');
  const channel = state().channelId!;
  expect($('.h-tour-frame')).toBeNull();
  store.addMod(channel, 'env');
  await pointsAt('mod-env');

  for (const type of ['drive', 'delay', 'reverb', 'filter']) store.addEffect(channel, type, 0);
  await pointsAt('mod-env');
  const scroller = $('.h-factory-scroll')!;
  const before = $('.h-tour-frame')!.getBoundingClientRect().top;
  scroller.scrollTop += 40;
  await expect.poll(() => $('.h-tour-frame')!.getBoundingClientRect().top).toBe(before - 40);
  await pointsAt('mod-env');
});

describe('every step of every worked example points at a control that is on screen', () => {
  const pieces = CHAPTERS.flatMap((c) => c.pages.flatMap((p) => p.pieces.filter((piece): piece is WorkedPiece =>
    typeof piece !== 'string' && piece.kind === 'worked')));

  /** Put an example into the app the way Load does, without asking. */
  function load(example: Example): void {
    const project = example.make();
    if (example.kind === 'project') return store.openProject(project, null);
    store.openProject(demoProject(), null);
    if (example.kind === 'sound') store.addChannel(project.channels[0].sound, project.samples);
    else store.insertBlock(extractBlock(project, project.patterns[0].id)!);
  }

  for (const beginner of [true, false]) {
    test(beginner ? 'in beginner mode' : 'in pro mode', async () => {
      usePrefs.setState({ beginner });
      renderApp();
      for (const piece of pieces) {
        flushSync(() => load(piece.example));
        for (const [i, step] of piece.steps.entries()) {
          flushSync(() => showStep(step));
          if (step.target) {
            const message = `${piece.example.title}, step ${i + 1}: ${step.target}`;
            await expect.poll(() => !!target(step.target!), { message }).toBe(true);
          }
          if (step.act) flushSync(() => step.act!(state()));
        }
        flushSync(() => {
          closeTour();
          useDialogs.setState({ dialog: null });
        });
      }
    }, 60_000);
  }
});

describe('the book in a window of its own', () => {
  const win = () => useBook.getState().window!;
  const $w = <T extends Element = HTMLElement>(sel: string) => win().document.querySelector<T>(sel);
  const $$w = (sel: string) => [...win().document.querySelectorAll<HTMLElement>(sel)];
  const windowButton = (label: string) => $$w('.h-book .h-button, .h-book .h-title-button')
    .find((b) => b.textContent === label)!;
  const titleButton = (label: string) => $$('.h-book .h-title-button').find((b) => b.textContent === label)!;
  const status = () => $('.h-statusfield')!.textContent;
  const windowCount = () => $w('.h-book-step.is-current .h-book-count')?.textContent;

  async function detach(): Promise<void> {
    await userEvent.click(titleButton('Detach'));
    await expect.poll(() => $w('.h-book-title')?.textContent).toBeTruthy();
  }

  test('Detach moves the book into its own window and gives the views its width; Attach brings it back', async () => {
    renderApp();
    flushSync(() => openBook('first-steps', 1));
    const docked = $('.h-app-views')!.getBoundingClientRect().width;
    await detach();
    expect($('.h-book')).toBeNull();
    expect($('.h-app-views')!.getBoundingClientRect().width).toBeGreaterThan(docked + 300);
    expect(win().document.title).toBe('Guide Book');
    expect(getComputedStyle($w('.h-book')!).position).toBe('fixed');
    expect($w('.h-book-title')!.textContent).toBe(CHAPTERS[0].pages[1].title);
    expect(usePrefs.getState().bookDetached).toBe(true);

    flushSync(() => windowButton('Next').click());
    expect($w('.h-book-title')!.textContent).toBe(CHAPTERS[0].pages[2].title);
    const third = $$w('.h-book-contents .h-list-row').find((r) => r.textContent === `3. ${CHAPTERS[2].title}`)!;
    flushSync(() => third.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect($w('.h-book-title')!.textContent).toBe(CHAPTERS[2].pages[0].title);

    const opened = win();
    flushSync(() => windowButton('Attach').click());
    await expect.poll(() => opened.closed).toBe(true);
    expect(useBook.getState().open).toBe(true);
    expect(pageTitle()).toBe(CHAPTERS[2].pages[0].title);
    expect(titleButton('Detach')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('hadjitron-prefs')!).bookDetached).toBe(false);
  });

  test('the detached book loads an example after the offer to save in the main window, and hears one', async () => {
    renderApp();
    store.setBpm(101);
    flushSync(() => openBook('first-steps', 1));
    await detach();
    flushSync(() => windowButton('Load this example').click());
    await expect.poll(() => $('.h-message-text')?.textContent).toBe('Save changes to Welcome?');
    expect(win().document.body.inert).toBe(true);
    await userEvent.click($$('.h-message-buttons .h-button').find((b) => b.textContent === "Don't Save")!);
    await expect.poll(() => state().project.bpm).toBe(126);
    await expect.poll(() => win().document.body.inert).toBe(false);

    flushSync(() => turnTo(pageKey(CHAPTERS.find((c) => c.id === 'effects')!, 1)));
    const hear = () => $$w('.h-book-side .h-button').find((b) => /Hear it|Stop/.test(b.textContent!))!;
    flushSync(() => hear().click());
    await expect.poll(() => vi.mocked(audio.playRendered).mock.calls.length).toBe(1);
    await expect.poll(() => hear().textContent).toBe('Stop');
    flushSync(() => hear().click());
    expect(audio.stopRendered).toHaveBeenCalled();
    await expect.poll(() => hear().textContent).toBe('Hear it');
  });

  test('a guided step in the detached book frames its control in the main window', async () => {
    renderApp();
    flushSync(() => openBook('first-steps', 3));
    await detach();
    await startWorked(MAKE_A_SONG);
    await expect.poll(windowCount).toBe('Step 1 of 14');
    const framed = (name: string) => {
      const t = target(name)?.getBoundingClientRect();
      const f = $('.h-tour-frame')?.getBoundingClientRect();
      return !!t && !!f && f.left === Math.round(t.left) - 3 && f.top === Math.round(t.top) - 3;
    };
    await expect.poll(() => framed('grid')).toBe(true);
    flushSync(() => $$w('.h-book-step.is-current .h-button').find((b) => b.textContent === 'Next')!.click());
    await expect.poll(windowCount).toBe('Step 2 of 14');
    await expect.poll(() => framed('row-Kick')).toBe(true);

    await finishWorked(MAKE_A_SONG);
    expect(state().project.song).toHaveLength(3);
    await expect.poll(() => $('.h-tour-frame')).toBeNull();
  });

  test('keys pressed in the book window reach the app, except the reading keys, which scroll the page', async () => {
    renderApp();
    flushSync(() => openBook('first-steps', 0));
    await detach();
    const key = (k: string, code = k, init: KeyboardEventInit = {}) => flushSync(() => win().document.body
      .dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...init })));
    key(' ', 'Space');
    expect(state().playing).toBe(true);
    key(' ', 'Space');
    expect(state().playing).toBe(false);
    store.setBpm(99);
    key('z', 'KeyZ', { ctrlKey: true, metaKey: true });
    expect(state().project.bpm).toBe(126);

    const page = $w('.h-book-page')!;
    page.style.height = '200px';
    key('PageDown');
    expect(page.scrollTop).toBeGreaterThan(0);
    key('Home');
    expect(page.scrollTop).toBe(0);
    store.setView('track');
    const step = { channelId: state().project.channels[0].id, index: 0 };
    store.selectStep(step);
    key('ArrowRight');
    expect(state().step).toEqual(step);
    const removeKeys = installKeys();
    flushSync(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    removeKeys();
    expect(state().step).toEqual({ ...step, index: 1 });
  });

  test('closing the window closes the book, which opens again detached at the size it had', async () => {
    renderApp();
    flushSync(() => openBook());
    await detach();
    const { innerWidth: width, innerHeight: height } = win();
    win().close();
    await expect.poll(() => useBook.getState().open).toBe(false);
    expect(useBook.getState().window).toBeNull();
    expect($('.h-book')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('hadjitron-prefs')!);
    expect(stored.bookDetached).toBe(true);
    expect(stored.bookWindow).toMatchObject({ width, height });

    setPrefs({ bookWindow: { width: 500, height: 600, left: 40, top: 30 } });
    const open = vi.spyOn(window, 'open');
    flushSync(() => openBook());
    expect(open.mock.lastCall![2]).toBe('popup,width=500,height=600,left=40,top=30');
    expect($('.h-book')).toBeNull();
    expect($w('.h-book')).not.toBeNull();
    flushSync(closeBook);
    expect(useBook.getState().window).toBeNull();
    expect(usePrefs.getState().bookDetached).toBe(true);
  });

  test('a blocked pop-up leaves the book docked and says so in the status bar', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderApp();
    flushSync(() => openBook());
    await userEvent.click(titleButton('Detach'));
    expect($('.h-book')).not.toBeNull();
    expect(useBook.getState().window).toBeNull();
    expect(usePrefs.getState().bookDetached).toBe(false);
    await userEvent.hover($('.h-app-views')!);
    await expect.poll(status).toMatch(/^The browser would not open a window for the Guide Book/);

    flushSync(closeBook);
    expect(status()).not.toMatch(/Guide Book/);
    flushSync(() => setPrefs({ bookDetached: true }));
    flushSync(() => openBook());
    expect($('.h-book')).not.toBeNull();
    expect(usePrefs.getState().bookDetached).toBe(false);
  });
});
