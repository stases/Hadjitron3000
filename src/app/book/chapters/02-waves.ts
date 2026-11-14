import { DEFAULT_SHAPE, encodeShape } from '../../../core/shape';
import { setParam } from '../../../state/store';
import type { Chapter, Example } from '../pages';
import { chord, held, line, makeSound, soundExample, tune } from '../build';
import type { SoundSpec } from '../build';
import { set, when } from '../steps';

const wave = (title: string, w: string, extra: Partial<SoundSpec> = {}): Example =>
  soundExample(title, () => makeSound({ name: title, src: { wave: w }, amp: { sustain: 0.8 }, ...extra }), held(60, 8));

/** A drawn cycle that rises like a saw and then jumps about: sharp corners, so it buzzes. */
const BUZZ = encodeShape(Array.from({ length: 64 }, (_, i) => (i < 32 ? -1 + i / 16 : i < 44 ? -0.6 : 0.35)));

const plainBass = soundExample('A new oscillator for a bass', () => makeSound({ name: 'Plain Bass' }), line(52));
const squareLead = soundExample('A new oscillator for a lead', () => makeSound({ name: 'Hollow Lead' }), tune(72));
const drawnBuzz = soundExample('A new oscillator to draw on', () => makeSound({ name: 'Drawn Buzz' }), tune(60));

