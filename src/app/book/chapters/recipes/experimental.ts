import { addFx, beat, extras, loop, mix, newBlock, newSound, place, rackFx, scale, send, set, tempo, write } from
  '../../steps';
import { recipe } from './start';

export default recipe({
  title: 'Recipe: Experimental',
  name: 'My Experiment',
  about: [
    'In the manner of Aphex Twin, this is music that sounds both sweet and broken: a gentle, music-box melody over '
      + 'drums that stutter, crackle and fold back on themselves. Rhythms are fast and irregular, rows run at '
      + 'lengths of their own, and digital damage is part of the tone. This one is at 100 BPM, in D Dorian: minor '
      + 'with a hopeful raised sixth, a little bittersweet.',
  ],
  sounds: [
    'The drums are short and dry, so the stutters stay sharp: ratchets make machine-gun rolls, chances make the '
      + 'pattern change every bar, and a crushed tick in a row of five steps slides against the four-step kick. The '
      + 'melody is the Ring Bell, an FM bell made stranger by a ring modulator, so its notes clang slightly out of '
      + 'any scale. A Comb on the snare rings it like a struck pipe.',
  ],
  result: 'A 24-bar piece where a bittersweet bell melody floats over drums that stutter and never quite repeat, '
    + 'with a pause in the middle where only the bell and the ticking remain.',
  steps: [
    tempo(100, 'Set the tempo to 100 BPM.', { title: 'The drums' }),
    newSound('Kick', 'In the Factory press New... and add the Kick.'),
    write('Beat', 'Kick', beat('x.....x...x..x..'), 'Put kicks on steps 1, 7, 11 and 14: a broken beat.'),
    newSound('Snare', 'Add the Snare.'),
    write('Beat', 'Snare', beat('....x.......x..x'), 'Put snares on steps 5, 13 and 16.'),
    addFx('comb', 'In the Factory, add a Comb to the Snare, from the Deep list.', { sound: 'Snare' }),
    set('fx:comb', { freq: 294, feedback: 0.8, mix: 0.35 }, 'Set its Freq to about 294 Hz, a D, Feedback to 80 % and '
      + 'Mix to 35 %. The snare now rings.', { sound: 'Snare' }),
    extras('Beat', 'Snare', [15], { ratchet: 4 }, 'Open the Snare in the piano roll, select its last note and set '
      + 'Ratchet to 4x under Deep: a stuttering roll.'),
    newSound('Tick', 'Add the Tick.'),
    write('Beat', 'Tick', beat('x.xx.'), 'In the grid, put ticks on steps 1, 3 and 4.'),
    loop('Beat', 'Tick', 5, 'Drag the marker at the end of the Tick row back to step 5: the ticks repeat every five '
      + 'steps against the sixteen of the bar.'),
    addFx('crusher', 'Add a Crusher to the Tick.', { sound: 'Tick' }),
    set('fx:crusher', { bits: 4, rate: 4000 }, 'Set Bits to 4 and Rate to about 4 kHz: a crackle like a broken toy.',
      { sound: 'Tick' }),
    newBlock('Bell', 2, 'Press + in the Block bar for a new block, Rename... it to Bell, and set Bars to 2.',
      { title: 'The melody' }),
    newSound('Ring Bell', 'Add the Ring Bell.'),
    scale({ root: 2, type: 'dorian' }, 'Ring Bell', 'Open the Ring Bell in the piano roll and set the scale to D '
      + 'Dorian.'),
    write('Bell', 'Ring Bell', [[0, 74, 4], [4, 77, 2], [6, 81, 2], [8, 79, 6], [16, 74, 4], [20, 71, 2], [22, 72, 2],
      [24, 69, 8]], 'Write the melody: D for four steps, then F and A, two steps each, and G for six; in bar 2, D '
        + 'again, then B and C, and a long A.', { roll: true }),
    extras('Bell', 'Ring Bell', [4, 6, 20, 22], { chance: 70 }, 'Select the four short notes and set Chance to 70 %, '
      + 'so the melody leaves gaps of its own.'),
    place([['Bell', 1, 0, 24, 2, 4]], 'In the Song, place Bell in lane 2 from bar 1 to bar 24, with a Fade in of 2 '
      + 'bars and a Fade out of 4.', { title: 'The arrangement' }),
    place([['Beat', 0, 4, 8], ['Beat', 0, 16, 8]], 'Place Beat in lane 1 at bar 5 for 8 bars, and again at bar 17 '
      + 'for 8 bars. The bell plays alone in bars 13 to 16.'),
    send('Ring Bell', [0.3, 0.15], 'In the Mixer, send the Ring Bell to the Room, about 30 %, and the Echo, about '
      + '15 %.', { title: 'The mix' }),
    mix('Tick', { level: -16, pan: 0.4 }, 'Bring the Tick down to about -16 dB and pan it to the right.'),
    rackFx('master', 'compressor', { threshold: -14, ratio: 3 }, 'Add a Compressor to the master: Threshold about '
      + '-14 dB, Ratio 3:1. It squeezes the stutters together.'),
  ],
  checkpoints: [['After the drums', 13], ['After the melody', 18], ['After the arrangement', 20]],
  change: [
    'There is no bass line here on purpose; the kick and the bell carry the low and the high. Try other row lengths, '
      + '3, 7 or 11 steps, for the ticks, and ratchets of 6 or 8 on single kicks. Set the tempo to 160 for the frantic '
      + 'drill and bass sound, or put a Comb tuned to the key on the whole kit.',
  ],
});
