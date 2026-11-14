import { emptyProject } from '../../core/defaults';
import type { NoteExtras } from '../../core/notes';
import type { Project } from '../../core/types';
import { block, channels, each, hits, laneLevels, lanes, mix, notes } from '../compose';

const slide: NoteExtras = { slide: true };

/**
 * "Acid": 128 BPM in E Phrygian. Three acid lines with slides and accents (Acid Bass low, Acid Squelch an octave up,
 * Acid Square on a row of seven steps that drifts against the bar) over a four-on-the-floor beat. 24 bars.
 */
export function acidProject(): Project {
  const chans = channels(['Kick', 'Clap', 'Hat', 'Open Hat', 'Acid Bass', 'Acid Squelch', 'Acid Square']);
  mix(chans, {
    Clap: [0.15, 0],
    'Acid Squelch': [0, 0.2],
    'Acid Square': [0.1, 0.2],
  });
  const [kick, clap, hat, openHat, bass, squelch, square] = chans.map((c) => c.id);
  const beat = block('Beat', 0, 1, {
    [kick]: hits('x...x...x...x...', {}, 55),
    [clap]: hits('....x.......x...'),
    [hat]: hits('xoXoxoXoxoXoxoXo'),
    [openHat]: hits('..x...x...x...x.'),
  });
  // E is 52 here: the bass sounds an octave below the note it is given.
  const acid1 = block('Acid 1', 3, 2, {
    [bass]: notes([
      [0, 52, 1, 1], [1, 52, 1, 0.6], [2, 64, 1, 0.9, slide], [3, 52, 1, 0.6], [4, 55, 1, 0.8], [5, 52, 1, 0.6],
      [6, 64, 2, 1], [8, 52, 1, 0.7], [9, 53, 1, 0.9, slide], [10, 52, 1, 0.6], [11, 62, 1, 1], [12, 52, 1, 0.6],
      [13, 64, 1, 0.8, slide], [14, 55, 1, 0.9], [15, 57, 1, 0.7, slide],
      [16, 52, 1, 1], [17, 52, 1, 0.6], [18, 67, 1, 1, slide], [19, 64, 1, 0.7, slide], [20, 52, 1, 0.6],
      [22, 60, 1, 0.9], [23, 59, 1, 0.7, slide], [24, 52, 2, 1], [26, 53, 1, 0.6], [27, 52, 1, 0.8, slide],
      [28, 64, 1, 1], [29, 52, 1, 0.6], [30, 62, 1, 0.9, slide], [31, 60, 1, 0.7, slide],
    ]),
  });
  const acid2 = block('Acid 2', 4, 2, {
    [squelch]: notes([
      [0, 64, 2, 1], [2, 76, 1, 0.8, slide], [3, 64, 1, 0.6], [4, 65, 1, 0.9, slide], [6, 64, 1, 0.7],
      [7, 71, 1, 1], [8, 69, 2, 0.8, slide], [10, 64, 1, 0.6], [11, 67, 1, 1], [12, 64, 1, 0.6],
      [14, 76, 1, 1, slide], [15, 74, 1, 0.7, slide],
      [16, 64, 1, 1], [17, 64, 1, 0.6], [18, 72, 1, 0.9], [19, 71, 1, 0.7, slide], [20, 64, 2, 1],
      [22, 65, 1, 0.8, slide], [23, 64, 1, 0.6], [24, 76, 1, 1], [25, 64, 1, 0.6], [26, 69, 2, 0.9, slide],
      [28, 67, 1, 0.7], [29, 64, 1, 1], [30, 79, 1, 0.8, slide], [31, 76, 1, 0.7, slide],
    ]),
  });
  const squareLine = block('Square Line', 2, 1, {
    [square]: notes([[0, 64, 1, 1], [2, 67, 1, 0.7, slide], [3, 64, 1, 0.6], [5, 71, 1, 0.9], [6, 69, 1, 0.7, slide]]),
  }, { [square]: 7 });
  const breakBlock = block('Break', 1, 2, {
    [hat]: hits('xoXoxoXoxoXoxoXoxoXoxoXoxoXoXXXX', each([28, 29, 30, 31], { ratchet: 2 })),
    [openHat]: hits('..x...x...x...x...x...x...x...x.'),
    [clap]: hits('....x.......x.......x.......x.xX', { 30: { ratchet: 3 }, 31: { ratchet: 4 } }),
  });
  return {
    ...emptyProject(),
    name: 'Acid',
    bpm: 128,
    scale: { root: 4, type: 'phrygian' },
    master: -2,
    channels: chans,
    patterns: [beat, acid1, acid2, squareLine, breakBlock],
    song: lanes([
      [[beat, 0, 16], [breakBlock, 16, 2], [beat, 18, 6]],
      [[acid1, 4, 20]],
      [[acid2, 10, 6], [acid2, 18, 6]],
      [[squareLine, 8, 16]],
    ]),
    lanes: laneLevels([0, 0, 0, -3]),
  };
}
