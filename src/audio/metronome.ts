// The metronome: a short click on every beat while the transport runs, higher and louder on the first beat of the
// bar. It is its own small look-ahead scheduler and plays straight into the context's destination, past the master
// and the engine, so it is never part of the mix or of an export.

import { beatsBetween } from '../core/meter';
import type { Bar } from '../core/meter';
import type { Clock } from '../core/record';
import { tickTime, timeTick } from '../core/sequencer';

const TICK_MS = 25;
const LOOKAHEAD = 0.12;
const CLICK = 0.03;
const LEVEL = 0.25;
const ACCENT = 0.4;

export interface MetronomeState {
  /** The transport's clock, null while it is stopped. */
  clock: Clock | null;
  bar: Bar;
  /** Clicks on every beat; without it only the count-in (the ticks before 0) clicks. */
  on: boolean;
}

export class Metronome {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** The tick from which beats have not been scheduled yet. */
  private next = -Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly read: () => MetronomeState,
  ) {}

  start(): void {
    this.stop();
    this.next = -Infinity;
    this.timer = setInterval(() => this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD), TICK_MS);
    this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Schedule the clicks of the beats that sound from now until context time `until` and are not scheduled yet. */
  scheduleUntil(until: number): void {
    const { clock, bar, on } = this.read();
    if (!clock) return;
    const tickOf = (time: number) => timeTick(time - clock.origin, clock.bpm, clock.swing);
    const from = Math.max(this.next, tickOf(this.ctx.currentTime));
    const to = tickOf(until);
    for (const beat of beatsBetween(from, to, bar)) {
      if (on || beat.tick < 0) this.click(clock.origin + tickTime(beat.tick, clock.bpm, clock.swing), beat.downbeat);
    }
    this.next = Math.max(from, to);
  }

  private click(time: number, downbeat: boolean): void {
    const osc = new OscillatorNode(this.ctx, { frequency: downbeat ? 1760 : 1320 });
    const gain = new GainNode(this.ctx, { gain: 0 });
    gain.gain.setValueAtTime(downbeat ? ACCENT : LEVEL, time);
    gain.gain.exponentialRampToValueAtTime(1e-4, time + CLICK);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + CLICK);
    osc.onended = () => gain.disconnect();
  }
}
