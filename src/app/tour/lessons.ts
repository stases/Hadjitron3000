// The two tutorials as plain data: what each step says, which control it points at (the element with that
// data-tour attribute), the view it opens in, and how to tell that the user has done it.

import { SOURCES } from '../../core/modules';
import type { Pattern, Project, Sound, Step } from '../../core/types';
import type { AppState, View } from '../../state/store';
import type { DialogKind } from '../dialogStore';

/** What a step can look at: the app now, the project the lesson started from, and the open dialog. */
export interface Look {
  state: AppState;
  start: Project;
  dialog: DialogKind | null;
}

export interface TourStep {
  title: string;
  text: string;
  target?: string;
  view?: View;
  /** True once the user has done what the step asks; 'press' means pressing the target is all it takes. */
  done?: ((look: Look) => boolean) | 'press';
}

export type LessonId = 'sound' | 'song';

export interface Lesson {
  title: string;
  steps: TourStep[];
}

const sound = ({ state }: Look): Sound | undefined =>
  state.project.channels.find((c) => c.id === state.channelId)?.sound;
const effect = (look: Look, type: string) => sound(look)?.chain.find((m) => m.type === type);
const block = ({ state }: Look): Pattern => state.project.patterns.find((p) => p.id === state.patternId)!;

/** The steps of the current block in the row of the sound with this name. */
function row(look: Look, name: string): Step[] {
  const channel = look.state.project.channels.find((c) => c.sound.name === name);
  return channel ? Object.values(block(look).cells[channel.id] ?? {}) : [];
}

/** A block's steps as text, so that two blocks can be compared. */
const stepsText = (pattern: Pattern) =>
  Object.entries(pattern.cells)
    .flatMap(([channel, steps]) => Object.entries(steps).map(([i, s]) => `${channel}:${i}:${s.note}:${s.len}:${s.vel}`))
    .sort()
    .join(' ');

function layered({ state }: Look): boolean {
  const song = state.project.song;
  return song.some((a) => song.some((b) => a.lane !== b.lane && a.bar < b.bar + b.bars && b.bar < a.bar + a.bars));
}

const MAKE_A_SOUND: TourStep[] = [
  {
    title: 'The Factory',
    text: 'This is the Factory, where sounds are made. A sound is a rack of units read from top to bottom: '
      + 'the first one makes a tone and every unit below it changes that tone a little. In this tutorial you build '
      + 'a short, plucky bass from nothing.',
    view: 'factory',
  },
  {
    title: 'A new sound',
    text: 'Press New... and pick Oscillator under New, then press Add to Track. An oscillator is the simplest '
      + 'source there is: a tone that keeps going at the pitch of the key you press.',
    target: 'new-sound',
    view: 'factory',
    done: (look) => !!sound(look) && !look.start.channels.some((c) => c.id === look.state.channelId),
  },
  {
    title: 'Play it',
    text: 'Click the keys of the piano at the bottom, or press A, S, D and F on your computer keyboard. What you '
      + 'hear is a raw sawtooth wave: bright, buzzy, and steady for as long as you hold the key.',
    target: 'keyboard',
    view: 'factory',
    done: 'press',
  },
  {
    title: 'The wave',
    text: 'The wave is the basic shape of the tone, and the shape decides its colour. Click the square wave, the '
      + 'last button under Wave: it sounds hollow and woody, a classic for bass lines. Hold a key and watch the '
      + 'scope next to the piano; it draws the wave you hear.',
    target: 'unit-source',
    view: 'factory',
    done: (look) => sound(look)?.source.params.wave === 'square',
  },
  {
    title: 'The amp envelope',
    text: 'The amp envelope shapes how loud a note is from the moment the key goes down until it fades away. '
      + 'Drag the Sustain knob all the way down. Each note now falls away by itself over the Decay time, and that '
      + 'quick fall is what makes a pluck.',
    target: 'unit-amp',
    view: 'factory',
    done: (look) => Number(sound(look)?.amp.sustain ?? 1) <= 0.1,
  },
  {
    title: 'A filter',
    text: 'A filter takes part of the sound away. A low pass filter lets the low notes through and dulls the '
      + 'bright top, a bit like a hand over the speaker. Press Effect and choose Filter.',
    target: 'add-effect',
    view: 'factory',
    done: (look) => !!effect(look, 'filter'),
  },
  {
    title: 'The cutoff',
    text: 'Cutoff is where the filter starts to cut. Turn it down to about 300 Hz and play a few notes: the sound '
      + 'goes dark and round. Press Shaping at the right of the unit for more: a little Reso adds a whistle right '
      + 'at the cutoff.',
    target: 'unit-filter',
    view: 'factory',
    done: (look) => Number(effect(look, 'filter')?.params.cutoff ?? Infinity) <= 600,
  },
  {
    title: 'A modulator',
    text: 'A modulator turns a knob for you. An envelope turns it once on every note, an LFO back and forth in a '
      + 'loop. Press Modulator and choose Envelope.',
    target: 'add-modulator',
    view: 'factory',
    done: (look) => (sound(look)?.mods.length ?? 0) > 0,
  },
  {
    title: 'Point it at the cutoff',
    text: 'Set the Target of the envelope to Filter · Cutoff. Now every note opens the filter for a moment and '
      + 'closes it again, which gives the bass its snappy start. Amount sets how far it opens.',
    target: 'unit-mod',
    view: 'factory',
    done: (look) => {
      const filter = effect(look, 'filter');
      return !!filter && !!sound(look)?.mods.some((m) => m.target?.module === filter.id && m.target.param === 'cutoff');
    },
  },
  {
    title: 'Some room',
    text: 'Echo and reverb put a sound in a room. Delay repeats each note a little later and a little quieter; '
      + 'Reverb adds the soft tail of a hall. Press Effect and choose one of them, and turn its Mix down if it '
      + 'blurs the notes.',
    target: 'add-effect',
    view: 'factory',
    done: (look) => !!effect(look, 'delay') || !!effect(look, 'reverb'),
  },
  {
    title: 'A name',
    text: 'Click the name at the top and type a new one, Pluck Bass for example. The Track and the library show '
      + 'your sound by this name.',
    target: 'sound-name',
    view: 'factory',
    done: (look) => {
      const name = sound(look)?.name.trim();
      return !!name && !SOURCES.some((s) => s.label === name);
    },
  },
  {
    title: 'Keep it',
    text: 'Press Save to Library. Your sound is kept in the library folder from now on, and New... offers it to '
      + 'every project you make.',
    target: 'save-sound',
    view: 'factory',
    done: 'press',
  },
  {
    title: 'Your own sound',
    text: 'That is a whole sound, from the first wave to the last echo. It is already a row on the Track, ready '
      + 'for a bass line; the Make a Song tutorial in the Help menu shows how to write one.',
  },
];

