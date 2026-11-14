import { emptyProject } from '../../core/defaults';
import type { Project } from '../../core/types';
import { automate, block, channels, chords, each, hits, lanes, mix, notes } from '../compose';

// F minor: F minor, D flat, A flat and E flat, a bar each.
const PAD: number[][] = [[65, 68, 72], [65, 68, 73], [63, 68, 72], [63, 67, 70]];
const CHOIR: number[][] = [[60, 65, 68], [61, 65, 68], [60, 63, 68], [58, 63, 67]];
const ROOTS = [53, 49, 56, 51]; // F, D flat, A flat and E flat; the bass sounds an octave below its notes

/**
 * "Trance": 138 BPM in F minor. A rolling off-beat bass pumped by the kick, a gated pad, an arpeggio, a supersaw
 * lead, and a breakdown with a choir, a downlifter and an uplifter, the choir's filter opening over it. 32 bars.
 */
export function tranceProject(): Project {
  const chans = channels([
    'Punch Kick', 'Clap', 'Open Hat', 'Tight Hat', 'Rolling Bass', 'Gated Pad', 'Arp Pluck', 'Supersaw', 'Choir Pad',
    'Downlifter', 'Uplifter',
  ]);
  mix(chans, {
    Clap: [0.15, 0],
    'Rolling Bass': [0, 0, 'Punch Kick', 0.7, 0.14],
    'Gated Pad': [0.1, 0, 'Punch Kick', 0.5, 0.2],
    'Arp Pluck': [0.1, 0.2, 'Punch Kick', 0.35, 0.2],
    Supersaw: [0.2, 0.15, 'Punch Kick', 0.3, 0.2],
    'Choir Pad': [0.3, 0],
    Uplifter: [0.2, 0],
    Downlifter: [0.2, 0],
  });
  const [kick, clap, openHat, hat, bass, pad, arp, lead, choir, down, up] = chans.map((c) => c.id);
  const bars = (chord: (bar: number) => [number, number[], number, number?][]) => [0, 1, 2, 3].flatMap(chord);
  const beat = block('Beat', 0, 2, {
    [kick]: hits('X...x...X...x...X...x...X...x...', {}, 56),
    [clap]: hits('....x.......x.......x.......x...'),
    [openHat]: hits('..x...x...x...x...x...x...x...x.'),
    [hat]: hits('oxoooxoooxoooxoooxoooxoooxoooxoX', each([0, 2, 3, 4, 6, 7, 8, 10, 11, 16, 18, 19, 26, 27], {
      chance: 60,
    })),
  });
  const bassBlock = block('Bass', 3, 4, {
    [bass]: notes(ROOTS.flatMap((root, bar) => [0, 1, 2, 3].flatMap((beat) => [1, 2, 3].map(
      (s): [number, number, number, number] => [bar * 16 + beat * 4 + s, root, 1, s === 1 ? 0.9 : 0.7])))),
  });
  const padBlock = block('Pad', 5, 4, { [pad]: chords(bars((bar) => [[bar * 16, PAD[bar], 16, 0.7]])) });
  const arpBlock = block('Arp', 4, 4, { [arp]: chords(bars((bar) => [[bar * 16, PAD[bar], 16, 0.8]])) });
  const leadBlock = block('Lead', 2, 4, {
    [lead]: notes([
      [0, 77, 3], [3, 80, 3], [6, 84, 2], [8, 82, 2], [10, 80, 2], [12, 77, 4],
      [16, 77, 3], [19, 80, 3], [22, 85, 2], [24, 84, 2], [26, 80, 2], [28, 77, 4],
      [32, 75, 3], [35, 80, 3], [38, 84, 2], [40, 82, 2], [42, 80, 2], [44, 79, 4],
      [48, 75, 3], [51, 79, 3], [54, 82, 6], [60, 79, 4],
    ]),
    [arp]: chords(bars((bar) => [[bar * 16, PAD[bar], 16, 0.7]])),
  });
  const breakdown = block('Breakdown', 6, 8, {
    [choir]: chords([0, 1, 2, 3, 4, 5, 6, 7].map((bar) => [bar * 16, CHOIR[bar % 4], 16, 0.7])),
    [down]: notes([[0, 60, 16, 0.9]]),
    [up]: notes([[64, 60, 64, 0.9]]),
  });
  const project: Project = {
    ...emptyProject(),
    name: 'Trance',
    bpm: 138,
    scale: { root: 5, type: 'minor' },
    master: -4.5,
    channels: chans,
    patterns: [beat, bassBlock, padBlock, arpBlock, leadBlock, breakdown],
    song: lanes([
      [[beat, 0, 12], [beat, 20, 12]],
      [[bassBlock, 4, 8], [bassBlock, 20, 12]],
      [[arpBlock, 0, 12, 4], [leadBlock, 20, 12]],
      [[padBlock, 4, 8], [breakdown, 12, 8], [padBlock, 20, 12]],
    ]),
  };
  project.automation = [automate(project, choir, 'filter', 'cutoff', [[12, 500], [19, 6000]])];
  return project;
}
