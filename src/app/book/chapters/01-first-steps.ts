import { TICKS_PER_STEP, newNote, newSound } from '../../../core/defaults';
import { SOURCES } from '../../../core/modules';
import type { Note, Pattern } from '../../../core/types';
import { demoProject, starterProject } from '../../../presets/projects';
import {
  addChannel, addEffect, addMod, addNote, addPlacement, duplicatePattern, renameSound, resizeNotes, resizePlacement,
  setModTarget, setParam, setPlaying, setView,
} from '../../../state/store';
import type { AppState } from '../../../state/store';
import { openDialog } from '../../dialogStore';
import type { Look } from '../../tour/tourStore';
import type { Chapter, Example, WorkedPiece } from '../pages';
import { look, when } from '../steps';

const sound = ({ state }: Look) => state.project.channels.find((c) => c.id === state.channelId)?.sound;
const block = (state: AppState): Pattern => state.project.patterns.find((p) => p.id === state.patternId)!;
const channelNamed = (state: AppState, name: string) => state.project.channels.find((c) => c.sound.name === name)!.id;

/** The notes of the current block in the row of the sound with this name. */
function row({ state }: Look, name: string): Note[] {
  const channel = state.project.channels.find((c) => c.sound.name === name);
  return channel ? block(state).notes[channel.id] ?? [] : [];
}

/** Put a one-step note on a step of a row of the current block. */
const put = (state: AppState, name: string, step: number, note = 60) =>
  addNote(state.patternId, channelNamed(state, name), newNote(step * TICKS_PER_STEP, note));

/** A block's notes as text, so that two blocks can be compared. */
const notesText = (pattern: Pattern) =>
  Object.entries(pattern.notes)
    .flatMap(([channel, notes]) => notes.map((n) => `${channel}:${n.start}:${n.note}:${n.len}:${n.vel}`))
    .sort()
    .join(' ');

function layered({ state }: Look): boolean {
  const song = state.project.song;
  return song.some((a) => song.some((b) => a.lane !== b.lane && a.bar < b.bar + b.bars && b.bar < a.bar + a.bars));
}

const starter: Example = { kind: 'project', title: 'A new project', make: starterProject };

export const MAKE_A_SOUND: WorkedPiece = {
  kind: 'worked',
  example: starter,
  result: 'A short, plucky bass of your own, with a name, in your library and on the Track ready for a bass line.',
  steps: [
    look('This is the Factory, where sounds are made. A sound is a rack of units read from top to bottom: the first '
      + 'one makes a tone and every unit below it changes that tone a little. In this lesson you build a short, plucky '
      + 'bass from nothing.', { title: 'The Factory', view: 'factory' }),
    when('Press New... and pick Oscillator under New, then press Add to Track. An oscillator is the simplest source '
      + 'there is: a tone that keeps going at the pitch of the key you press.',
    (l) => !!sound(l) && !l.start.channels.some((c) => c.id === l.state.channelId),
    () => addChannel(newSound('osc', 'Oscillator')), { title: 'A new sound', target: 'new-sound', view: 'factory' }),
    look('Click the keys of the piano at the bottom, or press A, S, D and F on your computer keyboard. What you hear '
      + 'is a raw sawtooth wave: bright, buzzy, and steady for as long as you hold the key.',
    { title: 'Play it', target: 'keyboard', view: 'factory', press: true }),
    when('The wave is the basic shape of the tone, and the shape decides its colour. Click the square wave, the last '
      + 'button under Wave: it sounds hollow and woody, a classic for bass lines. Hold a key and watch the scope next to '
      + 'the piano; it draws the wave you hear.',
    (l) => sound(l)?.source.params.wave === 'square',
    (s) => setParam(s.channelId!, 'source', 'wave', 'square'), { title: 'The wave', target: 'unit-source', view: 'factory' }),
    when('The amp envelope shapes how loud a note is from the moment the key goes down until it fades away. Drag the '
      + 'Sustain knob all the way down. Each note now falls away by itself over the Decay time, and that quick fall is '
      + 'what makes a pluck.',
    (l) => Number(sound(l)?.amp.sustain ?? 1) <= 0.1,
    (s) => setParam(s.channelId!, 'amp', 'sustain', 0), { title: 'The amp envelope', target: 'unit-amp', view: 'factory' }),
    when('A filter takes part of the sound away. A low pass filter lets the low notes through and dulls the bright '
      + 'top, a bit like a hand over the speaker. Every sound has one right under the Source; click the lamp at the '
      + 'left of the Filter unit to switch it on.',
    (l) => sound(l)?.filter.on === true,
    (s) => setParam(s.channelId!, 'filter', 'on', true), { title: 'A filter', target: 'unit-filter', view: 'factory' }),
    when('Cutoff is where the filter starts to cut. Turn it down to about 300 Hz and play a few notes: the sound goes '
      + 'dark and round. A little Reso adds a whistle right at the cutoff.',
    (l) => sound(l)?.filter.on === true && Number(sound(l)?.filter.cutoff) <= 600,
    (s) => setParam(s.channelId!, 'filter', 'cutoff', 300), { title: 'The cutoff', target: 'unit-filter', view: 'factory' }),
    when('A modulator turns a knob for you. An envelope turns it once on every note, an LFO back and forth in a loop. '
      + 'Press Modulator and choose Envelope.',
    (l) => (sound(l)?.mods.length ?? 0) > 0,
    (s) => addMod(s.channelId!, 'env'), { title: 'A modulator', target: 'add-modulator', view: 'factory' }),
    when('Set the Target of the envelope to Filter · Cutoff. Now every note opens the filter for a moment and closes '
      + 'it again, which gives the bass its snappy start. Each note gets an envelope of its own, so notes that overlap '
      + 'do not cut each other short. Amount sets how far it opens.',
    (l) => !!sound(l)?.mods.some((m) => m.target?.module === 'filter' && m.target.param === 'cutoff'),
    (s) => {
      const mod = s.project.channels.find((c) => c.id === s.channelId)!.sound.mods.find((m) => m.type === 'env')!;
      setModTarget(s.channelId!, mod.id, { module: 'filter', param: 'cutoff' });
    }, { title: 'Point it at the cutoff', target: 'mod-env', view: 'factory' }),
    when('Echo and reverb put a sound in a room. Delay repeats each note a little later and a little quieter; Reverb '
      + 'adds the soft tail of a hall. Press Effect and choose one of them, and turn its Mix down if it blurs the notes.',
    (l) => !!sound(l)?.chain.some((m) => m.type === 'delay' || m.type === 'reverb'),
    (s) => addEffect(s.channelId!, 'delay'), { title: 'Some room', target: 'add-effect', view: 'factory' }),
    when('Click the name at the top and type a new one, Pluck Bass for example. The Track and the library show your '
      + 'sound by this name.',
    (l) => {
      const name = sound(l)?.name.trim();
      return !!name && !SOURCES.some((s) => s.label === name);
    },
    (s) => renameSound(s.channelId!, 'Pluck Bass'), { title: 'A name', target: 'sound-name', view: 'factory' }),
    look('Press Save to Library. Your sound is kept in the library folder from now on, and New... offers it to every '
      + 'project you make.', { title: 'Keep it', target: 'save-sound', view: 'factory', press: true }),
    look('That is a whole sound, from the first wave to the last echo. It is already a row on the Track, ready for a '
      + 'bass line; the next lesson shows how to write one.', { title: 'Your own sound' }),
  ],
};

