import { refSpec } from '../../../core/automation';
import { barOf } from '../../../core/meter';
import { toNorm } from '../../../core/params';
import type { Project } from '../../../core/types';
import { preset } from '../../../presets';
import type { Chapter } from '../pages';
import { chord, hits, join, line, makeProject, notes, projectExample } from '../build';
import type { ProjectSpec } from '../build';
import { automate, curve, look } from '../steps';

/** A row of automation of a channel's control, [bar from 0, value in the control's units], added to a project. */
function automated(project: Project, sound: string, module: string, param: string,
  points: [number, number][]): Project {
  const owner = project.channels.find((c) => c.sound.name === sound)!.id;
  const target = { owner, module, param };
  const spec = refSpec(project, target)!;
  const bar = barOf(project.meter).ticks;
  project.automation = [...project.automation, {
    id: `a${project.automation.length}`, target,
    points: points.map(([at, v]) => [Math.round(at * bar), toNorm(spec, v)]),
  }];
  return project;
}

/** Eight bars of a pad, whose filter stays put or opens along the song. */
const padSong = (name: string): ProjectSpec => ({
  name, bpm: 124, sounds: [preset('Warm Pad')],
  blocks: [{ name: 'Pad', bars: 2, rows: { 'Warm Pad': chord(57, 32) } }],
  song: [['Pad', 0, 0, 8]],
});

/** A short song with a breakdown in A minor: beat and bass, eight bars of pad alone with a clap roll, and the drop. */
const breakdown = projectExample('A song with a breakdown, and nothing automated yet', (): ProjectSpec => ({
  name: 'Breakdown',
  bpm: 124,
  master: -2,
  sounds: [preset('Kick'), preset('Clap'), preset('Hat'), preset('Round Bass'), preset('Warm Pad')],
  blocks: [
    { name: 'Beat', bars: 1, rows: {
      Kick: hits('x...x...x...x...'), Clap: hits('....x.......x...'), Hat: hits('..x...x...x...x.'),
    } },
    { name: 'Bass', bars: 1, rows: { 'Round Bass': line(57) } },
    { name: 'Pad', bars: 2, rows: { 'Warm Pad': join(chord(57, 16), notes([[16, 53, 16], [16, 57, 16], [16, 60, 16]])) } },
    { name: 'Roll', bars: 2, rows: { Clap: hits('x.......x...x...x.x.x.x.xxxxxxxX') } },
  ],
  song: [['Beat', 0, 0, 8], ['Bass', 1, 0, 8], ['Pad', 2, 0, 24], ['Roll', 3, 14, 2], ['Beat', 0, 16, 8],
    ['Bass', 1, 16, 8]],
  sends: { 'Warm Pad': [0.15, 0] },
}));

const padCutoff = { sound: 'Warm Pad', unit: 'fx:filter', param: 'cutoff' } as const;
const clapEcho = { sound: 'Clap', unit: 'send', param: '1' } as const;

const chapter: Chapter = {
  id: 'automation',
  title: 'Automation',
  pages: [
    {
      title: 'Rows of automation',
      pieces: [
        'Modulators move a knob in a loop or with every note. Automation moves it along the song instead, once, the '
          + 'way a producer rides a knob while the track plays: a filter that opens over a sixteen-bar build, a reverb '
          + 'that grows for the last chorus, an echo that swells into the drop and stops dead on it.',
        'Each row of automation is a small amber display under the lanes of the Song, bar for bar with them. In '
          + 'beginner mode the rows wait behind the Deep button there. Press + Automation, choose a sound, a bus or '
          + 'the Master, and then the control. Click in the row to add a point, drag a point to move it, and '
          + 'right-click it or press Delete to take it away. Points land on the beats; hold Alt to put one anywhere. '
          + 'Between two points the control moves in a straight line, and before the first and after the last it '
          + 'holds still.',
        'A knob that a row moves gets an amber ring, and while the song plays it follows the row. Automation belongs '
          + 'to the song: a block playing on its own on the Track ignores it, and an export moves every control as '
          + 'playback does.',
        {
          kind: 'compare',
          before: projectExample('Eight bars of a pad', () => padSong('Still Pad Song')),
          after: { kind: 'project', title: 'The same with its cutoff opening along the song', make: () => automated(
            makeProject(padSong('Opening Pad Song')), 'Warm Pad', 'fx1', 'cutoff', [[0, 250], [7, 5000]]) },
          claim: { measure: 'movement', more: true },
        },
      ],
    },
    {
      title: 'What can be automated',
      pieces: [
        'A row can move any knob of a sound: its source, its filter, its amp envelope, any of its effects and its '
          + 'output, and its two sends. It can move the level of the Room and the Echo, any knob of the effects on '
          + 'them, and the master\'s level and effects.',
        'Some things cannot be moved, each for a reason. Choices, such as a wave or a filter\'s mode, and switches, '
          + 'such as Ping pong, jump rather than move, so they have no line to follow. A reverb\'s Size and Tone build '
          + 'the whole sound of its room in one go, and rebuilding it while it rings would click. The arpeggiator\'s '
          + 'Octaves and Gate decide which notes play before the sound hears them. And a modulator\'s own knobs are '
          + 'not offered: to change how far an LFO moves, automate the control it moves instead, or the sound\'s '
          + 'level.',
        'A note can also hold a control at a value of its own for as long as it sounds: a lock, which the chapter on '
          + 'writing notes explains. While a locked note plays, its lock wins over the row.',
      ],
    },
    {
      title: 'Worked: a sweep and a rising echo',
      pieces: [
        'The two most common moves in dance music: a filter that slowly opens over a breakdown, so the drop feels like '
          + 'a door flung open, and an echo that swells on the last hits before the drop and is cut off on it. This '
          + 'example loads a song where bars 9 to 16 are a breakdown of pad alone, with a clap roll at the end.',
        {
          kind: 'worked',
          example: breakdown,
          result: 'The pad starts dark in the breakdown and opens slowly to a bright chord, the clap roll echoes louder '
            + 'and louder, and on the drop at bar 17 the filter settles and the echo stops.',
          steps: [
            automate(padCutoff, 'In the Song, press Deep under the lanes in beginner mode, then + Automation. Choose Warm '
              + 'Pad, then Filter (whole sound), then Cutoff. An empty row appears under the lanes.', { title: 'The sweep' }),
            curve(1, padCutoff, [[8, 400], [15.75, 5000], [16, 1200]], 'Click in the row at the start of bar 9, low '
              + 'down, and drag the point until the status bar reads about 400 Hz. Put a second point on the last beat '
              + 'of bar 16 at about 5 kHz, and a third at the start of bar 17 at about 1.2 kHz, where the pad sits for '
              + 'the drop.'),
            automate(clapEcho, 'Press + Automation again and choose Clap, then Send · Echo.', { title: 'The rising echo' }),
            curve(2, clapEcho, [[14, 0], [15.75, 0.7], [16, 0]], 'In the new row, put a point at the start of bar 15 at '
              + '0 %, one on the last beat of bar 16 at about 70 %, and one at the start of bar 17 back at 0 %. The '
              + 'roll now echoes more and more, and the drop cuts it off.'),
            look('Play the song from bar 7 and watch the Warm Pad\'s Cutoff knob in the Factory and the Clap\'s Echo '
              + 'send in the Mixer: both follow their rows, with an amber ring.', { target: 'timeline', view: 'song' }),
          ],
        },
        'Try the same sweep on the master\'s level for a fade out, or on the Room\'s level so the whole mix sinks into '
          + 'the reverb at the end of a breakdown.',
      ],
    },
  ],
};

export default chapter;
