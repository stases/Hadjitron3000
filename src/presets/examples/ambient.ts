import { emptyProject } from '../../core/defaults';
import type { Project } from '../../core/types';
import { automate, block, channels, chords, hits, lanes, mix, notes } from '../compose';
import { presetSamples } from '../index';

/**
 * "Ambient": 90 BPM in D Dorian, in the manner of Loscil and Carbon Based Lifeforms. A bed of wind and a cloud of
 * grains held for the whole song, the grains moving slowly from the dark start of their recording to its bright end
 * and back, foggy chords and a shimmering pad that fade into each other, a soft sub pulse with a shaker, dub chords
 * into a long echo, and a soft acid line on a row of twelve steps. Everything fades in and out. 32 bars.
 */
export function ambientProject(): Project {
  const chans = channels([
    'Sub Pulse', 'Shaker', 'Wind', 'Cloud Pad', 'Fog Pad', 'Shimmer Pad', 'Dub Chord', 'Soft Acid Line',
  ]);
  mix(chans, {
    Shaker: [0.35, 0.1],
    'Fog Pad': [0.15, 0],
    'Shimmer Pad': [0.1, 0],
    'Dub Chord': [0.1, 0.4],
    'Soft Acid Line': [0.25, 0.3],
  });
  const [pulse, shaker, wind, cloud, fog, shimmer, dub, acid] = chans.map((c) => c.id);
  // D sounds at 62 on the sub pulse, two octaves below its note.
  const pulseBlock = block('Pulse', 0, 2, {
    [pulse]: notes([[0, 62, 2, 0.8], [6, 62, 1, 0.45], [10, 62, 2, 0.7], [16, 62, 2, 0.8], [22, 57, 1, 0.45],
      [26, 60, 2, 0.7]]),
    [shaker]: hits('..x...x...x...x...x...x...x...xo', { 6: { chance: 70 }, 22: { chance: 70 }, 31: { chance: 50 } }),
  });
  // Cloud Pad's recording is a D minor ninth chord, which C3 plays at its own pitch.
  const airBlock = block('Air', 1, 8, {
    [wind]: notes([[0, 60, 128, 0.7, { hold: true }]]),
    [cloud]: notes([[0, 60, 128, 0.5, { hold: true }]]),
  });
  // D minor 9, then F major 7.
  const fogBlock = block('Fog', 5, 8, {
    [fog]: chords([[0, [62, 65, 69, 72, 76], 64, 0.5], [64, [65, 69, 72, 76], 64, 0.5]]),
  });
  const shimmerBlock = block('Shimmer', 6, 8, {
    [shimmer]: notes([[0, 81, 32, 0.8], [0, 74, 64, 0.7], [32, 84, 32, 0.8], [64, 76, 32, 0.8], [64, 69, 64, 0.7],
      [96, 79, 32, 0.8]]),
  });
  // A root and its fifth, each with the minor third Dub Chord adds: D minor 7 and A minor 7.
  const dubBlock = block('Dub Chords', 4, 2, {
    [dub]: chords([[2, [62, 69], 2, 0.9], [11, [62, 69], 1, 0.6], [18, [57, 64], 2, 0.9]]),
  });
  const acidBlock = block('Acid Line', 3, 4, {
    [acid]: notes([[0, 62, 1, 0.8], [2, 69, 1, 0.6], [3, 65, 1, 0.5], [5, 72, 1, 0.7], [6, 62, 1, 0.5],
      [8, 67, 1, 0.7, { slide: true }], [9, 69, 1, 0.5], [11, 74, 1, 0.8, { slide: true }]]),
  }, { [acid]: 12 });
  const project: Project = {
    ...emptyProject(),
    name: 'Ambient',
    bpm: 90,
    scale: { root: 2, type: 'dorian' },
    master: -1,
    channels: chans,
    patterns: [pulseBlock, airBlock, fogBlock, shimmerBlock, dubBlock, acidBlock],
    song: lanes([
      [[airBlock, 0, 32, 4, 6]],
      [[fogBlock, 0, 16, 4], [shimmerBlock, 16, 16, 0, 6]],
      [[pulseBlock, 6, 22, 2, 4]],
      [[dubBlock, 4, 10, 2], [acidBlock, 14, 16, 2, 4]],
    ]),
    samples: presetSamples('Cloud Pad'),
  };
  project.automation = [automate(project, cloud, 'source', 'position', [[0, 0.1], [20, 0.9], [32, 0.3]])];
  return project;
}
