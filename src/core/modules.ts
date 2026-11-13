// Module definitions: the parameters of every source, effect and modulator.
// The audio engine, the file format and the interface are all driven by this table,
// so a new module starts here (and gets its audio in src/audio/modules).

import type { Levelled } from './levels';
import type { ModTarget, Sound } from './types';

export type Taper = 'lin' | 'log' | 'cube';
export type Unit = 'Hz' | 's' | 'dB' | '%' | 'st' | 'ct' | 'x' | 'pan' | '';

/** How a float parameter responds to a modulator. */
export interface ModSpec {
  depth: number; // change of the underlying AudioParam, in its own unit, at amount 1 and modulator output 1
  span: number; // the same change in display units
  unit: string; // label of the display unit
}

export interface FloatSpec extends Levelled {
  kind: 'float';
  id: string;
  label: string;
  min: number;
  max: number;
  def: number;
  taper?: Taper; // how a knob travels from min to max, linear when absent
  unit?: Unit;
  step?: number;
  mod?: ModSpec; // present when the parameter can be a modulation target
}

export interface ChoiceSpec extends Levelled {
  kind: 'choice';
  id: string;
  label: string;
  options: readonly (readonly [value: string, label: string])[];
  def: string;
}

export interface BoolSpec extends Levelled {
  kind: 'bool';
  id: string;
  label: string;
  def: boolean;
}

/** Holds a sample id (a key of Project.samples), or '' when no sample is loaded. */
export interface SampleSpec extends Levelled {
  kind: 'sample';
  id: string;
  label: string;
}

export type ParamSpec = FloatSpec | ChoiceSpec | BoolSpec | SampleSpec;
export type ModuleKind = 'source' | 'amp' | 'effect' | 'mod' | 'out';

/** A module and each of its parameters have a level (src/core/levels.ts), Basics when not given. */
export interface ModuleDef extends Levelled {
  type: string;
  kind: ModuleKind;
  label: string;
  params: readonly ParamSpec[];
}

const f = (id: string, label: string, min: number, max: number, def: number, extra: Partial<FloatSpec> = {}): FloatSpec => ({
  kind: 'float',
  id,
  label,
  min,
  max,
  def,
  ...extra,
});
const c = (id: string, label: string, options: ChoiceSpec['options'], def = options[0][0]): ChoiceSpec => ({
  kind: 'choice',
  id,
  label,
  options,
  def,
});
const b = (id: string, label: string, def: boolean): BoolSpec => ({ kind: 'bool', id, label, def });
const shaping = <T extends ParamSpec>(spec: T): T => ({ ...spec, level: 2 });
const deep = <T extends ParamSpec>(spec: T): T => ({ ...spec, level: 3 });

const percent: ModSpec = { depth: 1, span: 100, unit: '%' };
const pitch = f('pitch', 'Pitch', -24, 24, 0, { unit: 'st', step: 1, mod: { depth: 4800, span: 48, unit: 'st' } });
const fine = shaping(f('fine', 'Fine', -100, 100, 0, { unit: 'ct', step: 1 }));
const adsr = (attack: number, decay: number, sustain: number, release: number): FloatSpec[] => [
  f('attack', 'Attack', 0, 5, attack, { unit: 's', taper: 'cube' }),
  f('decay', 'Decay', 0, 5, decay, { unit: 's', taper: 'cube' }),
  f('sustain', 'Sustain', 0, 1, sustain, { unit: '%' }),
  f('release', 'Release', 0, 10, release, { unit: 's', taper: 'cube' }),
];
// Values are Web Audio OscillatorType names.
const WAVES = [
  ['sine', 'Sine'],
  ['triangle', 'Triangle'],
  ['sawtooth', 'Saw'],
  ['square', 'Square'],
] as const;

export const SOURCES: readonly ModuleDef[] = [
  {
    type: 'osc',
    kind: 'source',
    label: 'Oscillator',
    params: [
      c('wave', 'Wave', WAVES, 'sawtooth'),
      pitch,
      fine,
      shaping(f('voices', 'Voices', 1, 7, 1, { step: 1 })),
      shaping(f('spread', 'Spread', 0, 100, 15, { unit: 'ct' })),
      deep(f('width', 'Width', 0, 1, 0.5, { unit: '%' })),
      shaping(f('noise', 'Noise', 0, 1, 0, { unit: '%' })),
    ],
  },
  {
    type: 'fm',
    kind: 'source',
    label: 'FM Pair',
    level: 2,
    params: [
      pitch,
      fine,
      deep(f('ratio', 'Ratio', 0.25, 16, 2, { taper: 'log', unit: 'x', step: 0.01 })),
      f('amount', 'Amount', 0, 12, 2, { taper: 'cube', mod: { depth: 12, span: 12, unit: '' } }),
    ],
  },
  {
    type: 'noise',
    kind: 'source',
    label: 'Noise',
    params: [
      c('color', 'Color', [
        ['white', 'White'],
        ['pink', 'Pink'],
        ['brown', 'Brown'],
      ]),
    ],
  },
  {
    type: 'sample',
    kind: 'source',
    label: 'Sampler',
    params: [
      { kind: 'sample', id: 'sample', label: 'Sample' },
      pitch,
      fine,
      f('start', 'Start', 0, 1, 0, { unit: '%' }),
      f('end', 'End', 0, 1, 1, { unit: '%' }),
      shaping(b('loop', 'Loop', false)),
      shaping(b('reverse', 'Reverse', false)),
      deep(
        c('mode', 'Play', [
          ['oneshot', 'One shot'],
          ['gate', 'Gate'],
        ]),
      ),
    ],
  },
];

