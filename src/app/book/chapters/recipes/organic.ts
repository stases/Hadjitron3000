import { beat, extras, mix, newBlock, newSound, place, rackFx, scale, send, set, tempo, write } from '../../steps';
import { recipe } from './start';

export default recipe({
  title: 'Recipe: Organic',
  name: 'My Organic',
  about: [
    'In the manner of Four Tet, this is dance music that sounds hand-made: plucked and struck sounds instead of '
      + 'synthesizers, swung percussion that never quite repeats, a warm bass, and everything a little worn, as if '
      + 'sampled from old records. This one is at 122 BPM with a deep swing, in G minor.',
  ],
  sounds: [
    'The percussion is a soft kick, a shaker whose ghost notes play at random, and a plucked string: noise through '
      + 'a comb tuned to G, so every hit rings at the key of the piece. The melody is the Kalimba, an FM sound whose '
      + 'bright attack fades like a thumb piano, and the chords are the Old Tape Piano, an electric piano through a '
      + 'tape that wobbles and hisses. A Tape on the master wears the whole mix in the same way.',
  ],
  result: 'A 32-bar piece: kalimba and piano fading in, the swung beat and the bass, a short break with the keys '
    + 'alone, and the full groove to the fade.',
  steps: [
    tempo(122, 'Set the tempo to 122 BPM and Swing to about 35 %: the shuffle is half the style.',
      { swing: 0.35, title: 'The percussion' }),
    newSound('Kick', 'In the Factory press New... and add the Kick.'),
    write('Beat', 'Kick', beat('x...x...x...x..o'), 'Put the kick on every beat, with a soft extra one on step 16.'),
    newSound('Shaker', 'Add the Shaker.'),
    write('Beat', 'Shaker', beat('xoxoxoxoxoxoxoxo'), 'Put a shake on every step: loud on the eighths, ghost notes in '
      + 'between.'),
    extras('Beat', 'Shaker', [1, 5, 9, 13], { chance: 50 }, 'Open the Shaker in the piano roll, select the ghost notes on '
      + 'steps 2, 6, 10 and 14, and set Chance to 50 %.'),
    newSound('Plucked String', 'Add the Plucked String.'),
    write('Beat', 'Plucked String', beat('..x..x....x..x..'), 'In the grid, put it on steps 3, 6, 11 and 14: a plucked '
      + 'rhythm that rings at G.'),
    newBlock('Bass', 2, 'Press + in the Block bar for a new block, Rename... it to Bass, and set Bars to 2.',
      { title: 'The bass' }),
    newSound('Sub Bass', 'Add the Sub Bass.'),
    scale({ root: 7, type: 'minor' }, 'Sub Bass', 'Open the Sub Bass in the piano roll and set the scale to G Minor.'),
    write('Bass', 'Sub Bass', [[0, 67, 3], [6, 67, 1], [8, 70, 3], [14, 65, 2], [16, 63, 3], [22, 63, 1], [24, 62, 4],
      [30, 65, 2]], 'Write the bass: G, three steps long, a short G on step 7, B flat on step 9 and F on 15; in bar '
        + '2, E flat, a short E flat, a long D and F.', { roll: true }),
    newBlock('Keys', 2, 'Make another block, Rename... it to Keys, and set its Bars to 2.', { title: 'The keys' }),
    newSound('Kalimba', 'Add the Kalimba.'),
    write('Keys', 'Kalimba', [[0, 79], [3, 82], [6, 79], [8, 86], [11, 84], [14, 82], [16, 79], [19, 77], [22, 75],
      [24, 74, 2], [27, 77], [30, 79]], 'In the roll, write a falling melody: G, B flat, G, D, C, B flat in bar 1 '
        + 'and G, F, E flat, D, F, G in bar 2, three steps apart.', { roll: true }),
    newSound('Old Tape Piano', 'Add the Old Tape Piano.'),
    write('Keys', 'Old Tape Piano', [[0, 67, 16], [0, 70, 16], [0, 74, 16], [16, 63, 16], [16, 67, 16], [16, 70, 16]],
      'Write two chords, a bar each: G minor, G, B flat and D; then E flat major, E flat, G and B flat.', { roll: true }),
    set('fx:tape', { wow: 0.6 }, 'In the Factory, turn the Tape\'s Wow up to about 60 %: the chords now sway like an '
      + 'old cassette.', { sound: 'Old Tape Piano' }),
    place([['Keys', 2, 0, 32, 4, 4]], 'In the Song, place Keys in lane 3 from bar 1 to the end, 32 bars, with a '
      + '4-bar Fade in and Fade out.', { title: 'The arrangement' }),
    place([['Beat', 0, 4, 12], ['Bass', 1, 8, 8]], 'Place Beat in lane 1 at bar 5 for 12 bars, and Bass in lane 2 at '
      + 'bar 9 for 8 bars.'),
    place([['Beat', 0, 20, 12], ['Bass', 1, 20, 12]], 'Leave bars 17 to 20 to the keys, then bring Beat and Bass back '
      + 'at bar 21 for the last 12 bars.'),
    send('Kalimba', [0.3, 0.1], 'In the Mixer, send the Kalimba to the Room, about 30 %, and a little to the Echo.',
      { title: 'The mix' }),
    mix('Shaker', { level: -8, pan: -0.3 }, 'Bring the Shaker down to about -8 dB and pan it a little left.'),
    rackFx('master', 'tape', { age: 0.45, hiss: 0.2 }, 'Add a Tape to the master, under Shaping, with Age at about '
      + '45 % and Hiss at 20 %. The whole piece now sounds as if it came off one old tape.'),
  ],
  checkpoints: [['After the drums', 8], ['After the bass', 12], ['After the arrangement', 21]],
  change: [
    'Swap the Kalimba for the Bell or the Soft Keys, or tune the Plucked String\'s comb to D for a different ring. '
      + 'Four Tet often lets one sound play in a row of its own length: give the Plucked String 12 steps and hear it '
      + 'move around the bar.',
  ],
});
