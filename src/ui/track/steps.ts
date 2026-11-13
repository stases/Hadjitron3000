// Where the cells of the step grid sit in the project's meter, and how the notes of one row fall into them.

import { TICKS_PER_STEP } from '../../core/defaults';
import { beatOf } from '../../core/meter';
import type { Bar } from '../../core/meter';
import { ROOT_NOTE } from '../../core/notes';
import type { Note } from '../../core/types';
import { resizeNotes } from '../../state/store';

export const CELL_W = 24;
const GAP = 2;
const BEAT_GAP = 6;
const BAR_GAP = 12;

/** Left edge of column `i` in the lane: a wider gap before each beat, and a wider one still before each bar. */
export function cellX(i: number, bar: Bar): number {
  const bars = Math.floor(i / bar.steps);
  const beats = bars * (bar.beats.length - 1) + beatOf(i - bars * bar.steps, bar);
  return i * (CELL_W + GAP) + beats * (BEAT_GAP - GAP) + bars * (BAR_GAP - GAP);
}

export function laneWidth(columns: number, bar: Bar): number {
  return cellX(columns - 1, bar) + CELL_W;
}

/** Width of a key of `len` columns starting at column `i`, across the gaps it covers. */
export function spanWidth(i: number, len: number, bar: Bar): number {
  return cellX(i + len - 1, bar) + CELL_W - cellX(i, bar);
}

/** The space after column `i` before the next one. */
export const gapAfter = (i: number, bar: Bar) => cellX(i + 1, bar) - cellX(i, bar) - CELL_W;

/** True when column `i` starts a beat. */
export const onBeat = (i: number, bar: Bar) => bar.beats.includes(i % bar.steps);

/** The column under a point of the lane; a gap belongs to the column before it. -1 outside the lane. */
export function columnAt(x: number, columns: number, bar: Bar): number {
  if (x < 0 || x >= laneWidth(columns, bar)) return -1;
  let i = Math.min(columns - 1, Math.floor(x / (CELL_W + GAP)));
  while (i > 0 && cellX(i, bar) > x) i--;
  return i;
}

/** The notes of a row that start inside one step: what one cell of the grid shows. */
export interface Cell {
  index: number;
  notes: Note[]; // lowest first
  span: number; // columns, up to the end of its longest note
}

export function makeCell(index: number, notes: readonly Note[]): Cell {
  const end = Math.max(...notes.map((n) => n.start + n.len));
  return {
    index,
    notes: [...notes].sort((a, b) => a.note - b.note),
    span: Math.max(1, Math.ceil(end / TICKS_PER_STEP) - index),
  };
}

export type Cells = ReadonlyMap<number, Cell>;

/** A cell the grid cannot show whole: a chord, or a note that starts between grid lines. */
export function richCell(cell: Cell): boolean {
  return cell.notes.length > 1 || cell.notes.some((n) => n.start % TICKS_PER_STEP !== 0);
}

/** The notes of a row grouped by the step they start in. */
export function rowCells(notes: readonly Note[] | undefined): Map<number, Cell> {
  const groups = new Map<number, Note[]>();
  for (const n of notes ?? []) {
    const index = Math.floor(n.start / TICKS_PER_STEP);
    groups.set(index, [...(groups.get(index) ?? []), n]);
  }
  return new Map([...groups].map(([index, group]) => [index, makeCell(index, group)]));
}

/** The cell that covers column `i`: one starting there, else the latest one reaching over it; -1 when empty. */
export function stepOver(cells: Cells, i: number): number {
  if (cells.has(i)) return i;
  let found = -1;
  for (const cell of cells.values()) {
    if (cell.index < i && i < cell.index + cell.span && cell.index > found) found = cell.index;
  }
  return found;
}

/** The most columns a cell at `start` may cover: up to the end of the block or the next cell of the row. */
export function maxLength(cells: Cells, start: number, columns: number): number {
  let end = columns;
  for (const index of cells.keys()) if (index > start && index < end) end = index;
  return end - start;
}

/**
 * A cell's notes when its key is made `columns` long: the longest ones end at the new edge and none reaches past
 * it, so the shorter notes of a chord keep their length.
 */
export function fitNotes(cell: Cell, columns: number): Note[] {
  const edge = (cell.index + columns) * TICKS_PER_STEP;
  const longest = Math.max(...cell.notes.map((n) => n.start + n.len));
  return cell.notes.map((n) => {
    const end = n.start + n.len;
    return end === longest || end > edge ? { ...n, len: edge - n.start } : n;
  });
}

/** Make a cell's key `columns` long in the document. Call it inside a gesture to make it one undo step. */
export function resizeCell(patternId: string, channelId: string, cell: Cell, columns: number): void {
  fitNotes(cell, columns).forEach((n, i) => {
    const change = n.len - cell.notes[i].len;
    if (change !== 0) resizeNotes(patternId, channelId, [n.id], change);
  });
}

// The note a new step of each row gets: the last one used on that row.
const lastNotes = new Map<string, number>();

export const lastNote = (channelId: string) => lastNotes.get(channelId) ?? ROOT_NOTE;

export function rememberNote(channelId: string, note: number): void {
  lastNotes.set(channelId, note);
}
