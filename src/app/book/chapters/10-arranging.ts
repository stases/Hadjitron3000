import { preset } from '../../../presets';
import type { Chapter } from '../pages';
import { chord, hits, join, notes, projectExample } from '../build';
import type { ProjectSpec } from '../build';
import { lane, place } from '../steps';

/** Four blocks in A minor at 124 BPM, none of them placed yet. */
const blocks = projectExample('Four blocks, an empty song', (): ProjectSpec => ({
  name: 'Four Blocks',
  bpm: 124,
  swing: 0.2,
  master: -3,
  sounds: [preset('Kick'), preset('Clap'), preset('Hat'), preset('Round Bass'), preset('Warm Pad'),
    preset('Trance Pluck')],
  blocks: [
    { name: 'Beat', bars: 1, rows: {
      Kick: hits('x...x...x...x...'), Clap: hits('....x.......x...'), Hat: hits('o.x.o.x.o.x.o.xo'),
    } },
    { name: 'Bass', bars: 2, rows: {
      'Round Bass': notes([[0, 57, 3], [6, 57], [8, 57, 2], [14, 64, 2], [16, 53, 3], [22, 53], [24, 60, 3], [30, 55, 2]]),
    } },
    { name: 'Pad', bars: 2, rows: { 'Warm Pad': join(chord(57, 16), notes([[16, 53, 16, 0.8], [16, 57, 16, 0.8],
      [16, 60, 16, 0.8]])) } },
    { name: 'Lead', bars: 2, rows: {
      'Trance Pluck': notes([[0, 76], [3, 72], [6, 69], [8, 76], [11, 72], [14, 69], [16, 77], [19, 72], [22, 69],
        [24, 77], [27, 76], [30, 72]]),
    } },
  ],
}));

const chapter: Chapter = {
  id: 'arranging',
  title: 'Arranging',
  pages: [
    {
      title: 'The Song',
      pieces: [
        'A block is a loop. A piece of music is those loops coming and going: the beat alone, then the bass, a '
          + 'breakdown where the drums drop out, the big return. The Song view lays blocks out in time to make that '
          + 'shape, which is called the arrangement.',
        'Pick a block from the list on the left, then click on the timeline to place it; keep the button down to drag '
          + 'it into place. Each block placed is a tile. Drag a tile to move it and its right end to make it longer: '
          + 'a short block repeats to fill a long tile, so a one-bar beat can play for sixteen bars. The bar under '
          + 'the timeline sets the length of the selected tile exactly, and Edit in Track opens its block.',
        'Most dance music is built in sections of eight or sixteen bars, because listeners feel those lengths without '
          + 'counting. Something should change at the start of each: a sound comes in or goes out, a filter opens, '
          + 'a new block takes over.',
      ],
    },
    {
      title: 'Lanes, fades and lane levels',
      pieces: [
        'The timeline has four lanes, and blocks in different lanes play at the same time. Keep each kind of thing in '
          + 'its own lane, drums in the first, bass in the second and so on, and the shape of the song shows at a '
          + 'glance: where a lane is empty, that part is silent.',
        'A tile can fade in at its start and fade out at its end, set in the bar under the timeline under Shaping, or '
          + 'by dragging the small handles in its top corners. A pad that fades in over four bars is the gentlest '
          + 'way to begin a piece; a fade out at the end, the gentlest way to finish.',
        'The head of each lane has a mute button, M, and a level slider for everything the lane plays. Mute a lane '
          + 'while the song plays to hear what the piece is like without it; turn a lane down to sit the pads further '
          + 'back without opening the Mixer.',
      ],
    },
    {
      title: 'Worked: four blocks into a piece',
      pieces: [
        'This example loads four blocks in A minor at 124 BPM: a beat, a bass line, a pad and a plucked lead, with '
          + 'an empty song. The steps turn them into a 32-bar piece with an intro, a drop, a breakdown and a return. '
          + 'Lanes and bars count from 1 here, as on the screen.',
        {
          kind: 'worked',
          example: blocks,
          result: 'A 32-bar piece: a pad fading in, the beat at bar 5, the bass at bar 9, a breakdown at bar 17 where '
            + 'only the pad and the lead play, and everything back together from bar 25 to the fade at the end.',
          steps: [
            place([['Pad', 2, 0, 32, 4, 4]], 'The intro: select Pad in the list and place it at bar 1 of lane 3. Make '
              + 'the tile 32 bars long, then set Fade in to 4 bars and Fade out to 4 bars.'),
            place([['Beat', 0, 4, 12]], 'The beat comes in after four bars: place Beat at bar 5 of lane 1 and make it 12 '
              + 'bars long, to the end of bar 16.'),
            place([['Bass', 1, 8, 8]], 'The bass joins at bar 9: place Bass in lane 2 at bar 9, 8 bars long. That is '
              + 'the drop.'),
            place([['Lead', 3, 16, 16, 2]], 'The breakdown: the drums and the bass stop at bar 17, and the lead enters '
              + 'alone over the pad. Place Lead in lane 4 at bar 17, 16 bars long, with a Fade in of 2 bars.'),
            place([['Beat', 0, 24, 8], ['Bass', 1, 24, 8]], 'The return: place Beat in lane 1 and Bass in lane 2 at bar '
              + '25, both 8 bars long. Everything plays together until the end.'),
            lane(3, { level: -4 }, 'Turn lane 3, the pad, down to about -4 dB with the slider in its head, so the lead '
              + 'stands in front of it.'),
            lane(4, { mute: true }, 'Press M on lane 4 and play the song from bar 17: the breakdown without its lead '
              + 'is only a pad. That is how to judge whether a part earns its place.'),
            lane(4, { mute: false }, 'Press M again to bring the lead back, and play the whole piece from the start.'),
          ],
        },
        'A breakdown works because of what it takes away. Try a shorter one of four bars, or keep the hats running '
          + 'through it by making a second block with only the hat row and placing that instead.',
      ],
    },
  ],
};

export default chapter;
