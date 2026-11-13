// Recording: while Record is on and a block plays on repeat, every note played by hand on the selected sound is
// written into the current block where it was heard and for as long as it was held. One pass, from Record on or
// the start of playback until Record off or stop, is one undo step.

import { create } from 'zustand';
import { barOf } from '../core/meter';
import { heardTick, takeNote } from '../core/record';
import type { Clock } from '../core/record';
import { addNotes, useApp } from '../state/store';
import { clock, contextTime, countIn, latency, onLiveNote } from './audio';
import type { LiveNote } from './audio';
import { usePrefs } from './prefs';

export const useRecord = create<{ on: boolean }>(() => ({ on: false }));

/** A key down during the pass: where it was heard, on which block and clock. */
interface Down {
  tick: number;
  vel: number;
  patternId: string;
  clock: Clock;
}

// The pass running now; its notes share one undo step.
let take: object | null = null;
const downs = new Map<string, Down>();

/** Whether notes played now are being recorded. */
export const recording = () => take !== null;

/** Record works only while what plays is a block on repeat. */
const blockScope = () => useApp.getState().scope === 'pattern';

/** Switch Record on or off. Switched on while stopped, playing starts after a one-bar count-in. */
export function toggleRecord(): void {
  if (!blockScope()) return;
  const on = !useRecord.getState().on;
  useRecord.setState({ on });
  if (on && !useApp.getState().playing) countIn();
}

/** Write a note whose key went up at heard tick `up`. */
function write(channelId: string, note: number, down: Down, up: number): void {
  const { project } = useApp.getState();
  const pattern = project.patterns.find((p) => p.id === down.patternId);
  if (!pattern || !take) return;
  const bar = barOf(project.meter);
  const grid = {
    unit: usePrefs.getState().quantize, bar, bpm: down.clock.bpm, swing: down.clock.swing,
    length: pattern.bars * bar.ticks,
  };
  const n = takeNote(down.tick, up, grid, note, down.vel);
  if (n) addNotes(pattern.id, channelId, [n], take);
}

/** A note played or let go by hand. Exported for the tests, which hand it a clock of their own. */
export function liveNote({ channelId, note, vel, time }: LiveNote): void {
  const key = `${channelId}:${note}`;
  const c = clock();
  const down = downs.get(key);
  if (down) {
    downs.delete(key);
    write(channelId, note, down, heardTick(c ?? down.clock, time, latency()));
  }
  if (vel !== null && take && c) {
    downs.set(key, { tick: heardTick(c, time, latency()), vel, patternId: useApp.getState().patternId, clock: c });
  }
}

/** End the pass: keys still down are written as if let go now. */
function finish(): void {
  const time = contextTime();
  for (const [key, down] of downs) {
    const sep = key.lastIndexOf(':');
    write(key.slice(0, sep), Number(key.slice(sep + 1)), down, heardTick(clock() ?? down.clock, time, latency()));
  }
  downs.clear();
  take = null;
}

/** Follow the store: stopping or playing the song switches Record off, and passes start and end with it. */
export function initRecord(): void {
  onLiveNote(liveNote);
  const sync = () => {
    const { playing } = useApp.getState();
    if (useRecord.getState().on && (!blockScope() || (!playing && take))) useRecord.setState({ on: false });
    const running = useRecord.getState().on && playing && blockScope();
    if (running && !take) take = {};
    else if (!running && take) finish();
  };
  useApp.subscribe(sync);
  useRecord.subscribe(sync);
}
