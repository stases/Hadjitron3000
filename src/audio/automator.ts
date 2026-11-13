// While the song plays, the automator works out what every automated parameter is worth and hands the engine the
// points of straight lines through those values. The transport and the renderer both drive one, step by step, so an
// export moves its parameters exactly as live playback did.

import { AUTO_GRID, inNote, pointsValue, refKey, refSpec, storedValue } from '../core/automation';
import { barOf } from '../core/meter';
import { fromNorm, toNorm } from '../core/params';
import { songBars } from '../core/sequencer';
import type { NoteEvent, ParamRef, Project } from '../core/types';

/** What the automator moves: the engine, or a recorder in the tests. */
export interface AutomationSink {
  automate(ref: ParamRef, value: number, time: number): void;
  endAutomation(): void;
}

/** A note's lock of a parameter shared by its sound's notes, held in context time from its start to its end. */
interface Held {
  key: string;
  value: number;
  from: number;
  until: number;
}

/**
 * The value of a parameter at a tick is, first, that of the latest note sounding then that locks it, then that of its
 * row, then the stored one. It is sampled on a grid of AUTO_GRID ticks, and a point goes to the engine only where the
 * value changes, together with the sample before the change, so a value that holds costs nothing.
 */
export class Automator {
  private readonly refs = new Map<string, ParamRef>();
  /** The last point handed on for each parameter: its tick and its value 0..1. */
  private readonly last = new Map<string, { tick: number; value: number }>();
  private held: Held[] = [];

  constructor(private readonly sink: AutomationSink) {}

  /** The song starts at `tick`, at context time `time`: every automated parameter moves to its value there. */
  start(project: Project, tick: number, time: number): void {
    for (const row of project.automation) {
      if (row.points.length === 0 || !refSpec(project, row.target)) continue;
      const key = refKey(row.target);
      this.refs.set(key, row.target);
      this.emit(project, key, tick, this.value(project, key, tick, time), time);
    }
  }

  /** A note that starts at context time `time`: its locks of shared parameters hold from then until it ends. */
  hold(project: Project, e: NoteEvent, time: number): void {
    for (const { target, value } of e.locks ?? []) {
      const ref = { owner: e.channelId, ...target };
      if (inNote(target.module) || !refSpec(project, ref)) continue;
      const key = this.register(project, ref);
      this.held.push({ key, value, from: time, until: time + e.dur });
    }
  }

  /** Hand on the points of ticks [from, to); `at` gives the context time of a tick. */
  advance(project: Project, from: number, to: number, at: (tick: number) => number): void {
    for (const row of project.automation) {
      if (row.points.length > 0 && refSpec(project, row.target)) this.register(project, row.target);
    }
    const first = Math.ceil(from / AUTO_GRID) * AUTO_GRID;
    for (const key of this.refs.keys()) {
      if (!refSpec(project, this.refs.get(key)!)) continue;
      for (let tick = first; tick < to; tick += AUTO_GRID) {
        const value = this.value(project, key, tick, at(tick));
        const last = this.last.get(key)!;
        if (value === last.value) continue;
        const before = tick - AUTO_GRID;
        if (last.tick < before && before >= 0) this.emit(project, key, before, last.value, at(before));
        this.emit(project, key, tick, value, at(tick));
      }
    }
    const past = at(first - AUTO_GRID);
    this.held = this.held.filter((h) => h.until >= past);
  }

  /** The song stopped: the engine puts every parameter back. */
  stop(): void {
    this.sink.endAutomation();
  }

  /** Follow a parameter from now on, starting from its stored value. */
  private register(project: Project, ref: ParamRef): string {
    const key = refKey(ref);
    if (!this.refs.has(key)) {
      this.refs.set(key, ref);
      this.last.set(key, { tick: -Infinity, value: toNorm(refSpec(project, ref)!, storedValue(project, ref)) });
    }
    return key;
  }

  private value(project: Project, key: string, tick: number, time: number): number {
    const held = this.held.findLast((h) => h.key === key && h.from <= time && time < h.until);
    if (held) return held.value;
    const row = project.automation.find((r) => r.points.length > 0 && refKey(r.target) === key);
    const ref = this.refs.get(key)!;
    if (!row) return toNorm(refSpec(project, ref)!, storedValue(project, ref));
    const total = songBars(project) * barOf(project.meter).ticks;
    return pointsValue(row.points, total > 0 ? tick % total : tick);
  }

  private emit(project: Project, key: string, tick: number, value: number, time: number): void {
    this.last.set(key, { tick, value });
    const ref = this.refs.get(key)!;
    this.sink.automate(ref, fromNorm(refSpec(project, ref)!, value), time);
  }
}
