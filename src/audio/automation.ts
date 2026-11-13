// Writing envelope segments into AudioParams, and smooth parameter changes.

import { valueAt, type Segment } from '../core/envelope';
import type { GainCurve } from '../core/types';

/** Segments (times relative to `t0`) as they are scheduled on a parameter, multiplied by `scale`. */
export interface Plan {
  t0: number;
  scale: number;
  segs: Segment[];
}

/** Effect, output and modulator parameters follow knob changes with this time constant. */
export const SMOOTH = 0.015;

export function glide(param: AudioParam, value: number, time: number, tau = SMOOTH): void {
  param.setTargetAtTime(value, time, tau);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function schedule(param: AudioParam, plan: Plan): void {
  const { t0, scale } = plan;
  for (const s of plan.segs) {
    param.setValueAtTime(s.from * scale, t0 + s.start);
    if (s.tau === 0) param.linearRampToValueAtTime(s.to * scale, t0 + s.end);
    else param.setTargetAtTime(s.to * scale, t0 + s.start, s.tau);
  }
}

/**
 * Drop everything the plan scheduled from `time` on and hold the parameter at the value it
 * has then (computed, so this does not need cancelAndHoldAtTime). Returns that level, unscaled.
 */
export function cut(param: AudioParam, plan: Plan, time: number): number {
  const u = time - plan.t0;
  const level = valueAt(plan.segs, u);
  const inRamp = plan.segs.some((s) => s.tau === 0 && u > s.start && u < s.end);
  param.cancelScheduledValues(time);
  // Inside a linear ramp the remaining ramp event was cancelled; a ramp to the computed value restores it.
  if (inRamp) param.linearRampToValueAtTime(level * plan.scale, time);
  else param.setValueAtTime(level * plan.scale, time);
  return level;
}

/**
 * Make a parameter follow a gain curve from `t`, in straight lines, holding its last value. `joined` takes over
 * from a curve already running there: the first point is reached by a ramp from that curve's previous point.
 */
export function follow(param: AudioParam, curve: GainCurve, t: number, joined = false): void {
  param.cancelScheduledValues(t);
  if (joined) param.linearRampToValueAtTime(curve[0][1], t);
  else param.setValueAtTime(curve[0][1], t);
  for (const [at, gain] of curve.slice(1)) param.linearRampToValueAtTime(gain, t + at);
}