export const MAKE_A_SONG: WorkedPiece = {
  kind: 'worked',
  example: starter,
  result: 'Two blocks of a beat and a bass line, arranged in two lanes of a song, and the window that exports it.',
  steps: [
    look('This is the Track. Every row is a sound and every column a sixteenth note; four columns make a beat. What '
      + 'you write here is a block, a short loop that you arrange into a song later.',
    { title: 'The Track', target: 'grid', view: 'track' }),
    when('Click the first cell of every beat in the Kick row: columns 1, 5, 9 and 13. Press Space to hear the loop, '
      + 'and Space again to stop it.',
    (l) => row(l, 'Kick').length >= 4,
    (s) => [0, 4, 8, 12].forEach((i) => put(s, 'Kick', i)), { title: 'A kick drum', target: 'row-Kick', view: 'track' }),
    when('Put a Snare on columns 5 and 13, and a Hat in some of the empty columns in between. Hold the button down and '
      + 'move sideways to paint several cells at once.',
    (l) => row(l, 'Snare').length > 0 && row(l, 'Hat').length > 0,
    (s) => {
      put(s, 'Snare', 4);
      put(s, 'Snare', 12);
      [2, 6, 10, 14].forEach((i) => put(s, 'Hat', i));
    }, { title: 'Snare and hats', target: 'grid', view: 'track' }),
    when('Click a cell in the Sub Bass row, then drag the step up or down to change its note. The bar under the grid '
      + 'tells you which note it is.',
    (l) => row(l, 'Sub Bass').some((n) => n.note !== 60),
    (s) => put(s, 'Sub Bass', 0, 63), { title: 'A bass note', target: 'row-Sub Bass', view: 'track' }),
    when('Drag the right edge of a bass step to the right to hold the note longer. A step can stretch across as many '
      + 'columns as you like.',
    (l) => row(l, 'Sub Bass').some((n) => n.len > TICKS_PER_STEP),
    (s) => {
      const id = channelNamed(s, 'Sub Bass');
      resizeNotes(s.patternId, id, block(s).notes[id].map((n) => n.id), 2 * TICKS_PER_STEP);
    }, { title: 'A longer note', target: 'row-Sub Bass', view: 'track' }),
    when('A song is made of blocks. Press Copy to make block B, a copy of this one, to turn into a variation.',
      (l) => l.state.project.patterns.length > l.start.patterns.length,
      (s) => duplicatePattern(s.patternId), { title: 'A second block', target: 'copy-block', view: 'track' }),
    when('The grid now shows block B. Change it a little: take out a kick, move the bass note, add a few hats. Small '
      + 'changes like these keep a song moving.',
    ({ state }) => {
      const current = block(state);
      const others = state.project.patterns.filter((p) => p !== current);
      return others.length > 0 && others.every((p) => notesText(p) !== notesText(current));
    },
    (s) => put(s, 'Hat', 15), { title: 'A variation', target: 'grid', view: 'track' }),
    when('Now the blocks go in order. Click the Song tab.', (l) => l.state.view === 'song', () => setView('song'),
      { title: 'The Song', target: 'tab-song', view: 'track' }),
    when('Pick A in the list at the left and click the first bar of lane 1 to place it there. Then pick B and click the '
      + 'bar right after A.',
    (l) => new Set(l.state.project.song.map((p) => p.pattern)).size >= 2,
    (s) => {
      addPlacement(s.project.patterns[0].id, 0, 0);
      addPlacement(s.project.patterns[1].id, 0, 1);
    }, { title: 'Place the blocks', target: 'timeline', view: 'song' }),
    when('Drag the right edge of a placed block to make it longer. A block placed longer than itself plays again from '
      + 'the start, so a one-bar block can fill four bars.',
    ({ state }) => state.project.song.some((s) => s.bars > state.project.patterns.find((p) => p.id === s.pattern)!.bars),
    (s) => resizePlacement(s.project.song.at(-1)!.id, 3), { title: 'Stretch a block', target: 'timeline', view: 'song' }),
    when('Blocks in different lanes play at the same time. Place a block in lane 2 under one in lane 1, and the two '
      + 'sound together.', layered, (s) => addPlacement(s.project.patterns[0].id, 1, 2),
    { title: 'Layers', target: 'timeline', view: 'song' }),
    when('Press Play, or Space. In the Song view Play plays the whole song from the start, every lane at once.',
      (l) => l.state.playing, () => setPlaying(true), { title: 'Listen', target: 'play', view: 'song' }),
    when('Choose Export Audio... in the File menu to turn the song into a WAV or MP3 file that any music player can '
      + 'open.', (l) => l.dialog?.kind === 'export', () => openDialog({ kind: 'export' }),
    { title: 'Export', target: 'menu-file', view: 'song' }),
    look('That is a song: a beat, a bass line, a variation and an arrangement. The chapters after this one go through '
      + 'every part of it slowly, with sounds and tracks to load and take apart.', { title: 'Your first song' }),
  ],
};

