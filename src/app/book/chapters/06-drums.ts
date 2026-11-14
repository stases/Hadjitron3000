import type { Chapter } from '../pages';
import { hits, makeSound, projectExample, soundExample } from '../build';
import { addFx, addMod, point, set } from '../steps';

const kit = projectExample('A techno beat on seven plain sounds', () => ({
  name: 'Techno Kit',
  bpm: 128,
  master: -3,
  sounds: [
    makeSound({ name: 'Kick', src: { wave: 'sine' }, out: { level: -2 } }),
    makeSound({ name: 'Snare', out: { level: -6 } }),
    makeSound({ name: 'Clap', source: 'noise', out: { level: -2 } }),
    makeSound({ name: 'Hat', source: 'noise', out: { level: -12 } }),
    makeSound({ name: 'Open Hat', source: 'noise', out: { level: -14 } }),
    makeSound({ name: 'Tom', src: { wave: 'sine' }, out: { level: -9 } }),
    makeSound({ name: 'Rim', source: 'fm', out: { level: -12 } }),
  ],
  blocks: [{
    name: 'Beat',
    bars: 1,
    rows: {
      Kick: hits('x...x...x...x...'),
      Clap: hits('....x.......x...'),
      Snare: hits('.......o.....o.o'),
      Hat: hits('xoxoxoxoxoxoxoxo'),
      'Open Hat': hits('..x...x...x...x.'),
      Tom: hits('...........x..x.', 55),
      Rim: hits('...x.....x......'),
    },
  }],
}));

const burst = { name: 'Raw Noise', source: 'noise', amp: { decay: 0.05, sustain: 0, release: 0.03 }, out: { level: -10 } };

