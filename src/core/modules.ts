// Module definitions: the parameters of every source, effect and modulator.
// The audio engine, the file format and the interface are all driven by this table,
// so a new module starts here (and gets its audio in src/audio/modules).

import type { Levelled } from './levels';
import type { ModInst, ModTarget, Sound } from './types';

export type Taper = 'lin' | 'log' | 'cube';
export type Unit = 'Hz' | 's' | 'dB' | '%' | 'st' | 'ct' | 'oct' | 'x' | 'pan' | '';

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
export type ModuleKind = 'source' | 'play' | 'filter' | 'amp' | 'effect' | 'mod' | 'out';

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
const cutoff = f('cutoff', 'Cutoff', 20, 20000, 2000, {
  taper: 'log', unit: 'Hz', mod: { depth: 6000, span: 5, unit: 'oct' },
});
const filterModes = c('mode', 'Mode', [
  ['lowpass', 'Low pass'],
  ['highpass', 'High pass'],
  ['bandpass', 'Band pass'],
]);
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
      // The pulse width of every square oscillator of the voice; the duty cycle moves by up to 50 % at amount 1.
      shaping(f('pw', 'Pulse', 0.05, 0.95, 0.5, { unit: '%', mod: { depth: 0.5, span: 50, unit: '%' } })),
      shaping(c('wave2', 'Wave 2', WAVES, 'sawtooth')),
      shaping(f('pitch2', 'Pitch 2', -24, 24, 0, { unit: 'st', step: 1 })),
      shaping(f('fine2', 'Fine 2', -100, 100, 0, { unit: 'ct', step: 1 })),
      shaping(f('mix2', 'Mix 2', 0, 1, 0, { unit: '%' })),
      shaping(f('sub', 'Sub', 0, 1, 0, { unit: '%' })),
      shaping(f('subOct', 'Sub Oct', -2, -1, -1, { unit: 'oct', step: 1 })),
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

/** How the notes of a sound follow each other; shown in the Source unit. */
export const PLAY: ModuleDef = {
  type: 'play',
  kind: 'play',
  label: 'Play',
  params: [
    shaping(
      c('mode', 'Mode', [
        ['poly', 'Poly'],
        ['mono', 'Mono'],
        ['legato', 'Legato'],
      ]),
    ),
    shaping(f('glide', 'Glide', 0, 2, 0, { unit: 's', taper: 'cube' })),
  ],
};

/** The filter inside every note, between the source and the amp. `on` is its lamp, not a control. */
export const FILTER: ModuleDef = {
  type: 'voicefilter',
  kind: 'filter',
  label: 'Filter',
  params: [
    b('on', 'On', false),
    filterModes,
    cutoff,
    f('reso', 'Reso', 0, 1, 0.15, { unit: '%' }),
    shaping(
      c('slope', 'Slope', [
        ['12', '12 dB'],
        ['24', '24 dB'],
      ]),
    ),
    shaping(f('drive', 'Drive', 0, 1, 0, { unit: '%' })),
    deep(f('key', 'Key', 0, 1, 0, { unit: '%' })),
    deep(f('vel', 'Velocity', -1, 1, 0, { unit: '%' })),
  ],
};

export const AMP: ModuleDef = { type: 'amp', kind: 'amp', label: 'Amp Envelope', params: adsr(0.002, 0.3, 0.8, 0.2) };

export const EFFECTS: readonly ModuleDef[] = [
  {
    type: 'filter',
    kind: 'effect',
    label: 'Filter (whole sound)',
    level: 2,
    params: [filterModes, cutoff, shaping(f('reso', 'Reso', 0, 1, 0.15, { unit: '%' }))],
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

// How much a per-note modulator's amount follows the note's velocity.
const modVel = deep(f('vel', 'Velocity', 0, 1, 0, { unit: '%' }));

export const MODS: readonly ModuleDef[] = [
  { type: 'env', kind: 'mod', label: 'Envelope', params: [...adsr(0, 0.2, 0, 0.2), modVel] },
  {
    type: 'lfo',
    kind: 'mod',
    label: 'LFO',
    params: [c('wave', 'Wave', WAVES, 'sine'), f('rate', 'Rate', 0.02, 40, 2, { taper: 'log', unit: 'Hz' }), modVel],
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
  [...SOURCES, PLAY, FILTER, AMP, ...EFFECTS, ...MODS, OUT].map((d) => [d.type, d]),
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

/** The fixed units by their module id in a sound. */
const FIXED: Readonly<Record<string, ModuleDef>> = { play: PLAY, filter: FILTER, amp: AMP, out: OUT };

/** The definition behind a module id of a sound: "source", a fixed unit, or a chain or modulator id. */
export function moduleDef(sound: Sound, moduleId: string): ModuleDef | undefined {
  if (moduleId === 'source') return MODULES[sound.source.type];
  if (Object.hasOwn(FIXED, moduleId)) return FIXED[moduleId];
  const inst = sound.chain.find((m) => m.id === moduleId) ?? sound.mods.find((m) => m.id === moduleId);
  return inst && MODULES[inst.type];
}

export function paramSpec(def: ModuleDef, paramId: string): ParamSpec | undefined {
  return def.params.find((p) => p.id === paramId);
}

/** The modules built inside every note; only their parameters can be moved by a per-note modulator. */
export const inVoice = (moduleId: string) => moduleId === 'source' || moduleId === 'filter';

/** Whether a modulator is built for each note: it is set to and its target lives in the voice. */
export const perNote = (mod: ModInst) => mod.per === 'note' && !!mod.target && inVoice(mod.target.module);

/** Every parameter of a sound that a modulator can be pointed at, in signal order. */
export function modTargets(sound: Sound): (ModTarget & { label: string })[] {
  const ids = ['source', 'filter', ...sound.chain.map((m) => m.id), 'out'];
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
