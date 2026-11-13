// A look-ahead scheduler: a timer hands the engine every note that starts within the next 120 ms, one step's
// window of ticks at a time, so each note is scheduled exactly once.

import { TICKS_PER_STEP } from '../core/defaults';
import { eventsBetween, stepSeconds, tickTime } from '../core/sequencer';
import type { PlayScope, Project } from '../core/types';
import type { Engine } from './engine';

const TICK_MS = 25;
const LOOKAHEAD = 0.12;
// The first step sounds this long after start(), so it is not already late when scheduled.
const START_DELAY = 0.05;

export class Transport {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Context time of absolute step 0 at the current tempo. */
  private origin = 0;
  private bpm = 120;
  private swing = 0;
  private next = 0;

  constructor(
    private readonly engine: Engine,
    private readonly read: () => { project: Project; scope: PlayScope },
  ) {}

  get playing(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    this.stop();
    const { project } = this.read();
    this.bpm = project.bpm;
    this.swing = project.swing;
    this.origin = this.engine.ctx.currentTime + START_DELAY;
    this.next = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.engine.stopAll();
  }

  position(): number {
    if (this.timer === undefined) return -1;
    const ctx = this.engine.ctx;
    const latency = ctx instanceof AudioContext ? ctx.outputLatency || 0 : 0;
    return Math.max(0, (ctx.currentTime - latency - this.origin) / stepSeconds(this.bpm));
  }

  private tick(): void {
    const { project, scope } = this.read();
    if (project.bpm !== this.bpm || project.swing !== this.swing) {
      // Keep the next unscheduled step on its place in the grid; later steps follow the new tempo.
      this.origin += this.next * (stepSeconds(this.bpm) - stepSeconds(project.bpm));
      this.bpm = project.bpm;
      this.swing = project.swing;
    }
    const now = this.engine.ctx.currentTime;
    while (this.origin + tickTime(this.next * TICKS_PER_STEP, this.bpm, this.swing) < now + LOOKAHEAD) {
      const from = this.next * TICKS_PER_STEP;
      for (const e of eventsBetween(project, scope, from, from + TICKS_PER_STEP)) {
        // After a stall (a throttled timer) notes that should already have started are dropped.
        if (this.origin + e.time >= now) this.engine.play(e.channelId, e.note, e.vel, this.origin + e.time, e.dur);
      }
      this.next++;
    }
  }
}