const chapter: Chapter = {
  id: 'drums',
  title: 'Drums from nothing',
  pages: [
    {
      title: 'What a drum is',
      pieces: [
        'A drum is a short burst of sound with no tune to speak of. Hit a drum and its skin thumps at a low pitch '
          + 'that falls quickly as the skin settles; hit a cymbal and it hisses. So drum sounds are made of two '
          + 'things: a sine wave whose pitch drops in a blink, and noise, shaped by a quick amp envelope with no '
          + 'sustain.',
        'A kick is a low sine that starts high and drops in a few hundredths of a second: the drop is the thump. '
          + 'A tom is the same, higher and longer. A snare is a tone with noise on top, the rattle of its wires. A hat '
          + 'is noise with everything below the very top filtered away, short for a closed hat and longer for an '
          + 'open one. A clap is a burst of noise in the middle of the range, echoed a few times very quickly, like '
          + 'several hands not quite together.',
        {
          kind: 'compare',
          before: soundExample('A burst of plain noise', () => makeSound(burst), hits('x...x...x...x...')),
          after: soundExample('The same through a high pass, a hat', () => makeSound({ ...burst, name: 'Hat Noise',
            fx: [['filter', { mode: 'highpass', cutoff: 9000, reso: 0.2 }]], out: { level: -2 } }), hits('x...x...x...x...')),
          claim: { measure: 'lows', more: false },
        },
      ],
    },
    {
      title: 'Worked: a whole techno kit',
      pieces: [
        'This example loads a project with a techno beat already written, played by seven sounds that are still '
          + 'plain oscillators and noise. Press Space at any step to hear where the kit has got to. Each step picks '
          + 'the sound it is about in the Factory.',
        {
          kind: 'worked',
          example: kit,
          result: 'A punchy kit: a kick that thumps, a crisp clap, ticking and hissing hats, a snare roll, a tom and a '
            + 'rim shot, all built from sines and noise.',
          steps: [
            set('source', { pitch: -15 }, 'The kick: turn the sine\'s Pitch down to -15 st.', { sound: 'Kick' }),
            set('amp', { decay: 0.4, sustain: 0, release: 0.1 }, 'In its Amp, set Decay to about 0.4 s, Sustain all '
              + 'the way down and Release to 0.1 s.', { sound: 'Kick' }),
            addMod('env', 'Press Modulator and choose Envelope.', { sound: 'Kick' }),
            point('mod:env', ['source', 'pitch'], 0.6, 'Set its Target to Source · Pitch and Amount to about +60 %. '
              + 'Every hit now starts high and falls.', { sound: 'Kick' }),
            set('mod:env', { decay: 0.05 }, 'Set the envelope\'s Decay to about 50 ms: the drop is the thump.',
              { sound: 'Kick' }),
            addFx('drive', 'Press Effect and choose Drive, for a little warmth and punch.', { sound: 'Kick' }),
            set('fx:drive', { amount: 0.4 }, 'Set its Amount to about 40 %.', { sound: 'Kick' }),
            set('source', { wave: 'triangle', pitch: -5, noise: 0.6 }, 'The snare: set Wave to triangle, Pitch to -5 '
              + 'st, and under Shaping Noise to 60 %, the rattle of the wires.', { sound: 'Snare' }),
            set('amp', { decay: 0.2, sustain: 0, release: 0.1 }, 'Set its Decay to 0.2 s, Sustain to zero and Release '
              + 'to 0.1 s.', { sound: 'Snare' }),
            addFx('filter', 'Add the effect Filter (whole sound).', { sound: 'Snare' }),
            set('fx:filter', { mode: 'highpass', cutoff: 180 }, 'Set its Mode to High pass and Cutoff to about 180 Hz, '
              + 'to keep the snare out of the kick\'s way.', { sound: 'Snare' }),
            set('amp', { decay: 0.2, sustain: 0, release: 0.12 }, 'The clap: set its Decay to 0.2 s, Sustain to zero '
              + 'and Release to about 0.12 s.', { sound: 'Clap' }),
            addFx('filter', 'Add a Filter (whole sound).', { sound: 'Clap' }),
            set('fx:filter', { mode: 'bandpass', cutoff: 1300 }, 'Set its Mode to Band pass and Cutoff to about 1.3 '
              + 'kHz, the slap of hands.', { sound: 'Clap' }),
            addFx('delay', 'Add a Delay.', { sound: 'Clap' }),
            set('fx:delay', { sync: 'free', time: 0.012, feedback: 0.55, mix: 0.7 }, 'Set Sync to Free, and under '
              + 'Shaping Time to about 12 ms and Feedback to 55 %; Mix to 70 %. The quick echoes turn one burst into '
              + 'several hands.', { sound: 'Clap' }),
            set('amp', { decay: 0.05, sustain: 0, release: 0.03 }, 'The closed hat: Decay about 50 ms, no Sustain, '
              + 'Release about 30 ms.', { sound: 'Hat' }),
            addFx('filter', 'Add a Filter (whole sound).', { sound: 'Hat' }),
            set('fx:filter', { mode: 'highpass', cutoff: 7500 }, 'Set it to High pass at about 7.5 kHz. Only the sizzle '
              + 'is left.', { sound: 'Hat' }),
            set('amp', { decay: 0.4, sustain: 0, release: 0.08 }, 'The open hat: the same idea, longer. Decay about '
              + '0.4 s, no Sustain.', { sound: 'Open Hat' }),
            addFx('filter', 'Add a Filter (whole sound).', { sound: 'Open Hat' }),
            set('fx:filter', { mode: 'highpass', cutoff: 6500 }, 'High pass at about 6.5 kHz.', { sound: 'Open Hat' }),
            set('amp', { decay: 0.3, sustain: 0, release: 0.12 }, 'The tom: Decay 0.3 s, no Sustain.', { sound: 'Tom' }),
            addMod('env', 'Add an Envelope.', { sound: 'Tom' }),
            point('mod:env', ['source', 'pitch'], 0.25, 'Point it at Source · Pitch with about +25 %, a gentler drop '
              + 'than the kick\'s.', { sound: 'Tom' }),
            set('source', { pitch: 12, ratio: 1.41, amount: 3 }, 'The rim: an FM Pair. Set Pitch to +12 st, Amount to '
              + '3, and under Deep Ratio to 1.41, an odd ratio that clanks like wood and metal.', { sound: 'Rim' }),
            set('amp', { decay: 0.06, sustain: 0, release: 0.04 }, 'Keep it very short: Decay about 60 ms, no Sustain.',
              { sound: 'Rim' }),
          ],
        },
        'Every factory drum is built the same way; open Kick, Snare or Clap from the library and compare. Try a longer '
          + 'kick decay and a lower pitch for an 808-style boom, or a Crusher on the hats for grit.',
      ],
    },
  ],
};

export default chapter;
