import type { Chapter, ComparePiece, Page, Piece } from '../pages';
import { chord, held, hits, line, makeSound, notes, soundExample, tune } from '../build';
import type { SoundSpec } from '../build';
import type { Note } from '../../../core/types';
import { addFx, addMod, point, set } from '../steps';

/** A page for one effect: what it does, its knobs, a pair to hear and a use in a style. */
function effectPage(title: string, unit: string, what: readonly string[], when: string, compare: ComparePiece,
  use: readonly Piece[]): Page {
  return { title, pieces: [...what, { kind: 'knobs', unit, when }, compare, ...use] };
}

/** A pair of the same sound and notes, without and with something. */
function pair(spec: SoundSpec, phrase: Note[], withIt: Partial<SoundSpec>, names: [string, string],
  claim: ComparePiece['claim'], opts: { bars?: number; bpm?: number } = {}): ComparePiece {
  return {
    kind: 'compare',
    before: soundExample(names[0], () => makeSound(spec), phrase, opts),
    after: soundExample(names[1], () => makeSound({ ...spec, name: `${spec.name} After`, ...withIt }), phrase, opts),
    claim,
  };
}

/** A sound to hear on its own, with the notes that suit it. */
const example = (spec: SoundSpec, phrase: Note[], opts: { bars?: number; bpm?: number } = {}): Piece =>
  ({ kind: 'example', example: soundExample(spec.name, () => makeSound(spec), phrase, opts) });

const saw: SoundSpec = { name: 'Saw Chord', amp: { sustain: 0.8 }, out: { level: -12 } };
const pluck: SoundSpec = {
  name: 'Short Pluck', src: { wave: 'triangle' }, amp: { decay: 0.25, sustain: 0, release: 0.1 }, out: { level: -4 },
};
const plucks = notes([[0, 72], [4, 75], [8, 79]]);
const bass: SoundSpec = {
  name: 'Bright Bass', src: { pitch: -12 }, amp: { sustain: 0.8 }, out: { level: -10 },
};
const burst: SoundSpec = {
  name: 'Noise Burst', source: 'noise', amp: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }, out: { level: -6 },
};
const tone: SoundSpec = { name: 'Triangle Tone', src: { wave: 'triangle' }, amp: { sustain: 0.8 } };

const glitch = soundExample('Glitch Hit', () => makeSound({
  name: 'Glitch Hit', source: 'noise', amp: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 },
  out: { level: -4 },
}), notes([[0, 60, 1, 1], [3, 60, 1, 0.6], [6, 60, 1, 0.9], [8, 60, 1, 0.5], [11, 60, 1, 0.8], [14, 60, 1, 0.7]]));

const dubChord = soundExample('Dub Chord', () => makeSound({
  name: 'Dub Chord', src: { wave2: 'sawtooth', pitch2: 7, fine2: 6, mix2: 0.45 },
  filter: { on: true, cutoff: 700, reso: 0.25, key: 0.4 }, amp: { decay: 0.22, sustain: 0, release: 0.15 },
  mods: [['env', ['filter', 'cutoff'], 0.35, { decay: 0.16 }, 'note']], out: { level: -8 },
}), notes([[2, 60], [2, 63], [2, 67], [10, 60], [10, 63], [10, 67]]), { bpm: 118 });

const shimmerPad = soundExample('Glass Chord', () => makeSound({
  name: 'Glass Chord', src: { wave: 'triangle', voices: 3, spread: 12, width: 0.7 },
  amp: { attack: 0.8, decay: 1, sustain: 0.8, release: 2 }, out: { level: -10 },
}), chord(60, 24), { bars: 2, bpm: 80 });

