// The Guide Book's window: whether it is open, docked or in a window of its own, the page (kept in the preferences),
// loading and hearing examples, and running the steps of a worked example.

import { create } from 'zustand';
import { ringOut } from '../../audio';
import { extractBlock } from '../../core/block';
import type { PlayScope, Project } from '../../core/types';
import { addChannel, beginGesture, commitGesture, openProject, setView, useApp } from '../../state/store';
import { playRendered, stopRendered } from '../audio';
import { addBlockToProject, confirmDiscard } from '../commands';
import { setPrefs, usePrefs } from '../prefs';
import { closeTour, startTour } from '../tour/tourStore';
import { closeBookWindow, openBookWindow } from './bookWindow';
import { CHAPTERS, PAGES, findPage, pageKey } from './pages';
import type { Example, WorkedPiece } from './pages';

/** The longest an example rings on after its notes when heard. */
const HEAR_TAIL = 8;
interface BookState {
  open: boolean;
  hearing: Example | null;
  /** How far the example being heard has been rendered, 0..1, until it starts to play; null when it plays. */
  rendering: number | null;
  /** The book's own window while it is detached and open. */
  window: Window | null;
  /** What the status bar says when the book could not open a window of its own. */
  notice: string;
}

const BLOCKED = 'The browser would not open a window for the Guide Book, so it stays here; allow pop-ups to detach it.';

export const useBook = create<BookState>(() => ({
  open: false, hearing: null, rendering: null, window: null, notice: '',
}));

/** Open the book where the reader left it, or at a page, docked or in its own window as it was last. */
export function openBook(chapter?: string, page = 0): void {
  const c = CHAPTERS.find((ch) => ch.id === chapter);
  if (c) turnTo(pageKey(c, page));
  if (usePrefs.getState().bookDetached && !useBook.getState().window) showWindow();
  useBook.setState({ open: true });
}

export function closeBook(): void {
  closeTour();
  stopHearing();
  closeBookWindow();
  useBook.setState({ open: false, window: null, notice: '' });
}

/** Put the book in its own window; when the browser will not open one, it stays docked and says so. */
function showWindow(): boolean {
  const win = openBookWindow(closeBook);
  if (!win) {
    setPrefs({ bookDetached: false });
    useBook.setState({ window: null, notice: BLOCKED });
    return false;
  }
  useBook.setState({ window: win, notice: '' });
  return true;
}

export function detachBook(): void {
  if (showWindow()) setPrefs({ bookDetached: true });
}

export function attachBook(): void {
  closeBookWindow();
  useBook.setState({ window: null });
  setPrefs({ bookDetached: false });
}

/** Show a page; steps under way on the page left end, and so does an example being heard. */
export function turnTo(key: string): void {
  if (key === usePrefs.getState().bookPage) return;
  closeTour();
  stopHearing();
  setPrefs({ bookPage: key });
}

/** The page `by` pages on in reading order, across chapters. */
export function turnBy(by: number): void {
  const { chapter, page } = findPage(usePrefs.getState().bookPage);
  const i = PAGES.findIndex((p) => p.chapter === chapter && p.page === page) + by;
  if (i >= 0 && i < PAGES.length) turnTo(pageKey(CHAPTERS[PAGES[i].chapter], PAGES[i].page));
}

/**
 * Put an example into the app: a sound or a block joins the reader's project, a whole project replaces it after
 * the offer to save. False when the reader cancels or the project has no room.
 */
export async function loadExample(example: Example): Promise<boolean> {
  const project = example.make();
  if (example.kind === 'project') {
    if (!(await confirmDiscard())) return false;
    openProject(project, null);
    return true;
  }
  if (example.kind === 'sound') {
    addChannel(project.channels[0].sound, project.samples);
    setView('factory');
    return true;
  }
  if (!(await addBlockToProject(extractBlock(project, project.patterns[0].id)!))) return false;
  setView('track');
  return true;
}

/**
 * Load a worked example with its first `done` steps already done, as one change of the project: a sound or a
 * block as one undo step, a project as if opened that way.
 */
async function loadDone(piece: WorkedPiece, done: number): Promise<boolean> {
  const project = piece.example.kind === 'project';
  if (!project) beginGesture();
  try {
    if (!(await loadExample(piece.example))) return false;
    for (const step of piece.steps.slice(0, done)) step.act?.(useApp.getState());
  } finally {
    if (!project) commitGesture();
  }
  if (project) openProject(useApp.getState().project, null);
  return true;
}

/** Load a worked example and start its steps, or start them after a checkpoint with the steps before it done. */
export async function startWorked(piece: WorkedPiece, from = 0): Promise<void> {
  if (await loadDone(piece, from)) startTour(piece.steps, from);
}

/** Load the finished state of a worked example: its start with every step done. */
export async function finishWorked(piece: WorkedPiece): Promise<void> {
  if (await loadDone(piece, piece.steps.length)) closeTour();
}

/** What Hear plays of an example: its song when it has one, or its first block. */
export function hearScope(project: Project): PlayScope {
  return project.song.length > 0 ? { kind: 'song' } : { kind: 'pattern', patternId: project.patterns[0].id };
}

/** Play an example without loading it, or stop it when it is the one playing. */
export async function hear(example: Example): Promise<void> {
  if (useBook.getState().hearing === example) return stopHearing();
  useBook.setState({ hearing: example, rendering: 0 });
  const project = example.make();
  const tail = Math.min(HEAR_TAIL, ringOut(project.channels.map((c) => c.sound), project.bpm));
  const mine = () => useBook.getState().hearing === example;
  const playing = await playRendered(project, hearScope(project), tail, {
    onProgress: (fraction) => mine() && useBook.setState({ rendering: fraction }),
    onEnd: () => mine() && useBook.setState({ hearing: null }),
  });
  if (mine()) useBook.setState(playing ? { rendering: null } : { hearing: null, rendering: null });
}

export function stopHearing(): void {
  stopRendered();
  useBook.setState({ hearing: null, rendering: null });
}
