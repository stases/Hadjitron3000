// Making the examples of the Guide Book in code: sounds from a factory sound or from nothing, notes, blocks and
// whole projects. Ids are fixed, so an example sounds the same every time it is made, chances included.

import { TICKS_PER_STEP, emptyProject, newChannel, newLanes, newMod, newModule, newSound } from '../../core/defaults';
import type { Meter, ModInst, Note, Params, Pattern, Placement, Project, Scale, Sound } from '../../core/types';
import { preset } from '../../presets';
import { factoryId, factorySample } from '../../presets/samples';
import type { Example } from './pages';

/** A modulator: its type, its target as [module, parameter] (an effect by its place in the chain, fx1 on), amount. */
export type ModSpec = [type: string, target: [module: string, param: string], amount: number, params?: Params,
  per?: ModInst['per']];

export interface SoundSpec {
  name: string;
  /** A factory sound to start from; a new oscillator when absent. */
  from?: string;
  source?: string;
  src?: Params;
  play?: Params;
  filter?: Params;
  amp?: Params;
  out?: Params;
  /** The effects in order, in place of those of `from`; fx1, fx2 and so on to modulators. */
  fx?: readonly [type: string, params?: Params][];
  /** The modulators, in place of those of `from`. */
  mods?: readonly ModSpec[];
}

/** A sound made from a spec. */
export function makeSound(spec: SoundSpec): Sound {
  const sound = spec.from ? preset(spec.from) : newSound(spec.source ?? 'osc');
  sound.name = spec.name;
  // A new cloud of grains starts on the factory pad, as it does in the Sound Library.
  if (sound.source.type === 'grains' && !sound.source.params.sample) sound.source.params.sample = factoryId('pad');
  Object.assign(sound.source.params, spec.src);
  Object.assign(sound.play, spec.play);
  Object.assign(sound.filter, spec.filter);
  Object.assign(sound.amp, spec.amp);
  Object.assign(sound.out, spec.out);
  if (spec.fx) {
    sound.chain = spec.fx.map(([type, params], i) => {
      const module = newModule(type);
      return { ...module, id: `fx${i + 1}`, params: { ...module.params, ...params } };
    });
  }
  if (spec.mods) {
    sound.mods = spec.mods.map(([type, [module, param], amount, params, per], i) => {
      const mod = newMod(type);
      return { ...mod, id: `mod${i + 1}`, per: per ?? mod.per, target: { module, param }, amount,
        params: { ...mod.params, ...params } };
    });
  }
  return sound;
}

/** Notes from [step, note, length in steps, velocity], one step long at 0.8 when not given. */
export function notes(rows: readonly (readonly [number, number, number?, number?])[]): Note[] {
  return rows.map(([step, note, len = 1, vel = 0.8], i) => ({
    id: `n${i}`, start: Math.round(step * TICKS_PER_STEP), len: Math.round(len * TICKS_PER_STEP), note, vel,
  }));
}

/** Several lists of notes as one row, numbered afresh so their ids stay apart. */
export function join(...rows: Note[][]): Note[] {
  return rows.flat().map((n, i) => ({ ...n, id: `n${i}` }));
}

/** Drum hits from a string of steps: x a hit, X an accent, o a ghost note, any other character a rest. */
export function hits(row: string, note = 60): Note[] {
  const vel: Record<string, number> = { x: 0.8, X: 1, o: 0.4 };
  return notes([...row].flatMap((ch, i) => (vel[ch] ? [[i, note, 1, vel[ch]] as const] : [])));
}

/** Notes of a note-to-step map with extras, such as an acid line's slides. */
export function withExtras(list: Note[], extras: Record<number, Partial<Note>>): Note[] {
  return list.map((n) => ({ ...n, ...extras[n.start / TICKS_PER_STEP] }));
}

export interface BlockSpec {
  name: string;
  bars: number;
  color?: number;
  /** The notes of each sound, by its name. */
  rows: Record<string, Note[]>;
  /** Rows of their own length, in steps, by sound name. */
  loops?: Record<string, number>;
}

export interface ProjectSpec {
  name: string;
  bpm?: number;
  swing?: number;
  meter?: Meter;
  scale?: Scale;
  master?: number;
  sounds: readonly Sound[];
  blocks: readonly BlockSpec[];
  /** Placements: [block, lane, first bar, bars, fade in, fade out]. */
  song?: readonly (readonly [block: string, lane: number, bar: number, bars: number, fadeIn?: number,
    fadeOut?: number])[];
  /** Sends to the Room and the Echo, by sound name. */
  sends?: Record<string, [number, number]>;
  /** Ducking, by sound name: [the sound that pushes it down, amount, release]. */
  ducks?: Record<string, [string, number, number]>;
  /** Lane levels in dB, from lane 1. */
  lanes?: readonly number[];
}