const filter = effectPage('Filter (whole sound)', 'filter', [
  'Besides the filter in every note, a sound can have a filter as an effect, which works on all of its notes '
    + 'together, like a tone knob on an amplifier. It cuts the same way: low pass keeps the bottom, high pass the '
    + 'top, band pass a slice. Because it is one filter for the whole sound, a modulator moving it sweeps everything '
    + 'at once, which is what a slow filter sweep in a breakdown needs.',
], 'Reach for it for slow sweeps over a whole part, and to thin out or darken a sound in the mix.',
pair(saw, chord(60, 16), { fx: [['filter', { mode: 'lowpass', cutoff: 600, reso: 0.15 }]] },
  ['A bright saw chord', 'The same through a low pass'], { measure: 'highs', more: false }), [
  'In techno a filter that opens over four or eight bars builds tension before the beat drops back in. Here an '
    + 'LFO does it, synced to one bar here so you hear a whole sweep at once; set it to 4 or 8 bars in a song.',
  example({ ...saw, name: 'Sweeping Chord', fx: [['filter', { cutoff: 400, reso: 0.4 }]],
    mods: [['lfo', ['fx1', 'cutoff'], 0.35, { sync: '1bar', wave: 'triangle' }]] }, chord(57, 32), { bars: 2, bpm: 128 }),
]);

const drive = effectPage('Drive', 'drive', [
  'Drive pushes a sound so hard that the top and bottom of its wave are squashed flat. Squashing adds harmonics, '
    + 'so a driven sound is brighter, fuller and louder in feel. Soft squashes gently, like a warm valve amplifier; '
    + 'Hard crunches like a guitar pedal; Fold turns the wave over on itself for a strange, hollow buzz. Tone takes '
    + 'away some of the fizz the drive adds.',
], 'Reach for it to make a kick punch, a bass growl, or anything sound warmer and closer.',
pair({ name: 'Sine Bass', src: { wave: 'sine' }, amp: { sustain: 0.8 } }, held(45, 8),
  { fx: [['drive', { shape: 'hard', amount: 0.7 }]], out: { level: -12 } },
  ['A clean sine bass', 'The same driven hard'], { measure: 'harmonics', more: true, hz: 110 }), [
  'Hard techno drives its kick until it distorts: a long kick through a hard Drive turns a thump into a booming, '
    + 'growling hit.',
  example({ name: 'Driven Kick', from: 'Kick', amp: { decay: 0.6 }, fx: [['drive', { shape: 'hard', amount: 0.6,
    tone: 6000 }]], out: { level: -6 } }, hits('x...x...x...x...'), { bpm: 140 }),
]);

const eq = effectPage('EQ', 'eq', [
  'An EQ, short for equaliser, turns parts of the sound up or down by pitch range, like the bass and treble knobs '
    + 'of a stereo. Low is the body and boom, High the air and sizzle, and Mid a range you choose with Mid Freq: '
    + 'boxy around 400 Hz, nasal around 1 kHz, forward around 3 kHz. Low Cut takes away everything below its '
    + 'frequency.',
], 'Reach for it to make room: cut what a sound does not need so the others can be heard.',
pair(bass, line(48), { fx: [['eq', { low: 6, high: -15 }]], out: { level: -13 } },
  ['A bright saw bass', 'The same with Low up and High well down'], { measure: 'highs', more: false }), [
  'A full mix is crowded at the bottom. A pad needs nothing below a few hundred hertz, and cutting it there leaves '
    + 'the room to the kick and the bass. This pad has its Low Cut at 250 Hz.',
  example({ name: 'Pad Without Mud', from: 'Warm Pad', fx: [['eq', { lowcut: 250 }], ['reverb', { size: 4, mix: 0.35 }]] },
    chord(48, 32), { bars: 2 }),
]);

