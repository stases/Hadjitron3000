import { emptyProject } from '../../core/defaults';
import type { Project } from '../../core/types';
import { block, channels, chords, hits, join, lanes, mix, notes } from '../compose';

// C minor 9, A flat major 7, F minor 9 and B flat with an added ninth, a bar each.
const PAD: number[][] = [[63, 67, 70, 74], [63, 67, 68, 72], [63, 65, 68, 72], [62, 65, 70, 72]];
const ROOTS = [60, 56, 65, 58]; // the sub plays two octaves below its note: C, A flat, F, B flat

/**
 * "Organic": 122 BPM in C minor, swung. A soft kick, a rim and a shaker on a heavy swing, a wood block that plays
 * between the grid lines on a row of twelve steps, kalimba and harp lines with notes off the grid, mallets on a row
 * of ten steps that drifts against the bar, and a breathing pad over a warm sub. 32 bars.
 */
export function organicProject(): Project {
  const chans = channels([
    'Kick', 'Rim', 'Shaker', 'Wood Block', 'Warm Sub', 'Breath Pad', 'Soft Kalimba', 'Soft Mallet', 'Harp',
  ]);
  mix(chans, {
    Rim: [0.15, 0],
    'Wood Block': [0.1, 0.15],
    'Breath Pad': [0.2, 0, 'Kick', 0.25, 0.3],
    'Soft Kalimba': [0.25, 0.15],
    'Soft Mallet': [0.2, 0.2],
    Harp: [0.25, 0.1],
  });
  const [kick, rim, shaker, wood, sub, pad, kalimba, mallet, harp] = chans.map((c) => c.id);
  const groove = block('Groove', 0, 2, {
    [kick]: hits('x.........x.....x.......x..x....', {}, 51),
    [rim]: hits('....x.......x..o....x.......x.o.'),
    [shaker]: notes([...'xoxoXoxoxoxoXoxoxoxoXoxoxoxoXoxx'].map((ch, i): [number, number, number, number] =>
      [i, 60, 1, ch === 'X' ? 0.8 : ch === 'x' ? 0.55 : 0.3])),
    [wood]: notes([[0, 55, 1, 0.7], [3.5, 60, 1, 0.5], [6, 51, 1, 0.6], [8 + 2 / 3, 55, 1, 0.5], [10, 58, 1, 0.6]]),
  }, { [wood]: 12 });
  const keys = block('Kalimba', 4, 4, {
    [kalimba]: notes([
      [0, 75, 2, 0.8], [1.5, 79, 2, 0.5], [3, 82, 2, 0.7], [6, 79, 1, 0.5], [8, 84, 3, 0.8], [11.5, 82, 1, 0.5],
      [14, 79, 2, 0.6], [16, 75, 2, 0.8], [17.5, 77, 2, 0.5], [19, 80, 2, 0.7], [24, 79, 3, 0.8], [27.5, 77, 1, 0.5],
      [30, 75, 2, 0.6], [32, 72, 2, 0.8], [33.5, 75, 2, 0.5], [35, 79, 2, 0.7], [38, 77, 1, 0.5], [40, 80, 3, 0.8],
      [43.5, 79, 1, 0.5], [46, 77, 2, 0.6], [48, 74, 2, 0.8], [49.5, 77, 2, 0.5], [51, 82, 2, 0.7],
      [56, 79, 4, 0.7], [60.5, 74, 2, 0.5],
    ]),
  });
  const mallets = block('Mallets', 2, 4, {
    [mallet]: notes([[0, 67, 1, 0.8], [2, 70, 1, 0.6], [3, 72, 1, 0.7], [6, 75, 1, 0.6], [8, 70, 1, 0.5]]),
  }, { [mallet]: 10 });
  // Up through each chord in eighths and back, the off-beats a little late.
  const harpBlock = block('Harp', 5, 4, {
    [harp]: notes(PAD.flatMap((chord, bar) => [...chord, chord[0] + 12, ...chord.slice(1).reverse()].map(
      (note, i): [number, number, number, number] =>
        [bar * 16 + i * 2 + (i % 2 ? 0.25 : 0), note, 1.5, i ? 0.6 : 0.8]))),
  });
  const padBlock = block('Pad and Sub', 3, 4, {
    [pad]: chords(PAD.map((chord, bar) => [bar * 16, chord, 16, 0.7])),
    [sub]: join(...ROOTS.map((root, bar) => notes([[bar * 16, root, 6, 0.55], [bar * 16 + 6.5, root, 1.5, 0.35],
      [bar * 16 + 10, root, 5, 0.5]]))),
  });
  return {
    ...emptyProject(),
    name: 'Organic',
    bpm: 122,
    swing: 0.45,
    scale: { root: 0, type: 'minor' },
    master: -2.5,
    channels: chans,
    patterns: [groove, keys, mallets, harpBlock, padBlock],
    song: lanes([
      [[groove, 4, 4, 0, 0, [kick]], [groove, 8, 20]],
      [[padBlock, 0, 32, 2, 4]],
      [[keys, 0, 16], [harpBlock, 16, 16, 0, 4]],
      [[mallets, 8, 20]],
    ]),
  };
}
