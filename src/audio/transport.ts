// A look-ahead scheduler: a timer hands the engine every note that starts within the next 120 ms, one step's
// window of ticks at a time, so each note is scheduled exactly once.

import { TICKS_PER_STEP } from '../core/defaults';
import type { Clock } from '../core/record';
import { eventsBetween, stepSeconds, tickTime } from '../core/sequencer';
import type { NoteEvent, PlayScope, Project } from '../core/types';
import type { Engine } from './engine';

const TICK_MS = 25;
const LOOKAHEAD = 0.12;
// The first step sounds this long after start(), so it is not already late when scheduled.
const START_DELAY = 0.05;

/** How long sound takes from the context's clock to the speakers: its processing latency and the device's. */
export function outputDelay(ctx: BaseAudioContext): number {
  return ctx instanceof AudioContext ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : 0;
}

/** Start one note of the sequencer at context time `time`; live playback and export both play notes here. */
export function playEvent(engine: Engine, e: NoteEvent, time: number): void {
  engine.play(e.channelId, e.note, e.vel, time, e.dur, e.slide, e.gain);
}

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

  /** Start from tick 0, `lead` seconds from now (the count-in). */
  start(lead = 0): void {
    this.stop();
    const { project } = this.read();
    this.bpm = project.bpm;
    this.swing = project.swing;
    this.origin = this.engine.ctx.currentTime + START_DELAY + lead;
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

  /** The clock the transport counts ticks on while it runs, or null when stopped. */
  clock(): Clock | null {
    return this.timer === undefined ? null : { origin: this.origin, bpm: this.bpm, swing: this.swing };
  }

  position(): number {
    if (this.timer === undefined) return -1;
    const ctx = this.engine.ctx;
    return Math.max(0, (ctx.currentTime - outputDelay(ctx) - this.origin) / stepSeconds(this.bpm));
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
        if (this.origin + e.time >= now) playEvent(this.engine, e, this.origin + e.time);
      }
      this.next++;
    }
  }
}
