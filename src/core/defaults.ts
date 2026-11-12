// Fresh documents: ids, an empty sound, an empty pattern, an empty project.

import { AMP, MODULES, OUT } from './modules';
import { defaultParams } from './params';
import type { ModInst, ModuleInst, Pattern, Project, Sound, Step } from './types';

export const STEPS_PER_BAR = 16;
export const MAX_BARS = 8;
export const CHANNEL_COLORS = 8;
export const PATTERN_NAMES = 'ABCDEFGH';

/** A short random id, e.g. "c_k3f9x2a1". */
export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
}

export function newModule(type: string): ModuleInst {
  return { id: uid('m'), type, params: defaultParams(MODULES[type]), on: true };
}

export function newMod(type: string): ModInst {
  return { ...newModule(type), target: null, amount: 0.5 };
}

export function newSound(sourceType = 'osc', name = 'New Sound'): Sound {
  return {
    name,
    source: { id: 'source', type: sourceType, params: defaultParams(MODULES[sourceType]) },
    amp: defaultParams(AMP),
    chain: [],
    mods: [],
    out: defaultParams(OUT),
  };
}

export function newStep(note = 60): Step {
  return { note, vel: 0.8, len: 1 };
}

export function newPattern(name: string): Pattern {
  return { id: uid('p'), name, bars: 1, cells: {} };
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
    song: [pattern.id],
    samples: {},
  };
}
