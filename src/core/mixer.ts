// The mixer's controls: what a channel sends to the two buses, its ducking, and the buses' faders. Sends, bus
// faders and the bus racks are Basics; ducking and the master rack are Shaping.

import type { Level } from './levels';
import type { FloatSpec } from './modules';
import type { Mixer, ModuleInst } from './types';

/** An effect rack of the mixer: a send bus by its index, or the master. */
export type MixerRack = 0 | 1 | 'master';
/** Whose modules: a sound, by its channel id, or an effect rack of the mixer. */
export type Owner = string | { rack: MixerRack };

export const MASTER_RACK_LEVEL: Level = 2;
export const BUS_LETTERS = ['A', 'B'] as const;
export const MAX_BUS_NAME = 12;

export const SEND: FloatSpec = { kind: 'float', id: 'send', label: 'Send', min: 0, max: 1, def: 0, unit: '%' };

export const BUS_LEVEL: FloatSpec = {
  kind: 'float', id: 'level', label: 'Level', min: -48, max: 6, def: 0, unit: 'dB', step: 0.1,
};

export const DUCK_AMOUNT: FloatSpec = {
  kind: 'float', id: 'amount', label: 'Amount', min: 0, max: 1, def: 0.5, unit: '%', level: 2,
};

export const DUCK_RELEASE: FloatSpec = {
  kind: 'float', id: 'release', label: 'Release', min: 0.02, max: 4, def: 0.25, unit: 's', taper: 'log', level: 2,
};

export function rackChain(mixer: Mixer, rack: MixerRack): ModuleInst[] {
  return rack === 'master' ? mixer.master.chain : mixer.buses[rack].chain;
}
