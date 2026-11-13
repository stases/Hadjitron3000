import { CHANNEL_COLORS, MAX_BARS, newPattern, uid } from './defaults';
import { AMP, MODULES, OUT, paramSpec } from './modules';
import type { ModuleDef, ModuleKind } from './modules';
import { MAX_NOTE, MIN_NOTE } from './notes';
import { coerce } from './params';
import type { ModInst, ModuleInst, Params, Pattern, Project, SampleData, Sound, Step } from './types';

export const SOUND_EXT = 'h3s';
export const PROJECT_EXT = 'h3k';
export const FORMAT_VERSION = 1;

/** Thrown for any file the app cannot read. Its message is shown to the user as is. */
export class FormatError extends Error {}

/** Id of an audio file: 's' followed by the first 16 hex digits of its SHA-256. */
export async function sampleId(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return 's' + Array.from(hash.subarray(0, 8), (v) => v.toString(16).padStart(2, '0')).join('');
}

/** Ids of samples referenced by the source's sample parameters. */
export function soundSampleIds(sound: Sound): string[] {
  return MODULES[sound.source.type].params.flatMap((p) => {
    const value = sound.source.params[p.id];
    return p.kind === 'sample' && typeof value === 'string' && value !== '' ? [value] : [];
  });
}

function encodeSamples(ids: string[], samples: Record<string, SampleData>): object {
  return Object.fromEntries([...new Set(ids)].filter((id) => Object.hasOwn(samples, id)).map((id) => {
    const sample = samples[id];
    const chunks: string[] = [];
    for (let i = 0; i < sample.bytes.length; i += 0x8000) {
      chunks.push(String.fromCharCode(...sample.bytes.subarray(i, i + 0x8000)));
    }
    return [id, { name: sample.name, data: btoa(chunks.join('')) }];
  }));
}

export function serializeSound(sound: Sound, samples: Record<string, SampleData>): string {
  return JSON.stringify({
    format: 'hadjitron3000/sound',
    version: FORMAT_VERSION,
    sound,
    samples: encodeSamples(soundSampleIds(sound), samples),
  }, null, 2);
}