const chapter: Chapter = {
  id: 'waves',
  title: 'Waves and tone',
  pages: [
    {
      title: 'What a sound is made of',
      pieces: [
        'A sound is the air moving back and forth very quickly. How many times a second it moves is the pitch: 110 '
          + 'times a second is a low A, 440 the A in the middle of a piano. One trip back and forth is a cycle, and '
          + 'the shape of that trip is the wave.',
        'The shape decides the colour of the tone. A smooth shape sounds soft and pure; a shape with sharp corners '
          + 'sounds bright and buzzy, because sharp corners are made of many higher pitches, called harmonics, '
          + 'sounding along with the note. Two sounds at the same pitch with different waves are like a flute and a '
          + 'violin playing the same note.',
        'The scope beside the piano in the Factory draws the wave of the selected sound while it plays. The examples '
          + 'here draw theirs below the buttons while you hear them.',
        { kind: 'example', example: wave('A sine wave', 'sine'), picture: 'scope' },
        'A sine is the purest tone there is, one pitch and no harmonics at all. It sounds round and soft, like a '
          + 'whistle or a tuning fork, and at low pitches it is the deep hum under a bass.',
      ],
    },
    {
      title: 'The four waves',
      pieces: [
        'The oscillator, the most common source, offers four stock waves. Each has its own family of harmonics, and '
          + 'that is all that makes them sound different.',
        { kind: 'example', example: wave('A triangle wave', 'triangle'), picture: 'scope' },
        'A triangle has a few soft harmonics: a little brighter than a sine, gentle and flute-like. Good for soft '
          + 'leads, bells and quiet basses.',
        { kind: 'example', example: wave('A saw wave', 'sawtooth'), picture: 'scope' },
        'A saw, short for sawtooth, has every harmonic, falling away slowly. It is bright and buzzy, like a bowed '
          + 'string or a brass section, and because it has so much in it, a filter has a lot to take away. Most '
          + 'basses, pads and leads in techno and trance start as saws.',
        { kind: 'example', example: wave('A square wave', 'square'), picture: 'scope' },
        'A square has only every other harmonic, the odd ones. That gap makes it sound hollow and woody, like a '
          + 'clarinet, and it is the sound of old video games.',
      ],
    },
    {
      title: 'The knobs of the oscillator',
      pieces: [
        'The Source unit holds the oscillator. In beginner mode it shows Wave and Pitch; Shaping opens the second '
          + 'oscillator, the sub, the extra voices and the pulse width, and Deep the rest.',
        { kind: 'knobs', unit: 'osc', when: 'The oscillator is where most sounds begin: basses, leads, pads and plucks.' },
      ],
    },
    {
      title: 'Thicker tones',
      pieces: [
        'One oscillator is a thin, steady line. Real instruments are never quite that steady, and a few tricks make '
          + 'the tone fuller.',
        'Voices plays several copies of the oscillator at once, and Spread detunes them against each other by a '
          + 'few hundredths of a semitone. The copies drift in and out of step, which sounds like a section of '
          + 'players instead of one. Width spreads them between the speakers. Five saws spread like this are the '
          + 'supersaw, the big wide sound of trance.',
        {
          kind: 'compare',
          before: soundExample('One saw', () => makeSound({ name: 'One Saw', src: { wave: 'sawtooth' }, amp: { sustain: 0.8 },
            out: { level: -9 } }), chord(60, 16)),
          after: soundExample('Five saws, spread wide', () => makeSound({ name: 'Five Saws', src: { wave: 'sawtooth',
            voices: 5, spread: 20, width: 0.9 }, amp: { sustain: 0.8 }, out: { level: -12 } }), chord(60, 16)),
          claim: { measure: 'width', more: true },
        },
        'The second oscillator, Osc 2, plays along with the first. Tune it seven semitones up with Pitch 2 for a '
          + 'fifth, twelve for an octave, or leave it at the same pitch and turn Fine 2 a few cents for a slow, fat '
          + 'beating. Mix 2 sets how much of it you hear. The Sub is a pure sine one or two octaves below the note: '
          + 'you feel it more than you hear it, and it gives a bass its weight.',
      ],
    },
    {
      title: 'Pulse width and noise',
      pieces: [
        'When either oscillator plays the square, Pulse makes it narrower or wider. At 50 % it is the plain square; '
          + 'narrower, it loses its hollowness and turns thin and nasal, like an oboe or a reed. An LFO moving the '
          + 'pulse width makes it shimmer, the classic PWM sound of old synthesizers.',
        {
          kind: 'compare',
          before: soundExample('A square at 50 %', () => makeSound({ name: 'Square', src: { wave: 'square' },
            amp: { sustain: 0.8 } }), held(60, 8)),
          after: soundExample('A narrow pulse at 12 %', () => makeSound({ name: 'Pulse', src: { wave: 'square', pw: 0.12 },
            amp: { sustain: 0.8 } }), held(60, 8)),
          claim: { measure: 'highs', more: true },
        },
        'Noise is every pitch at once, at random: hiss. The oscillator can mix some in with Noise, for breath on a '
          + 'flute or grit on a snare. The Noise source plays nothing else, in three colours. White is bright like '
          + 'steam, pink is softer like rain, and brown is a deep rumble like the sea from far away. Noise is what '
          + 'hi-hats, snares, wind and waves are made of.',
        {
          kind: 'compare',
          before: soundExample('White noise', () => makeSound({ name: 'White', source: 'noise', amp: { sustain: 0.8 },
            out: { level: -12 } }), held(60, 8)),
          after: soundExample('Brown noise', () => makeSound({ name: 'Brown', source: 'noise', src: { color: 'brown' },
            amp: { sustain: 0.8 }, out: { level: -6 } }), held(60, 8)),
          claim: { measure: 'lows', more: true },
        },
        { kind: 'knobs', unit: 'noise', when: 'Reach for noise for drums, wind, rain and the breath in a pad.' },
      ],
    },
    {
      title: 'FM: bells and glass',
      pieces: [
        'The FM Pair is two sine waves, one of which wobbles the pitch of the other hundreds of times a second. The '
          + 'wobble is too fast to hear as a wobble; instead it turns into new harmonics. Ratio sets how fast the hidden '
          + 'one runs against the note: whole numbers give warm, musical tones like electric pianos, odd ratios such '
          + 'as 3.5 or 1.41 give bells, gongs and metal. Amount sets how hard it pushes: a little is soft, a lot is '
          + 'bright and clanging.',
        {
          kind: 'compare',
          before: soundExample('FM with a little Amount', () => makeSound({ name: 'Soft FM', source: 'fm',
            src: { ratio: 3.5, amount: 0.3 }, amp: { decay: 1.5, sustain: 0.3 } }), tune(72)),
          after: soundExample('FM with a lot of Amount', () => makeSound({ name: 'Bright FM', source: 'fm',
            src: { ratio: 3.5, amount: 3 }, amp: { decay: 1.5, sustain: 0.3 }, out: { level: -10 } }), tune(72)),
          claim: { measure: 'highs', more: true },
        },
        'An envelope pointed at Amount makes the start of each note bright and lets it mellow as it fades, which is '
          + 'how real bells and pianos behave. The factory sounds Bell, Kalimba and Soft Keys are all made this way.',
        { kind: 'knobs', unit: 'fm', when: 'Reach for FM for bells, electric pianos, kalimbas, glassy pads and gongs.' },
      ],
    },
    {
      title: 'The sampler',
      pieces: [
        'The Sampler plays a recording instead of making a wave: a drum hit, a voice, a field recording of rain. Drop '
          + 'an audio file on the window and it becomes a new sound, or choose Sampler as the source and press Load. '
          + 'The display shows the recording; drag its markers to play only part of it.',
        'Pitch plays the recording faster and higher, or slower and lower, like a tape. Loop plays the part between '
          + 'the markers round and round while the key is held, and Crossfade blends its end into its start so rain '
          + 'or room tone goes round without a click. Reverse plays it backwards.',
        { kind: 'knobs', unit: 'sample', when: 'Reach for the sampler for real drums, voices, found sounds and texture.' },
      ],
    },
    {
      title: 'Worked: a plain bass',
      pieces: [
        'A bass is low, steady and round. This one is a saw an octave down, with the bright top filtered off and a '
          + 'sine underneath.',
        {
          kind: 'worked',
          example: plainBass,
          result: 'A round, solid bass: the saw gives it a little edge, the filter keeps it dark, and the sub gives it '
            + 'weight on big speakers.',
          steps: [
            set('source', { pitch: -12 }, 'Turn Pitch down to -12 st. Twelve semitones are an octave, and an octave '
              + 'down is where basses live.'),
            set('filter', { on: true }, 'Click the lamp of the Filter unit to switch it on.'),
            set('filter', { cutoff: 450 }, 'Turn Cutoff down to about 450 Hz. The buzz goes and a dark, round tone is '
              + 'left.'),
            set('amp', { decay: 0.3, sustain: 0.6, release: 0.08 }, 'In the Amp, set Decay to about 0.3 s, Sustain '
              + 'to 60 % and Release to about 80 ms. Each note starts a little louder and stops cleanly, so fast notes '
              + 'stay apart.'),
            set('source', { sub: 0.5 }, 'Turn Sub up to about half, under Shaping. A pure sine an octave lower joins '
              + 'in.'),
          ],
        },
      ],
    },
    {
      title: 'Worked: a hollow square lead',
      pieces: [
        'A lead plays the tune, so it has to cut through. The square wave is hollow and woody; a narrower pulse and a '
          + 'short echo make it sing.',
        {
          kind: 'worked',
          example: squareLead,
          result: 'A hollow, reedy lead that sits above everything else and leaves a short echo behind each phrase.',
          steps: [
            set('source', { wave: 'square' }, 'Under Wave, click the square, the fourth picture.'),
            set('source', { pw: 0.3 }, 'Set Pulse to about 30 %, under Shaping. The square gets thinner and more '
              + 'nasal, like a reed.'),
            set('filter', { on: true, cutoff: 3000 }, 'Switch the Filter on and set Cutoff to about 3 kHz, to take the '
              + 'harshest top off.'),
            set('amp', { sustain: 0.6, release: 0.35 }, 'In the Amp, set Sustain to 60 % and Release to about 0.35 s, '
              + 'so long notes settle a little and every note fades instead of stopping dead.'),
          ],
        },
      ],
    },
    {
      title: 'Worked: a drawn buzz',
      pieces: [
        'Draw, the last wave, lets you draw one cycle yourself with the mouse. Sharp corners buzz, smooth curves '
          + 'hum. It is a Deep control, so in beginner mode the step opens the Deep section for you.',
        {
          kind: 'worked',
          example: drawnBuzz,
          result: 'A buzzing, slightly broken tone that no stock wave makes, filtered so it bites without hurting.',
          steps: [
            { ...set('source', { wave: 'draw' }, 'Under Wave, choose Draw, the last picture. A display with one '
              + 'cycle of a sine appears.'), unfold: () => [['osc', 3]] },
            when('Draw over the display: a slope rising across the first half, then a sudden drop, a flat step and a '
              + 'jump. Hold Shift for straight lines. Play a key while you draw and hear it change.',
            ({ state }) => {
              const sound = state.project.channels.find((c) => c.id === state.channelId)?.sound;
              return !!sound && sound.source.params.shape !== DEFAULT_SHAPE;
            },
            (state) => setParam(state.channelId!, 'source', 'shape', BUZZ),
            { target: 'unit-source', view: 'factory' }),
            set('filter', { on: true, cutoff: 1800 }, 'Switch the Filter on and set Cutoff to about 1.8 kHz.'),
            set('amp', { decay: 0.5, sustain: 0.4, release: 0.15 }, 'In the Amp, set Decay to 0.5 s, Sustain to 40 % '
              + 'and Release to about 0.15 s.'),
            set('source', { voices: 3, spread: 12 }, 'Under Shaping, set Voices to 3 and Spread to about 12 ct, for a '
              + 'thicker, slightly wobbly buzz.'),
          ],
        },
        'A drawing keeps the notes of a sound in tune whatever you draw, because it is one cycle repeated at the '
          + 'pitch of the note. Try a drawing with many small steps for a chiptune voice, or a lumpy curve for an '
          + 'organ.',
      ],
    },
  ],
};

export default chapter;
