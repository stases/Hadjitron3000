// The ADSR shape, defined once: the engine schedules audio parameters from these
// segments and the interface draws the same curve.

import type { Params } from './types';

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/**
 * A piece of the curve from `start` to `end` (seconds). With `tau` 0 it is a straight
 * line from `from` to `to`; otherwise an exponential approach from `from` towards `to`
 * with time constant `tau`, cut off at `end`.
 */
export interface Segment {
  start: number;
  end: number;
  from: number;
  to: number;
  tau: number;
}

const MIN_ATTACK = 0.001;
const MIN_DECAY = 0.001;
const MIN_RELEASE = 0.005;

export function adsrOf(params: Params): Adsr {
  return {
    attack: params.attack as number,
    decay: params.decay as number,
    sustain: params.sustain as number,
    release: params.release as number,
  };
}

function segmentValue(seg: Segment, t: number): number {
  const u = Math.min(Math.max(t, seg.start), seg.end) - seg.start;
  if (seg.tau === 0) return seg.end === seg.start ? seg.to : seg.from + ((seg.to - seg.from) * u) / (seg.end - seg.start);
  return seg.to + (seg.from - seg.to) * Math.exp(-u / seg.tau);
}

/**
 * Release from `level` at time `at`: an exponential fall with time constant release / 4,
 * finished by the tangent line, which reaches exactly 0 at release * 1.25.
 */
export function releaseSegments(level: number, at: number, release: number): Segment[] {
  const r = Math.max(release, MIN_RELEASE);
  const knee = level * Math.exp(-4);
  return [
    { start: at, end: at + r, from: level, to: 0, tau: r / 4 },
    { start: at + r, end: at + 1.25 * r, from: knee, to: 0, tau: 0 },
  ];
}

/**
 * The envelope of a note held `gate` seconds (Infinity while held), starting from `from`. Given `at`, it is the rest
 * of that envelope from `at` on, with the level `from` there: the attack goes on to its peak when `at` falls inside
 * it, otherwise the level settles towards sustain. A note tied to the next one goes on this way without restarting.
 */
export function envelopeSegments(env: Adsr, gate = Infinity, from = 0, at = 0): Segment[] {
  const a = Math.max(env.attack, MIN_ATTACK);
  const g = Math.max(gate, at);
  const segs: Segment[] = [];
  if (at < a) {
    const end = Math.min(a, g);
    segs.push({ start: at, end, from, to: from + ((1 - from) * (end - at)) / (a - at), tau: 0 });
  }
  if (g > Math.max(a, at)) {
    const start = Math.max(a, at);
    segs.push({ start, end: g, from: at < a ? 1 : from, to: env.sustain, tau: Math.max(env.decay, MIN_DECAY) / 4 });
  }
  if (segs.length === 0) segs.push({ start: at, end: at, from, to: from, tau: 0 });
  if (g === Infinity) return segs;
  return segs.concat(releaseSegments(valueAt(segs, g), g, env.release));
}

export function valueAt(segs: Segment[], t: number): number {
  if (t < segs[0].start) return segs[0].from;
  for (const seg of segs) if (t < seg.end) return segmentValue(seg, t);
  return segmentValue(segs[segs.length - 1], t);
}

/** Level `t` seconds after note-on for a note held `gate` seconds. */
export function envelopeAt(env: Adsr, t: number, gate = Infinity, from = 0): number {
  return valueAt(envelopeSegments(env, gate, from), t);
}
