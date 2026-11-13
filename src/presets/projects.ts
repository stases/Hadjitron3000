// The two projects the app can start from (an empty kit, and the demo song of the first launch),
// and the factory blocks taken from the demo.

import { extractBlock } from '../core/block';
import { TICKS_PER_STEP, emptyProject, newChannel, newPattern, uid } from '../core/defaults';
import type { Block, Channel, Note, Pattern, Project } from '../core/types';
import { preset } from './index';

function channels(names: string[]): Channel[] {
  return names.map((name, color) => newChannel(uid('c'), preset(name), color % 8));
}

/** A new project: six sounds and one empty bar. */
export function starterProject(): Project {
  return { ...emptyProject(), channels: channels(['Kick', 'Snare', 'Hat', 'Sub Bass', 'Kalimba', 'Warm Pad']) };
}

/** Melody row: [step, note, length in steps, velocity] with length 1 and velocity 0.8 by default. */
function notes(row: [number, number, number?, number?][]): Note[] {
  return row.map(([step, note, len = 1, vel = 0.8]) => ({
    id: uid('n'), start: step * TICKS_PER_STEP, len: len * TICKS_PER_STEP, note, vel,
  }));
}

/** Drum row: x is a hit, X an accent, o a ghost note. */
function hits(row: string): Note[] {
  const vel: Record<string, number> = { x: 0.8, X: 1, o: 0.4 };
  return notes([...row].flatMap((ch, i): [number, number, number, number][] => (vel[ch] ? [[i, 60, 1, vel[ch]]] : [])));
}

/** A two-bar block: its name, colour, and the notes of some of the sounds. */
function block(name: string, color: number, rows: Record<string, Note[]>): Pattern {
  return { ...newPattern(name, color), bars: 2, notes: rows };
}

/** The keys and pads of the demo share the Room on bus A: [reverb mix of their own, send to the Room]. */
const ROOM: Readonly<Record<string, [number, number]>> = {
  Kalimba: [0.12, 0.2], 'Warm Pad': [0.28, 0.15], 'Glass Pad': [0.32, 0.15], Bell: [0.22, 0.25],
};

/** "Welcome": eight blocks in E flat, a little swung, layered into a sixteen-bar song. */
export function demoProject(): Project {
  const chans = channels(['Kick', 'Clap', 'Hat', 'Sub Bass', 'Kalimba', 'Warm Pad', 'Glass Pad', 'Bell']);
  for (const channel of chans) {
    if (!Object.hasOwn(ROOM, channel.sound.name)) continue;
    const [mix, send] = ROOM[channel.sound.name];
    channel.sound.chain.find((m) => m.type === 'reverb')!.params.mix = mix;
    channel.sends = [send, 0];
  }
  const [kick, clap, hat, bass, kalimba, warm, glass, bell] = chans.map((c) => c.id);
  const beat = block('Beat', 0, {
    [kick]: hits('x...x...x...x...x...x...x...x..o'),
    [clap]: hits('....x.......x.......x.......x...'),
    [hat]: hits('o.x.o.x.o.x.o.xoo.x.o.x.o.x.o.x.'),
  });
  const bassline = block('Bass', 3, {
    [bass]: notes([[0, 63, 3], [6, 63], [8, 63, 2], [14, 70, 2], [16, 60, 3], [22, 60], [24, 67, 3], [30, 70, 2]]),
  });
  const keys = block('Keys', 4, {
    [kalimba]: notes([[0, 75, 1, 0.9], [3, 72, 1, 0.6], [6, 70, 1, 0.7], [8, 79, 1, 0.9], [11, 75, 1, 0.6],
      [14, 72, 1, 0.7], [16, 70, 1, 0.85], [19, 72, 1, 0.6], [22, 75, 1, 0.7], [24, 82, 1, 0.9], [27, 79, 1, 0.6],
      [30, 75, 1, 0.7]]),
    [bell]: notes([[12, 82, 4, 0.5], [28, 79, 4, 0.5]]),
  });
  const pads = block('Pads', 5, {
    [warm]: notes([[0, 63, 16, 0.7], [16, 60, 16, 0.7]]),
    [glass]: notes([[0, 70, 16, 0.6], [16, 67, 16, 0.6]]),
  });
  const breakBeat = block('Break', 1, {
    [kick]: hits('................x...x...x...x.x.'),
    [clap]: hits('....................x.......x...'),
    [hat]: hits('..x...x...x...x...x...x...x...xo'),
  });
  const bassUp = block('Bass up', 3, {
    [bass]: notes([[0, 68, 6], [8, 68, 4], [16, 70, 6], [24, 70, 4], [30, 70, 2]]),
  });
  const keysUp = block('Keys up', 4, {
    [kalimba]: notes([[0, 79, 1, 0.9], [2, 75, 1, 0.6], [4, 72, 1, 0.7], [7, 75, 1, 0.8], [10, 79, 1, 0.6],
      [12, 82, 1, 0.9], [16, 77, 1, 0.85], [18, 75, 1, 0.6], [20, 70, 1, 0.7], [23, 72, 1, 0.8], [26, 75, 1, 0.6],
      [28, 77, 1, 0.7], [30, 79, 1, 0.9]]),
    [bell]: notes([[6, 87, 4, 0.45], [22, 89, 4, 0.45]]),
  });
  const padsUp = block('Pads up', 6, {
    [warm]: notes([[0, 68, 16, 0.7], [16, 70, 16, 0.7]]),
    [glass]: notes([[0, 75, 16, 0.6], [16, 77, 16, 0.6]]),
  });
  // One row per lane: [block, first bar, bars].
  const lanes: [Pattern, number, number][][] = [
    [[beat, 4, 4], [breakBeat, 8, 4], [beat, 12, 4]],
    [[bassline, 4, 4], [bassUp, 8, 4], [bassline, 12, 4]],
    [[keys, 2, 6], [keysUp, 8, 4], [keys, 12, 4]],
    [[pads, 0, 8], [padsUp, 8, 4], [pads, 12, 4]],
  ];
  return {
    ...emptyProject(),
    name: 'Welcome',
    bpm: 126,
    swing: 0.3,
    master: -3,
    channels: chans,
    patterns: [beat, bassline, keys, pads, breakBeat, bassUp, keysUp, padsUp],
    song: lanes.flatMap((row, lane) => row.map(([p, bar, bars]) => ({ id: uid('s'), pattern: p.id, lane, bar, bars }))),
  };
}

/** The factory blocks of the Block Library: the eight blocks of the demo song, each with the sounds it plays. */
export function factoryBlocks(): Block[] {
  const demo = demoProject();
  return demo.patterns.map((pattern) => extractBlock(demo, pattern.id)!);
}