export const AMP: ModuleDef = { type: 'amp', kind: 'amp', label: 'Amp Envelope', params: adsr(0.002, 0.3, 0.8, 0.2) };

export const EFFECTS: readonly ModuleDef[] = [
  {
    type: 'filter',
    kind: 'effect',
    label: 'Filter',
    params: [
      c('mode', 'Mode', [
        ['lowpass', 'Low pass'],
        ['highpass', 'High pass'],
        ['bandpass', 'Band pass'],
      ]),
      f('cutoff', 'Cutoff', 20, 20000, 2000, { taper: 'log', unit: 'Hz', mod: { depth: 6000, span: 5, unit: 'oct' } }),
      shaping(f('reso', 'Reso', 0, 1, 0.15, { unit: '%' })),
    ],
  },
  {
    type: 'drive',
    kind: 'effect',
    label: 'Drive',
    level: 2,
    params: [
      shaping(
        c('shape', 'Shape', [
          ['soft', 'Soft'],
          ['hard', 'Hard'],
          ['fold', 'Fold'],
        ]),
      ),
      f('amount', 'Amount', 0, 1, 0.3, { unit: '%' }),
      shaping(f('tone', 'Tone', 200, 20000, 12000, { taper: 'log', unit: 'Hz' })),
      f('mix', 'Mix', 0, 1, 1, { unit: '%' }),
    ],
  },
  {
    type: 'delay',
    kind: 'effect',
    label: 'Delay',
    params: [
      c(
        'sync',
        'Sync',
        [
          ['free', 'Free'],
          ['1/2', '1/2'],
          ['1/4', '1/4'],
          ['1/8d', '1/8 dotted'],
          ['1/8', '1/8'],
          ['1/8t', '1/8 triplet'],
          ['1/16d', '1/16 dotted'],
          ['1/16', '1/16'],
          ['1/32', '1/32'],
        ],
        '1/8d',
      ),
      shaping(f('time', 'Time', 0.001, 2, 0.3, { taper: 'log', unit: 's', mod: { depth: 0.02, span: 20, unit: 'ms' } })),
      shaping(f('feedback', 'Feedback', 0, 0.95, 0.4, { unit: '%' })),
      shaping(f('tone', 'Tone', 200, 20000, 4000, { taper: 'log', unit: 'Hz' })),
      shaping(b('pingpong', 'Ping pong', false)),
      f('mix', 'Mix', 0, 1, 0.3, { unit: '%', mod: percent }),
    ],
  },
  {
    type: 'reverb',
    kind: 'effect',
    label: 'Reverb',
    params: [
      f('size', 'Size', 0.2, 10, 2, { taper: 'log', unit: 's' }),
      shaping(f('tone', 'Tone', 500, 20000, 6000, { taper: 'log', unit: 'Hz' })),
      f('mix', 'Mix', 0, 1, 0.25, { unit: '%', mod: percent }),
    ],
  },
];

export const MODS: readonly ModuleDef[] = [
  { type: 'env', kind: 'mod', label: 'Envelope', params: adsr(0, 0.2, 0, 0.2) },
  {
    type: 'lfo',
    kind: 'mod',
    label: 'LFO',
    params: [c('wave', 'Wave', WAVES, 'sine'), f('rate', 'Rate', 0.02, 40, 2, { taper: 'log', unit: 'Hz' })],
  },
];

export const OUT: ModuleDef = {
  type: 'out',
  kind: 'out',
  label: 'Output',
  params: [
    // The bottom of the range (-48 dB) is silence.
    f('level', 'Level', -48, 6, -6, { unit: 'dB', mod: percent }),
    f('pan', 'Pan', -1, 1, 0, { unit: 'pan', mod: percent }),
  ],
};

export const MODULES: Readonly<Record<string, ModuleDef>> = Object.fromEntries(
  [...SOURCES, AMP, ...EFFECTS, ...MODS, OUT].map((d) => [d.type, d]),
);

/** Length of a tempo-synced delay time in beats (quarter notes). */
export const SYNC_BEATS: Readonly<Record<string, number>> = {
  '1/2': 2,
  '1/4': 1,
  '1/8d': 0.75,
  '1/8': 0.5,
  '1/8t': 1 / 3,
  '1/16d': 0.375,
  '1/16': 0.25,
  '1/32': 0.125,
};

/** The definition behind a module id of a sound ("source", "amp", "out", or a chain or modulator id). */
export function moduleDef(sound: Sound, moduleId: string): ModuleDef | undefined {
  if (moduleId === 'source') return MODULES[sound.source.type];
  if (moduleId === 'amp') return AMP;
  if (moduleId === 'out') return OUT;
  const inst = sound.chain.find((m) => m.id === moduleId) ?? sound.mods.find((m) => m.id === moduleId);
  return inst && MODULES[inst.type];
}

export function paramSpec(def: ModuleDef, paramId: string): ParamSpec | undefined {
  return def.params.find((p) => p.id === paramId);
}

/** Every parameter of a sound that a modulator can be pointed at, in signal order. */
export function modTargets(sound: Sound): (ModTarget & { label: string })[] {
  const ids = ['source', ...sound.chain.map((m) => m.id), 'out'];
  const seen: Record<string, number> = {};
  return ids.flatMap((module) => {
    const def = moduleDef(sound, module);
    if (!def) return [];
    const n = (seen[def.type] = (seen[def.type] ?? 0) + 1);
    const name = def.kind === 'source' ? 'Source' : n > 1 ? `${def.label} ${n}` : def.label;
    return def.params
      .filter((p) => p.kind === 'float' && p.mod)
      .map((p) => ({ module, param: p.id, label: `${name} · ${p.label}` }));
  });
}
