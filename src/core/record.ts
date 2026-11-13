// Notes played in by hand while a block plays on repeat: where on the transport's clock they were heard, and how
// they land in the block.

import type { Bar } from './meter';
import { tickTime, timeTick } from './sequencer';
import type { NoteInit } from './types';

/** The transport's clock while it runs: the context time of tick 0, and the tempo and swing it counts in. */
export interface Clock {
  origin: number;
  bpm: number;
  swing: number;
}

/** The Quantize choices, in ticks; 0 is Off. */
export const QUANTIZE: readonly { label: string; ticks: number }[] = [
  { label: 'Off', ticks: 0 },
  { label: '1/16', ticks: 24 },
  { label: '1/32', ticks: 12 },
  { label: '1/8T', ticks: 32 },
  { label: '1/16T', ticks: 16 },
];

/**
 * The tick the listener was hearing when something happened at context time `time`: sound takes `latency` seconds
 * from the clock to the ear, so the loop heard then was scheduled that much earlier. Fractional, and negative
 * during a count-in.
 */
export function heardTick(clock: Clock, time: number, latency: number): number {
  return timeTick(time - latency - clock.origin, clock.bpm, clock.swing);
}

/**
 * The grid line nearest to a tick by where they sound. Lines run every `unit` ticks from the start of each bar; with
 * swing they are heard where `tickTime` puts them, so the line heard closest to the tick wins.
 */
export function quantize(tick: number, unit: number, bar: Bar, bpm: number, swing: number): number {
  const barStart = Math.floor(tick / bar.ticks) * bar.ticks;
  const before = barStart + Math.floor((tick - barStart) / unit) * unit;
  const after = Math.min(before + unit, barStart + bar.ticks);
  const at = tickTime(tick, bpm, swing);
  return at - tickTime(before, bpm, swing) <= tickTime(after, bpm, swing) - at ? before : after;
}

/** How a pass writes its notes: the grid (0 for Off), the bar, the tempo and swing, and the block's length in ticks. */
export interface TakeGrid {
  unit: number;
  bar: Bar;
  bpm: number;
  swing: number;
  length: number;
}

/**
 * The note a key held from heard tick `down` to `up` writes into a block that repeats from tick 0. With a grid its
 * start goes to the nearest line and its length to whole units, at least one; without, both are whole ticks. A note
 * held across the end of the block is cut there. Null for a note that lands before the first beat (in the count-in).
 */
export function takeNote(down: number, up: number, grid: TakeGrid, note: number, vel: number): NoteInit | null {
  const { unit, length } = grid;
  const start = unit ? quantize(down, unit, grid.bar, grid.bpm, grid.swing) : Math.round(down);
  if (start < 0 || length <= 0) return null;
  const held = up - down;
  const len = unit ? Math.max(1, Math.round(held / unit)) * unit : Math.max(1, Math.round(held));
  const at = start % length;
  return { start: at, len: Math.min(len, length - at), note, vel };
}
