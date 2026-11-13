// The sheet of the piano roll: where ticks and pitches sit, snapping, what lies under the pointer, how a drag
// changes the notes, the clipboard, and the background. Time uses the step grid's columns (steps.ts) at one pixel
// per tick, so the roll and the grid are the same sheet.

import { STEPS_PER_BAR, TICKS_PER_STEP } from '../../core/defaults';
import { MAX_NOTE, MIN_NOTE, isBlackKey } from '../../core/notes';
import type { Note, NoteInit } from '../../core/types';
import { CELL_W, cellX, columnAt, laneWidth } from './steps';

/** Height of one semitone. */
export const ROW_H = 12;
export const SHEET_H = (MAX_NOTE - MIN_NOTE + 1) * ROW_H;
export const BAR_TICKS = STEPS_PER_BAR * TICKS_PER_STEP;
const BEAT_TICKS = 4 * TICKS_PER_STEP;
const EDGE_PX = 4;

/** The snap choices, in ticks. */
export const SNAPS = [
  { label: '1/16', ticks: 24 },
  { label: '1/32', ticks: 12 },
  { label: '1/8 triplet', ticks: 32 },
  { label: '1/16 triplet', ticks: 16 },
  { label: 'Off', ticks: 1 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Left edge of a tick on the sheet. */
export function tickX(t: number): number {
  const step = Math.floor(t / TICKS_PER_STEP);
  return cellX(step) + t - step * TICKS_PER_STEP;
}

/** Right edge of something that ends at tick `t`: on a step line that is the right edge of the cell before it. */
export function endX(t: number): number {
  return t % TICKS_PER_STEP === 0 ? cellX(t / TICKS_PER_STEP - 1) + CELL_W : tickX(t);
}

/** The tick under a point of the sheet, from 0 to the end of the block; a gap counts as the step line after it. */
export function tickAt(x: number, columns: number): number {
  const at = clamp(Math.floor(x), 0, laneWidth(columns) - 1);
  const column = columnAt(at, columns);
  return column * TICKS_PER_STEP + Math.min(TICKS_PER_STEP, at - cellX(column));
}

export const noteY = (note: number) => (MAX_NOTE - note) * ROW_H;

export const pitchAt = (y: number) => clamp(MAX_NOTE - Math.floor(y / ROW_H), MIN_NOTE, MAX_NOTE);

export const snapFloor = (t: number, unit: number) => Math.floor(t / unit) * unit;
export const snapRound = (t: number, unit: number) => Math.round(t / unit) * unit;
const snapCeil = (t: number, unit: number) => Math.ceil(t / unit) * unit;

/** Where a note of the block is drawn; a note longer than what is left of the block is cut at its end. */
export function noteBox(n: Note, blockTicks: number): Box {
  const top = noteY(n.note);
  return { left: tickX(n.start), right: endX(Math.min(n.start + n.len, blockTicks)), top, bottom: top + ROW_H };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Part = 'start' | 'body' | 'end';

/**
 * The note under a point of the sheet and the part of it there: a few pixels at either end are its edges. Where
 * notes overlap, the one that starts last is on top.
 */
export function noteAt(
  notes: readonly Note[], x: number, y: number, blockTicks: number,
): { note: Note; part: Part } | null {
  const pitch = pitchAt(y);
  let found: Note | null = null;
  for (const n of notes) {
    if (n.note !== pitch || n.start >= blockTicks || (found && n.start < found.start)) continue;
    const box = noteBox(n, blockTicks);
    if (x >= box.left && x < box.right) found = n;
  }
  if (!found) return null;
  const { left, right } = noteBox(found, blockTicks);
  const edge = Math.min(EDGE_PX, Math.floor((right - left) / 3));
  return { note: found, part: x >= right - edge ? 'end' : x < left + edge ? 'start' : 'body' };
}

/** The ids of the notes a rubber band touches. */
export function notesIn(notes: readonly Note[], band: Box, blockTicks: number): string[] {
  return notes.flatMap((n) => {
    if (n.start >= blockTicks) return [];
    const b = noteBox(n, blockTicks);
    return b.left < band.right && b.right > band.left && b.top < band.bottom && b.bottom > band.top ? [n.id] : [];
  });
}

/**
 * The selected notes while they are dragged `ticks` later and `semitones` higher by the part of `grab` that was
 * pressed. The body moves them all by whole snap units, so notes between grid lines keep their place; an edge puts
 * the grabbed note's start or end on the nearest grid line and moves the others' by as much. Nothing leaves the
 * block or the note range, and no note gets shorter than a tick.
 */
export function dragNotes(
  origin: readonly Note[], grab: Note, part: Part, ticks: number, semitones: number, unit: number, blockTicks: number,
): Note[] {
  const starts = origin.map((n) => n.start);
  const ends = origin.map((n) => n.start + n.len);
  const shortest = Math.min(...origin.map((n) => n.len));
  const room = Math.max(0, blockTicks - Math.max(...ends));
  if (part === 'body') {
    const pitches = origin.map((n) => n.note);
    const dt = clamp(snapRound(ticks, unit), -Math.min(...starts), room);
    const dn = clamp(semitones, MIN_NOTE - Math.min(...pitches), MAX_NOTE - Math.max(...pitches));
    return origin.map((n) => ({ ...n, start: n.start + dt, note: n.note + dn }));
  }
  if (part === 'start') {
    const dt = clamp(snapRound(grab.start + ticks, unit) - grab.start, -Math.min(...starts), shortest - 1);
    return origin.map((n) => ({ ...n, start: n.start + dt, len: n.len - dt }));
  }
  const end = grab.start + grab.len;
  let to = snapRound(end + ticks, unit);
  if (to <= grab.start) to = snapFloor(grab.start, unit) + unit;
  const dl = clamp(to - end, 1 - shortest, room);
  return origin.map((n) => ({ ...n, len: n.len + dl }));
}

/**
 * The notes a velocity bar near `x` stands for: those that start where the bar is, or only the selected ones among
 * them when there are any, so the notes of a chord can be set together or one by one.
 */
export function velocityGroup(notes: readonly Note[], selected: readonly string[], x: number): Note[] {
  let start = -1;
  for (const n of notes) {
    const left = tickX(n.start);
    if (x >= left - 2 && x < left + 7 && n.start > start) start = n.start;
  }
  const at = notes.filter((n) => n.start === start);
  const chosen = at.filter((n) => selected.includes(n.id));
  return chosen.length > 0 ? chosen : at;
}

/** The length of a note drawn from `start` to the pointer at tick `at`: to the grid line after it, at least a unit. */
export function drawnLength(start: number, at: number, unit: number, blockTicks: number): number {
  return clamp(snapCeil(at + 1, unit) - start, unit, blockTicks - start);
}

/** Copied notes: starts counted from the grid line before the first of them, and how far a copy goes. */
export interface Clip {
  notes: NoteInit[];
  span: number; // ticks from the clip's start to the grid line at or after its last end
}

/** Lift notes for the clipboard. `origin` is the tick the clip starts at in the block it came from. */
export function makeClip(notes: readonly Note[], unit: number): { clip: Clip; origin: number } {
  const origin = snapFloor(Math.min(...notes.map((n) => n.start)), unit);
  const end = Math.max(...notes.map((n) => n.start + n.len));
  const lifted = notes.map(({ id: _, ...n }) => ({ ...n, start: n.start - origin }));
  return { clip: { notes: lifted, span: snapCeil(end - origin, unit) }, origin };
}

/** A clip put down at tick `at`: notes that would start past the block are left out and none reaches past its end. */
export function placeClip(clip: Clip, at: number, blockTicks: number): NoteInit[] {
  return clip.notes.flatMap((n) => {
    const start = n.start + at;
    return start < blockTicks ? [{ ...n, start, len: Math.min(n.len, blockTicks - start) }] : [];
  });
}

/** A tick as bar.beat.sixteenth, all counted from 1, with the ticks past the sixteenth after a plus: "2.1.3+8". */
export function positionText(t: number): string {
  const off = t % TICKS_PER_STEP;
  const text = `${Math.floor(t / BAR_TICKS) + 1}.${Math.floor((t % BAR_TICKS) / BEAT_TICKS) + 1}.${
    Math.floor((t % BEAT_TICKS) / TICKS_PER_STEP) + 1}`;
  return off ? `${text}+${off}` : text;
}

/** The tick of a position typed as bar, bar.beat or bar.beat.sixteenth, then "+ticks" if wanted; NaN if unreadable. */
export function parsePosition(text: string): number {
  const m = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\s*\+\s*(\d+))?\s*$/.exec(text);
  if (!m) return NaN;
  const [bar, beat = 1, six = 1, off = 0] = m.slice(1).map((v) => (v === undefined ? undefined : Number(v)));
  if (bar! < 1 || beat < 1 || six < 1) return NaN;
  return (bar! - 1) * BAR_TICKS + (beat - 1) * BEAT_TICKS + (six - 1) * TICKS_PER_STEP + off;
}

/** A length in ticks as steps, with up to two decimals: "1.5", "0.67", "2". */
export function stepsText(ticks: number): string {
  return String(Math.round((ticks / TICKS_PER_STEP) * 100) / 100);
}

/** The ticks of a length typed in steps; NaN if unreadable. */
export function parseSteps(text: string): number {
  return Math.round(parseFloat(text.replace(',', '.')) * TICKS_PER_STEP);
}

const GAP = 'color-mix(in srgb, var(--face-lo) 70%, var(--lo))';

/** Hard-edged stripes along one axis of `length` pixels: [colour, from, to] in order, transparent between them. */
function stripes(direction: string, length: number, runs: [string, number, number][]): string {
  const stops: string[] = [];
  let at = 0;
  for (const [color, from, to] of runs) {
    if (from > at) stops.push(`transparent ${at}px ${from}px`);
    stops.push(`${color} ${from}px ${to}px`);
    at = to;
  }
  if (at < length) stops.push(`transparent ${at}px ${length}px`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/** The gaps between the steps as on the grid, repeating every bar. */
export function gapsBackground(): { backgroundImage: string; backgroundSize: string } {
  const bar = cellX(STEPS_PER_BAR);
  const gaps: [string, number, number][] = Array.from({ length: STEPS_PER_BAR }, (_, i) =>
    [GAP, cellX(i) + CELL_W, cellX(i + 1)]);
  return { backgroundImage: stripes('to right', bar, gaps), backgroundSize: `${bar}px 100%` };
}

/**
 * The sheet's background, repeating every octave and every bar: white and black key rows with a line between B and
 * C and between E and F, the gaps between the steps as on the grid, and a light line at each snap position that
 * falls inside a cell.
 */
export function sheetBackground(unit: number): { backgroundImage: string; backgroundSize: string } {
  const bar = cellX(STEPS_PER_BAR);
  const octave = 12 * ROW_H;
  const rows: [string, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const note = MAX_NOTE - i;
    const top = i * ROW_H;
    const line = note % 12 === 0 || note % 12 === 5;
    rows.push([isBlackKey(note) ? 'var(--face-lo)' : 'var(--face)', top, top + ROW_H - (line ? 1 : 0)]);
    if (line) rows.push(['var(--face-lo)', top + ROW_H - 1, top + ROW_H]);
  }
  const lines: [string, number, number][] = [];
  for (let t = unit; unit > 1 && t < BAR_TICKS; t += unit) {
    if (t % TICKS_PER_STEP !== 0) lines.push(['var(--face-hi)', tickX(t), tickX(t) + 1]);
  }
  const gaps = gapsBackground();
  const layers = [gaps.backgroundImage, stripes('to bottom', octave, rows)];
  const sizes = [gaps.backgroundSize, `100% ${octave}px`];
  if (lines.length > 0) {
    layers.unshift(stripes('to right', bar, lines));
    sizes.unshift(`${bar}px 100%`);
  }
  return { backgroundImage: layers.join(', '), backgroundSize: sizes.join(', ') };
}
