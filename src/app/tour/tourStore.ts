// The running tutorial: which lesson, which step, and whether the user has done what the step asks.

import { create } from 'zustand';
import type { Project } from '../../core/types';
import { setView, useApp } from '../../state/store';
import { newProject } from '../commands';
import { LESSONS } from './lessons';
import type { LessonId } from './lessons';

interface TourState {
  lesson: LessonId | null;
  index: number;
  done: boolean; // stays true for the rest of the step once the user has done it
  start: Project | null; // the project the lesson began with
}

export const useTour = create<TourState>(() => ({ lesson: null, index: 0, done: false, start: null }));

function go(index: number): void {
  const { lesson } = useTour.getState();
  const step = lesson && LESSONS[lesson].steps[index];
  if (!step) return closeTour();
  useTour.setState({ index, done: false });
  if (step.view) setView(step.view);
}

/** Start a lesson on a new project, after offering to save unsaved changes. */
export async function startLesson(lesson: LessonId): Promise<void> {
  if (!(await newProject())) return;
  useTour.setState({ lesson, start: useApp.getState().project });
  go(0);
}

/** The next step; after the last one the tutorial ends. */
export function nextStep(): void {
  go(useTour.getState().index + 1);
}

export function previousStep(): void {
  go(Math.max(0, useTour.getState().index - 1));
}

export function markDone(): void {
  useTour.setState({ done: true });
}

export function closeTour(): void {
  useTour.setState({ lesson: null, index: 0, done: false, start: null });
}
