import type { Chapter } from '../pages';
import { makeSound, notes, soundExample } from '../build';
import { addFx, set } from '../steps';

const overlapping = notes([[0, 72, 3], [2, 75, 3], [4, 79, 5], [8, 77, 3], [10, 75, 6]]);
const chords = notes([[0, 60, 16], [0, 63, 16], [0, 67, 16], [16, 56, 16], [16, 60, 16], [16, 63, 16]]);

const chapter: Chapter = {
  id: 'playing',
  title: 'Playing a sound',
  pages: [
    {
      title: 'Poly, Mono and Legato',
      pieces: [
        'How the notes of a sound follow each other is set under Play, in the Source unit\'s Shaping. Poly plays as '
          + 'many notes at once as you like, for chords and pads. Mono plays one at a time: a new note cuts off the '
          + 'one before, like a singer or a flute, and when you let go of a key the note you still hold comes back.',
        'Legato is Mono, except that a note played while the one before is still held does not start again: only '
          + 'its pitch moves, and its envelopes carry on. Glide makes each new note slide from the pitch of the note '
          + 'before, over the time you set. Mono or Legato with a little Glide is the sound of a classic synthesizer '
          + 'lead or bass, the slur between notes that a guitarist makes by sliding a finger.',
        { kind: 'knobs', unit: 'play', when: 'Reach for Mono and Glide for leads and basses that should sing from note '
          + 'to note, and for the Arp whenever held chords should turn into running patterns.' },
      ],
    },
    {
      title: 'The arpeggiator',
      pieces: [
        'An arpeggio is a chord played one note at a time. The arpeggiator, Arp under Play, does it for you: hold a '
          + 'chord, or write one on the Track, and it plays the notes one after another in time with the song. Up '
          + 'climbs from the lowest note, Down falls, Up-Down goes both ways, Random picks, and As Played follows the '
          + 'order of your fingers.',
        'Rate is how fast, as a note value: 1/16 is the running sixteenths of trance. Octaves repeats the pattern one '
          + 'or more octaves higher before starting again, and Gate is how long each note sounds, from a short tick '
          + 'to a smooth line. Two held chords become a whole bar of melody, and a change of chord changes the '
          + 'pattern at once.',
      ],
    },
    {
      title: 'Scales',
      pieces: [
        'A scale is the set of notes a piece keeps to, seven of the twelve in an octave for most music. Notes from '
          + 'one scale sound like they belong together. The key is its first note, the home the music returns to. '
          + 'Minor scales sound dark, wistful or serious, the usual choice for techno, trance and ambient; major '
          + 'sounds bright; Dorian is minor with a hopeful lift; Phrygian is minor with a dark, Spanish edge, much '
          + 'loved in acid and hard techno; the pentatonics leave out the notes that clash, so almost nothing sounds '
          + 'wrong.',
        'Give the project a scale in the piano roll\'s toolbar, under its Shaping. The rows of the notes outside it '
          + 'are shaded, Snap to scale keeps new notes on it, and Randomise draws only notes of it. The chapter on '
          + 'writing notes goes through the roll.',
      ],
    },
    {
      title: 'Worked: a gliding lead',
      pieces: [
        'This lead slides from note to note wherever the notes overlap, the way a voice or a violin does.',
        {
          kind: 'worked',
          example: soundExample('A new oscillator for a lead', () => makeSound({ name: 'Glide Lead', amp: { sustain: 0.8 },
            out: { level: -9 } }), overlapping),
          result: 'A lead that sings from note to note: overlapping notes slide into each other without starting '
            + 'again.',
          steps: [
            set('play', { mode: 'legato' }, 'Under Shaping in the Source, find Play and set Mode to Legato.'),
            set('play', { glide: 0.12 }, 'Set Glide to about 0.12 s. Every new note now slides from the last one.'),
            set('filter', { on: true, cutoff: 2200, reso: 0.25 }, 'Switch the Filter on, Cutoff to about 2.2 kHz and '
              + 'Reso to 25 %.'),
            addFx('delay', 'Press Effect and choose Delay, for a little air behind the line.'),
            set('fx:delay', { mix: 0.2 }, 'Set its Mix to about 20 %.'),
          ],
        },
      ],
    },
    {
      title: 'Worked: a trance arp',
      pieces: [
        'Two long chords become the running, glittering pattern of a trance breakdown. The sound is a bright, short '
          + 'supersaw pluck; the arpeggiator does the rest.',
        {
          kind: 'worked',
          example: soundExample('A pluck playing two held chords', () => makeSound({
            name: 'Arp Pluck', src: { voices: 5, spread: 16, width: 0.8 }, filter: { on: true, cutoff: 600, reso: 0.3 },
            amp: { decay: 0.3, sustain: 0, release: 0.2 }, mods: [['env', ['filter', 'cutoff'], 0.5, { decay: 0.18 }, 'note']],
            out: { level: -15 },
          }), chords, { bars: 2, bpm: 138 }),
          result: 'The two chords run up and down two octaves in sixteenths, with echoes in between.',
          steps: [
            set('play', { arp: 'updown' }, 'Under Shaping in the Source, set Arp to Up-Down. The chords now play one '
              + 'note at a time.'),
            set('play', { octaves: 2 }, 'Set Octaves to 2, so the pattern climbs an octave higher before it turns.'),
            set('play', { gate: 0.35 }, 'Set Gate to about 35 %, for shorter, crisper notes.'),
            addFx('delay', 'Press Effect and choose Delay.'),
            set('fx:delay', { mix: 0.25, feedback: 0.55 }, 'Set its Mix to about 25 % and, under Shaping, Feedback '
              + 'to 55 %. The dotted eighth echoes fill the gaps between the notes.'),
          ],
        },
        'Try Random for a pattern that never quite repeats, or Rate at 1/16 triplet for a rolling, galloping feel.',
      ],
    },
  ],
};

export default chapter;
