import { FILTER, paramSpec } from '../../../core/modules';
import type { FloatSpec } from '../../../core/modules';
import { toNorm } from '../../../core/params';
import type { Note } from '../../../core/types';
import { preset } from '../../../presets';
import { hits, makeSound, notes, projectExample, soundExample, withExtras } from '../build';
import type { Chapter, Example } from '../pages';
import { beat, extras, lock, loop, meter, scale, tempo, velocity, write } from '../steps';

const A = 45; // the A where acid lines live, 55 Hz on the Acid Bass

/** An acid line, and the same line with a few notes that lock the filter wide open. */
const acidLine = notes([[0, A, 1, 1], [2, A], [3, A + 12, 1, 0.9], [5, A], [6, A + 3], [8, A, 1, 1], [10, A + 7],
  [11, A], [13, A + 12, 1, 0.9], [14, A + 3]]);
const open = { locks: [{ target: { module: 'filter', param: 'cutoff' },
  value: toNorm(paramSpec(FILTER, 'cutoff') as FloatSpec, 2500) }] };
const openLine = withExtras(acidLine, { 3: open, 8: open, 13: open });

const lockedHats = projectExample('A kick and a line of hats', () => ({
  name: 'Locked Hats',
  bpm: 124,
  sounds: [preset('Kick'), preset('Hat')],
  blocks: [{ name: 'Groove', bars: 1, rows: { Kick: hits('x...x...x...x...'), Hat: hits('xoxoxoxoxoxoxoxo') } }],
}));

/** A project of a kick, a hat and a snare playing one block. */
const kitWith = (title: string, bpm: number, rows: Record<string, Note[]>,
  opts: { loops?: Record<string, number>; swing?: number } = {}): Example => projectExample(title, () => ({
  name: title, bpm, swing: opts.swing, sounds: [preset('Kick'), preset('Hat'), preset('Snare')],
  blocks: [{ name: 'Beat', bars: 1, rows, loops: opts.loops }],
}));

const acid = projectExample('An acid bass and a kick, no notes yet for the bass', () => ({
  name: 'Acid Line',
  bpm: 128,
  sounds: [preset('Kick'), preset('Acid Bass')],
  blocks: [{ name: 'Acid', bars: 1, rows: { Kick: hits('x...x...x...x...') } }],
}));

const hats = projectExample('A kick on its own, waiting for hats', () => ({
  name: 'Hat Line',
  bpm: 124,
  sounds: [preset('Kick'), preset('Hat')],
  blocks: [{ name: 'Groove', bars: 1, rows: { Kick: hits('x...x...x...x...') } }],
}));

const seven = projectExample('A kick, a snare, two hats and a bass, all silent', () => ({
  name: 'Seven',
  bpm: 132,
  sounds: [preset('Kick'), preset('Snare'), preset('Hat'), preset('Tick'), preset('Round Bass')],
  blocks: [{ name: 'Seven', bars: 1, rows: {} }],
}));

