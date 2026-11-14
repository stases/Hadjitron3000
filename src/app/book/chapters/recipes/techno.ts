import { addMod, beat, duck, mix, newBlock, newSound, place, point, rackFx, scale, send, set, tempo, write } from
  '../../steps';
import { recipe } from './start';

const F = 53; // F, which the Round Bass plays two octaves down, at 44 Hz
const rolling = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].map((s) => [s, F, 1, s % 4 === 2 ? 0.9 : 0.7] as const);

export default recipe({
  title: 'Recipe: Techno',
  name: 'My Techno',
  about: [
    'Techno is music for long nights: a kick on every beat, a bass that rolls between the kicks, and a few sounds '
      + 'that change slowly over minutes. It came out of Detroit in the 1980s and went to Berlin. This one is at '
      + '128 BPM, in F minor.',
  ],
  sounds: [
    'The Punch Kick is a sine whose pitch drops in a blink, driven and squeezed so it thumps in the chest. The bass '
      + 'plays only between the kicks, and ducks under them as well, so the two never fight. The chord stab is two '
      + 'saws a fifth apart through a filter that snaps shut, echoed off into the distance: the sound of Basic '
      + 'Channel and of dub techno. An LFO slowly opening the stab\'s filter is what keeps the piece moving.',
  ],
  result: 'A 32-bar techno track: kick and hats alone, the rolling bass, a breakdown with only the echoing stab, and '
    + 'everything together to the end.',
  steps: [
    tempo(128, 'Set the tempo to 128 BPM in the bar at the top.', { title: 'The beat' }),
    newSound('Punch Kick', 'In the Factory press New..., choose Punch Kick from the library and add it to the Track.'),
    write('Beat', 'Punch Kick', beat('x...x...x...x...'), 'In the Track, put the kick on every beat: steps 1, 5, 9 and 13.'),
    newSound('Hat', 'Add the Hat from the library.'),
    write('Beat', 'Hat', beat('..x...x...x...x.'), 'Put a hat on the off-beats, between the kicks: steps 3, 7, 11 and 15.'),
    newSound('Clap', 'Add the Clap.'),
    write('Beat', 'Clap', beat('....x.......x...'), 'Put the clap on the second and fourth beats, steps 5 and 13.'),
    newSound('Tick', 'Add the Tick, a short metallic click.'),
    write('Beat', 'Tick', beat('x..x..x..x..x...'), 'Put ticks on steps 1, 4, 7, 10 and 13: groups of three against '
      + 'the four of the kick, a roll that keeps the beat from standing still.'),
    newBlock('Bass', 1, 'Make a new block for the bass: press + in the Block bar above the grid, then Rename... it '
      + 'to Bass.',
      { title: 'The bass' }),
    newSound('Round Bass', 'Add Round Bass from the library.'),
    set('amp', { decay: 0.12, sustain: 0 }, 'In its Amp, set Decay to about 0.12 s and Sustain all the way down, '
      + 'so every note is a short thud.', { sound: 'Round Bass' }),
    scale({ root: 5, type: 'minor' }, 'Round Bass', 'Open Round Bass in the piano roll and set the scale to F Minor '
      + 'under its Shaping.'),
    write('Bass', 'Round Bass', rolling, 'Write an F on every step except the kicks\' steps 1, 5, 9 and 13. The bass '
      + 'now rolls in the gaps.', { roll: true }),
    duck('Round Bass', 'Punch Kick', 0.5, 0.12, 'In the Mixer, under Shaping, set Round Bass to duck under the Punch '
      + 'Kick: Amount about 50 %, Release about 0.12 s.'),
    newBlock('Stab', 2, 'Make another block, Rename... it to Stab, and set its Bars to 2.', { title: 'The stab' }),
    newSound('Dub Stab', 'Add the Dub Stab.'),
    write('Stab', 'Dub Stab', [[6, 65], [6, 68], [6, 72], [22, 65], [22, 68], [22, 72], [28, 63], [28, 67], [28, 70]],
      'In the roll, write an F minor chord, F, A flat and C, on step 7 of each bar, and an E flat chord, E flat, G '
        + 'and B flat, on step 13 of bar 2.', { roll: true }),
    addMod('lfo', 'In the Factory, add an LFO to the Dub Stab.', { sound: 'Dub Stab' }),
    point('mod:lfo', ['filter', 'cutoff'], 0.3, 'Point it at Filter · Cutoff with an Amount of about +30 %.',
      { sound: 'Dub Stab' }),
    set('mod:lfo', { sync: '8bar', wave: 'triangle' }, 'Set its Sync to 8 bars and Wave to triangle: the stab opens '
      + 'and closes over eight bars.', { sound: 'Dub Stab' }),
    place([['Beat', 0, 0, 12]], 'In the Song, place Beat in lane 1 at bar 1, 12 bars long.', { title: 'The arrangement' }),
    place([['Bass', 1, 4, 8]], 'Place Bass in lane 2 at bar 5, 8 bars long.'),
    place([['Stab', 2, 8, 24, 2, 4]], 'Place Stab in lane 3 at bar 9, 24 bars long, to the end, with a Fade in of 2 '
      + 'bars and a Fade out of 4.'),
    place([['Beat', 0, 16, 16], ['Bass', 1, 16, 16]], 'Bars 13 to 16 are the breakdown, the stab alone. Bring Beat and '
      + 'Bass back at bar 17 in their lanes, 16 bars each.'),
    send('Clap', [0.25, 0], 'In the Mixer, send the Clap to the Room, about 25 %.', { title: 'The mix' }),
    mix('Hat', { level: -12, pan: 0.2 }, 'Bring the Hat down to about -12 dB and pan it a little right.'),
    rackFx('master', 'compressor', { threshold: -12, ratio: 2 }, 'Add a Compressor to the master, under Shaping: '
      + 'Threshold about -12 dB, Ratio 2:1.'),
  ],
  checkpoints: [['After the drums', 9], ['After the bass', 15], ['After the arrangement', 25]],
  change: [
    'Try a Reese Bass instead of the Round Bass for a darker, growling low end, or the Open Hat on the off-beats for '
      + 'a bigger beat. Change the stab\'s chords to E flat and D flat minor for a different mood. In a real set the '
      + 'piece would be six minutes long: copy the arrangement out, and let something change every 16 bars.',
  ],
});
