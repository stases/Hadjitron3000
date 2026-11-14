// The sampler's slices: where hits start in a recording, where a region is cut, and how the slices are laid out as
// notes of a block.

import { TICKS_PER_STEP } from './defaults';
import type { NoteInit } from './types';

/** A hit found in a recording: when it starts, in seconds, and how sharply the level rises there, in dB. */
export interface Onset {
  time: number;
  rise: number;
}

// The level after a point is compared with the level before it, over these windows in seconds: short ones for the
// highs, which keep an onset within a hop or two of where the hit starts, and longer ones for the full sound, which
// would otherwise rise and fall with every period of a low note.
const WINDOWS = { high: { before: 0.006, after: 0.002 }, full: { before: 0.02, after: 0.01 } };
const HOP = 0.0007;
// Two hits are at least this far apart.
const GAP = 0.025;
// Rises from below this level under the loudest moment are noise, not hits.
const FLOOR_DB = -50;
// A slice at a hit this close to the region's start would be a sliver, so the start stands for it.
const SLIVER = 0.01;
// The rise a hit needs at full sensitivity and at none.
const MIN_RISE = 3;
const MAX_RISE = 24;

/**
 * Every hit of a recording. The level is measured twice, in full and on its first difference, which weighs the
 * highs, so a hat on the tail of a kick still stands out; a hit is where either rises most within GAP on both sides.
 */
export function detectOnsets(channels: readonly Float32Array[], sampleRate: number): Onset[] {
  const n = channels[0]?.length ?? 0;
  const hop = Math.max(1, Math.round(HOP * sampleRate));
  // Running sums of the squares of the mono mix and of its first difference.
  const full = new Float64Array(n + 1);
  const high = new Float64Array(n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const c of channels) x += c[i];
    x /= channels.length;
    full[i + 1] = full[i] + x * x;
    high[i + 1] = high[i] + (x - prev) * (x - prev);
    prev = x;
  }
  const bands = ([[full, WINDOWS.full], [high, WINDOWS.high]] as const).map(([sums, w]) => {
    const before = Math.max(1, Math.round(w.before * sampleRate));
    const after = Math.max(1, Math.round(w.after * sampleRate));
    const mean = (a: number, b: number) => (sums[Math.min(b, n)] - sums[Math.max(a, 0)]) / (b - a);
    let loudest = 0;
    for (let t = 0; t + after <= n; t += hop) loudest = Math.max(loudest, mean(t, t + after));
    const floor = loudest * 10 ** (FLOOR_DB / 10);
    return (t: number) => {
      const now = mean(t, t + after);
      return now > floor ? 10 * Math.log10(now / (mean(t - before, t) + floor)) : 0;
    };
  });
  const times: number[] = [];
  const rises: number[] = [];
  for (let t = hop; t < n; t += hop) {
    times.push(t);
    rises.push(Math.max(bands[0](t), bands[1](t)));
  }
  // A hit is the latest of the highest rises within GAP: the after window starts on it, not a little before.
  const reach = Math.round(GAP * sampleRate / hop);
  const onsets: Onset[] = [];
  for (let k = 0; k < rises.length; k++) {
    if (rises[k] < MIN_RISE) continue;
    let peak = true;
    for (let j = Math.max(0, k - reach); j <= Math.min(rises.length - 1, k + reach) && peak; j++) {
      peak = j < k ? rises[j] <= rises[k] : j === k || rises[j] < rises[k];
    }
    if (peak) onsets.push({ time: times[k] / sampleRate, rise: rises[k] });
  }
  return onsets;
}

/**
 * The rise in dB a hit needs at a sensitivity from 0 to 1, from MAX_RISE down to MIN_RISE in equal ratios: halfway,
 * 8.5 dB, a hat on the tail of a snare still counts and the wobble of a fading note does not.
 */
export const riseFor = (sens: number) => MAX_RISE * (MIN_RISE / MAX_RISE) ** sens;

/**
 * Where the region from `start` to `end` seconds is cut: `slices` equal pieces ('2' to '32'), or one at every onset
 * that rises enough for the sensitivity ('hits'). The start, every cut and the end, in order; null for 'off'.
 */
export function sliceBounds(
  start: number, end: number, slices: string, onsets: readonly Onset[], sens: number,
): number[] | null {
  if (slices === 'off' || end <= start) return null;
  if (slices !== 'hits') {
    const n = Number(slices);
    return Array.from({ length: n + 1 }, (_, k) => start + ((end - start) * k) / n);
  }
  const cuts = onsets
    .filter((o) => o.rise >= riseFor(sens) && o.time > start + SLIVER && o.time < end - SLIVER)
    .map((o) => o.time);
  return [start, ...cuts, end];
}

/**
 * The notes that play the slices one after another as they were recorded: slice k on note 60 + k, at its place in
 * the recording at `rate` times its speed and `bpm`, on the nearest step from tick 0, each lasting until the next.
 * `ticks` is how long the slices take in all.
 */
export function sliceNotes(bounds: readonly number[], rate: number, bpm: number): { notes: NoteInit[]; ticks: number } {
  const perSecond = (bpm / 60) * 4 * TICKS_PER_STEP;
  const step = (t: number) => Math.round(((t - bounds[0]) / rate) * perSecond / TICKS_PER_STEP) * TICKS_PER_STEP;
  const starts = bounds.map(step);
  const notes = starts.slice(0, -1).map((start, k) => ({
    start, len: Math.max(TICKS_PER_STEP, starts[k + 1] - start), note: 60 + k, vel: 0.8,
  }));
  const last = notes.at(-1);
  return { notes, ticks: last ? last.start + last.len : 0 };
}
