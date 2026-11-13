// A look-ahead scheduler: a timer hands the engine every note that starts within the next 120 ms, one step's
// window of ticks at a time, so each note is scheduled exactly once. While the song plays, an automator moves the
// automated parameters through the same windows.

import { TICKS_PER_STEP } from '../core/defaults';
import type { Clock } from '../core/record';
import { eventsBetween, stepSeconds, tickTime } from '../core/sequencer';
import type { NoteEvent, PlayScope, Project } from '../core/types';
import { Automator } from './automator';
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
  engine.play(e.channelId, e.note, e.vel, time, e.dur, e.slide, e.gain, e.locks);
}

/**
 * Schedule step `step` of the scope, which starts at context time `origin` plus its own time: the notes that start in
 * it, except those that would start before `now`, and with an automator the automated parameters through it. The
 * notes' locks of shared parameters reach the automator first. Live playback and export both go through here.
 */
export function playStep(
  engine: Engine, automator: Automator | null, project: Project, scope: PlayScope, step: number, origin: number,
  now = -Infinity,
): void {
  const from = step * TICKS_PER_STEP;
  const events = eventsBetween(project, scope, from, from + TICKS_PER_STEP).filter((e) => origin + e.time >= now);
  if (automator) {
    for (const e of events) automator.hold(project, e, origin + e.time);
    automator.advance(project, from, from + TICKS_PER_STEP, (t) => origin + tickTime(t, project.bpm, project.swing));
  }
  for (const e of events) playEvent(engine, e, origin + e.time);
}

export class Transport {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Context time of absolute step 0 at the current tempo. */
  private origin = 0;
  private bpm = 120;
  private swing = 0;
  private next = 0;
  /** Moves the automated parameters while the song plays; null while a block plays on repeat. */
  private automator: Automator | null = null;

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
    this.automator?.stop();
    this.automator = null;
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
    // Automation applies to the song only; switching to a block on repeat puts the parameters back.
    if ((scope.kind === 'song') !== !!this.automator) {
      this.automator?.stop();
      this.automator = scope.kind === 'song' ? new Automator(this.engine) : null;
      const tick = this.next * TICKS_PER_STEP;
      this.automator?.start(project, tick, this.origin + tickTime(tick, this.bpm, this.swing));
    }
    const now = this.engine.ctx.currentTime;
    while (this.origin + tickTime(this.next * TICKS_PER_STEP, this.bpm, this.swing) < now + LOOKAHEAD) {
      // After a stall (a throttled timer) notes that should already have started are dropped.
      playStep(this.engine, this.automator, project, scope, this.next, this.origin, now);
      this.next++;
    }
    this.engine.flushAutomation();
  }
}