export function serializeProject(project: Project): string {
  const { name, bpm, swing, master, channels, patterns, song } = project;
  return JSON.stringify({
    format: 'hadjitron3000/project',
    version: FORMAT_VERSION,
    project: { name, bpm, swing, master, channels, patterns, song },
    samples: encodeSamples(channels.flatMap((c) => soundSampleIds(c.sound)), project.samples),
  }, null, 2);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new FormatError(`Invalid ${label}: expected an object.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new FormatError(`Invalid ${label}: expected an array.`);
  return value;
}

function envelope(text: string, kind: 'sound' | 'project'): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FormatError(`This is not a Hadjitron 3000 ${kind} file.`);
  }
  if (!isObject(value) || value.format !== `hadjitron3000/${kind}`) {
    throw new FormatError(`This is not a Hadjitron 3000 ${kind} file.`);
  }
  if (typeof value.version === 'number' && value.version > FORMAT_VERSION) {
    throw new FormatError('This file was made by a newer version of Hadjitron 3000.');
  }
  return value;
}

function decodeSamples(value: unknown): Record<string, SampleData> {
  return Object.fromEntries(Object.entries(object(value === undefined ? {} : value, 'samples')).map(([id, entry]) => {
    const sample = object(entry, `sample ${id}`);
    if (typeof sample.name !== 'string' || typeof sample.data !== 'string') {
      throw new FormatError(`Invalid sample ${id}: expected a name and base64 data.`);
    }
    let binary: string;
    try {
      binary = atob(sample.data);
    } catch {
      throw new FormatError(`Invalid sample ${id}: unreadable base64 data.`);
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return [id, { name: sample.name, bytes }];
  }));
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback;
}

function params(value: unknown, def: ModuleDef): Params {
  const values = object(value === undefined ? {} : value, `${def.type} parameters`);
  return Object.fromEntries(def.params.map((p) => [p.id, coerce(p, values[p.id])]));
}

function module(value: unknown, kind: ModuleKind, ids: Set<string>, reserved: Set<string>): ModuleInst {
  const entry = object(value, `${kind} module`);
  const def = typeof entry.type === 'string' && Object.hasOwn(MODULES, entry.type) ? MODULES[entry.type] : undefined;
  if (!def || def.kind !== kind) throw new FormatError(`Unknown ${kind} module: ${String(entry.type)}.`);
  let id = typeof entry.id === 'string' ? entry.id : '';
  if (kind === 'source') {
    id = 'source';
  } else if (id === '' || ids.has(id)) {
    do { id = uid('m'); } while (ids.has(id) || reserved.has(id));
  }
  ids.add(id);
  return { id, type: def.type, params: params(entry.params, def), on: entry.on !== false };
}

function readSound(value: unknown, samples: Record<string, SampleData>): Sound {
  const raw = object(value, 'sound');
  const chain = array(raw.chain, 'sound chain');
  const mods = array(raw.mods, 'sound modulators');
  const ids = new Set(['source', 'amp', 'out']);
  const reserved = new Set([...chain, ...mods].flatMap((m) => isObject(m) && typeof m.id === 'string' ? [m.id] : []));
  const sound: Sound = {
    name: typeof raw.name === 'string' ? raw.name : 'New Sound',
    source: module(raw.source, 'source', ids, reserved),
    amp: params(raw.amp, AMP),
    chain: chain.map((m) => module(m, 'effect', ids, reserved)),
    mods: [],
    out: params(raw.out, OUT),
  };
  for (const p of MODULES[sound.source.type].params) {
    if (p.kind === 'sample' && !Object.hasOwn(samples, String(sound.source.params[p.id]))) {
      sound.source.params[p.id] = '';
    }
  }
  const targets = new Map([
    ['source', MODULES[sound.source.type]],
    ...sound.chain.map((m): [string, ModuleDef] => [m.id, MODULES[m.type]]),
    ['out', OUT],
  ]);
  sound.mods = mods.map((value): ModInst => {
    const inst = module(value, 'mod', ids, reserved);
    const rawMod = object(value, 'modulator');
    let target = null;
    if (isObject(rawMod.target)) {
      const { module: moduleId, param } = rawMod.target;
      const def = typeof moduleId === 'string' ? targets.get(moduleId) : undefined;
      const spec = def && typeof param === 'string' ? paramSpec(def, param) : undefined;
      if (typeof moduleId === 'string' && typeof param === 'string' && spec?.kind === 'float' && spec.mod) {
        target = { module: moduleId, param };
      }
    }
    return { ...inst, target, amount: number(rawMod.amount, 0, -1, 1) };
  });
  return sound;
}

export function parseSound(text: string): { sound: Sound; samples: Record<string, SampleData> } {
  const file = envelope(text, 'sound');
  const samples = decodeSamples(file.samples);
  return { sound: readSound(file.sound, samples), samples };
}

function uniqueId(value: unknown, ids: Set<string>, label: string): string {
  if (typeof value !== 'string' || value === '') throw new FormatError(`Invalid ${label}: missing id.`);
  if (ids.has(value)) throw new FormatError(`Duplicate ${label} id: ${value}.`);
  ids.add(value);
  return value;
}

function readPattern(value: unknown, ids: Set<string>, channels: Set<string>): Pattern {
  const raw = object(value, 'pattern');
  const cells = object(raw.cells === undefined ? {} : raw.cells, 'pattern cells');
  return {
    id: uniqueId(raw.id, ids, 'pattern'),
    name: typeof raw.name === 'string' ? raw.name : '',
    bars: Math.round(number(raw.bars, 1, 1, MAX_BARS)),
    cells: Object.fromEntries(Object.entries(cells).filter(([id]) => channels.has(id)).map(([id, values]) => {
      const steps = Object.entries(object(values, `cells for channel ${id}`)).flatMap(([index, value]) => {
        const i = Number(index);
        if (index.trim() === '' || !Number.isSafeInteger(i) || i < 0) return [];
        const rawStep = object(value, `step ${index}`);
        const step: Step = {
          note: Math.round(number(rawStep.note, 60, MIN_NOTE, MAX_NOTE)),
          vel: number(rawStep.vel, 0.8, 0, 1),
          len: Math.round(number(rawStep.len, 1, 1, 128)),
        };
        return [[i, step]];
      });
      return [id, Object.fromEntries(steps)];
    })),
  };
}

export function parseProject(text: string): Project {
  const file = envelope(text, 'project');
  return readProject(file.project, decodeSamples(file.samples));
}

/** Validate and normalize a project that is already in memory (a parsed file, or a stored session). */
export function readProject(value: unknown, samples: Record<string, SampleData>): Project {
  const raw = object(value, 'project');
  const channelIds = new Set<string>();
  const channels = array(raw.channels, 'channels').map((value) => {
    const channel = object(value, 'channel');
    return {
      id: uniqueId(channel.id, channelIds, 'channel'),
      sound: readSound(channel.sound, samples),
      color: Math.round(number(channel.color, 0, 0, CHANNEL_COLORS - 1)),
      mute: channel.mute === true,
      solo: channel.solo === true,
    };
  });
  const patternIds = new Set<string>();
  const patterns = array(raw.patterns === undefined ? [] : raw.patterns, 'patterns')
    .map((p) => readPattern(p, patternIds, channelIds));
  if (patterns.length === 0) {
    const pattern = newPattern('A');
    patterns.push(pattern);
    patternIds.add(pattern.id);
  }
  return {
    name: typeof raw.name === 'string' ? raw.name : 'Untitled',
    bpm: number(raw.bpm, 120, 40, 240),
    swing: number(raw.swing, 0, 0, 1),
    master: number(raw.master, 0, -48, 6),
    channels,
    patterns,
    song: array(raw.song === undefined ? [] : raw.song, 'song')
      .filter((id): id is string => typeof id === 'string' && patternIds.has(id)),
    samples,
  };
}
