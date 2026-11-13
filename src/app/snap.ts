// Where notes land while Snap to Scale is on: on the notes of the project's scale. Without the switch or a scale every
// pitch is allowed. Notes already in a block are only changed by a gesture that moves them, never silently.

import { MAX_NOTE, MIN_NOTE } from '../core/notes';
import { inScale, nearestInScale } from '../core/scale';
import type { Scale } from '../core/types';
import { useApp } from '../state/store';
import { usePrefs } from './prefs';

/** The scale notes snap to now, or undefined when they do not snap. */
export function snapScale(): Scale | undefined {
  return usePrefs.getState().scaleSnap ? useApp.getState().project.scale : undefined;
}

/** A pitch as a new, dragged, recorded or step-entered note gets it. */
export const snapPitch = (note: number) => nearestInScale(note, snapScale());

/** The pitch one step up (1) or down (-1) from `note`: the next note of the scale while snapping, else a semitone. */
export function stepPitch(note: number, dir: 1 | -1): number {
  const scale = snapScale();
  let next = note + dir;
  while (!inScale(next, scale) && next > MIN_NOTE && next < MAX_NOTE) next += dir;
  return Math.min(MAX_NOTE, Math.max(MIN_NOTE, next));
}
