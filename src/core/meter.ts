// Time signatures. A bar of beats/unit has beats * 16 / unit steps, grouped into beats: four steps (a quarter note)
// in x/4, six (a dotted quarter) in 6/8, 9/8 and 12/8, and in 5/8 and 7/8 four with the remainder, six, last.

import { MAX_BARS, TICKS_PER_STEP } from './defaults';
import type { Meter } from './types';

export const METERS: readonly Meter[] = [
  [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8],
];

/** One bar of a meter. */
export interface Bar {
  steps: number;
  ticks: number;
  /** The step each beat starts on, from 0. */
  beats: readonly number[];
}

export const DEFAULT_METER: Meter = [4, 4];

const bars = new Map<string, Bar>();

export const meterText = ([beats, unit]: Meter) => `${beats}/${unit}`;

/** The bar of a meter; the same object every time, so it can be compared and memoised. */
export function barOf(meter: Meter): Bar {
  const key = meterText(meter);
  let bar = bars.get(key);
  if (!bar) {
    const [beats, unit] = meter;
    const steps = (beats * 16) / unit;
    const sizes = unit === 4 ? Array<number>(beats).fill(4)
      : beats % 3 === 0 ? Array<number>(beats / 3).fill(6)
        : [...Array<number>((beats - 3) / 2).fill(4), 6];
    const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
    bar = { steps, ticks: steps * TICKS_PER_STEP, beats: starts };
    bars.set(key, bar);
  }
  return bar;
}

/** The beat of a bar that step `s` of the bar falls in, from 0. */
export function beatOf(s: number, bar: Bar): number {
  let beat = 0;
  while (beat + 1 < bar.beats.length && bar.beats[beat + 1] <= s) beat++;
  return beat;
}

/**
 * The beats that start on ticks in [from, to), with bars counted from tick 0 both ways (a count-in has negative
 * ticks); the first beat of each bar is its downbeat.
 */
export function beatsBetween(from: number, to: number, bar: Bar): { tick: number; downbeat: boolean }[] {
  const beats: { tick: number; downbeat: boolean }[] = [];
  for (let start = Math.floor(from / bar.ticks) * bar.ticks; start < to; start += bar.ticks) {
    for (const step of bar.beats) {
      const tick = start + step * TICKS_PER_STEP;
      if (tick >= from && tick < to) beats.push({ tick, downbeat: step === 0 });
    }
  }
  return beats;
}

/** The meter a value names, or null when it is not one of METERS. */
export function readMeter(value: unknown): Meter | null {
  const meter = Array.isArray(value) && value.length === 2
    ? METERS.find((m) => m[0] === value[0] && m[1] === value[1]) : undefined;
  return meter ? [meter[0], meter[1]] : null;
}

/** The fewest bars, at least one and at most MAX_BARS, that hold `ticks`. */
export function barsToHold(ticks: number, bar: Bar): number {
  return Math.min(MAX_BARS, Math.max(1, Math.ceil(ticks / bar.ticks)));
}

/** The length of the longest block in ticks, in the longest bar; no note starts at or after it. */
export const MAX_TICKS = MAX_BARS * Math.max(...METERS.map((m) => barOf(m).ticks));
