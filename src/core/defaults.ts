// Fresh documents: ids, an empty sound, an empty block, an empty project.

import { DUCK_AMOUNT, DUCK_RELEASE } from './mixer';
import { AMP, FILTER, MODULES, OUT, PLAY } from './modules';
import { defaultParams } from './params';
import type {
  Channel, Duck, Lane, Mixer, ModInst, ModuleInst, NoteInit, Params, Pattern, Project, Sound,
} from './types';

/** 96 ticks to a quarter note: a 32nd is 12 ticks, a sixteenth triplet 16. */
export const TICKS_PER_STEP = 24;
export const MAX_BARS = 32;
export const CHANNEL_COLORS = 8;
export const SONG_LANES = 4;
export const MAX_SONG_BARS = 256;
/** Default block names; a project holds at most this many blocks. */
export const PATTERN_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A short random id, e.g. "c_k3f9x2a1". */
export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
}

export function newModule(type: string): ModuleInst {
  return { id: uid('m'), type, params: defaultParams(MODULES[type]), on: true };
}

/** A module for a send bus: one with a Mix starts fully wet, since the dry sound already reaches the master. */
export function newBusModule(type: string, params: Params = {}): ModuleInst {
  const module = newModule(type);
  if (typeof module.params.mix === 'number') module.params.mix = 1;
  Object.assign(module.params, params);
  return module;
}

/** The buses of a new project: a room and an echo, both fully wet, and nothing on the master. */
export function defaultMixer(): Mixer {
  return {
    buses: [
      { name: 'Room', chain: [newBusModule('reverb', { size: 2.5, tone: 5000 })], level: 0, mute: false },
      {
        name: 'Echo',
        chain: [newBusModule('delay', { sync: '1/8d', feedback: 0.35, tone: 3000, pingpong: true })],
        level: 0,
        mute: false,
      },
    ],
    master: { chain: [] },
  };
}

export function newDuck(): Duck {
  return { source: null, amount: DUCK_AMOUNT.def, release: DUCK_RELEASE.def };
}

/** A channel as a new sound gets it: heard, sending nothing to the buses and not ducking. */
export function newChannel(id: string, sound: Sound, color: number): Channel {
  return { id, sound, color, mute: false, solo: false, sends: [0, 0], duck: newDuck() };
}

/** A new envelope works on each note, a new LFO on the whole sound. */
export function newMod(type: string): ModInst {
  return { ...newModule(type), per: type === 'env' ? 'note' : 'sound', target: null, amount: 0.5 };
}

export function newSound(sourceType = 'osc', name = 'New Sound'): Sound {
  return {
    name,
    source: { id: 'source', type: sourceType, params: defaultParams(MODULES[sourceType]) },
    play: defaultParams(PLAY),
    filter: defaultParams(FILTER),
    amp: defaultParams(AMP),
    chain: [],
    mods: [],
    out: defaultParams(OUT),
  };
}

/** A note one step long at `start` ticks, as the grid and the computer keyboard write it. */
export function newNote(start = 0, note = 60): NoteInit {
  return { start, len: TICKS_PER_STEP, note, vel: 0.8 };
}

export function newPattern(name: string, color = 0): Pattern {
  return { id: uid('p'), name, color, bars: 1, notes: {} };
}

/** The lanes of a new song: each at 0 dB and playing. */
export function newLanes(): Lane[] {
  return Array.from({ length: SONG_LANES }, () => ({ level: 0, mute: false }));
}

export function emptyProject(): Project {
  const pattern = newPattern('A');
  return {
    name: 'Untitled',
    bpm: 120,
    swing: 0,
    meter: [4, 4],
    master: 0,
    mixer: defaultMixer(),
    channels: [],
    patterns: [pattern],
    song: [],
    lanes: newLanes(),
    samples: {},
  };
}