const compressor = effectPage('Compressor', 'compressor', [
  'A compressor turns a sound down when it gets loud and leaves it alone when it is quiet, so the loud and quiet '
    + 'parts end up closer together. Threshold is how loud the sound must get before it acts, Ratio how hard it '
    + 'turns it down, Attack how quickly it grabs and Release how quickly it lets go. Make-up turns the result back '
    + 'up, so it sounds denser and as loud as before. The meter shows how far it is turning down right now.',
], 'Reach for it to make drums punchier and steadier, and to glue a part together.',
pair(pluck, plucks, { fx: [['compressor', { threshold: -30, ratio: 10, attack: 0.002, release: 0.1, makeup: 12 }]] },
  ['A pluck as it is', 'The same squeezed'], { measure: 'crest', more: false }), [
  'A slow Attack lets the first click of each note through before the compressor grabs, which makes drums and '
    + 'plucks snap; a short Release lets the sound swell back between hits, the breathing of house and techno.',
  example({ name: 'Squeezed Bass', from: 'Round Bass', fx: [['filter', { cutoff: 320, reso: 0.22 }],
    ['compressor', { threshold: -24, ratio: 6, attack: 0.02, release: 0.08, makeup: 8 }]] }, line(48), { bpm: 124 }),
]);

const chorus = effectPage('Chorus', 'chorus', [
  'A chorus plays two copies of the sound slightly late and swings their lateness slowly back and forth, so '
    + 'they drift a little out of tune with the original, like several players together. Spread puts the copies '
    + 'apart in the speakers, which makes a narrow sound wide.',
], 'Reach for it to make pads, strings and keys wide and lush.',
pair({ ...saw, name: 'Narrow Saw', out: { level: -9 } }, tune(72), { fx: [['chorus', { depth: 0.6, mix: 0.5 }]] },
  ['A plain saw lead', 'The same through Chorus'], { measure: 'width', more: true }), [
  'The warm, wide chords of Carbon Based Lifeforms owe a lot to chorus on soft pads.',
  example({ name: 'Chorus Pad', src: { wave: 'triangle', voices: 3, spread: 10 }, filter: { on: true, cutoff: 1800 },
    amp: { attack: 1, sustain: 0.8, release: 2 }, fx: [['chorus', { depth: 0.6, mix: 0.6 }], ['reverb', { size: 5,
      mix: 0.35 }]], out: { level: -9 } }, chord(57, 32), { bars: 2, bpm: 90 }),
]);

const phaser = effectPage('Phaser', 'phaser', [
  'A phaser cuts a few narrow notches out of the sound and sweeps them up and down, which gives the swirling, '
    + 'whooshing motion of a jet passing overhead. Rate or Sync sets how fast it sweeps, Depth how far, and '
    + 'Feedback how sharp and whistling the notches sound.',
], 'Reach for it to make a steady pad, hat or guitar swirl.',
pair({ ...saw, name: 'Steady Chord' }, chord(57, 32), { fx: [['phaser', { rate: 0.6, depth: 0.9, feedback: 0.6,
  mix: 0.5 }]] }, ['A steady saw chord', 'The same through Phaser'], { measure: 'movement', more: true }, { bars: 2 }), [
  'House producers run phasers over open hats and pads, synced slowly to the bars.',
  example({ name: 'Phased Hats', from: 'Open Hat', fx: [['filter', { mode: 'highpass', cutoff: 6500, reso: 0.25 }],
    ['phaser', { sync: '2bar', depth: 0.9, feedback: 0.6 }]] }, hits('..x...x...x...x...x...x...x...x.'), { bars: 2,
    bpm: 124 }),
]);

const ring = effectPage('Ring Mod', 'ring', [
  'A ring modulator multiplies the sound by a sine at its Freq. What comes out are new pitches at the sum and the '
    + 'difference of the two, which rarely fit any scale: the clangs of bells, robots and metal. Slowed to a few '
    + 'hertz it does something gentler, a throbbing tremolo.',
], 'Reach for it for bells, metallic percussion, robot voices and experimental noise.',
pair({ name: 'Sine Tone', src: { wave: 'sine' }, amp: { sustain: 0.8 } }, held(57, 8),
  { fx: [['ring', { freq: 300, mix: 1 }]] }, ['A plain sine', 'The same through Ring Mod at 300 Hz'],
  { measure: 'sidebands', more: true, hz: 520 }), [
  'In experimental music a ring modulator over soft keys turns a tune into a gamelan of clanks.',
  example({ name: 'Clank Keys', from: 'Soft Keys', fx: [['ring', { freq: 440, mix: 0.5 }], ['reverb', { size: 2,
    mix: 0.25 }]] }, tune(72)),
]);

