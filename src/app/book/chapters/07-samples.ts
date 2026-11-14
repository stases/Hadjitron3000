import { TICKS_PER_STEP } from '../../../core/defaults';
import { preset } from '../../../presets';
import { addNotes, useApp } from '../../../state/store';
import type { AppState } from '../../../state/store';
import type { Chapter } from '../pages';
import { chord, held, hits, makeSound, notes, projectExample, soundExample } from '../build';
import type { SoundSpec } from '../build';
import { addFx, addMod, newBlock, point, set, write } from '../steps';
import type { TourStep } from '../../tour/tourStore';

/** The factory break in a new order: slice 1 is the kick, 3 the snare, and so on, one per key from C3 (60) up. */
const shuffled = notes([[0, 60, 2], [2, 61, 2], [4, 62, 2], [6, 60, 1], [7, 60, 1], [8, 64, 2], [10, 62, 1],
  [11, 62, 1], [12, 66, 2], [14, 63, 1], [15, 67, 1]]);

/** The row of the Chopped Break in the Beat block. */
const breakRow = (state: AppState) => {
  const channel = state.project.channels.find((c) => c.sound.name === 'Chopped Break');
  const block = state.project.patterns.find((p) => p.name === 'Beat');
  return channel && block ? block.notes[channel.id] ?? [] : [];
};

/**
 * Slices to Track: done once the row plays every one of the eight slices. The scripted run writes them where the
 * button puts them for this one-bar break at 120 BPM, two steps apart; the real button reads the recording.
 */
const slicesToTrack: TourStep = {
  title: 'Slices to Track',
  text: 'Under the Source\'s Shaping press Slices to Track. The eight slices appear in the Chopped Break\'s row of '
    + 'Beat, one after another, C3 to G3: the break plays exactly as it was recorded.',
  target: 'slices-to-track',
  view: 'factory',
  select: { sound: 'Chopped Break', block: 'Beat' },
  unfold: () => [['sample', 2]],
  done: ({ state }) => [60, 61, 62, 63, 64, 65, 66, 67].every((n) => breakRow(state).some((x) => x.note === n)),
  act: (state) => {
    const channel = state.project.channels.find((c) => c.sound.name === 'Chopped Break')!;
    const block = useApp.getState().project.patterns.find((p) => p.name === 'Beat')!;
    addNotes(block.id, channel.id, [...Array(8).keys()].map((k) => ({
      start: 2 * k * TICKS_PER_STEP, len: 2 * TICKS_PER_STEP, note: 60 + k, vel: 0.8,
    })));
  },
};

const chop = projectExample('The factory break, its slices switched off, and a kick', () => ({
  name: 'Chop',
  bpm: 120,
  sounds: [makeSound({ name: 'Chopped Break', from: 'Chopped Break', src: { slices: 'off' } }),
    preset('Kick')],
  blocks: [{ name: 'Beat', bars: 1, rows: { Kick: hits('x.......x.......') } }],
}));

/** A cloud of grains on the factory pad, held: the base of the pairs. */
const cloud: SoundSpec = {
  name: 'Grain Cloud', source: 'grains', src: { size: 0.15, density: 8, spray: 0, position: 0.5 },
  amp: { attack: 0.2, sustain: 1, release: 0.5 }, out: { level: -6 },
};

