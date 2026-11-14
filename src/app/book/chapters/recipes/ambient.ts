import { beat, extras, mix, newBlock, newSound, place, rackFx, scale, send, set, tempo, write } from '../../steps';
import { recipe } from './start';

export default recipe({
  title: 'Recipe: Ambient',
  name: 'My Ambient',
  about: [
    'In the manner of Loscil or Carbon Based Lifeforms, this is music to sink into: a low drone that never stops, '
      + 'slow chords that swell and drift, drops of melody in a deep reverb, and a soft pulse far below. Nothing '
      + 'happens quickly, but nothing stands still either. This one is at 84 BPM, in D minor.',
  ],
  sounds: [
    'The pulse is a kick with a long decay and a band of pink noise, held for the whole piece, like distant rain. '
      + 'The Deep Drone is two saws a fifth apart with a sub, held, whose filter and pan drift slowly by themselves. '
      + 'The Slow Tide pad drifts out of tune in every voice, and the Kalimba drops notes into a twelve-second room. '
      + 'Long attacks and releases blur every edge.',
  ],
  result: 'A 24-bar piece: the drone fading in alone, the pad swelling over it, a soft half-time pulse in the middle, '
    + 'and everything dissolving into reverb at the end.',
  steps: [
    tempo(84, 'Set the tempo to 84 BPM.', { title: 'The pulse' }),
    newSound('Kick', 'In the Factory press New... and add the Kick.'),
    write('Beat', 'Kick', beat('x.......x.......'), 'Put a kick on steps 1 and 9 only: a slow, half-time heartbeat.'),
    set('amp', { decay: 0.9 }, 'In its Amp, set Decay to about 0.9 s, so each kick booms softly.', { sound: 'Kick' }),
    newSound('Dust', 'Add the Dust, a band of noise.'),
    write('Beat', 'Dust', [[0, 60, 16]], 'Put one note on step 1 of the Dust row and make it the whole bar long.'),
    extras('Beat', 'Dust', [0], { hold: true }, 'Open the Dust in the piano roll, select the note and switch Hold on: '
      + 'it now sounds for as long as the block is placed.'),
    newSound('Tick', 'Add the Tick.'),
    write('Beat', 'Tick', beat('...x.......x..x.'), 'In the grid, put a few ticks on steps 4, 12 and 15, like drops '
      + 'falling.'),
    newBlock('Drone', 4, 'Press + in the Block bar for a new block, Rename... it to Drone, and set Bars to 4.',
      { title: 'The drone' }),
    newSound('Deep Drone', 'Add the Deep Drone.'),
    scale({ root: 2, type: 'minor' }, 'Deep Drone', 'Open the Deep Drone in the piano roll and set the scale to D '
      + 'Minor.'),
    write('Drone', 'Deep Drone', [[0, 62, 64]], 'Write one D, all four bars long.', { roll: true }),
    extras('Drone', 'Deep Drone', [0], { hold: true }, 'Select it and switch Hold on.'),
    newBlock('Pads', 4, 'Make another block, Rename... it to Pads, and set its Bars to 4.', { title: 'The pad' }),
    newSound('Slow Tide', 'Add the Slow Tide.'),
    set('amp', { attack: 4, release: 8 }, 'Its Attack is twelve seconds, longer than these chords. Set it to about '
      + '4 s and the Release to 8 s.', { sound: 'Slow Tide' }),
    write('Pads', 'Slow Tide', [[0, 62, 32], [0, 65, 32], [0, 69, 32], [32, 58, 32], [32, 62, 32], [32, 65, 32]],
      'In the roll, write two chords of two bars each: D minor, D, F and A; then B flat major, B flat, D and F.',
      { roll: true }),
    newSound('Kalimba', 'Add the Kalimba.'),
    write('Pads', 'Kalimba', [[6, 81], [20, 77], [38, 74], [44, 77], [54, 76]], 'Write a few lone notes far apart: A, '
      + 'F, D, F and E.', { roll: true }),
    set('fx:reverb', { size: 12, mix: 0.45 }, 'In the Factory, set the Kalimba\'s Reverb Size to about 12 s and Mix '
      + 'to 45 %.', { sound: 'Kalimba' }),
    place([['Drone', 1, 0, 24, 4, 6]], 'In the Song, place Drone in lane 2 from bar 1 to bar 24, with a 4-bar Fade '
      + 'in and a 6-bar Fade out.', { title: 'The arrangement' }),
    place([['Pads', 2, 4, 20, 4, 4]], 'Place Pads in lane 3 from bar 5 to the end, 20 bars, with 4-bar fades.'),
    place([['Beat', 0, 8, 12, 2, 2]], 'Place Beat in lane 1 from bar 9 for 12 bars, with 2-bar fades: the pulse '
      + 'rises and falls away in the middle of the piece.'),
    send('Slow Tide', [0.3, 0], 'In the Mixer, send the Slow Tide to the Room, about 30 %.', { title: 'The mix' }),
    mix('Kick', { level: -8 }, 'Bring the Kick down to about -8 dB: felt rather than heard.'),
    rackFx('master', 'compressor', { threshold: -16, ratio: 2 }, 'Add a gentle Compressor to the master: Threshold '
      + 'about -16 dB, Ratio 2:1.'),
  ],
  checkpoints: [['After the pulse', 9], ['After the drone', 14], ['After the arrangement', 24]],
  change: [
    'Switch Freeze on in a Space on the Kalimba while a note rings to hold it as a new drone. Try the Frozen Hall '
      + 'instead of the Slow Tide for a glittering, shimmering pad, or slow the whole piece to 70 BPM. In ambient, '
      + 'taking away is usually better than adding: mute a lane and see if the piece misses it.',
  ],
});
