// The mix of the song: the level of each lane and the fades of each placement, which the sequencer turns into one
// gain curve per note.

import type { GainCurve, Lane, Placement } from './types';

/** The bottom of a lane's level, which is silence, and the top, in dB. */
export const MIN_LEVEL = -48;
export const MAX_LEVEL = 6;
/** Breakpoints per fade; straight lines between them stay within 0.2 % of the curve. */
const FADE_POINTS = 16;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The linear gain of a lane: 0 when it is muted or at the bottom of its range. */
export function laneGain(lane: Lane): number {
  return lane.mute || lane.level <= MIN_LEVEL ? 0 : 10 ** (lane.level / 20);
}

/** Fades in whole bars that fit inside a placement of `bars` bars, the fade-in first; a fade of 0 is left out. */
export function fitFades(bars: number, fadeIn: number, fadeOut: number): Pick<Placement, 'fadeIn' | 'fadeOut'> {
  const rise = clamp(Math.round(fadeIn), 0, bars);
  const fall = clamp(Math.round(fadeOut), 0, bars - rise);
  return { ...(rise > 0 && { fadeIn: rise }), ...(fall > 0 && { fadeOut: fall }) };
}

/**
 * The gain of a placement's fades `tick` ticks into it, an equal-power curve: the sine of a quarter turn rising
 * over the fade-in and falling over the fade-out. Past the end it is 0 after a fade-out and 1 without one.
 */
export function fadeGain(tick: number, length: number, fadeIn: number, fadeOut: number): number {
  const rise = fadeIn > 0 ? clamp(tick / fadeIn, 0, 1) : 1;
  const fall = fadeOut > 0 ? clamp((length - tick) / fadeOut, 0, 1) : 1;
  return Math.sin((rise * Math.PI) / 2) * Math.sin((fall * Math.PI) / 2);
}

/** A placement as the gain of its notes sees it: its length and fades in ticks, and the gain of its lane. */
export interface Shape {
  length: number;
  fadeIn: number;
  fadeOut: number;
  level: number;
}

const fadePoints = (from: number, span: number) =>
  span > 0 ? Array.from({ length: FADE_POINTS + 1 }, (_, k) => from + (span * k) / FADE_POINTS) : [];

/**
 * The gain curve of a note that sounds from `start` to `end` ticks into a placement; `time` turns those ticks into
 * seconds. A note that ends inside a fade follows it on to the fade's end, so its release keeps rising or falling
 * with the fade, and holds the last value after that. A curve that never changes is a single point.
 */
export function noteCurve(shape: Shape, start: number, end: number, time: (tick: number) => number): GainCurve {
  const { length, fadeIn, fadeOut, level } = shape;
  const until = end < fadeIn ? fadeIn : end > length - fadeOut && end < length ? length : end;
  const inside = new Set([...fadePoints(0, fadeIn), ...fadePoints(length - fadeOut, fadeOut)]);
  const ticks = [start, ...[...inside].filter((t) => t > start && t < until), until];
  const t0 = time(start);
  const curve = ticks.map((t): [number, number] => [time(t) - t0, level * fadeGain(t, length, fadeIn, fadeOut)]);
  return curve.every(([, gain]) => gain === curve[0][1]) ? [[0, curve[0][1]]] : curve;
}
