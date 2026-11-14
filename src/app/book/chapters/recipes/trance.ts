import {
  automate, beat, curve, duck, mix, newBlock, newSound, place, rackFx, scale, send, set, tempo, write,
} from '../../steps';
import { recipe } from './start';

const strings = { sound: 'Wide Strings', unit: 'filter', param: 'cutoff' } as const;
const A = 57; // A, which the Round Bass plays two octaves down, at 55 Hz
const offbeat = (root: number, from: number) => [2, 6, 10, 14].map((s) => [from + s, root, 2] as const);

/** A minor, F major, C major and G major, one bar each, as held chords. */
const chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]
  .flatMap((notes, bar) => notes.map((n) => [bar * 16, n + 12, 16] as const));

export default recipe({
  title: 'Recipe: Trance',
  name: 'My Trance',
  about: [
    'Trance is euphoric and driving: a steady four-to-the-floor kick, a bass on every off-beat eighth, and above them '
      + 'chords spun into running sixteenth-note arpeggios. Its breakdowns drop the drums for a long, swelling chord '
      + 'progression before the kick returns. This one is at 138 BPM, in A minor, over the chords A minor, F, C and G.',
  ],
  sounds: [
    'The bass plays only the off-beats, so kick and bass alternate and the beat gallops. The lead is the Trance '
      + 'Pluck, five saws slightly out of tune with a filter that snaps shut, put through the arpeggiator: held '
      + 'chords become a glittering line. Wide Strings, five saws through chorus and a wide stereo image, fill the '
      + 'background, and a dotted echo on the pluck makes sixteenths sound faster than they are.',
  ],
  result: 'A 32-bar trance piece: the beat and bass, the arpeggio entering, an eight-bar breakdown where the strings '
    + 'slowly open under the arpeggio, and the full drop to the end.',
  steps: [
    tempo(138, 'Set the tempo to 138 BPM.', { title: 'The beat' }),
    newSound('Punch Kick', 'In the Factory press New... and add the Punch Kick from the library.'),
    write('Beat', 'Punch Kick', beat('x...x...x...x...'), 'In the Track, put the kick on every beat.'),
    newSound('Open Hat', 'Add the Open Hat.'),
    write('Beat', 'Open Hat', beat('..x...x...x...x.'), 'Put an open hat on every off-beat: steps 3, 7, 11 and 15.'),
    newSound('Clap', 'Add the Clap.'),
    write('Beat', 'Clap', beat('....x.......x...'), 'Put the clap on steps 5 and 13.'),
    newBlock('Bass', 4, 'Press + in the Block bar to make a new block, Rename... it to Bass, and set Bars to 4.',
      { title: 'The bass' }),
    newSound('Round Bass', 'Add the Round Bass.'),
    scale({ root: 9, type: 'minor' }, 'Round Bass', 'Open Round Bass in the piano roll and set the scale to A Minor.'),
    write('Bass', 'Round Bass', [...offbeat(A, 0), ...offbeat(A - 4, 16), ...offbeat(A + 3, 32), ...offbeat(A - 2, 48)],
      'Write the off-beat bass, two steps long on steps 3, 7, 11 and 15 of every bar: A in bar 1, F in bar 2, C in '
        + 'bar 3, G in bar 4, following the chords.', { roll: true }),
    duck('Round Bass', 'Punch Kick', 0.4, 0.1, 'In the Mixer, under Shaping, duck the Round Bass under the Punch Kick: '
      + 'Amount about 40 %, Release about 0.1 s.'),
    newBlock('Arp', 4, 'Make another block, Rename... it to Arp, and set its Bars to 4.', { title: 'The arpeggio' }),
    newSound('Trance Pluck', 'Add the Trance Pluck.'),
    write('Arp', 'Trance Pluck', chords, 'In the roll, write the four chords, each held for a whole bar: A, C and E; '
      + 'then F, A and C; then G, C and E; then G, B and D, an octave above the bass.', { roll: true }),
    set('play', { arp: 'updown', octaves: 2 }, 'In the Factory, under the Source\'s Shaping, set Arp to Up-Down and '
      + 'Octaves to 2. The chords run up and down in sixteenths.', { sound: 'Trance Pluck' }),
    set('play', { gate: 0.3 }, 'Set Gate to about 30 % for short, crisp notes.', { sound: 'Trance Pluck' }),
    newSound('Wide Strings', 'Add the Wide Strings.'),
    write('Arp', 'Wide Strings', chords.map(([s, n, l]) => [s, n - 12, l] as const), 'Write the same four chords for '
      + 'the strings, an octave lower.', { roll: true }),
    place([['Beat', 0, 0, 16], ['Bass', 1, 4, 12]], 'In the Song, place Beat in lane 1 from bar 1, 16 bars long, and '
      + 'Bass in lane 2 from bar 5, 12 bars long.', { title: 'The arrangement' }),
    place([['Arp', 2, 8, 24, 4]], 'Place Arp in lane 3 from bar 9 to the end, 24 bars, with a 4-bar Fade in.'),
    place([['Beat', 0, 24, 8], ['Bass', 1, 24, 8]], 'Bars 17 to 24 are the breakdown: the chords alone. Bring Beat and '
      + 'Bass back at bar 25 for the last 8 bars.'),
    automate(strings, 'Under the lanes, press Deep in beginner mode, then + Automation, and choose Wide Strings, '
      + 'Filter, Cutoff.'),
    curve(1, strings, [[16, 500], [23.75, 6000], [24, 2600]], 'Put a point at the start of bar 17 at about 500 Hz, '
      + 'one on the last beat of bar 24 at about 6 kHz and one at the start of bar 25 back at 2.6 kHz: the strings '
      + 'open slowly over the breakdown and settle on the drop.'),
    mix('Wide Strings', { level: -16 }, 'In the Mixer, bring the Wide Strings down to about -16 dB, behind the '
      + 'arpeggio.', { title: 'The mix' }),
    send('Trance Pluck', [0.2, 0], 'Send the Trance Pluck to the Room, about 20 %.'),
    send('Clap', [0.2, 0], 'And the Clap, about 20 %.'),
    rackFx('master', 'compressor', { threshold: -12, ratio: 2 }, 'Add a Compressor to the master: Threshold about '
      + '-12 dB, Ratio 2:1.'),
  ],
  checkpoints: [['After the drums', 7], ['After the bass', 12], ['After the arrangement', 24]],
  change: [
    'Try Arp at Random, or Rate 1/16 triplet, for a different motion. Put an Uplifter in lane 4 over the last four '
      + 'bars of the breakdown, a note four bars long, for the classic rush into the drop. For a harder, faster '
      + 'style, push the tempo to 145 and give the kick more Drive.',
  ],
});