const chapter: Chapter = {
  id: 'notes',
  title: 'Writing notes',
  pages: [
    {
      title: 'The grid',
      pieces: [
        'The Track is where notes are written, in blocks: a few bars of notes for any of the project\'s sounds. Each '
          + 'sound has a row, and in the grid every row is cut into steps. A step is a sixteenth note, four steps make '
          + 'a beat and sixteen a bar of 4/4. Click a step to put a note there and click it again to take it away; drag '
          + 'across steps to paint several.',
        'This is the quickest way to write drums, and it is how drum machines have worked since the 1980s: kick on '
          + 'every beat, clap on the second and fourth, hats in between. Set a block\'s length with Bars, from one to '
          + 'thirty-two, and press Copy to make a copy of the block to start a variation from.',
        {
          kind: 'example',
          example: kitWith('The classic four to the floor', 126, {
            Kick: hits('x...x...x...x...'), Snare: hits('....x.......x...'), Hat: hits('..x...x...x...x.'),
          }),
        },
      ],
    },
    {
      title: 'The piano roll',
      pieces: [
        'Basses, leads and chords need pitch, and the grid shows only one note per step. Click the roll button beside '
          + 'a sound\'s name to open its row in the piano roll: time runs left to right as in '
          + 'the grid, and pitch runs up the keyboard at the left. Click to put a note, drag its body to move it and '
          + 'its right end to make it longer.',
        'Snap sets the grid notes land on: a step, a beat, or finer for fast rolls and loose timing. Notes in one '
          + 'column sound together, so a chord is simply three or four notes stacked. A minor chord is a root, the '
          + 'note three semitones above it and the note seven above; a major chord has four instead of three.',
      ],
    },
    {
      title: 'Velocity',
      pieces: [
        'Velocity is how hard a note is played, from almost silent to full. Select notes and set it in the bar under '
          + 'the grid or the roll. Every sound plays louder notes louder, and many open their filter further too, so a '
          + 'line with loud and soft notes has a pulse that a line of equal notes lacks.',
        'Drummers call the loud ones accents and the very soft ones ghost notes. In the grid, a ghost hat between two '
          + 'normal ones makes a beat swing and breathe; in an acid line, the accents bark.',
        {
          kind: 'example',
          example: kitWith('Hats with accents and ghost notes', 126, {
            Kick: hits('x...x...x...x...'), Hat: hits('oxoXoxoXoxoXoxoX'),
          }),
        },
      ],
    },
    {
      title: 'Chance, slide, hold and ratchet',
      pieces: [
        'Select notes and the bar under the grid shows more for them, behind its Shaping and Deep toggles in beginner '
          + 'mode. Chance plays a note only some of the times the block comes round: hats at 60 % never quite repeat, '
          + 'so a one-bar loop sounds alive for minutes. Slide makes the pitch glide into a note from the one before '
          + 'it on the same row, the rubbery slur of an acid line.',
        'Hold makes a note a drone: it sounds to the end of the block\'s place in the song, however short it is drawn. '
          + 'Ratchet, under Deep, plays a note two, three, four, six or eight times inside its own length, for the '
          + 'stuttering rolls of trap hats and the fast repeats of glitch music.',
        {
          kind: 'example',
          example: kitWith('Hats with chance and a ratchet at the end', 126, {
            Kick: hits('x...x...x...x...'),
            Hat: withExtras(hits('x.xxx.xxx.xxx.xx'), { 3: { chance: 50 }, 7: { chance: 50 }, 11: { chance: 50 },
              15: { ratchet: 4 } }),
          }),
        },
      ],
    },
    {
      title: 'Swing',
      pieces: [
        'Swing pushes every second sixteenth a little late, so steps go long-short, long-short instead of evenly. A '
          + 'little gives house and garage their shuffle; a lot gives the lazy roll of hip hop. It works on the whole '
          + 'project and is set with the Swing knob in the bar at the top.',
        'Because only the off-beat sixteenths move, swing matters most for hats and fast lines; kicks on the beat do '
          + 'not move at all.',
        {
          kind: 'example',
          example: kitWith('Hats and ghost notes with swing', 122, {
            Kick: hits('x...x...x...x...'), Hat: hits('xoxoxoxoxoxoxoxo'),
          }, { swing: 0.45 }),
        },
      ],
    },
    {
      title: 'Time signatures and rows of their own',
      pieces: [
        'Most dance music is in 4/4: four beats a bar. The time signature, a Deep control next to the tempo, changes '
          + 'that for every block. 3/4 is the waltz; 7/8 has seven quick beats, grouped two, two and three, so the '
          + 'bar seems to limp forward; 5/4 and 7/8 are much loved in progressive and experimental music.',
        'A row can also have a length of its own, against the block. Drag the small marker at the end of a row, a Deep '
          + 'control: a row of three steps repeats every three sixteenths while the kick keeps four, so the two '
          + 'drift apart and meet again only every three beats. That is the rolling, endless feel of much minimal '
          + 'techno and of Four Tet\'s percussion.',
        {
          kind: 'example',
          example: kitWith('A three-step hat over a four-step kick', 124, {
            Kick: hits('x...x...x...x...'), Hat: hits('x.x'),
          }, { loops: { Hat: 3 } }),
        },
      ],
    },
    {
      title: 'Scales and the randomiser',
      pieces: [
        'Give the project a scale under the piano roll\'s Shaping, and the roll shades the rows outside it. Snap to '
          + 'scale keeps the notes you draw on it, and Fit to Scale in the Track menu moves the notes already there.',
        'Randomise fills the row, or a stretch you drag along the roll\'s ruler, with random notes of the scale: how '
          + 'many, how high and how loud you choose in its window. It is a way to find a line you would not have '
          + 'written. Keep the bits you like, delete the rest, and press Undo if it all went wrong.',
      ],
    },
    {
      title: 'Worked: an acid line',
      pieces: [
        'An acid line is a sixteenth-note bass that jumps between the root and its octave, with a few notes slid into '
          + 'and a few accented. Its key is A, in the Phrygian scale: minor with a dark half step above the root.',
        {
          kind: 'worked',
          example: acid,
          result: 'A squelching, rolling line in A that barks on its accents and slurs between its high and low notes.',
          steps: [
            scale({ root: 9, type: 'phrygian' }, 'Acid Bass', 'Open the Acid Bass row in the piano roll. Under the roll\'s '
              + 'Shaping, set the scale to A Phrygian.'),
            write('Acid', 'Acid Bass', [[0, A], [2, A], [3, A + 12], [5, A], [6, A + 1], [8, A], [10, A + 7], [11, A],
              [13, A + 12], [14, A + 3]], 'Write the line: A on steps 1, 3, 6, 9 and 12; the A an octave up on 4 and 14; '
                + 'the B flat just above the root on 7; the E on 11; the C on 15. Each note one step long.', { roll: true }),
            velocity('Acid', 'Acid Bass', [0, 3, 8, 13], 1, 'Select the notes on steps 1, 4, 9 and 14, holding Shift to '
              + 'add to the selection, and set their velocity all the way up in the bar below. These are the accents.'),
            velocity('Acid', 'Acid Bass', [2, 5, 11], 0.5, 'Select the notes on steps 3, 6 and 12 and set their velocity '
              + 'to about half, so they murmur.'),
            extras('Acid', 'Acid Bass', [3, 13], { slide: true }, 'Select the two high notes, on steps 4 and 14, and '
              + 'switch Slide on: they glide up from the note before.'),
            extras('Acid', 'Acid Bass', [6], { slide: true }, 'Slide the B flat on step 7 as well. Play the block and '
              + 'listen to the line talk.'),
          ],
        },
      ],
    },
    {
      title: 'Worked: a hat line',
      pieces: [
        'A good hat line never quite repeats. Chance and ratchets make one bar of hats sound like a drummer.',
        {
          kind: 'worked',
          example: hats,
          result: 'A shuffling hat line that changes a little every bar and rolls into the next one.',
          steps: [
            write('Groove', 'Hat', beat('xxxxxxxxxxxxxxxx'), 'In the grid, paint a hat on every step of the Hat row.'),
            velocity('Groove', 'Hat', [1, 3, 5, 7, 9, 11, 13, 15], 0.45, 'Open the Hat row in the piano roll, where '
              + 'several notes can be selected at once. Select the hats on the even steps, the ones between the eighths, '
              + 'and set their velocity to about 45 %. They become ghost notes.'),
            extras('Groove', 'Hat', [3, 7, 11], { chance: 50 }, 'Select the ghost hats on steps 4, 8 and 12 and set '
              + 'Chance to 50 %. Each now plays only every other time or so, at random.'),
            extras('Groove', 'Hat', [15], { ratchet: 3 }, 'Select the last hat and, under Deep, set Ratchet to 3x: a '
              + 'quick roll into the next bar.'),
            tempo(124, 'Finally set Swing in the bar at the top to about 30 %, for a gentle shuffle.', { swing: 0.3 }),
          ],
        },
      ],
    },
    {
      title: 'Worked: a pattern in 7/8',
      pieces: [
        'Seven beats is an odd number of eighths, and it makes a groove that stumbles forward and catches itself. The '
          + 'bar is grouped two, two and three: the three is the long beat at the end.',
        {
          kind: 'worked',
          example: seven,
          result: 'A limping, driving groove in 7/8 at 132 BPM: kick, snare and bass lock to the long last beat.',
          steps: [
            meter([7, 8], 'Next to the tempo, under Deep in beginner mode, set the time signature to 7/8. The block now '
              + 'has fourteen steps: beats on steps 1, 5 and 9.'),
            write('Seven', 'Kick', beat('x.......x.....'), 'Put a kick on step 1 and step 9.'),
            write('Seven', 'Snare', beat('....x......x..'), 'Put a snare on step 5 and step 12.'),
            write('Seven', 'Hat', beat('x.x.x.x.x.x.x.'), 'Put a hat on every other step, all seven eighths.'),
            write('Seven', 'Round Bass', [[0, 57, 3], [4, 60, 3], [8, 55, 5]], 'Open Round Bass in the piano roll and '
              + 'write three notes: an A on step 1, three steps long; a C on step 5, three long; and a G on step 9, '
              + 'five long, to fill the long beat.', { roll: true }),
            write('Seven', 'Tick', beat('x'), 'Back in the grid, put a Tick on step 1.'),
            loop('Seven', 'Tick', 3, 'Under the grid\'s Deep, drag the marker at the end of the Tick row back to step 3. '
              + 'The tick now comes every three steps against the two, two and three of the bar, and lands somewhere new '
              + 'on every beat.'),
          ],
        },
      ],
    },
    {
      title: 'Locks: a note\'s own knob values',
      pieces: [
        'Every note of a row plays the same sound. A lock lets one note hold a control of that sound at a value of its '
          + 'own while it plays: one snare with a longer tail, one stab with its filter wide open, one hit panned hard '
          + 'left. Drum machines call this parameter locking, and it is how a single sound becomes a whole family of '
          + 'variations in one row.',
        'Select notes in the piano roll, and under Deep in the bar below choose a control under Lock 1, then turn the '
          + 'knob beside it; it starts at the value the sound has. Lock 2 adds a second control once the first is set. '
          + 'A control inside the note, such as the filter, the pitch or the amp envelope, changes for that note '
          + 'alone, even in a chord. A control the notes share, such as an effect or the output, takes the locked '
          + 'value while the note sounds and goes back when it ends. A locked note has a small padlock at its top '
          + 'right, and a lock wins over automation while its note sounds.',
        {
          kind: 'compare',
          before: soundExample('An acid line', () => makeSound({ name: 'Acid Line', from: 'Acid Bass' }), acidLine,
            { bpm: 128 }),
          after: soundExample('The same with three notes locking the filter open', () => makeSound({
            name: 'Locked Acid', from: 'Acid Bass' }), openLine, { bpm: 128 }),
          claim: { measure: 'highs', more: true },
        },
      ],
    },
    {
      title: 'Worked: a hat line with locks',
      pieces: [
        'One hat sound, sixteen notes, and a few locks: a line that sounds like two hats played by a drummer who moves '
          + 'around the kit.',
        {
          kind: 'worked',
          example: lockedHats,
          result: 'A hat line where two hats ring open, two sit to the left and right, and one is fuller than the rest.',
          steps: [
            lock('Groove', 'Hat', [6, 14], 0, ['amp', 'decay'], 0.35, 'Open the Hat row in the piano roll and select '
              + 'the hats on steps 7 and 15, holding Shift. Under Deep in the bar below, set Lock 1 to Amp · Decay and '
              + 'turn its knob to about 0.35 s: those two now ring like an open hat.'),
            lock('Groove', 'Hat', [6], 1, ['out', 'pan'], 0.6, 'Select only the hat on step 7 and set its Lock 2 to '
              + 'Output · Pan, at about R 60.'),
            lock('Groove', 'Hat', [10], 0, ['out', 'pan'], -0.6, 'Select the hat on step 11 and lock its Output · Pan '
              + 'to about L 60. The two answer each other from the sides.'),
            lock('Groove', 'Hat', [12], 0, ['fx:filter', 'cutoff'], 3000, 'Select the hat on step 13 and lock the '
              + 'Filter · Cutoff of its effect to about 3 kHz: more of the noise comes through, a fuller hit.'),
          ],
        },
        'The notes an arpeggiator plays from a locked note keep its locks, and so do the repeats of a row with a length '
          + 'of its own: a locked note on a row of five steps lands somewhere new in every bar.',
      ],
    },
  ],
};

export default chapter;
