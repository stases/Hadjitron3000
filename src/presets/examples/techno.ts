import { emptyProject } from '../../core/defaults';
import type { Project } from '../../core/types';
import { automate, block, channels, chords, each, hits, join, laneLevels, lanes, mix, notes } from '../compose';

const A = 57; // the kicks and the drone are tuned to A

/**
 * "Techno": 130 BPM in A minor. A rumbling kick that ducks the drone, off-beat hats, a clap with a room, dub stabs of
 * a minor seventh (two notes of Minor Stab, each a minor third), and a break with a noise riser, over which the
 * drone's filter opens, to fall shut again on the drop. 32 bars.
 */
export function technoProject(): Project {
  const chans = channels([
    'Rumble Kick', 'Hard Kick', 'Room Clap', 'Rim', 'Tight Hat', 'Long Hat', 'Ride', 'Metal Hit', 'Low Tom',
    'Minor Stab', 'Dark Drone', 'Noise Riser',
  ]);
  mix(chans, {
    'Room Clap': [0.15, 0],
    Rim: [0, 0.2],
    'Metal Hit': [0.1, 0.3],
    'Minor Stab': [0.15, 0.35, 'Rumble Kick', 0.35, 0.2],
    'Dark Drone': [0, 0, 'Rumble Kick', 0.6, 0.3],
    'Noise Riser': [0.2, 0],
  });
  const [rumble, hard, clap, rim, hat, longHat, ride, metal, tom, stab, drone, riser] = chans.map((c) => c.id);
  const beat = block('Beat', 0, 2, {
    [rumble]: hits('x...x...x...x...x...x...x...x...', {}, A),
    [clap]: hits('....x.......x.......x.......x...'),
    [rim]: hits('...x..x.......x....x..x......x..', each([14, 29], { chance: 60 })),
    [hat]: hits('o.x.o.x.o.xoo.x.o.x.o.x.o.xoo.x.', each([0, 4, 8, 11, 12, 16, 20, 24, 27, 28], { chance: 50 })),
  });
  const hardBeat = block('Hard Beat', 1, 2, {
    [rumble]: hits('x...x...x...x...x...x...x...x...', {}, A),
    [hard]: hits('x...x...x...x...x...x...x...x...', {}, A),
    [clap]: hits('....x.......x.......x.......x..o'),
    [hat]: hits('xoxxxoxxxoxxxoxxxoxxxoxxxoxxxoX.', { 30: { ratchet: 3 }, ...each([1, 5, 9, 13, 17], { chance: 70 }) }),
    [longHat]: hits('..x...x...x...x...x...x...x...x.'),
  });
  const hats = block('Hats', 2, 2, {
    [longHat]: hits('..x...x...x...x...x...x...x...x.'),
    [ride]: hits('X...x...X...x...X...x...X...x...'),
    [metal]: hits('.......x..........x....x......x.', each([7, 23, 30], { chance: 50 })),
  });
  // Am7 for two bars, then Dm7 and Em7: a root and its fifth, each with the minor third Minor Stab adds.
  const stabBar = (bar: number, root: number): [number, number[], number, number][] => [
    [bar * 16 + 2, [root, root + 7], 1, 0.8],
    [bar * 16 + 10, [root, root + 7], 1, 0.7],
  ];
  const stabs = block('Stabs', 4, 4, {
    [stab]: join(
      chords([...stabBar(0, 57), ...stabBar(1, 57), ...stabBar(2, 50), ...stabBar(3, 52)]),
      notes([[13, 64, 1, 0.5, { chance: 50 }], [45, 57, 1, 0.5, { chance: 50 }]]),
    ),
  });
  const droneBlock = block('Drone', 5, 8, { [drone]: notes([[0, A, 128, 0.8, { hold: true }]]) });
  const breakBlock = block('Break', 6, 4, {
    [riser]: notes([[0, 60, 64, 0.9]]),
    [metal]: hits('x'),
    [longHat]: hits(`${'.'.repeat(32)}..x...x...x...x.x.x.x.x.xxxxxxxx`),
    [clap]: hits(`${'.'.repeat(56)}x...x..X`, { 60: { ratchet: 3 }, 63: { ratchet: 4 } }),
    [tom]: notes([[52, 57], [54, 55], [56, 52, 1, 0.9], [58, 50, 1, 0.9], [60, 48, 2, 1, { ratchet: 2 }]]),
  });
  const project: Project = {
    ...emptyProject(),
    name: 'Techno',
    bpm: 130,
    scale: { root: 9, type: 'minor' },
    master: 2,
    channels: chans,
    patterns: [beat, hardBeat, hats, stabs, droneBlock, breakBlock],
    song: lanes([
      [[beat, 0, 4, 0, 0, [clap, rim]], [beat, 4, 8], [breakBlock, 12, 4], [hardBeat, 16, 12], [beat, 28, 4]],
      [[hats, 8, 4], [hats, 16, 16]],
      [[stabs, 4, 8, 2], [stabs, 16, 16]],
      [[droneBlock, 0, 32, 4, 4]],
    ]),
    lanes: laneLevels([0, 0, 0, -5]),
  };
  project.automation = [automate(project, drone, 'filter', 'cutoff', [[12, 260], [15.75, 1500], [16, 260]])];
  return project;
}