const demo: Example = { kind: 'project', title: 'The demo song, Welcome', make: demoProject };

const chapter: Chapter = {
  id: 'first-steps',
  title: 'First steps',
  pages: [
    {
      title: 'How this book works',
      pieces: [
        'This book sits beside the program so you can read and play at the same time. Each chapter takes one part '
          + 'of making music and goes through it with sounds and tracks you can load, hear and change.',
        'Hear it plays an example without touching your project. Load this example puts it into the program: a sound '
          + 'or a block joins your project, and a whole project takes its place, after asking whether to save yours.',
        'A worked example is a row of steps. Load it, and an amber frame points at the control each step is about. '
          + 'When you have done what the step asks, it ticks itself off; press Next to go on. If you get stuck, Show me '
          + 'the finished one loads the result.',
        'In beginner mode the program keeps some controls folded away behind small Shaping and Deep buttons. When a '
          + 'step needs one of them, it opens the fold for you. Beginner Mode in the View menu turns the folds off.',
      ],
    },
    {
      title: 'Sounds, blocks and songs',
      pieces: [
        'Hadjitron 3000 has four views, the tabs under the transport bar. The Factory builds sounds. The Track writes '
          + 'short blocks of notes with them. The Song arranges blocks into a piece. The Mixer balances the sounds '
          + 'against each other.',
        'A sound is an instrument: a kick, a bass, a pad. It does nothing until notes play it. A block is a few bars '
          + 'of notes for any of the sounds, such as a beat or a bass line, and it loops while you work on it. A song '
          + 'is blocks placed one after another and on top of each other on four lanes.',
        'Play, or Space, plays what the view shows: the block on the Track, the whole song in the Song. The status bar '
          + 'at the bottom says which, and explains whatever control the pointer is over.',
        { kind: 'example', example: demo },
        'The demo song is eight blocks in four lanes. Load it, press Space in the Song, and click through the tabs '
          + 'while it plays.',
      ],
    },
    {
      title: 'Lesson: make a sound',
      pieces: [
        'The first lesson builds a sound from nothing in thirteen steps. It starts a new project, so save yours first '
          + 'if you want to keep it; the program asks.',
        MAKE_A_SOUND,
      ],
    },
    {
      title: 'Lesson: make a song',
      pieces: [
        'The second lesson writes a beat and a bass line in a new project and arranges them into a short song.',
        MAKE_A_SONG,
      ],
    },
  ],
};

export default chapter;
