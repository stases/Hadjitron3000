import { addMod, beat, extras, mix, newBlock, newSound, place, point, rackFx, scale, send, set, tempo, velocity, write,
} from '../../steps';
import { recipe } from './start';

const E = 52; // E, which the Acid Bass plays an octave down, at 82 Hz

/** A sixteenth-note acid line in E Phrygian: [step, note, length]. */
const line = [[0, E], [1, E], [3, E + 12], [4, E], [6, E + 1], [7, E], [8, E + 12], [10, E], [11, E + 3], [12, E],
  [14, E + 7], [15, E + 12]].map(([s, n]) => [s, n] as const);

export default recipe({
  title: 'Recipe: Acid',
  name: 'My Acid',
  about: [
    'Acid house began in Chicago in 1987, when producers turned the knobs of a little bass synthesizer while it '
      + 'played and found it squelched and talked. Its sound is a single saw through a ringing filter, with slides '
      + 'between notes and accents that bark, over a plain drum machine beat. This one is at 126 BPM, in E Phrygian: '
      + 'minor, with the dark half step above the root that acid loves.',
  ],
  sounds: [
    'The Acid Bass is a saw through a steep, ringing filter, with an envelope that snaps the filter open on every '
      + 'note and opens it further on loud ones. Slides make it glide between notes. Here an LFO slowly sweeps the '
      + 'cutoff, playing the part of the hand on the knob. The drums are deliberately plain, so the line is the star.',
  ],
  result: 'A 32-bar acid track: the beat, the line squelching in, its filter slowly opening and closing over eight '
    + 'bars, a break with the line alone and the full beat back.',
  steps: [
    tempo(126, 'Set the tempo to 126 BPM, with Swing at about 20 %.', { swing: 0.2, title: 'The beat' }),
    newSound('Kick', 'In the Factory press New... and add the Kick.'),
    write('Beat', 'Kick', beat('x...x...x...x...'), 'Put the kick on every beat.'),
    newSound('Hat', 'Add the Hat.'),
    write('Beat', 'Hat', beat('x.x.x.x.x.x.x.x.'), 'Put a hat on every eighth note: every other step.'),
    newSound('Clap', 'Add the Clap.'),
    write('Beat', 'Clap', beat('....x.......x...'), 'Put the clap on steps 5 and 13.'),
    newBlock('Acid', 1, 'Press + in the Block bar for a new block and Rename... it to Acid.', { title: 'The line' }),
    newSound('Acid Bass', 'Add the Acid Bass.'),
    scale({ root: 4, type: 'phrygian' }, 'Acid Bass', 'Open the Acid Bass in the piano roll and set the scale to E '
      + 'Phrygian.'),
    write('Acid', 'Acid Bass', line, 'Write the line: E on steps 1, 2, 5, 8, 11 and 13; the E an octave up on 4, 9 '
      + 'and 16; F on 7; G on 12; B on 15. All one step long.', { roll: true }),
    velocity('Acid', 'Acid Bass', [0, 3, 8, 14], 1, 'Select the notes on steps 1, 4, 9 and 15 and set their velocity '
      + 'all the way up: the accents.'),
    extras('Acid', 'Acid Bass', [3, 8, 15], { slide: true }, 'Select the high E\'s on steps 4, 9 and 16 and switch '
      + 'Slide on.'),
    addMod('lfo', 'In the Factory, add an LFO to the Acid Bass.', { sound: 'Acid Bass' }),
    point('mod:lfo', ['filter', 'cutoff'], 0.3, 'Point it at Filter · Cutoff, Amount about +30 %.', { sound: 'Acid Bass' }),
    set('mod:lfo', { sync: '8bar', wave: 'triangle' }, 'Set its Sync to 8 bars and Wave to triangle: a slow hand on the '
      + 'cutoff knob.', { sound: 'Acid Bass' }),
    place([['Beat', 0, 0, 16]], 'In the Song, place Beat in lane 1 from bar 1, 16 bars long.',
      { title: 'The arrangement' }),
    place([['Acid', 1, 4, 28, 2]], 'Place Acid in lane 2 from bar 5 to the end, 28 bars, with a Fade in of 2 bars.'),
    place([['Beat', 0, 20, 12]], 'Leave bars 17 to 20 for the line alone, then bring Beat back at bar 21 for the last '
      + '12 bars.'),
    send('Acid Bass', [0, 0.15], 'In the Mixer, send the Acid Bass to the Echo, about 15 %.', { title: 'The mix' }),
    mix('Hat', { level: -13, pan: -0.2 }, 'Bring the Hat down to about -13 dB and pan it a little left.'),
    rackFx('master', 'compressor', { threshold: -12, ratio: 2 }, 'Add a Compressor to the master: Threshold about '
      + '-12 dB, Ratio 2:1.'),
  ],
  checkpoints: [['After the drums', 7], ['After the bass', 16], ['After the arrangement', 19]],
  change: [
    'An acid line is played, not written: while the song runs, turn the Acid Bass\'s Cutoff and Reso and listen. '
      + 'Change which notes slide and which bark and the same notes become a new line. Add a Drive after the bass for '
      + 'the harder acid techno sound, or a second, quieter line an octave up.',
  ],
});
