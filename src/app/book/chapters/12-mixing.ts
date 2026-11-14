import { preset } from '../../../presets';
import type { Chapter } from '../pages';
import { hits, notes, projectExample } from '../build';
import type { ProjectSpec } from '../build';
import { addFx, duck, look, mix, rackFx, send, set } from '../steps';

const bassLine = notes([[0, 57, 4], [4, 57, 4], [8, 60, 4], [12, 55, 4]]);

/** A kick and a long bass on the beat, with or without ducking. */
const pumping = (ducked: boolean): ProjectSpec => ({
  name: ducked ? 'Ducked Bass' : 'Bass Under Kick',
  bpm: 124,
  sounds: [preset('Kick'), preset('Sub Bass')],
  blocks: [{ name: 'Beat', bars: 1, rows: { Kick: hits('x...x...x...x...'), 'Sub Bass': bassLine } }],
  ducks: ducked ? { 'Sub Bass': ['Kick', 0.7, 0.18] } : undefined,
});

const muddy = projectExample('A muddy mix: everything loud, in the middle and dry', () => ({
  name: 'Muddy Mix',
  bpm: 124,
  sounds: [preset('Kick'), preset('Clap'), preset('Hat'), preset('Sub Bass'), preset('Warm Pad'),
    preset('Square Lead')].map((s) => ({ ...s, out: { ...s.out, level: s.name === 'Kick' ? -2 : -6 } })),
  blocks: [{
    name: 'Loop', bars: 2, rows: {
      Kick: hits('x...x...x...x...x...x...x...x...'),
      Clap: hits('....x.......x.......x.......x...'),
      Hat: hits('..x...x...x...x...x...x...x...x.'),
      'Sub Bass': notes([[0, 57, 4], [4, 57, 4], [8, 60, 4], [12, 55, 4], [16, 53, 4], [20, 53, 4], [24, 55, 4],
        [28, 55, 4]]),
      'Warm Pad': notes([[0, 45, 16], [0, 48, 16], [0, 52, 16], [16, 41, 16], [16, 45, 16], [16, 48, 16]]),
      'Square Lead': notes([[0, 76, 2], [3, 72], [6, 69, 2], [10, 72, 2], [16, 77, 2], [19, 72], [22, 69, 2],
        [26, 67, 2]]),
    },
  }],
}));

const chapter: Chapter = {
  id: 'mixing',
  title: 'Mixing',
  pages: [
    {
      title: 'The Mixer',
      pieces: [
        'Mixing is making every sound heard at once: none buried, none too loud, each with a place of its own. The '
          + 'Mixer has a strip for every sound, with a fader for its level, a pan knob for where it sits between the '
          + 'speakers, mute and solo, and a meter. Solo is the quickest way to hear what one sound is really doing.',
        'Start with the levels. Bring everything down, then set the kick and the bass first, since the rest of a '
          + 'dance track is built around them, and add the others until each one is just heard. Then pan: keep kick, '
          + 'bass, snare and lead in the middle, and spread hats, percussion and pads a little to the sides, so the '
          + 'middle stays clear.',
      ],
    },
    {
      title: 'The Room and the Echo',
      pieces: [
        'Under the strips are two buses, the Room and the Echo: a reverb and a delay that every sound can share. Each '
          + 'strip has a send knob for each bus that says how much of that sound goes there. Sharing one room makes '
          + 'sounds seem to play in the same place, which is warmer than each having a reverb of its own, and it '
          + 'costs the computer less.',
        'Click a bus\'s rack button to see and change its effects below the strips: a longer Room, a different '
          + 'Echo time, or something else entirely, such as a Chorus bus. Keep kick and bass out of the buses; send '
          + 'claps, leads and pads.',
      ],
    },
    {
      title: 'Ducking',
      pieces: [
        'A kick and a bass share the bottom of the mix, and where they hit together they blur into one boom. Ducking '
          + 'makes the bass dip for a moment every time the kick plays, and swell back after, so each kick punches '
          + 'through. Turned up, it becomes the pumping, breathing sound of French house and much of EDM.',
        'Ducking is a Shaping control of the Mixer: choose which sound pushes this one down, how far with Amount, and '
          + 'how quickly it comes back with Release. It keeps working while the kick is muted.',
        {
          kind: 'compare',
          before: projectExample('A bass under a kick', () => pumping(false)),
          after: projectExample('The same bass ducked by the kick', () => pumping(true)),
          claim: { measure: 'duck', more: true },
        },
      ],
    },
    {
      title: 'The master and loudness',
      pieces: [
        'Everything ends on the master: its fader is the volume of what you hear and export, and its meter shows how '
          + 'loud the whole mix is. The red lamps at the top mean it is too loud; past that, the master squashes the '
          + 'peaks so they never break up, but a mix that lives there loses its punch.',
        'The master has its own rack of effects, under Shaping: a gentle Compressor there glues the mix together, an '
          + 'EQ shapes its overall tone. Aim for a mix whose meter reaches the top of the amber lamps on the loudest '
          + 'parts and leaves the red alone. A mix that is clear is heard as louder than one that is merely loud.',
      ],
    },
    {
      title: 'Worked: cleaning up a muddy mix',
      pieces: [
        'This example loads a two-bar loop where every sound is loud, in the middle and dry: the pad booms under the '
          + 'bass, the hats sit on top of the clap, and the lead is stuck to the speakers. Play it between the steps and '
          + 'hear each change.',
        {
          kind: 'worked',
          example: muddy,
          result: 'The same loop with room to breathe: kick and bass punch through, the pad sits behind them, the hats '
            + 'shimmer to the side and the lead echoes into the room.',
          steps: [
            mix('Hat', { level: -14, pan: -0.3 }, 'In the Mixer, bring the Hat\'s fader down to about -14 dB and turn '
              + 'its pan a little to the left, about L 30.'),
            addFx('eq', 'The pad is the mud. Open Warm Pad in the Factory and press Effect, then choose EQ.',
              { sound: 'Warm Pad' }),
            set('fx:eq', { lowcut: 300 }, 'Under the EQ\'s Shaping, set Low Cut to about 300 Hz. The boom under the bass '
              + 'is gone, and the pad keeps its warmth.', { sound: 'Warm Pad' }),
            mix('Warm Pad', { level: -14 }, 'Back in the Mixer, bring Warm Pad down to about -14 dB.'),
            duck('Sub Bass', 'Kick', 0.6, 0.15, 'Under Shaping on the Sub Bass strip, set Duck to Kick, Amount to '
              + 'about 60 % and Release to about 0.15 s. The kick now cuts through the bass on every beat.'),
            send('Square Lead', [0.15, 0.3], 'Turn the Square Lead\'s Room send to about 15 % and its Echo send to '
              + '30 %. The lead steps back into a space.'),
            send('Clap', [0.25, 0], 'Turn the Clap\'s Room send to about 25 %.'),
            rackFx('master', 'compressor', { threshold: -12, ratio: 2 }, 'Under Shaping, press the master\'s rack '
              + 'button, add a Compressor, and set its Threshold to about -12 dB and its Ratio to 2:1. It gently '
              + 'holds the mix together.'),
            look('Play the loop and watch the master meter: it should reach the top of the amber lamps on the kicks '
              + 'and stay out of the red. Mute and solo strips to hear what each change did.',
            { target: 'master', view: 'mixer' }),
          ],
        },
      ],
    },
  ],
};

export default chapter;