const width = effectPage('Width', 'width', [
  'Width makes a sound narrower or wider between the speakers. At 0 % everything comes from the middle, at 100 % '
    + 'it is as it was, and above that what differs between left and right is turned up, so it spreads further. '
    + 'Bass Mono keeps everything below its frequency in the middle, so a wide sound keeps a solid bottom.',
], 'Reach for it to spread pads and backgrounds wide, and to keep basses and kicks in the middle.',
pair({ ...saw, name: 'Five Saws', src: { voices: 5, spread: 18, width: 0.5 } }, chord(60, 16),
  { fx: [['width', { width: 2, bass: 150 }]] }, ['A pad of five saws', 'The same at 200 % width'],
  { measure: 'width', more: true }), [
  'Wide strings behind a mono bass is the classic shape of a mix: the bass in the middle, the strings around the '
    + 'listener.',
  example({ name: 'Wide Strings Again', from: 'Wide Strings' }, chord(60, 32), { bars: 2 }),
]);

const delay = effectPage('Delay', 'delay', [
  'A delay plays the sound again a little later and a little quieter, and again, like an echo in a valley. Sync '
    + 'sets the spacing as a note value, so the echoes fall in time with the song; 1/8 dotted, the default, puts '
    + 'them between the beats. Feedback is how many echoes, Tone how dark they get, Low Cut how thin, and Ping pong '
    + 'bounces them from side to side.',
], 'Reach for it to give plucks, chords and leads a sense of space and rhythm.',
pair(pluck, plucks, { fx: [['delay', { feedback: 0.5, mix: 0.4 }]] }, ['A dry pluck', 'The same with Delay'],
  { measure: 'tail', more: true }), [
  'A trance pluck with a dotted echo makes a simple line of eighth notes sound like a rolling sixteenth pattern.',
  example({ name: 'Echo Pluck', from: 'Trance Pluck' }, notes([[0, 72], [4, 75], [8, 79], [12, 77]]), { bpm: 138 }),
]);

const reverb = effectPage('Reverb', 'reverb', [
  'A reverb is the sound of a room: thousands of echoes so close together that they blur into one soft tail. '
    + 'Size is how long the room rings, from a small room at a fraction of a second to a cathedral at ten and more. '
    + 'Tone makes it brighter or darker, Mix how much of it you hear.',
], 'Reach for it to place a sound in a space; long and dark for ambient, short for drums.',
pair(pluck, plucks, { fx: [['reverb', { size: 4, mix: 0.4 }]] }, ['A dry pluck', 'The same in a hall'],
  { measure: 'tail', more: true }), [
  'Ambient music sinks its sounds deep into long reverbs: a kalimba in a twelve-second hall becomes a drop of water '
    + 'in a cave.',
  example({ name: 'Cave Kalimba', from: 'Kalimba', fx: [['reverb', { size: 12, tone: 3500, mix: 0.5 }]] },
    notes([[0, 79], [3, 75], [6, 72], [10, 70]]), { bpm: 80 }),
]);

const crusher = effectPage('Crusher', 'crusher', [
  'A crusher makes a sound worse on purpose, the way an old sampler or a game console did. Bits is how finely each '
    + 'moment is measured: 16 is clean, 8 is gritty, fewer turns it to fizz. Rate is how often it is measured: lower '
    + 'rates make high notes fold down into odd, metallic ones.',
], 'Reach for it for lo-fi grit on drums and keys, and for broken digital textures.',
pair(tone, held(69, 8), { fx: [['crusher', { bits: 4, rate: 6000 }]], out: { level: -10 } },
  ['A clean triangle', 'The same crushed'], { measure: 'highs', more: true }), [
  'Four Tet often lets his keys and samples sound worn and grainy. A few bits less and a lower rate on soft keys '
    + 'does that.',
  example({ name: 'Grainy Keys', from: 'Soft Keys', fx: [['crusher', { bits: 7, rate: 11000, mix: 0.8 }],
    ['filter', { cutoff: 5000, reso: 0.05 }]] }, tune(72)),
]);