const chapter: Chapter = {
  id: 'samples',
  title: 'Samples, slices and grains',
  pages: [
    {
      title: 'Playing recordings',
      pieces: [
        'Besides making tones from nothing, a sound can play a recording. The Sampler, which the chapter on waves '
          + 'introduces, plays a file at the pitch of each key, like a tape sped up or slowed down. Press Load... in '
          + 'its Source unit, or drop an audio file on it. Start and End choose the part to play.',
        'Two more ways to play a recording come in this chapter. Slices cut it into pieces and give each piece a key '
          + 'of its own, which turns a drum loop into a kit. Grains, a Deep source, play it as a cloud of tiny '
          + 'overlapping pieces, which turns any recording into a pad, a texture or a swarm. The factory has one of '
          + 'each: Chopped Break, a one-bar drum loop in eight slices, and Cloud Pad, a cloud of grains from a pad '
          + 'recording.',
      ],
    },
    {
      title: 'Slices',
      pieces: [
        'Under the Sampler\'s Shaping, Slices cuts the part between Start and End into 2, 4, 8, 16 or 32 equal pieces, '
          + 'or, with Hits, at every hit it can hear. Sensitivity then decides how soft a hit may be and still start a '
          + 'slice: turn it up to catch the ghost notes. Dotted lines on the waveform show the cuts, and the slice a '
          + 'note plays lights up.',
        'The keys from C3 up play the slices in order: C3 the first, C sharp the second, D the third. Each plays at the '
          + 'pitch it was recorded at, so the drums stay in tune. Play them from the computer keyboard to rearrange '
          + 'the loop by hand: A, W, S, E, D and so on.',
        'Slices to Track writes the slices into the sound\'s row of the block, one after another on the nearest '
          + 'sixteenth, so the loop plays as recorded and the pieces can be moved about from there. If they need '
          + 'more bars than the block has, it asks whether to lengthen the block.',
        {
          kind: 'example',
          example: soundExample('The factory break, played in a new order', () => makeSound({ name: 'Chopped Break',
            from: 'Chopped Break' }), shuffled),
        },
      ],
    },
    {
      title: 'Worked: chop a break',
      pieces: [
        'Chopping is cutting a drum loop into pieces and playing them in a new order: the heart of jungle, of hip '
          + 'hop and of much of Four Tet\'s and Aphex Twin\'s drumming. This example loads the factory break with its '
          + 'slices off.',
        {
          kind: 'worked',
          example: chop,
          result: 'The break laid out on the Track, then a new beat made from its pieces, with a stutter at the end.',
          steps: [
            set('source', { slices: '8' }, 'Select the Chopped Break in the Factory. Under the Source\'s Shaping set '
              + 'Slices to 8: dotted lines cut the waveform into eight.', { sound: 'Chopped Break', title: 'Cut it' }),
            slicesToTrack,
            newBlock('Chop', 1, 'Press + in the Block bar on the Track to make a new block, and Rename... it to Chop.',
              { title: 'Play it in a new order' }),
            write('Chop', 'Chopped Break', [[0, 60, 2], [2, 61, 2], [4, 62, 2], [6, 60], [7, 60], [8, 64, 2],
              [10, 62], [11, 62], [12, 66, 2], [14, 63], [15, 67]], 'Open the Chopped Break in the piano roll and '
              + 'write the slices in a new order: C3 on step 1, C sharp on 3, D on 5, two short Cs on 7 and 8, E on 9, '
              + 'two short Ds on 11 and 12, F sharp on 13, D sharp on 15 and G on 16.', { roll: true }),
            write('Chop', 'Kick', [[0, 60], [8, 60]], 'Back in the grid, put the Kick on steps 1 and 9 under the '
              + 'chopped break, for weight.'),
          ],
        },
        'Try Hits instead of 8 equal slices: then every drum gets a slice of its own however the loop swings. Load '
          + 'any drum loop of your own with Load..., and the same steps chop it.',
      ],
    },
    {
      title: 'Granular playback',
      pieces: [
        'Imagine cutting a recording into hundreds of tiny pieces, each a tenth of a second long, and throwing '
          + 'handfuls of them into the air at once, each fading in and out softly. What you hear is not the recording '
          + 'playing but a cloud made of its colour: a held, shimmering sound that can be frozen at one moment of the '
          + 'file, stretched, scattered or tuned. Each tiny piece is a grain, and playing sound this way is called '
          + 'granular.',
        'Position picks the moment of the recording the grains come from, and the waveform marks it with a flag; drag '
          + 'it, or let a modulator move it, to travel slowly through the file without changing its pitch. Size is '
          + 'how long each grain lasts: short grains buzz, long ones smear the recording out. Density is how many '
          + 'sound at once. Spray scatters them around Position, Pitch Spray detunes each one at random, Width throws '
          + 'them between the speakers and Reverse plays some of them backwards. The keys move the whole cloud up '
          + 'and down, with C3 at the recording\'s own pitch.',
        {
          kind: 'example',
          example: soundExample('Cloud Pad, the factory cloud', () => makeSound({ name: 'Cloud Pad', from: 'Cloud Pad' }),
            chord(57, 32), { bars: 2, bpm: 80 }),
        },
        { kind: 'knobs', unit: 'grains', when: 'Reach for grains for pads and drones from any recording, for frozen '
          + 'moments of a sound, and for the shimmering clouds of ambient music.' },
      ],
    },
    {
      title: 'Spray, density and pitch spray',
      pieces: [
        'With no Spray, every grain comes from the same moment of the recording, and the cloud sounds still and '
          + 'glassy. With a lot of Spray they come from all over it, so the cloud keeps changing colour.',
        {
          kind: 'compare',
          before: soundExample('Grains from one moment', () => makeSound(cloud), held(60, 32), { bars: 2 }),
          after: soundExample('The same with full Spray', () => makeSound({ ...cloud, name: 'Sprayed Cloud',
            src: { ...cloud.src, spray: 1 } }), held(60, 32), { bars: 2 }),
          claim: { measure: 'movement', more: true },
        },
        'With a low Density the grains come one after another and the cloud patters like rain on a roof; with a high '
          + 'one they overlap into a smooth haze.',
        {
          kind: 'compare',
          before: soundExample('A sparse cloud', () => makeSound({ ...cloud, name: 'Sparse Cloud',
            src: { ...cloud.src, size: 0.04, density: 0.4 } }), held(60, 16)),
          after: soundExample('The same, dense', () => makeSound({ ...cloud, name: 'Dense Cloud',
            src: { ...cloud.src, size: 0.04, density: 40 } }), held(60, 16)),
          claim: { measure: 'crest', more: false },
        },
        'Pitch Spray detunes every grain by a different amount, so a single note becomes a choir of slightly wrong '
          + 'ones; with Octaves on, the grains jump by whole octaves instead and the cloud shimmers above and below.',
        {
          kind: 'compare',
          before: soundExample('A cloud in tune', () => makeSound(cloud), held(60, 16)),
          after: soundExample('The same with Pitch Spray', () => makeSound({ ...cloud, name: 'Detuned Cloud',
            src: { ...cloud.src, pspray: 1200 } }), held(60, 16)),
          claim: { measure: 'wobble', more: true },
        },
      ],
    },
    {
      title: 'Worked: an ambient cloud',
      pieces: [
        'From the pad recording that comes with the program to a slow, wide, endlessly changing cloud for ambient '
          + 'music. A new Grains sound starts on that recording.',
        {
          kind: 'worked',
          example: soundExample('A new Grains sound', () => makeSound({ name: 'My Cloud', source: 'grains' }),
            chord(57, 32), { bars: 2, bpm: 80 }),
          result: 'A soft, wide cloud that swells in, shimmers an octave above and below, drifts slowly through its '
            + 'recording and fades into a vast space.',
          steps: [
            set('source', { size: 0.4, density: 12 }, 'Set Size to about 0.4 s and Density to about 12: long grains, '
              + 'many at once, a smooth haze.'),
            set('source', { spray: 0.4 }, 'Under Shaping, set Spray to about 40 %, so the grains come from a wide stretch '
              + 'of the recording; the lit band on the waveform shows it.'),
            set('source', { pspray: 1200, octaves: true }, 'Turn Pitch Spray all the way up and switch Octaves on: some '
              + 'grains now sound an octave up or down.'),
            set('source', { width: 1, reverse: 0.3 }, 'Set Width to 100 % and Reverse to about 30 %.'),
            set('amp', { attack: 2, release: 4 }, 'In the Amp, set Attack to about 2 s and Release to about 4 s.'),
            addMod('drift', 'Press Modulator and choose Drift.'),
            point('mod:drift', ['source', 'position'], 0.3, 'Point it at Source · Position with an Amount of about '
              + '+30 %: the cloud wanders slowly through the recording.'),
            set('mod:drift', { rate: 0.1 }, 'Set its Rate to about 0.1 Hz, a new place every ten seconds.'),
            addFx('space', 'Press Effect and choose Space.'),
            set('fx:space', { size: 20, mix: 0.4 }, 'Set its Size to about 20 s and Mix to 40 %.'),
          ],
        },
        'Load a recording of your own, a voice, a guitar, rain, and the same settings turn it into a cloud of its '
          + 'own. Freeze in the Space holds the cloud for as long as you like.',
      ],
    },
  ],
};

export default chapter;
