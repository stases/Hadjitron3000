// The oscilloscope's timebase and trigger: which stretch of the latest samples one sweep shows.

import { noteFreq } from './notes';
import type { Sound } from './types';

/** Horizontal divisions of the graticule. */
export const DIVISIONS = 10;
/** Seconds per division, in the 1-2-5 steps of a bench scope. */
const TIMEBASES = [1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2];
/** The timebase when the pitch is unknown: noise, a sample, or nothing played yet. */
const FREE_TIMEBASE = 2e-3;
const MIN_CYCLES = 2.5;
/** The signal must fall below this share of its peak before the next rising zero crossing triggers a sweep. */
const HYSTERESIS = 0.2;

export interface Sweep {
  /** First sample of the sweep; fractional, so the trace does not jitter by whole samples. */
  start: number;
  /** Samples across the full width. */
  length: number;
}

/** The pitch in hertz a sound plays `note` at, or null when its source has no pitch of its own. */
export function fundamental(sound: Sound, note: number): number | null {
  const { type, params } = sound.source;
  if (type !== 'osc' && type !== 'fm') return null;
  return noteFreq(note + (params.pitch as number) + (params.fine as number) / 100);
}

/** Seconds per division: the shortest that shows a few cycles of `freq`. */
export function timebase(freq: number | null): number {
  if (freq === null) return FREE_TIMEBASE;
  return TIMEBASES.find((t) => DIVISIONS * t * freq >= MIN_CYCLES) ?? TIMEBASES[TIMEBASES.length - 1];
}

/**
 * The latest sweep of `length` samples in `s` (oldest sample first) that starts on a rising zero crossing, armed
 * only once the signal has dipped below -HYSTERESIS of its peak. Without such a crossing the sweep shows the
 * latest samples. `length` is limited to half the buffer, so there is always room to look for a crossing.
 */
export function sweep(s: Float32Array, length: number): Sweep {
  length = Math.min(length, s.length / 2);
  const last = Math.floor(s.length - 1 - length);
  let peak = 0;
  for (let i = Math.max(0, last - length); i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
  const arm = -HYSTERESIS * peak;
  // Walk back from the latest possible start. A crossing counts when the next dip below `arm` going back comes
  // before the next crossing, so it is the first crossing after a dip, as a forward-running trigger would fire.
  let crossing = -1;
  for (let i = last; i > 0 && peak > 0; i--) {
    if (s[i - 1] < 0 && s[i] >= 0) crossing = i - 1 + s[i - 1] / (s[i - 1] - s[i]);
    if (s[i - 1] < arm && crossing >= 0) return { start: crossing, length };
  }
  return { start: s.length - 1 - length, length };
}
