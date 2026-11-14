import type { Chapter } from '../pages';
import { chord, held, makeSound, notes, soundExample } from '../build';
import type { SoundSpec } from '../build';
import { addMod, point, set } from '../steps';

const pad: SoundSpec = {
  name: 'Still Pad', src: { voices: 5, spread: 18, width: 0.8 }, filter: { on: true, cutoff: 900, reso: 0.15 },
  amp: { attack: 1.5, decay: 1, sustain: 0.85, release: 3 }, fx: [['reverb', { size: 6, mix: 0.4 }]],
  out: { level: -12 },
};

const chapter: Chapter = {
  id: 'movement',
  title: 'Movement',
  pages: [
    {
      title: 'LFOs',
      pieces: [
        'A sound that never changes soon sounds like a machine. Modulators turn knobs for you while the sound plays, '
          + 'and the LFO, short for low frequency oscillator, turns one back and forth in a loop. It is a wave too '
          + 'slow to hear as a pitch, used to move something else.',
        'Pointed at the filter cutoff it makes a sound open and close like a mouth saying "wow"; at the pitch, a '
          + 'vibrato; at the output level, a tremolo; at the pan, a sound that wanders between the speakers. Rate is '
          + 'how fast, down to one cycle in several minutes, and Sync locks it to the tempo instead: 1/8 is two '
          + 'wobbles a beat, 4 bars one long sweep.',
        {
          kind: 'compare',
          before: soundExample('A pad that stands still', () => makeSound(pad), chord(60, 32), { bars: 2 }),
          after: soundExample('The same with an LFO on its cutoff', () => makeSound({ ...pad, name: 'Moving Pad',
            mods: [['lfo', ['filter', 'cutoff'], 0.3, { rate: 1.5 }]] }), chord(60, 32), { bars: 2 }),
          claim: { measure: 'movement', more: true },
        },
        { kind: 'knobs', unit: 'lfo', when: 'Reach for an LFO for anything that should move in a loop: wobbles, '
          + 'vibrato, tremolo, slow sweeps and autopan.' },
      ],
    },
    {
      title: 'Fade and retrigger',
      pieces: [
        'Fade lets the LFO grow in slowly after each note starts. A singer or a violinist does exactly that: the note '
          + 'starts straight and the vibrato blooms after a moment. Retrigger starts the wave from the beginning with '
          + 'every note, so each note of a wobble bass wobbles the same way instead of catching the loop wherever it '
          + 'happens to be.',
        {
          kind: 'example',
          example: soundExample('A lead whose vibrato fades in', () => makeSound({ name: 'Blooming Lead',
            src: { wave: 'triangle' }, amp: { sustain: 0.8, release: 0.3 },
            mods: [['lfo', ['source', 'pitch'], 0.004, { rate: 5.5, fade: 0.8, retrigger: true }]] }),
          notes([[0, 72, 8], [8, 75, 8]])),
        },
      ],
    },
    {
      title: 'Drift',
      pieces: [
        'An LFO repeats itself. Drift does not: it wanders from one random value to the next and never comes back the '
          + 'same way. Set slowly, it gives a pad or a drone the restless, living movement of an old analogue '
          + 'instrument or of wind. Rate is how often it heads somewhere new, Smooth whether it glides there or jumps.',
        {
          kind: 'compare',
          before: soundExample('A steady tone', () => makeSound({ name: 'Steady', src: { wave: 'triangle' },
            amp: { sustain: 0.8 } }), held(57, 16)),
          after: soundExample('The same tone drifting', () => makeSound({ name: 'Drifting', src: { wave: 'triangle' },
            amp: { sustain: 0.8 }, mods: [['drift', ['source', 'pitch'], 0.012, { rate: 3, smooth: 1 }]] }),
          held(57, 16)),
          claim: { measure: 'wobble', more: true },
        },
        { kind: 'knobs', unit: 'drift', when: 'Reach for drift whenever an LFO sounds too regular: slow pads, drones, '
          + 'tape-like pitch wander, sounds that should never repeat.' },
      ],
    },
    {
      title: 'Each note or the whole sound',
      pieces: [
        'A modulator works either on each note or on the whole sound, under its Shaping. On each note, every note '
          + 'gets a copy of its own that starts with the note: an envelope opens each note of a chord by itself, and '
          + 'a drift wanders differently in every voice, which is lovely on a pad. On the whole sound there is one '
          + 'modulator for all the notes: an LFO keeps running across them, which is what a sweep or an autopan '
          + 'needs.',
        'Only the source and the filter live inside a note, so a modulator pointed at an effect or at the output '
          + 'always works on the whole sound. A second envelope is just another Envelope: one on the filter and one '
          + 'on the pitch, for example, for a kick that drops in pitch while its body thumps.',
      ],
    },
    {
      title: 'Worked: a wobble bass',
      pieces: [
        'The wobble is the bass of dubstep and of much bass music: a growling saw whose filter an LFO opens and closes '
          + 'in time with the beat.',
        {
          kind: 'worked',
          example: soundExample('A new oscillator for a wobble', () => makeSound({ name: 'My Wobble', amp: { sustain: 0.9 } }),
            notes([[0, 48, 8], [8, 48, 4], [12, 51, 4]]), { bpm: 140 }),
          result: 'A growling bass that wobbles twice a beat, starting the same way on every note.',
          steps: [
            set('source', { pitch: -12, sub: 0.5 }, 'Turn Pitch down to -12 st, and under Shaping set Sub to about '
              + 'half.'),
            set('filter', { on: true, cutoff: 250, reso: 0.45 }, 'Switch the Filter on, Cutoff to about 250 Hz and Reso '
              + 'to 45 %.'),
            set('filter', { slope: '24', drive: 0.3 }, 'Under the filter\'s Shaping set Slope to 24 dB and Drive to '
              + 'about 30 %.'),
            addMod('lfo', 'Press Modulator and choose LFO.'),
            point('mod:lfo', ['filter', 'cutoff'], 0.5, 'Set its Target to Filter · Cutoff and Amount to about +50 %.'),
            set('mod:lfo', { sync: '1/8' }, 'Under the LFO\'s Shaping, set Sync to 1/8: two wobbles every beat, '
              + 'whatever the tempo.'),
            set('mod:lfo', { retrigger: true }, 'Under its Deep, switch Retrigger on, so every note starts its wobble '
              + 'from the top.'),
          ],
        },
        'Try Sync at 1/8 triplet or 1/16 for faster, rolling wobbles, and change it from bar to bar for the talking '
          + 'feel of a dubstep drop.',
      ],
    },
    {
      title: 'Worked: a slowly breathing pad',
      pieces: [
        'Ambient music in the manner of Loscil or Carbon Based Lifeforms lives on pads that never quite stand still. '
          + 'Slow movements, some regular and some random, make a chord breathe.',
        {
          kind: 'worked',
          example: soundExample('A pad that stands still', () => makeSound({ ...pad, name: 'Breathing Pad' }),
            chord(60, 32), { bars: 2 }),
          result: 'A pad that opens and closes over ten seconds, drifts a little out of tune in every voice and '
            + 'wanders slowly between the speakers.',
          steps: [
            addMod('lfo', 'Press Modulator and choose LFO.'),
            point('mod:lfo', ['filter', 'cutoff'], 0.15, 'Set its Target to Filter · Cutoff and Amount to about +15 %.'),
            set('mod:lfo', { rate: 0.1 }, 'Turn its Rate down to 0.1 Hz: one slow breath every ten seconds.'),
            addMod('drift', 'Press Modulator and choose Drift, under Shaping.'),
            point('mod:drift', ['source', 'pitch'], 0.003, 'Set its Target to Source · Pitch, its Amount just above the '
              + 'middle, about +0.3 %, and under Shaping set it to Each note. Every voice now wanders out of tune a '
              + 'little, its own way.', { per: 'note' }),
            addMod('lfo', 'Add another LFO.', { more: 2 }),
            point('mod:lfo:2', ['out', 'pan'], 0.4, 'Point it at Output · Pan with an Amount of about +40 %.'),
            set('mod:lfo:2', { rate: 0.07 }, 'Set its Rate to about 0.07 Hz, a slow walk from one speaker to the other '
              + 'every fourteen seconds.'),
          ],
        },
      ],
    },
    {
      title: 'Worked: a detuned analog lead',
      pieces: [
        'Old analogue synthesizers were never quite in tune, and that is a large part of their warmth. Two saws a '
          + 'few cents apart, a pitch that wanders a little and a vibrato that blooms give the same feeling.',
        {
          kind: 'worked',
          example: soundExample('A new oscillator for a lead', () => makeSound({ name: 'Analog Lead', out: { level: -9 } }),
            notes([[0, 72, 6], [6, 74, 2], [8, 75, 8]])),
          result: 'A warm lead that beats slowly against itself, never sits perfectly still, and sings on long notes.',
          steps: [
            set('source', { fine2: 8, mix2: 0.5 }, 'Under Shaping, set Fine 2 to about +8 ct and Mix 2 to 50 %. The '
              + 'second saw plays a hair sharp, and the two beat slowly.'),
            set('filter', { on: true, cutoff: 2500, reso: 0.2 }, 'Switch the Filter on, Cutoff to about 2.5 kHz and '
              + 'Reso to 20 %.'),
            addMod('drift', 'Press Modulator and choose Drift.'),
            point('mod:drift', ['source', 'pitch'], 0.002, 'Point it at Source · Pitch with an Amount of about +0.2 %, '
              + 'and set it to Each note.', { per: 'note' }),
            addMod('lfo', 'Press Modulator and choose LFO.'),
            point('mod:lfo', ['source', 'pitch'], 0.003, 'Point it at Source · Pitch with an Amount of about +0.3 %.'),
            set('mod:lfo', { rate: 5.5, fade: 0.6 }, 'Set its Rate to about 5.5 Hz, and under Deep its Fade to 0.6 s, '
              + 'so the vibrato blooms on long notes only.'),
            set('amp', { sustain: 0.7, release: 0.35 }, 'In the Amp, set Sustain to 70 % and Release to about 0.35 s.'),
          ],
        },
      ],
    },
  ],
};

export default chapter;
