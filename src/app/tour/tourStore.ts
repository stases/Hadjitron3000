// Guided steps: what each step says, the control it points at (the element with that data-tour attribute), the view
// it opens in, and how to tell that the user has done it. The Guide Book runs them; this keeps the running ones.

import { create } from 'zustand';
import type { Level } from '../../core/levels';
import type { Project } from '../../core/types';
import { selectChannel, selectPattern, setView, useApp } from '../../state/store';
import type { AppState, View } from '../../state/store';
import { showFold } from '../../ui/factory/levels';
import { closeRoll, openRoll } from '../../ui/track/rollState';
import type { DialogKind } from '../dialogStore';

/** What a step can look at: the app now, the project the steps started from, and the open dialog. */
export interface Look {
  state: AppState;
  start: Project;
  dialog: DialogKind | null;
}

export interface TourStep {
  title?: string;
  text: string;
  target?: string;
  view?: View;
  /** The sound and the block to show while the step is current, by name, and whether the sound's row is in the roll. */
  select?: { sound?: string; block?: string; roll?: boolean };
  /** Sections folded away in beginner mode that the step needs on screen: a unit type (or view part) and a level. */
  unfold?: (state: AppState) => [type: string, level: Level][];
  /** True once the user has done what the step asks; 'press' means pressing the target is all it takes. */
  done?: ((look: Look) => boolean) | 'press';
  /** Does what the step asks, for a scripted run and for loading the state after it. */
  act?: (state: AppState) => void;
}

interface TourState {
  steps: readonly TourStep[] | null;
  index: number;
  done: boolean; // stays true for the rest of the step once the user has done it
  ticked: readonly number[]; // the steps the user has done so far
  start: Project | null; // the project the steps began with
}

export const useTour = create<TourState>(() => ({ steps: null, index: 0, done: false, ticked: [], start: null }));

/** Shows what a step needs: its view, the sound and block it is about, and its folded sections. */
export function showStep(step: TourStep): void {
  if (step.view) setView(step.view);
  const { project } = useApp.getState();
  const channel = project.channels.find((c) => c.sound.name === step.select?.sound);
  const pattern = project.patterns.find((p) => p.name === step.select?.block);
  if (channel) selectChannel(channel.id);
  if (pattern) selectPattern(pattern.id);
  if (channel && step.select?.roll) openRoll(channel.id);
  if (step.select?.roll === false) closeRoll();
  for (const [type, level] of step.unfold?.(useApp.getState()) ?? []) showFold(type, level);
}

function go(index: number): void {
  const { steps } = useTour.getState();
  const step = steps?.[index];
  if (!step) return closeTour();
  useTour.setState({ index, done: false });
  showStep(step);
}

/** Run steps from the first one (or `from`), on the project as it is now. */
export function startTour(steps: readonly TourStep[], from = 0): void {
  useTour.setState({ steps, ticked: [...Array(from).keys()], start: useApp.getState().project });
  go(from);
}

/** The next step; after the last one the steps end. */
export function nextStep(): void {
  go(useTour.getState().index + 1);
}

export function previousStep(): void {
  go(Math.max(0, useTour.getState().index - 1));
}

export function markDone(): void {
  useTour.setState((s) => ({ done: true, ticked: s.ticked.includes(s.index) ? s.ticked : [...s.ticked, s.index] }));
}

export function closeTour(): void {
  useTour.setState({ steps: null, index: 0, done: false, ticked: [], start: null });
}
