import { emptyProject } from '../../core/defaults';
import type { Project } from '../../core/types';
import { block, channels, each, hits, lanes, lock, mix, notes } from '../compose';

/**
 * "Experimental": 112 BPM in D minor. A broken, bit-crushed beat whose clicks and hats run on rows of five and seven
 * steps, hats that play by chance and stutter in ratchets, a drill fill, a buzzing bass on a drawn wave over a warm
 * sub, a detuned music box and a drifting analog lead. A few notes lock controls of their own: a snare that rings
 * longer from the left, buzz notes with their filter wide open or shut, a click tuned higher. 24 bars.
 */
export function experimentalProject(): Project {
  const chans = channels([
    'Crushed Kick', 'Crushed Snare', 'Glitch Hit', 'Comb Click', 'Zap', 'Warm Sub', 'Draw Buzz', 'Music Box',
    'Drift Lead',
  ]);
  mix(chans, {
    'Comb Click': [0.2, 0],
    Zap: [0, 0.3],
    'Music Box': [0.25, 0],
    'Drift Lead': [0.1, 0.2],
  });
  const [kick, snare, glitch, click, zap, sub, buzz, box, lead] = chans.map((c) => c.id);
  const [, snareChan, , clickChan, , , buzzChan] = chans;
  const longLeft = { locks: [lock(snareChan, 'amp', 'decay', 0.45), lock(snareChan, 'out', 'pan', -0.8)] };
  const wide = { locks: [lock(buzzChan, 'filter', 'cutoff', 9000)] };
  const dark = { locks: [lock(buzzChan, 'filter', 'cutoff', 700)] };
  const broken = block('Broken Beat', 0, 2, {
    [kick]: hits('x.....x...x.....x..x..x...x..x..', {}, 57),
    [snare]: hits('....x..o....x.o.....x..o...xx.x.', {
      7: { chance: 50 }, 20: longLeft, 27: { ratchet: 3 }, 30: { ratchet: 4 },
    }),
    [glitch]: hits('xxoxxoxoxxoxxoxoxxoxxoxoxxoxxoxo', {
      ...each([2, 5, 7, 13, 15, 21, 23, 29, 31], { chance: 50 }), 11: { ratchet: 3 }, 26: { ratchet: 4 },
    }),
    [click]: hits('x..o.'),
  }, { [click]: 5 });
  const glitchBlock = block('Glitch', 1, 2, {
    [zap]: notes([[3, 60, 1, 0.8], [7, 67, 1, 0.6, { chance: 60 }], [12, 55, 1, 0.9], [19, 72, 1, 0.7],
      [22, 60, 1, 0.5, { ratchet: 3 }], [27, 64, 1, 0.8, { chance: 50 }], [30, 48, 2, 0.9, { ratchet: 6 }]]),
    [click]: hits('x.o..x.', { 5: { locks: [lock(clickChan, 'fx1', 'freq', 2100)] } }),
    [glitch]: hits('x...x.x.x...x.xxx...x.x.x...x.xx', { 14: { ratchet: 6 }, 31: { ratchet: 8 } }),
  }, { [click]: 7 });
  const drill = block('Drill', 2, 1, {
    [kick]: hits('x.x..x.x..x..x.x', {}, 57),
    [snare]: hits('.xoxXoxXoxXXxXXX', { 3: { ratchet: 2 }, 7: { ratchet: 3 }, 11: { ratchet: 4 }, 13: { ratchet: 6 },
      15: { ratchet: 8 } }),
    [glitch]: hits('xxxxxxxxxxxxxxxx', each([1, 5, 9, 13], { ratchet: 3 })),
  });
  // D sounds at 62 on the sub, which plays two octaves below its note.
  const bassBlock = block('Buzz Bass', 3, 2, {
    [sub]: notes([[0, 62, 5, 0.6], [6, 62, 2, 0.45], [10, 65, 4, 0.6], [16, 58, 6, 0.6], [24, 60, 4, 0.55],
      [28, 57, 4, 0.6]]),
    [buzz]: notes([[0, 50, 2, 0.8], [3, 50, 1, 0.5], [6, 62, 1, 0.7], [10, 53, 3, 0.8, wide], [14, 52, 1, 0.5],
      [16, 46, 4, 0.8], [21, 58, 1, 0.6], [24, 48, 3, 0.8, wide], [28, 45, 2, 0.9, dark],
      [31, 57, 1, 0.5, { chance: 50 }]]),
  });
  // The music box sounds an octave above its notes.
  const boxBlock = block('Music Box', 4, 4, {
    [box]: notes([[0, 62, 2, 0.7], [2, 65, 2, 0.6], [4, 69, 4, 0.8], [10, 67, 2, 0.6], [12, 65, 4, 0.7],
      [16, 64, 2, 0.6], [18, 65, 2, 0.6], [20, 62, 6, 0.8], [28, 57, 4, 0.5],
      [32, 62, 2, 0.7], [34, 65, 2, 0.6], [36, 69, 3, 0.8], [39, 72, 3, 0.7], [42, 70, 2, 0.6], [44, 69, 4, 0.7],
      [48, 67, 2, 0.6], [50, 64, 2, 0.6], [52, 61, 4, 0.7], [56, 62, 8, 0.8]]),
  });
  const leadBlock = block('Lead', 5, 4, {
    [lead]: notes([[0, 74, 6, 0.8], [6, 77, 2, 0.7, { slide: true }], [8, 76, 8, 0.8, { slide: true }],
      [18, 72, 4, 0.7], [22, 74, 2, 0.6, { slide: true }], [24, 69, 8, 0.8],
      [32, 74, 4, 0.8], [36, 81, 4, 0.8, { slide: true }], [40, 79, 6, 0.7, { slide: true }], [46, 77, 2, 0.6],
      [48, 76, 10, 0.8, { slide: true }], [58, 73, 6, 0.7]]),
  });
  return {
    ...emptyProject(),
    name: 'Experimental',
    bpm: 112,
    scale: { root: 2, type: 'minor' },
    master: -3.5,
    channels: chans,
    patterns: [broken, glitchBlock, drill, bassBlock, boxBlock, leadBlock],
    song: lanes([
      [[glitchBlock, 2, 2], [broken, 4, 10], [drill, 14, 1], [broken, 15, 8], [drill, 23, 1]],
      [[bassBlock, 8, 16]],
      [[leadBlock, 12, 12]],
      [[boxBlock, 0, 24, 0, 2]],
    ]),
  };
}
