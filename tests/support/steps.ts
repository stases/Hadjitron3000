// Tests write rows the way the step grid shows them: step index -> note, velocity and length in steps.

import { TICKS_PER_STEP, newNote } from '../../src/core/defaults';
import type { Note } from '../../src/core/types';

export interface StepSpec {
  note: number;
  vel: number;
  len: number; // steps, may be a fraction
}

/** A row of notes from a map of steps, sorted, with ids n0, n1, ... in step order. */
export function notesOf(steps: Record<number, StepSpec>): Note[] {
  return Object.entries(steps)
    .map(([i, s]) => ({
      start: Number(i) * TICKS_PER_STEP, len: Math.round(s.len * TICKS_PER_STEP), note: s.note, vel: s.vel,
    }))
    .sort((a, b) => a.start - b.start)
    .map((n, i) => ({ id: `n${i}`, ...n }));
}

/** The rows of a block from maps of steps. */
export function rowsOf(rows: Record<string, Record<number, StepSpec>>): Record<string, Note[]> {
  return Object.fromEntries(Object.entries(rows).map(([id, steps]) => [id, notesOf(steps)]));
}

/** One note a step long at step `i`, as the grid writes it. */
export function stepNote(i: number, note = 60, id = `n${i}`): Note {
  return { id, ...newNote(i * TICKS_PER_STEP, note) };
}

/** A row of on-grid notes read back as steps: start step -> note, velocity and length in steps. */
export function stepsOf(notes: readonly Note[] | undefined): Record<number, StepSpec> {
  return Object.fromEntries((notes ?? []).map((n) =>
    [n.start / TICKS_PER_STEP, { note: n.note, vel: n.vel, len: n.len / TICKS_PER_STEP }]));
}