const comb = effectPage('Comb', 'comb', [
  'A comb is a very short echo fed back into itself, so fast that the repeats run together into a tone. An echo '
    + 'every 220th of a second rings at 220 Hz. Whatever goes in, a click, a burst of noise or a drum, comes out '
    + 'ringing at that pitch, like a plucked string or a struck metal tube.',
  'Feedback decides how long it rings, and Damp how quickly the bright part of the ring dies. Turned below zero, '
    + 'Feedback rings an octave lower and sounds hollow, like a clarinet. The comb works on the whole sound, so it '
    + 'rings at its own Freq whatever note you play; tune it there.',
], 'Reach for it to turn noise into strings and bells, to give a drum a pitch, or to make anything metallic.',
pair(burst, notes([[0, 60], [4, 60], [8, 60], [12, 60]]),
  { name: 'Plucked Noise', fx: [['comb', { freq: 196, feedback: 0.95, damp: 0.3, mix: 1 }]] },
  ['A burst of noise', 'The same through Comb'], { measure: 'ring', more: true, hz: 196 }), [
  'In glitchy music in the manner of Aphex Twin, short hits are crushed and made to ring, and the ring jumps '
    + 'around in time with the beat. This hit starts as plain noise.',
  {
    kind: 'worked',
    example: glitch,
    result: 'A hit that fizzes like an old sampler and rings like metal, its pitch jumping every sixteenth note.',
    steps: [
      addFx('crusher', 'Press Effect at the bottom of the rack and choose Crusher, under Shaping.'),
      set('fx:crusher', { bits: 5, rate: 6000 }, 'Turn Bits down to 5 and Rate to about 6 kHz. The hiss turns into '
        + 'grainy fizz, like a sampler from 1987.'),
      addFx('comb', 'Press Effect again and choose Comb, which waits in the Deep list.'),
      set('fx:comb', { freq: 330, feedback: 0.9, mix: 0.7 }, 'Set Freq to about 330 Hz, Feedback to 90 % and Mix to '
        + '70 %. Every hit now rings at an E, like a struck pipe.'),
      addMod('lfo', 'Press Modulator and choose LFO.'),
      set('mod:lfo', { wave: 'square', sync: '1/16' }, 'Set its Wave to the square and Sync to 1/16. A square LFO '
        + 'jumps between two values instead of gliding.'),
      point('mod:lfo', ['fx:comb', 'freq'], 0.15, 'Set its Target to Comb · Freq and Amount to about +15 %. The '
        + 'ring now jumps between two pitches on every sixteenth: the broken, stepping sound of a glitch track.'),
    ],
  },
]);