const MAKE_A_SONG: TourStep[] = [
  {
    title: 'The Track',
    text: 'This is the Track. Every row is a sound and every column a sixteenth note; four columns make a beat. '
      + 'What you write here is a block, a short loop that you arrange into a song later.',
    target: 'grid',
    view: 'track',
  },
  {
    title: 'A kick drum',
    text: 'Click the first cell of every beat in the Kick row: columns 1, 5, 9 and 13. Press Space to hear the '
      + 'loop, and Space again to stop it.',
    target: 'row-Kick',
    view: 'track',
    done: (look) => row(look, 'Kick').length >= 4,
  },
  {
    title: 'Snare and hats',
    text: 'Put a Snare on columns 5 and 13, and a Hat in some of the empty columns in between. Hold the button '
      + 'down and move sideways to paint several cells at once.',
    target: 'grid',
    view: 'track',
    done: (look) => row(look, 'Snare').length > 0 && row(look, 'Hat').length > 0,
  },
  {
    title: 'A bass note',
    text: 'Click a cell in the Sub Bass row, then drag the step up or down to change its note. The bar under the '
      + 'grid tells you which note it is.',
    target: 'row-Sub Bass',
    view: 'track',
    done: (look) => row(look, 'Sub Bass').some((s) => s.note !== 60),
  },
  {
    title: 'A longer note',
    text: 'Drag the right edge of a bass step to the right to hold the note longer. A step can stretch across as '
      + 'many columns as you like.',
    target: 'row-Sub Bass',
    view: 'track',
    done: (look) => row(look, 'Sub Bass').some((s) => s.len > 1),
  },
  {
    title: 'A second block',
    text: 'A song is made of blocks. Press Copy to make block B, a copy of this one, to turn into a variation.',
    target: 'copy-block',
    view: 'track',
    done: (look) => look.state.project.patterns.length > look.start.patterns.length,
  },
  {
    title: 'A variation',
    text: 'The grid now shows block B. Change it a little: take out a kick, move the bass note, add a few hats. '
      + 'Small changes like these keep a song moving.',
    target: 'grid',
    view: 'track',
    done: (look) => {
      const current = block(look);
      const others = look.state.project.patterns.filter((p) => p !== current);
      return others.length > 0 && others.every((p) => stepsText(p) !== stepsText(current));
    },
  },
  {
    title: 'The Song',
    text: 'Now the blocks go in order. Click the Song tab.',
    target: 'tab-song',
    view: 'track',
    done: (look) => look.state.view === 'song',
  },
  {
    title: 'Place the blocks',
    text: 'Pick A in the list at the left and click the first bar of lane 1 to place it there. Then pick B and '
      + 'click the bar right after A.',
    target: 'timeline',
    view: 'song',
    done: (look) => new Set(look.state.project.song.map((p) => p.pattern)).size >= 2,
  },
  {
    title: 'Stretch a block',
    text: 'Drag the right edge of a placed block to make it longer. A block placed longer than itself plays again '
      + 'from the start, so a one-bar block can fill four bars.',
    target: 'timeline',
    view: 'song',
    done: ({ state }) =>
      state.project.song.some((s) => s.bars > state.project.patterns.find((p) => p.id === s.pattern)!.bars),
  },
  {
    title: 'Layers',
    text: 'Blocks in different lanes play at the same time. Place a block in lane 2 under one in lane 1, and the '
      + 'two sound together.',
    target: 'timeline',
    view: 'song',
    done: layered,
  },
  {
    title: 'Listen',
    text: 'Press Play, or Space. In the Song view Play plays the whole song from the start, every lane at once.',
    target: 'play',
    view: 'song',
    done: (look) => look.state.playing,
  },
  {
    title: 'Export',
    text: 'Choose Export Audio... in the File menu to turn the song into a WAV or MP3 file that any music player '
      + 'can open.',
    target: 'menu-file',
    view: 'song',
    done: (look) => look.dialog?.kind === 'export',
  },
  {
    title: 'Your first song',
    text: 'That is a song: a beat, a bass line, a variation and an arrangement. Add more blocks and sounds from '
      + 'the libraries, or build sounds of your own with the Make a Sound tutorial in the Help menu.',
  },
];

export const LESSONS: Readonly<Record<LessonId, Lesson>> = {
  sound: { title: 'Make a Sound', steps: MAKE_A_SOUND },
  song: { title: 'Make a Song', steps: MAKE_A_SONG },
};
