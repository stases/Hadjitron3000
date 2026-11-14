// The projects the app can start from (an empty kit, the demo song of the first launch and the six examples), and
// the factory blocks of the Block Library, taken from them.

import { extractBlock } from '../core/block';
import { emptyProject } from '../core/defaults';
import type { Block, Project } from '../core/types';
import { block, channels, hits, lanes, notes } from './compose';
import { EXAMPLES } from './examples';

/** A new project: six sounds and one empty bar. */
export function starterProject(): Project {
  return { ...emptyProject(), channels: channels(['Kick', 'Snare', 'Hat', 'Sub Bass', 'Kalimba', 'Warm Pad']) };
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
  const beat = block('Beat', 0, 2, {
    [kick]: hits('x...x...x...x...x...x...x...x..o'),
    [clap]: hits('....x.......x.......x.......x...'),
    [hat]: hits('o.x.o.x.o.x.o.xoo.x.o.x.o.x.o.x.'),
  });
  const bassline = block('Bass', 3, 2, {
    [bass]: notes([[0, 63, 3], [6, 63], [8, 63, 2], [14, 70, 2], [16, 60, 3], [22, 60], [24, 67, 3], [30, 70, 2]]),
  });
  const keys = block('Keys', 4, 2, {
    [kalimba]: notes([[0, 75, 1, 0.9], [3, 72, 1, 0.6], [6, 70, 1, 0.7], [8, 79, 1, 0.9], [11, 75, 1, 0.6],
      [14, 72, 1, 0.7], [16, 70, 1, 0.85], [19, 72, 1, 0.6], [22, 75, 1, 0.7], [24, 82, 1, 0.9], [27, 79, 1, 0.6],
      [30, 75, 1, 0.7]]),
    [bell]: notes([[12, 82, 4, 0.5], [28, 79, 4, 0.5]]),
  });
  const pads = block('Pads', 5, 2, {
    [warm]: notes([[0, 63, 16, 0.7], [16, 60, 16, 0.7]]),
    [glass]: notes([[0, 70, 16, 0.6], [16, 67, 16, 0.6]]),
  });
  const breakBeat = block('Break', 1, 2, {
    [kick]: hits('................x...x...x...x.x.'),
    [clap]: hits('....................x.......x...'),
    [hat]: hits('..x...x...x...x...x...x...x...xo'),
  });
  const bassUp = block('Bass up', 3, 2, {
    [bass]: notes([[0, 68, 6], [8, 68, 4], [16, 70, 6], [24, 70, 4], [30, 70, 2]]),
  });
  const keysUp = block('Keys up', 4, 2, {
    [kalimba]: notes([[0, 79, 1, 0.9], [2, 75, 1, 0.6], [4, 72, 1, 0.7], [7, 75, 1, 0.8], [10, 79, 1, 0.6],
      [12, 82, 1, 0.9], [16, 77, 1, 0.85], [18, 75, 1, 0.6], [20, 70, 1, 0.7], [23, 72, 1, 0.8], [26, 75, 1, 0.6],
      [28, 77, 1, 0.7], [30, 79, 1, 0.9]]),
    [bell]: notes([[6, 87, 4, 0.45], [22, 89, 4, 0.45]]),
  });
  const padsUp = block('Pads up', 6, 2, {
    [warm]: notes([[0, 68, 16, 0.7], [16, 70, 16, 0.7]]),
    [glass]: notes([[0, 75, 16, 0.6], [16, 77, 16, 0.6]]),
  });
  return {
    ...emptyProject(),
    name: 'Welcome',
    bpm: 126,
    swing: 0.3,
    master: -3,
    channels: chans,
    patterns: [beat, bassline, keys, pads, breakBeat, bassUp, keysUp, padsUp],
    song: lanes([
      [[beat, 4, 4], [breakBeat, 8, 4], [beat, 12, 4]],
      [[bassline, 4, 4], [bassUp, 8, 4], [bassline, 12, 4]],
      [[keys, 2, 6], [keysUp, 8, 4], [keys, 12, 4]],
      [[pads, 0, 8], [padsUp, 8, 4], [pads, 12, 4]],
    ]),
  };
}

/** The blocks of a project, each with the sounds it plays. */
const blocksOf = (project: Project): Block[] => project.patterns.map((pattern) => extractBlock(project, pattern.id)!);

/** The factory blocks of the Block Library: the demo's, then those of each example, grouped by the project's name. */
export function factoryBlocks(): { label: string; blocks: Block[] }[] {
  return [demoProject(), ...EXAMPLES.map((example) => example.project())]
    .map((p) => ({ label: p.name, blocks: blocksOf(p) }));
}
