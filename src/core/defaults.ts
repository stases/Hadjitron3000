// Fresh documents: ids, an empty sound, an empty block, an empty project.

import { AMP, FILTER, MODULES, OUT, PLAY } from './modules';
import { defaultParams } from './params';
import type { ModInst, ModuleInst, NoteInit, Pattern, Project, Sound } from './types';

export const STEPS_PER_BAR = 16;
/** 96 ticks to a quarter note: a 32nd is 12 ticks, a sixteenth triplet 16. */
export const TICKS_PER_STEP = 24;
export const MAX_BARS = 32;
/** The length of the longest block in ticks; no note starts at or after it. */
export const MAX_TICKS = MAX_BARS * STEPS_PER_BAR * TICKS_PER_STEP;
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

export function emptyProject(): Project {
  const pattern = newPattern('A');
  return {
    name: 'Untitled',
    bpm: 120,
    swing: 0,
    master: 0,
    channels: [],
    patterns: [pattern],
    song: [],
    samples: {},
  };
}
