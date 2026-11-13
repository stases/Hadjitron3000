// Writing envelope segments into AudioParams, smooth parameter changes, and the curves of automated parameters.

import { valueAt, type Segment } from '../core/envelope';
import type { GainCurve, Params } from '../core/types';
import type { Effect } from './modules/effects';

/** Segments (times relative to `t0`) as they are scheduled on a parameter, multiplied by `scale`. */
export interface Plan {
  t0: number;
  scale: number;
  segs: Segment[];
}

/** Effect, output and modulator parameters follow knob changes with this time constant. */
export const SMOOTH = 0.015;

/** Glides are noted down here instead of made while `rampWith` asks an update what it would set. */
let noted: [AudioParam, number][] | null = null;

export function glide(param: AudioParam, value: number, time: number, tau = SMOOTH): void {
  if (noted) noted.push([param, value]);
  else param.setTargetAtTime(value, time, tau);
}

function note(run: () => void): [AudioParam, number][] {
  noted = [];
  try {
    run();
    return noted;
  } finally {
    noted = null;
  }
}

/**
 * Automation through an update that moves its AudioParams only with `glide`: the AudioParams whose value depends on
 * parameter `id` go in a straight line to their values for `p`, arriving at `time`. Which ones depend on it is found
 * by asking the update what it would set, once for `p` and once with the parameter moved, without setting anything.
 */
export function rampWith(update: (p: Params) => void, p: Params, id: string, time: number): void {
  const target = note(() => update(p));
  const moved = note(() => update({ ...p, [id]: (p[id] as number) + 1 }));
  target.forEach(([param, value], i) => {
    if (moved[i]?.[1] !== value) param.linearRampToValueAtTime(value, time);
  });
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

/** After the song stops, an automated parameter glides back to its stored value this long after its last point. */
export const RELEASE = 0.05;
// Points of a curve this much older than the newest are forgotten.
const KEEP = 2;

/** The points an automated parameter was given, in context time and its own units: straight lines between them. */
export class Curve {
  private points: [number, number][] = [];

  add(time: number, value: number): void {
    const old = this.points.findLastIndex(([t]) => t < time - KEEP);
    if (old > 0) this.points = this.points.slice(old);
    this.points.push([time, value]);
  }

  /** The value at `t`, holding the first point before it and the last after it. */
  at(t: number): number {
    const i = this.points.findLastIndex(([time]) => time <= t);
    if (i < 0) return this.points[0][1];
    if (i === this.points.length - 1) return this.points[i][1];
    const [t0, v0] = this.points[i];
    const [t1, v1] = this.points[i + 1];
    return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }

  /** The times of the points after `t`. */
  after(t: number): number[] {
    return this.points.flatMap(([time]) => (time > t ? [time] : []));
  }

  end(): number {
    return this.points[this.points.length - 1][0];
  }
}

/** An effect of a chain and its stored parameters. */
export interface Placed {
  fx: Effect;
  params: Params;
}

/**
 * The automated parameters of a part of the graph by module and parameter id, with the curves they follow. An effect
 * with `ramp` follows in straight lines; one without is stepped through its `update` whenever `flush` is called.
 */
export class Automated {
  private readonly curves = new Map<string, Curve>();
  /** Effects without `ramp` that have points to follow, by module id: the time of the latest one. */
  private readonly steps = new Map<string, number>();

  add(module: string, param: string, value: number, time: number): void {
    const key = `${module}.${param}`;
    let curve = this.curves.get(key);
    if (!curve) this.curves.set(key, (curve = new Curve()));
    curve.add(time, value);
  }

  has(module: string, param: string): boolean {
    return this.curves.has(`${module}.${param}`);
  }

  at(module: string, param: string, t: number): number | undefined {
    return this.curves.get(`${module}.${param}`)?.at(t);
  }

  /** Every curve with its module and parameter. */
  entries(): [module: string, param: string, curve: Curve][] {
    return [...this.curves].map(([key, curve]) => {
      const dot = key.indexOf('.');
      return [key.slice(0, dot), key.slice(dot + 1), curve];
    });
  }

  /** A module's parameters with the automated ones at their values at `t`; the same object when none is automated. */
  overlay(module: string, params: Params, t: number): Params {
    const own = this.entries().filter(([m]) => m === module);
    return own.length === 0 ? params : { ...params, ...Object.fromEntries(own.map(([, p, curve]) => [p, curve.at(t)])) };
  }

  /** Move an effect's parameter to the value its curve has at `time`. */
  moveEffect(module: string, param: string, { fx, params }: Placed, bpm: number, time: number): void {
    if (fx.ramp) fx.ramp(this.overlay(module, params, time), bpm, param, time);
    else this.steps.set(module, Math.max(time, this.steps.get(module) ?? time));
  }

  /** Step the effects without `ramp` to their values now. */
  flush(now: number, find: (module: string) => Placed | undefined, bpm: number): void {
    for (const [module, until] of this.steps) {
      const placed = find(module);
      placed?.fx.update(this.overlay(module, placed.params, now), bpm);
      if (!placed || until <= now) this.steps.delete(module);
    }
  }

  /**
   * Every parameter goes back to its stored value after its last point, and its curve is forgotten: an effect's
   * through the effect, any other through `back`.
   */
  release(
    now: number, find: (module: string) => Placed | undefined, bpm: number,
    back?: (module: string, param: string, time: number) => void,
  ): void {
    const entries = this.entries();
    this.curves.clear();
    this.steps.clear();
    for (const [module, param, curve] of entries) {
      const time = Math.max(curve.end(), now) + RELEASE;
      const placed = find(module);
      if (placed?.fx.ramp) placed.fx.ramp(placed.params, bpm, param, time);
      else if (placed) placed.fx.update(placed.params, bpm);
      else back?.(module, param, time);
    }
  }
}
