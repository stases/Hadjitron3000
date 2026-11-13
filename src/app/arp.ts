// The arpeggiator for notes played by hand. The keys held on a sound with its arpeggiator on are not played as
// they are: a small scheduler plays them one after another through `arpeggiate`, as the sequencer does. It counts
// ticks on the transport's clock when the transport runs as the first key goes down, else on a clock of its own at
// the project's tempo and swing that starts with that key, and keeps that clock until every key is up.

import { arpeggiate } from '../core/arp';
import type { ArpSettings, Held } from '../core/arp';
import type { Clock } from '../core/record';
import { tickTime, timeTick } from '../core/sequencer';

const TIMER_MS = 10;
// Notes are handed to the engine this far ahead; a key let go inside it does not take back what is already there.
const AHEAD = 0.03;

/** What the scheduler needs from the app: the context's time and the clocks, each sound's settings, and the engine. */
export interface ArpHost {
  now(): number;
  clock(): Clock | null;
  tempo(): { bpm: number; swing: number };
  settings(channelId: string): ArpSettings | null;
  play(channelId: string, note: number, vel: number, time: number, dur: number): void;
}

interface Key extends Held {
  vel: number;
}

/** The keys of one sound since the first went down, and the tick up to which its notes are scheduled. */
interface Run {
  clock: Clock;
  keys: Key[];
  next: number;
}

export class LiveArp {
  private readonly runs = new Map<string, Run>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private serial = 0;

  constructor(private readonly host: ArpHost) {}

  /** Whether a key on this sound goes to the arpeggiator. */
  takes(channelId: string): boolean {
    return this.host.settings(channelId) !== null;
  }

  private tick(run: Run, time: number): number {
    return timeTick(time - run.clock.origin, run.clock.bpm, run.clock.swing);
  }

  down(channelId: string, note: number, vel: number): void {
    const now = this.host.now();
    let run = this.runs.get(channelId);
    if (!run) {
      run = { clock: this.host.clock() ?? { origin: now, ...this.host.tempo() }, keys: [], next: -Infinity };
      this.runs.set(channelId, run);
    }
    const at = this.tick(run, now);
    for (const key of run.keys) if (key.pitch === note && key.end === Infinity) key.end = at;
    run.keys.push({ start: at, end: Infinity, pitch: note, key: `${note}:${this.serial++}`, vel });
    // The order starts again here, so its first note sounds at once.
    run.next = Math.min(run.next, at);
    this.pump();
    this.timer ??= setInterval(() => this.pump(), TIMER_MS);
  }

  up(channelId: string, note: number): void {
    const run = this.runs.get(channelId);
    const key = run?.keys.find((k) => k.pitch === note && k.end === Infinity);
    if (!run || !key) return;
    key.end = this.tick(run, this.host.now());
    run.next = Math.min(run.next, key.end);
    this.pump();
  }

  /** Let go of every key. */
  stop(): void {
    this.runs.clear();
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Hand the engine the notes due before the look-ahead runs out, and forget what can no longer sound. */
  pump(): void {
    const now = this.host.now();
    for (const [channelId, run] of this.runs) {
      const settings = this.host.settings(channelId);
      const horizon = this.tick(run, now + AHEAD);
      if (settings && horizon > run.next) {
        const time = (t: number) => run.clock.origin + tickTime(t, run.clock.bpm, run.clock.swing);
        for (const a of arpeggiate(run.keys, settings, run.next, horizon)) {
          const at = time(a.tick);
          this.host.play(channelId, a.note, (a.held as Key).vel, Math.max(at, now), time(a.end) - at);
        }
      }
      run.next = Math.max(run.next, horizon);
      // Keys that ended before the last change can no longer move the order.
      const last = Math.max(...run.keys.flatMap((k) => [k.start, k.end]).filter((t) => t <= run.next));
      run.keys = run.keys.filter((k) => k.end >= last);
      if (!settings || run.keys.every((k) => k.end <= run.next)) this.runs.delete(channelId);
    }
    if (this.runs.size === 0) this.stop();
  }
}
