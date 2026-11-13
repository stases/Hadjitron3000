// A two-block loop with every sound in each block, for tests of the Track view.

import { emptyProject, newChannel, newPattern, uid } from '../../src/core/defaults';
import type { Channel, Note, Pattern, Project } from '../../src/core/types';
import { preset } from '../../src/presets';
import { notesOf } from './steps';
import type { StepSpec } from './steps';

function channels(names: string[]): Channel[] {
  return names.map((name, color) => newChannel(uid('c'), preset(name), color % 8));
}

/** Drum row: x is a hit, X an accent, o a ghost note. */
function hits(row: string): Note[] {
  const vel: Record<string, number> = { x: 0.8, X: 1, o: 0.4 };
  const steps = [...row].flatMap((ch, i) => (vel[ch] ? [[i, { note: 60, vel: vel[ch], len: 1 }]] : []));
  return notesOf(Object.fromEntries(steps));
}

/** Melody row: [step, note, length, velocity] with length 1 and velocity 0.8 by default. */
function notes(row: [number, number, number?, number?][]): Note[] {
  return notesOf(Object.fromEntries(row.map(([i, note, len = 1, vel = 0.8]): [number, StepSpec] =>
    [i, { note, vel, len }])));
}

function pattern(name: string, ids: string[], rows: Note[][]): Pattern {
  return { ...newPattern(name), bars: 2, notes: Object.fromEntries(rows.map((notes, i) => [ids[i], notes])) };
}

export function loopProject(): Project {
  const chans = channels(['Kick', 'Clap', 'Hat', 'Sub Bass', 'Kalimba', 'Warm Pad', 'Glass Pad', 'Bell']);
  const ids = chans.map((c) => c.id);
  const a = pattern('A', ids, [
    hits('x...x...x...x...x...x...x...x..o'),
    hits('....x.......x.......x.......x...'),
    hits('o.x.o.x.o.x.o.xoo.x.o.x.o.x.o.x.'),
    notes([[0, 63, 3], [6, 63], [8, 63, 2], [14, 70, 2], [16, 60, 3], [22, 60], [24, 67, 3], [30, 70, 2]]),
    notes([[0, 75, 1, 0.9], [3, 72, 1, 0.6], [6, 70, 1, 0.7], [8, 79, 1, 0.9], [11, 75, 1, 0.6], [14, 72, 1, 0.7],
      [16, 70, 1, 0.85], [19, 72, 1, 0.6], [22, 75, 1, 0.7], [24, 82, 1, 0.9], [27, 79, 1, 0.6], [30, 75, 1, 0.7]]),
    notes([[0, 63, 16, 0.7], [16, 60, 16, 0.7]]),
    notes([[0, 70, 16, 0.6], [16, 67, 16, 0.6]]),
    notes([[12, 82, 4, 0.5], [28, 79, 4, 0.5]]),
  ]);
  const b = pattern('B', ids, [
    hits('................x...x...x...x.x.'),
    hits('....................x.......x...'),
    hits('..x...x...x...x...x...x...x...xo'),
    notes([[0, 68, 6], [8, 68, 4], [16, 70, 6], [24, 70, 4], [30, 70, 2]]),
    notes([[0, 79, 1, 0.9], [2, 75, 1, 0.6], [4, 72, 1, 0.7], [7, 75, 1, 0.8], [10, 79, 1, 0.6], [12, 82, 1, 0.9],
      [16, 77, 1, 0.85], [18, 75, 1, 0.6], [20, 70, 1, 0.7], [23, 72, 1, 0.8], [26, 75, 1, 0.6], [28, 77, 1, 0.7], [30, 79, 1, 0.9]]),
    notes([[0, 68, 16, 0.7], [16, 70, 16, 0.7]]),
    notes([[0, 75, 16, 0.6], [16, 77, 16, 0.6]]),
    notes([[6, 87, 4, 0.45], [22, 89, 4, 0.45]]),
  ]);
  return {
    ...emptyProject(),
    name: 'Welcome',
    bpm: 126,
    swing: 0.3,
    master: -3,
    channels: chans,
    patterns: [a, b],
    song: [a, a, b, a].map((p, i) => ({ id: `s${i}`, pattern: p.id, lane: 0, bar: i * 2, bars: 2 })),
  };
}