/** A project made from a spec. Sounds are named; blocks and the song refer to them by name. */
export function makeProject(spec: ProjectSpec): Project {
  const channels = spec.sounds.map((sound, i) => newChannel(`c${i}`, sound, i % 8));
  const id = (name: string) => {
    const channel = channels.find((c) => c.sound.name === name);
    if (!channel) throw new Error(`${spec.name}: there is no sound called ${name}`);
    return channel.id;
  };
  for (const [name, sends] of Object.entries(spec.sends ?? {})) channels.find((c) => c.id === id(name))!.sends = sends;
  for (const [name, [source, amount, release]] of Object.entries(spec.ducks ?? {})) {
    channels.find((c) => c.id === id(name))!.duck = { source: id(source), amount, release };
  }
  const patterns: Pattern[] = spec.blocks.map((b, i) => ({
    id: `p${i}`,
    name: b.name,
    color: b.color ?? i % 8,
    bars: b.bars,
    notes: Object.fromEntries(Object.entries(b.rows).map(([name, list]) => [id(name), list])),
    ...(b.loops && { loops: Object.fromEntries(Object.entries(b.loops).map(([name, steps]) => [id(name), steps])) }),
  }));
  const song: Placement[] = (spec.song ?? []).map(([name, lane, bar, bars, fadeIn, fadeOut], i) => {
    const pattern = patterns.find((p) => p.name === name);
    if (!pattern) throw new Error(`${spec.name}: there is no block called ${name}`);
    return { id: `s${i}`, pattern: pattern.id, lane, bar, bars, ...(fadeIn && { fadeIn }), ...(fadeOut && { fadeOut }) };
  });
  const lanes = newLanes().map((lane, i) => ({ ...lane, level: spec.lanes?.[i] ?? 0 }));
  // The factory recordings the sounds play, which the program makes itself.
  const used = new Set(channels.map((c) => c.sound.source.params.sample));
  const samples = Object.fromEntries((['pad', 'break'] as const)
    .filter((kind) => used.has(factoryId(kind)))
    .map((kind) => [factoryId(kind), factorySample(kind).sample]));
  return {
    ...emptyProject(),
    name: spec.name,
    bpm: spec.bpm ?? 120,
    swing: spec.swing ?? 0,
    meter: spec.meter ?? [4, 4],
    ...(spec.scale && { scale: spec.scale }),
    master: spec.master ?? 0,
    channels,
    patterns,
    song,
    lanes,
    samples,
  };
}

/** A sound to load into the reader's project, heard on a phrase of notes (one bar at 120 when not given). */
export function soundExample(title: string, sound: () => Sound, phrase: Note[], opts: { bars?: number; bpm?: number } = {},
): Example {
  return {
    kind: 'sound',
    title,
    make: () => {
      const s = sound();
      return makeProject({
        name: title, bpm: opts.bpm, sounds: [s], blocks: [{ name: s.name, bars: opts.bars ?? 1, rows: { [s.name]: phrase } }],
      });
    },
  };
}

/** A block to load into the reader's project: the first block of a project. */
export function blockExample(title: string, spec: () => ProjectSpec): Example {
  return { kind: 'block', title, make: () => makeProject(spec()) };
}

/** A whole project, which replaces the reader's after the offer to save. */
export function projectExample(title: string, spec: () => ProjectSpec): Example {
  return { kind: 'project', title, make: () => makeProject(spec()) };
}

/** A one-bar tune around a root: up a minor chord and down again. */
export const tune = (root = 72): Note[] =>
  notes([[0, root, 2], [2, root + 3, 2], [4, root + 7, 2], [6, root + 10, 2], [8, root + 12, 4], [12, root + 7, 4]]);

/** A one-bar bass line around a root. */
export const line = (root = 48): Note[] =>
  notes([[0, root, 3], [4, root, 2], [6, root + 3, 2], [8, root, 3], [12, root + 7, 2], [14, root + 5, 2]]);

/** A minor chord held for `steps` steps. */
export const chord = (root = 60, steps = 16): Note[] => notes([[0, root, steps], [0, root + 3, steps], [0, root + 7, steps]]);

/** One note held for `steps` steps. */
export const held = (note = 60, steps = 4): Note[] => notes([[0, note, steps]]);
