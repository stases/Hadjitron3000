import { TICKS_PER_STEP } from '../../../core/defaults';
import { preset } from '../../../presets';
import { addNotes, selectChannel, setView, useApp } from '../../../state/store';
import { openDialog } from '../../dialogStore';
import type { Chapter } from '../pages';
import { hits, projectExample } from '../build';
import { look, when } from '../steps';

const keys = (state: ReturnType<typeof useApp.getState>) => state.project.channels.find((c) => c.sound.name === 'Soft Keys');

const session = projectExample('A beat to play along with, and an empty row for Soft Keys', () => ({
  name: 'Play Along',
  bpm: 100,
  sounds: [preset('Kick'), preset('Snare'), preset('Hat'), preset('Soft Keys')],
  blocks: [{ name: 'Jam', bars: 2, rows: {
    Kick: hits('x.....x...x.....x.....x...x.....'), Snare: hits('....x.......x.......x.......x...'),
    Hat: hits('x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.'),
  } }],
}));

const chapter: Chapter = {
  id: 'recording',
  title: 'Recording and export',
  pages: [
    {
      title: 'Playing in',
      pieces: [
        'The selected sound can be played like a piano on the computer keyboard: the row A S D F G H J K L is the white '
          + 'keys and W E T Y U O P the black ones above them, as on a real keyboard. Z and X move it an octave down '
          + 'and up. It works in every view, so a sound can be tried while its notes are being written.',
        'A MIDI keyboard, plugged in at any time, plays the selected sound too, with the velocity of each key. The '
          + 'small lamp near the right end of the bar at the top blinks with every note it sends, and its hint names '
          + 'the keyboards connected.',
      ],
    },
    {
      title: 'Recording',
      pieces: [
        'Rec, in the bar at the top, writes what you play into the current block as it loops. Press it while the block '
          + 'plays and the next notes you play are written in; press it when stopped and a bar of clicks counts you '
          + 'in first. The R key does the same. Recording works while a block plays on repeat, not the song.',
        'Quantize, next to Rec, moves what you record to the nearest line of a grid, so slightly early or late notes '
          + 'land in time. 1/16 suits most parts; Off keeps your timing exactly as played, which is right for loose, '
          + 'human parts. The metronome, the button after it or the C key, clicks on every beat while playing, with a '
          + 'higher click on the first beat of each bar.',
        'Since the block loops, a part can be built up in passes: the left hand first, then the right, or the kick, '
          + 'then the hats. Undo takes back the last pass.',
      ],
    },
    {
      title: 'Export',
      pieces: [
        'Export Audio, in the File menu, makes a sound file of the song or of the current block. A block can be '
          + 'repeated a number of times, for a loop to use elsewhere. WAV keeps every detail; MP3 is much smaller, for '
          + 'sending to friends. Let the end ring out lets echoes and long notes fade after the last bar, instead of '
          + 'stopping dead.',
        'Under Shaping, Separate file for each sound exports stems: one file per sound, all the same length, so they '
          + 'line up from the start when put into another program for mixing. Added up they can differ a little from '
          + 'the mix, since each meets the master\'s clipper on its own.',
        'Export Sound as WAV, in the Sound menu, saves one note of the selected sound as a file, to use as a sample.',
      ],
    },
    {
      title: 'Worked: record a part',
      pieces: [
        'This example loads a slow beat with an empty row for Soft Keys. Play a few chords or a melody over it and '
          + 'record them; any notes will do.',
        {
          kind: 'worked',
          example: session,
          result: 'A two-bar loop with keys you played yourself, and the dialog to export it.',
          steps: [
            look('Press the metronome button, or C, so a click marks each beat while you play.', {
              target: 'metronome', view: 'track', press: true,
            }),
            when('Click the head of the Soft Keys row in the Track to select it: the computer keyboard now plays it. '
              + 'Try a few keys.', ({ state }) => state.channelId === keys(state)?.id,
            (state) => selectChannel(keys(state)!.id), { target: 'row-Soft Keys', view: 'track' }),
            look('Press Rec, or R. A bar of clicks counts in, then the block plays and records. Play along.',
              { target: 'record', press: true }),
            when('Play until the row has at least four notes, then press Space to stop. If you do not like a pass, '
              + 'Undo takes it back.', ({ state }) => {
              const c = keys(state);
              const block = state.project.patterns.find((p) => p.id === state.patternId);
              return !!c && (block?.notes[c.id]?.length ?? 0) >= 4;
            }, (state) => {
              setView('track');
              addNotes(state.patternId, keys(state)!.id, [57, 60, 64, 67].map((note, i) => ({
                start: i * 8 * TICKS_PER_STEP, len: 6 * TICKS_PER_STEP, note, vel: 0.7,
              })));
            }, { target: 'row-Soft Keys', view: 'track' }),
            when('Open Export Audio in the File menu. Choose the block, two repeats and WAV, and export it.',
              ({ dialog }) => dialog?.kind === 'export', () => openDialog({ kind: 'export' }), { target: 'menu-file' }),
          ],
        },
      ],
    },
  ],
};

export default chapter;