const tape = effectPage('Tape', 'tape', [
  'Tape makes a sound as if it had been recorded on an old cassette and played back on a tired machine. Wow is a '
    + 'slow drift of the pitch, like a warped tape; Flutter a fast trembling; Hiss the noise of the tape under the '
    + 'sound; Saturation the gentle squash of a loud recording; Age the dullness of a worn tape.',
], 'Reach for it to make anything warmer, older and less perfect: keys, pads, whole mixes.',
pair(tone, held(69, 16), { fx: [['tape', { wow: 1, flutter: 0.7, hiss: 0, sat: 0.2, age: 0.2 }]] },
  ['A clean triangle', 'The same on a worn tape'], { measure: 'wobble', more: true }), [
  'Dub techno, from Basic Channel to Deepchord, is built from one chord stab echoing into the distance, smeared '
    + 'by tape and room. This stab starts dry.',
  {
    kind: 'worked',
    example: dubChord,
    result: 'A chord stab that echoes into the distance, each echo thinner, darker and more worn than the last.',
    steps: [
      addFx('delay', 'Press Effect and choose Delay. Its Sync is 1/8 dotted, the dub echo.'),
      set('fx:delay', { feedback: 0.7, mix: 0.45 }, 'Set Mix to about 45 % and, under Shaping, Feedback to 70 %, so '
        + 'the echoes go on for a while.'),
      set('fx:delay', { tone: 2400, lowcut: 400, pingpong: true }, 'Under Shaping, set Tone to about 2.4 kHz and Low '
        + 'Cut to about 400 Hz, and switch Ping pong on. Each echo is darker and thinner than the one before, and '
        + 'bounces between the speakers.'),
      addFx('tape', 'Press Effect and choose Tape.'),
      set('fx:tape', { wow: 0.35, age: 0.5 }, 'Set Wow to about 35 % and Age to 50 %. The echoes waver and dull like '
        + 'an old tape loop.'),
      addFx('reverb', 'Finally press Effect and choose Reverb.'),
      set('fx:reverb', { size: 4, mix: 0.15 }, 'Set Size to about 4 s and Mix to 15 %, a room for it all to fade '
        + 'into.'),
    ],
  },
]);

const space = effectPage('Space', 'space', [
  'Space is a second, bigger reverb. Its tail can last a minute, so a single note becomes a cloud that hangs in the '
    + 'air. Freeze holds the tail as it is, for as long as you like, while new notes play dry on top: a drone made '
    + 'from whatever was playing. Shimmer feeds the tail back an octave higher, so it rises and glitters as it '
    + 'fades, like a choir.',
], 'Reach for it for ambient clouds, endless drones and the glittering tails of shimmer pads.',
pair(pluck, plucks, { fx: [['space', { size: 20, mix: 0.5 }]] }, ['A dry pluck', 'The same in Space'],
  { measure: 'tail', more: true }), [
  'The shimmer pad is a staple of ambient music: a simple chord sinks into a huge space and comes back an octave '
    + 'higher, again and again.',
  {
    kind: 'worked',
    example: shimmerPad,
    result: 'A soft chord that blooms into a vast, slowly rising cloud an octave above itself.',
    steps: [
      addFx('space', 'Press Effect and choose Space, under Shaping.'),
      set('fx:space', { size: 20, mix: 0.5 }, 'Set Size to about 20 s and Mix to 50 %.'),
      set('fx:space', { tone: 3500 }, 'Turn Tone down to about 3.5 kHz, so the long tail stays soft.'),
      set('fx:space', { shimmer: 0.5 }, 'Under Shaping, set Shimmer to about 50 %. The tail now climbs an octave as '
        + 'it rings.'),
    ],
  },
  'Switch Freeze on while a chord rings and the cloud stays, for as long as you leave it on; play on top, then '
    + 'switch it off and let it fade.',
]);

const chapter: Chapter = {
  id: 'effects',
  title: 'Effects',
  pages: [
    {
      title: 'What effects are',
      pieces: [
        'Effects come after the amp envelope and work on all the notes of a sound together. Press Effect at the '
          + 'bottom of the rack to add one; they work from top to bottom, and the arrows move one up or down. The '
          + 'lamp at the left of an effect switches it off for a moment, so you can hear what it does.',
        'Each page of this chapter is one effect: what it does to the sound, what its knobs mean, a pair of examples '
          + 'to hear the difference, and a use in a style of music. Filter, Drive, Delay and Reverb are Basics or '
          + 'Shaping; Ring Mod and Comb wait in the Deep list of the Effect button in beginner mode.',
      ],
    },
    filter, drive, eq, compressor, chorus, phaser, ring, width, delay, reverb, crusher, comb, tape, space,
  ],
};

export default chapter;
