import { acidProject } from '../../../presets/examples/acid';
import { ambientProject } from '../../../presets/examples/ambient';
import { experimentalProject } from '../../../presets/examples/experimental';
import { organicProject } from '../../../presets/examples/organic';
import { technoProject } from '../../../presets/examples/techno';
import { tranceProject } from '../../../presets/examples/trance';
import type { Project } from '../../../core/types';
import type { Chapter, Example, Piece } from '../pages';
import { chord, hits, makeSound, notes, soundExample } from '../build';

/** A factory sound heard on a few notes. */
const factory = (name: string, phrase: ReturnType<typeof notes>, opts: { bars?: number; bpm?: number } = {}): Piece =>
  ({ kind: 'example', example: soundExample(name, () => makeSound({ name, from: name }), phrase, opts) });

/** An example song as an example: Hear plays the whole song, Load opens it in place of the project. */
const song = (title: string, make: () => Project): Piece => ({ kind: 'example', example: { kind: 'project', title, make } });

/** The first block of an example song, with its sounds, to add to the project. */
const firstBlock = (title: string, make: () => Project): Example => ({ kind: 'block', title, make });

const chapter: Chapter = {
  id: 'factory',
  title: 'The factory material',
  pages: [
    {
      title: 'The Sound Library',
      pieces: [
        'New... in the Factory opens the Sound Library: new sources at the top, then eighty-three factory sounds in '
          + 'eight groups, then the sounds you saved. Drums are kicks, snares, claps and hats, and the Chopped Break. '
          + 'Percussion is the smaller hits: ticks, shakers, wood and metal. Bass runs from pure subs to acid and '
          + 'growling basses. Keys are everything struck or plucked: kalimbas, bells, pianos, plucks and chord stabs. '
          + 'Leads are lines that sing on top, Pads the long chords behind, Textures noise and drones, and Risers the '
          + 'sweeps that build into a drop or fall out of one.',
        'Each group runs from the plain sounds to the special ones, and every factory sound is about as loud as its '
          + 'neighbours, so one can be swapped for another without reaching for the fader. Show, above the list, '
          + 'narrows it to one group. Audition, or a double-click, plays the chosen sound, Add to Track adds it, and '
          + 'Replace from Library in the Sound menu swaps the selected sound for another, keeping its notes.',
        'A few of the sounds have a trick of their own. Rumble Kick runs its kick into a dark reverb and a '
          + 'compressor, so every kick pushes the rumble of the last one down, the sound of modern techno; like Hard '
          + 'Kick and the subs, it sounds two octaves below the note it plays. Minor Stab adds a minor third above '
          + 'every note, so two notes a fifth apart make a minor seventh chord. Gated Pad chops itself into '
          + 'sixteenths with a square LFO on its level. The Risers take eight seconds to rise, or four to fall, so '
          + 'the length of the note decides how far they go.',
        factory('Rumble Kick', hits('x...x...x...x...', 57), { bpm: 130 }),
        factory('Minor Stab', notes([[2, 57], [2, 64], [10, 57], [10, 64]]), { bpm: 130 }),
        factory('Gated Pad', chord(53, 32), { bars: 2, bpm: 138 }),
        factory('Uplifter', notes([[0, 60, 64]]), { bars: 4, bpm: 128 }),
      ],
    },
    {
      title: 'The block sets',
      pieces: [
        'The Block Library, in the Block menu, holds blocks with the sounds that play them: the eight blocks of the '
          + 'Welcome demo and the blocks of the six example songs, each set under the name of its song, then the '
          + 'blocks you saved. Show narrows the list to one set. Audition plays a block once at the tempo of your '
          + 'project, and Add to Project brings it in with any of its sounds the project does not have yet.',
        'The blocks of one set share a key, so they fit together: take the beat of Techno, the bass of Techno and '
          + 'the stabs, and you have the start of a track of your own in the same key. Two of them to hear:',
        { kind: 'example', example: firstBlock('Beat, from the Techno set', technoProject) },
        { kind: 'example', example: firstBlock('Groove, from the Organic set', organicProject) },
      ],
    },
    {
      title: 'The example songs',
      pieces: [
        'File, Open Example opens one of six short songs as a new project, after offering to save yours: one for each '
          + 'kind of music the program is made for. They are made to be taken apart. Below each is what to look at; '
          + 'Hear plays the whole song once it is ready, and Load opens it.',
        'Techno, 130 BPM in A minor. The Rumble Kick carries it, and the Dark Drone under it ducks on every kick, as '
          + 'do the Minor Stab chords: look at their strips in the Mixer under Shaping. The first four bars play the '
          + 'Beat block without its clap and rim, chosen with Sounds... on that tile. Under the lanes, a row of '
          + 'automation opens the drone\'s filter over the break and lets it fall shut on the drop.',
        song('Techno', technoProject),
        'Trance, 138 BPM in F minor. The Rolling Bass on the off-beats carries it, and it, the Gated Pad and the Arp '
          + 'Pluck all pump with the Punch Kick by ducking. The Arp Pluck plays held chords through its arpeggiator. '
          + 'In the breakdown, a row of automation opens the Choir Pad\'s filter, between a Downlifter and an '
          + 'Uplifter.',
        song('Trance', tranceProject),
        'Acid, 128 BPM in E Phrygian. Three acid lines carry it: the Acid Bass low, the Acid Squelch an octave up and '
          + 'the Acid Square on a row of seven steps, which drifts against the bar. Open their rows in the piano roll '
          + 'to see the slides and accents. There is no ducking and no automation: the lines move by themselves.',
        song('Acid', acidProject),
        'Experimental, 112 BPM in D minor. A crushed broken beat carries it, with clicks and hats on rows of five '
          + 'and seven steps, chance and ratchets everywhere, and a drill fill. Look at the locks: select the snare '
          + 'note that rings longer from the left, the buzz bass notes that open or shut their filter, and the click '
          + 'tuned higher, and see their values under Deep in the bar below the roll.',
        song('Experimental', experimentalProject),
        'Organic, 122 BPM in C minor with a heavy swing. The Kalimba and Harp lines carry it, with notes off the grid: '
          + 'look at them in the roll, between the lines. The Wood Block and the Soft Mallet play on rows of twelve '
          + 'and ten steps, and the Breath Pad breathes with the kick by gentle ducking.',
        song('Organic', organicProject),
        'Ambient, 90 BPM in D Dorian. The Cloud Pad, a cloud of grains, carries it under Wind, held for the whole song, '
          + 'and a row of automation moves its Position from the dark start of its recording to the bright end and '
          + 'back. Every tile fades in and out; look at the fades in the Song.',
        song('Ambient', ambientProject),
      ],
    },
  ],
};

export default chapter;
