// Where the cells of the step grid sit, and small questions about the steps of one row.
// The gaps here must match the margins in track.css.

import { ROOT_NOTE } from '../../core/notes';
import type { Step } from '../../core/types';

export const CELL_W = 24;
const GAP = 2;
const BEAT_GAP = 6;
const BAR_GAP = 12;

/** Left edge of column `i` in the lane. */
export function cellX(i: number): number {
  return i * (CELL_W + GAP) + Math.floor(i / 4) * (BEAT_GAP - GAP) + Math.floor(i / 16) * (BAR_GAP - BEAT_GAP);
}

export function laneWidth(columns: number): number {
  return cellX(columns - 1) + CELL_W;
}

/** Width of a step of `len` columns starting at column `i`, across the gaps it covers. */
export function spanWidth(i: number, len: number): number {
  return cellX(i + len - 1) + CELL_W - cellX(i);
}

/** The column under a point of the lane; a gap belongs to the column before it. -1 outside the lane. */
export function columnAt(x: number, columns: number): number {
  if (x < 0 || x >= laneWidth(columns)) return -1;
  let i = Math.min(columns - 1, Math.floor(x / (CELL_W + GAP)));
  while (i > 0 && cellX(i) > x) i--;
  return i;
}

export type Cells = Readonly<Record<number, Step>>;

/** The start of the step that covers column `i`, or -1 when the cell is empty. */
export function stepOver(cells: Cells | undefined, i: number): number {
  for (const key in cells) {
    const start = Number(key);
    if (start <= i && i < start + cells[start].len) return start;
  }
  return -1;
}

/** The longest a step at `start` may be: up to the end of the pattern or the next step of the row. */
export function maxLength(cells: Cells | undefined, start: number, columns: number): number {
  let end = columns;
  for (const key in cells) {
    const other = Number(key);
    if (other > start && other < end) end = other;
  }
  return end - start;
}

// The note a new step of each row gets: the last one used on that row.
const lastNotes = new Map<string, number>();

export const lastNote = (channelId: string) => lastNotes.get(channelId) ?? ROOT_NOTE;

export function rememberNote(channelId: string, note: number): void {
  lastNotes.set(channelId, note);
}
