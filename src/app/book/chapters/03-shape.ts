import type { Chapter } from '../pages';
import { chord, held, makeSound, notes, soundExample } from '../build';
import type { SoundSpec } from '../build';
import { addFx, addMod, point, set } from '../steps';

const bright: SoundSpec = { name: 'Saw', src: { wave: 'sawtooth' }, amp: { sustain: 0.8 } };
const A1 = 45; // 110 Hz, so the eighth harmonic is at 880 Hz

const acidLine = notes([[0, 48, 1, 1], [2, 48, 1, 0.6], [3, 60, 1, 0.9], [5, 48, 1, 0.6], [6, 51, 1, 0.7],
  [8, 48, 1, 1], [10, 55, 1, 0.6], [11, 48, 1, 0.7], [13, 58, 1, 0.9], [14, 48, 1, 0.6]]);

const chapter: Chapter = {
  id: 'shape',
  title: 'Shape over time',
  pages: [
    {
      title: 'The amp envelope',
      pieces: [
        'A wave on its own just goes on. What makes it a pluck, a pad or a drum is how its loudness moves from the '
          + 'moment a key goes down to the moment it is quiet again. The amp envelope draws that shape in four parts.',
        'Attack is how long the note takes to rise to full loudness: almost nothing for a snap, seconds for a swell. '
          + 'Decay is how long it then takes to fall to the Sustain level, where it stays for as long as the key is '
          + 'held. Release is how long it fades once the key is let go. People call this ADSR, after the four '
          + 'letters.',
        { kind: 'envelope', params: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 },
          caption: 'A pluck: no attack, a quick decay and no sustain, so the note dies away by itself.' },
        { kind: 'envelope', params: { attack: 1.5, decay: 1, sustain: 0.8, release: 2.5 },
          caption: 'A pad: a slow attack that swells in, a high sustain and a long release that lingers.' },
        { kind: 'envelope', params: { attack: 0.001, decay: 0, sustain: 1, release: 0.05 },
          caption: 'An organ: full on at once, full for as long as the key is down, gone when it comes up.' },
        {
          kind: 'compare',
          before: soundExample('A short release', () => makeSound({ ...bright, name: 'Short', amp: { sustain: 0.8,
            release: 0.05 }, filter: { on: true, cutoff: 1500 } }), chord(60, 4)),
          after: soundExample('A long release', () => makeSound({ ...bright, name: 'Long', amp: { sustain: 0.8,
            release: 2.5 }, filter: { on: true, cutoff: 1500 } }), chord(60, 4)),
          claim: { measure: 'tail', more: true },
        },
        { kind: 'knobs', unit: 'amp', when: 'Every sound has one. Shape it first: it decides what kind of thing the '
          + 'sound is more than any other unit.' },
      ],
    },
    {
      title: 'The filter in every note',
      pieces: [
        'A filter takes part of the sound away. The low pass, the one you will use most, lets the low part through '
          + 'and dulls the top, like a hand cupped over the speaker. The high pass does the opposite and thins a '
          + 'sound out, and the band pass keeps only a slice of the middle, like a telephone.',
        'Cutoff is where it starts cutting. Reso, short for resonance, makes the filter ring right at the cutoff: a '
          + 'little gives a sound bite, a lot makes it whistle and squelch. Slope chooses how steeply it cuts: 12 dB '
          + 'is gentle, 24 dB is steep and round, the sound of classic synthesizer basses.',
        {
          kind: 'compare',
          before: soundExample('A filter with little Reso', () => makeSound({ ...bright, name: 'Soft Edge',
            filter: { on: true, cutoff: 880, reso: 0.1 } }), held(A1, 8)),
          after: soundExample('The same filter ringing', () => makeSound({ ...bright, name: 'Ringing',
            filter: { on: true, cutoff: 880, reso: 0.85 }, out: { level: -10 } }), held(A1, 8)),
          claim: { measure: 'ring', more: true, hz: 880 },
        },
        'This filter lives inside every note, so each note of a chord gets one of its own, and an envelope pointed at '
          + 'its cutoff opens each note by itself. It is off in a new sound; click its lamp to switch it on. Key makes '
          + 'the cutoff follow the note, so high notes are not duller than low ones, and Velocity makes soft notes '
          + 'darker.',
        { kind: 'knobs', unit: 'voicefilter', when: 'Switch it on for nearly every bass, pluck and pad made from a saw '
          + 'or a square.' },
      ],
    },
    {
      title: 'The filter envelope',
      pieces: [
        'A filter that stays still makes a sound darker. A filter that moves makes it speak. An envelope modulator '
          + 'pointed at the cutoff opens the filter at the start of each note and closes it again over its decay: '
          + 'that bright start which settles into a dark tone is what makes a pluck pluck and a bass go "dow".',
        'Add one with Modulator and choose Envelope, then set its Target to Filter · Cutoff. Its own Attack, Decay, '
          + 'Sustain and Release work like the amp envelope\'s, but move the cutoff instead of the loudness, and '
          + 'Amount sets how far. A new envelope works on each note, so every note of a chord opens its own filter.',
        {
          kind: 'compare',
          before: soundExample('A still, closed filter', () => makeSound({ ...bright, name: 'Still',
            filter: { on: true, cutoff: 400, reso: 0.3 }, amp: { decay: 0.4, sustain: 0.3 } }),
          notes([[0, 48, 3], [4, 48, 3], [8, 51, 3], [12, 55, 3]])),
          after: soundExample('The same with a filter envelope', () => makeSound({ ...bright, name: 'Moving',
            filter: { on: true, cutoff: 400, reso: 0.3 }, amp: { decay: 0.4, sustain: 0.3 },
            mods: [['env', ['filter', 'cutoff'], 0.6, { decay: 0.25 }, 'note']] }),
          notes([[0, 48, 3], [4, 48, 3], [8, 51, 3], [12, 55, 3]])),
          claim: { measure: 'movement', more: true },
        },
        { kind: 'knobs', unit: 'env', when: 'Reach for an envelope whenever something should happen once per note: a '
          + 'filter that snaps open, a pitch that drops on a kick, a bell that mellows.' },
      ],
    },
    {
      title: 'Drive and velocity',
      pieces: [
        'Drive, under the filter\'s Shaping, pushes each note into the filter harder, so it growls and the ringing '
          + 'thickens. Pushing a sound so hard that its wave is squashed adds harmonics, which is why a driven sine '
          + 'stops being a pure hum and starts to buzz.',
        {
          kind: 'compare',
          before: soundExample('A clean sine bass', () => makeSound({ name: 'Clean Sine', src: { wave: 'sine' },
            filter: { on: true, cutoff: 20000, reso: 0 }, amp: { sustain: 0.8 } }), held(A1, 8)),
          after: soundExample('The same driven', () => makeSound({ name: 'Driven Sine', src: { wave: 'sine' },
            filter: { on: true, cutoff: 20000, reso: 0, drive: 0.9 }, amp: { sustain: 0.8 }, out: { level: -10 } }),
          held(A1, 8)),
          claim: { measure: 'harmonics', more: true, hz: 110 },
        },
        'Velocity is how hard a note is played, from the Track\'s velocity or a MIDI keyboard. Louder is always '
          + 'louder; the filter\'s Velocity under Deep also makes soft notes darker, and a modulator\'s Velocity '
          + 'gives harder notes more of it. That is how accents in an acid line come out brighter and more urgent '
          + 'than the notes around them.',
      ],
    },
    {
      title: 'Worked: a pluck',
      pieces: [
        'A pluck is short and bright at the start, like a plucked string or a harp: the core of trance and of much '
          + 'house.',
        {
          kind: 'worked',
          example: soundExample('A new oscillator for a pluck', () => makeSound({ name: 'My Pluck' }),
            notes([[0, 72], [2, 75], [4, 79], [6, 72], [8, 84], [10, 79], [12, 75], [14, 79]])),
          result: 'A bright, quick pluck with a soft echo after it: play fast notes and it stays clear.',
          steps: [
            set('amp', { decay: 0.35, sustain: 0, release: 0.25 }, 'In the Amp, set Decay to about 0.35 s, Sustain '
              + 'all the way down and Release to 0.25 s. Each note now dies away by itself.'),
            set('filter', { on: true, cutoff: 400, reso: 0.3 }, 'Switch the Filter on, Cutoff to about 400 Hz and Reso '
              + 'to 30 %.'),
            addMod('env', 'Press Modulator and choose Envelope.'),
            point('mod:env', ['filter', 'cutoff'], 0.5, 'Set its Target to Filter · Cutoff and Amount to about +50 %. '
              + 'Each note now starts bright and closes quickly.'),
            set('source', { voices: 2, spread: 10 }, 'Under Shaping in the Source, set Voices to 2 and Spread to '
              + 'about 10 ct, for a little width.'),
            addFx('delay', 'Press Effect and choose Delay.'),
            set('fx:delay', { mix: 0.2 }, 'Set its Mix to about 20 %. Sync is 1/8 dotted, an echo that falls between '
              + 'the notes and makes them dance.'),
          ],
        },
      ],
    },
    {
      title: 'Worked: a pad',
      pieces: [
        'A pad is a long, soft chord that fills the background, the bed under ambient music and breakdowns.',
        {
          kind: 'worked',
          example: soundExample('A new oscillator for a pad', () => makeSound({ name: 'My Pad', out: { level: -12 } }),
            chord(60, 32), { bars: 2 }),
          result: 'A wide, soft chord that swells in, holds, and fades slowly into a hall.',
          steps: [
            set('source', { voices: 5, spread: 20, width: 0.8 }, 'Set Voices to 5 and Spread to about 20 ct under '
              + 'Shaping, and Width to 80 % under Deep. Five saws drift against each other and spread wide.'),
            set('filter', { on: true, cutoff: 1200 }, 'Switch the Filter on and set Cutoff to about 1.2 kHz, so the '
              + 'chord is warm rather than bright.'),
            set('amp', { attack: 1.2, decay: 1, sustain: 0.8, release: 2.5 }, 'In the Amp, set Attack to about 1.2 s, '
              + 'Decay to 1 s, Sustain to 80 % and Release to 2.5 s.'),
            addFx('reverb', 'Press Effect and choose Reverb.'),
            set('fx:reverb', { size: 5, mix: 0.4 }, 'Set its Size to about 5 s and Mix to 40 %.'),
          ],
        },
      ],
    },
    {
      title: 'Worked: an acid bass',
      pieces: [
        'Acid is the squelching, talking bass of acid house, a saw through a steep, ringing filter that an envelope '
          + 'snaps open on every note. Accents, the louder notes, open it further.',
        {
          kind: 'worked',
          example: soundExample('A new oscillator for an acid bass', () => makeSound({ name: 'My Acid' }), acidLine,
            { bpm: 128 }),
          result: 'A rubbery, squelching bass whose loud notes bark and whose soft ones murmur.',
          steps: [
            set('source', { pitch: -12 }, 'Turn Pitch down to -12 st.'),
            set('filter', { on: true, cutoff: 250, reso: 0.75 }, 'Switch the Filter on, Cutoff down to about 250 Hz '
              + 'and Reso up to 75 %.'),
            set('filter', { slope: '24' }, 'Under the filter\'s Shaping, set Slope to 24 dB for the round, steep '
              + 'squelch.'),
            addMod('env', 'Press Modulator and choose Envelope.'),
            point('mod:env', ['filter', 'cutoff'], 0.55, 'Set its Target to Filter · Cutoff and Amount to about +55 %.'),
            set('mod:env', { vel: 0.5 }, 'Under the envelope\'s Deep, set Velocity to 50 %. Loud notes now open the '
              + 'filter further than soft ones.'),
            set('filter', { drive: 0.4 }, 'Back in the Filter, set Drive to about 40 %, for growl.'),
            set('amp', { decay: 0.4, sustain: 0.5, release: 0.06 }, 'In the Amp, set Decay to 0.4 s, Sustain to 50 % '
              + 'and Release short, about 60 ms.'),
          ],
        },
        'Turn Cutoff and Reso while it plays: that is how an acid line is performed, with one hand on those two knobs. '
          + 'The chapter on playing a sound adds the slide between notes.',
      ],
    },
  ],
};

export default chapter;
