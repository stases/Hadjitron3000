// Automation rows of the song and the locks of notes: which parameters they can move, what those are called and
// how far they go, and the value of a row at a tick. Values are 0..1 over a parameter's range through its taper.

import { MAX_SONG_BARS } from './defaults';
import { METERS, barOf } from './meter';
import { BUS_LEVEL, SEND, rackChain } from './mixer';
import type { MixerRack } from './mixer';
import { MODULES, moduleDef, moduleParams, paramSpec } from './modules';
import type { FloatSpec } from './modules';
import { MAX_LOCKS } from './notes';
import type { AutoRow, Lock, ModTarget, ModuleInst, ParamRef, Project, Sound } from './types';

/** A moving value is sampled every this many ticks (a 128th note); the engine draws straight lines in between. */
export const AUTO_GRID = 3;
/** The module of a sound's sends; its params are the bus indices '0' and '1'. */
export const SEND_MODULE = 'send';
/** The last tick a point can sit on: the end of the longest song in the longest bar. */
export const MAX_SONG_TICKS = MAX_SONG_BARS * Math.max(...METERS.map((m) => barOf(m).ticks));

/**
 * Parameters that cannot move while the song plays: the reverb's size and tone rebuild its impulse, and the
 * arpeggiator's octaves and gate are read by the sequencer, which lays out the notes before the engine sees them.
 */
const FIXED: Readonly<Record<string, readonly string[]>> = { reverb: ['size', 'tone'], play: ['octaves', 'gate'] };

/** The modules built inside every note; a lock of one of their parameters goes to the note's own voice. */
export const inNote = (module: string) => ['source', 'play', 'filter', 'amp'].includes(module);

const SOUND_UNITS = ['source', 'play', 'filter', 'amp', 'out'];
const UNIT_NAMES: Readonly<Record<string, string>> = {
  source: 'Source', play: 'Play', filter: 'Filter', amp: 'Amp', out: 'Output',
};

const floatSpec = (type: string, param: string): FloatSpec | undefined => {
  const spec = paramSpec(MODULES[type], param);
  return spec?.kind === 'float' && !FIXED[type]?.includes(param) ? spec : undefined;
};

/** The spec of a parameter of a sound that automation and locks can move: a float of a unit or of an effect. */
export function soundSpec(sound: Sound, target: ModTarget): FloatSpec | undefined {
  if (!SOUND_UNITS.includes(target.module) && !sound.chain.some((m) => m.id === target.module)) return undefined;
  const def = moduleDef(sound, target.module);
  return def && floatSpec(def.type, target.param);
}

function rackModule(project: Project, rack: MixerRack, id: string): ModuleInst | undefined {
  return rackChain(project.mixer, rack).find((m) => m.id === id);
}

/** The spec of the parameter a reference names, or undefined when the project has no such parameter to move. */
export function refSpec(project: Project, ref: ParamRef): FloatSpec | undefined {
  const { owner, module, param } = ref;
  if (typeof owner === 'string') {
    const channel = project.channels.find((c) => c.id === owner);
    if (!channel) return undefined;
    if (module === SEND_MODULE) {
      return param === '0' || param === '1' ? { ...SEND, label: project.mixer.buses[Number(param)].name } : undefined;
    }
    return soundSpec(channel.sound, { module, param });
  }
  if (module === 'out') return param === 'level' ? BUS_LEVEL : undefined;
  const inst = rackModule(project, owner.rack, module);
  return inst && floatSpec(inst.type, param);
}

/** The value the document stores for a parameter, in its own units: what it has while it is not automated. */
export function storedValue(project: Project, ref: ParamRef): number {
  const { owner, module, param } = ref;
  if (typeof owner === 'string') {
    const channel = project.channels.find((c) => c.id === owner)!;
    if (module === SEND_MODULE) return channel.sends[Number(param)];
    return moduleParams(channel.sound, module)![param] as number;
  }
  if (module === 'out') return owner.rack === 'master' ? project.master : project.mixer.buses[owner.rack].level;
  return rackModule(project, owner.rack, module)!.params[param] as number;
}

export const refKey = (ref: ParamRef) => JSON.stringify([ref.owner, ref.module, ref.param]);

/** A parameter a list offers: what to set, and its name there, such as "Filter · Cutoff". */
export interface Target<T> {
  target: T;
  label: string;
}

/** Plate names of a chain's effects, numbered when a type occurs more than once, as the Factory shows them. */
function effectNames(chain: ModuleInst[]): Map<string, string> {
  const seen: Record<string, number> = {};
  return new Map(chain.map((m) => {
    const n = (seen[m.type] = (seen[m.type] ?? 0) + 1);
    return [m.id, n > 1 ? `${MODULES[m.type].label} ${n}` : MODULES[m.type].label];
  }));
}

/** Every parameter of a sound that a lock or automation can move, in signal order: units, then effects, then output. */
export function soundTargets(sound: Sound): Target<ModTarget>[] {
  const names = effectNames(sound.chain);
  const ids = ['source', 'play', 'filter', 'amp', ...sound.chain.map((m) => m.id), 'out'];
  return ids.flatMap((module) => {
    const def = moduleDef(sound, module)!;
    const name = UNIT_NAMES[module] ?? names.get(module)!;
    return def.params.flatMap((p) => {
      const target = { module, param: p.id };
      return soundSpec(sound, target) ? [{ target, label: `${name} · ${p.label}` }] : [];
    });
  });
}

function rackTargets(project: Project, rack: MixerRack): Target<ParamRef>[] {
  const chain = rackChain(project.mixer, rack);
  const names = effectNames(chain);
  const owner = { rack };
  return [
    { target: { owner, module: 'out', param: 'level' }, label: 'Level' },
    ...chain.flatMap((m) => MODULES[m.type].params.flatMap((p) => floatSpec(m.type, p.id)
      ? [{ target: { owner, module: m.id, param: p.id }, label: `${names.get(m.id)} · ${p.label}` }] : [])),
  ];
}

/** What automation can move, by whose it is: each sound with its sends, each bus, then the master. */
export function automationGroups(project: Project): { name: string; targets: Target<ParamRef>[] }[] {
  const buses = project.mixer.buses;
  return [
    ...project.channels.map((c) => ({
      name: c.sound.name,
      targets: [
        ...soundTargets(c.sound).map(({ target, label }) => ({ target: { owner: c.id, ...target }, label })),
        ...buses.map((bus, i) => ({
          target: { owner: c.id, module: SEND_MODULE, param: String(i) },
          label: `Send · ${bus.name}`,
        })),
      ],
    })),
    ...([0, 1] as const).map((rack) => ({ name: buses[rack].name, targets: rackTargets(project, rack) })),
    { name: 'Master', targets: rackTargets(project, 'master') },
  ];
}

/** The full name of an automated parameter, "Warm Pad · Filter · Cutoff", or null when the project has none such. */
export function refLabel(project: Project, ref: ParamRef): string | null {
  const key = refKey(ref);
  for (const group of automationGroups(project)) {
    const found = group.targets.find((t) => refKey(t.target) === key);
    if (found) return `${group.name} · ${found.label}`;
  }
  return null;
}

/** The value of straight lines through the points at `tick`, holding the first before it and the last after. */
export function pointsValue(points: AutoRow['points'], tick: number): number {
  const i = points.findLastIndex(([t]) => t <= tick);
  if (i < 0) return points[0][1];
  if (i === points.length - 1) return points[i][1];
  const [t0, v0] = points[i];
  const [t1, v1] = points[i + 1];
  return v0 + ((v1 - v0) * (tick - t0)) / (t1 - t0);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Points made valid: whole ticks inside the song's range, values in 0..1, in order of their ticks. */
export function cleanPoints(points: readonly (readonly [number, number])[]): AutoRow['points'] {
  return points
    .filter(([tick, value]) => Number.isFinite(tick) && Number.isFinite(value))
    .map(([tick, value]): [number, number] => [clamp(Math.round(tick), 0, MAX_SONG_TICKS), clamp(value, 0, 1)])
    .sort((a, b) => a[0] - b[0]);
}

/** The locks a note of this sound keeps: those of parameters the sound has, the first of each target. */
export function validLocks(sound: Sound, locks: readonly Lock[]): Lock[] {
  return locks.filter((lock, i) => soundSpec(sound, lock.target)
    && locks.findIndex((l) => l.target.module === lock.target.module && l.target.param === lock.target.param) === i)
    .slice(0, MAX_LOCKS);
}

/** Whether anything reaches send bus `index`: a channel sends to it, or a row of automation moves a send to it. */
export function busUsed(project: Project, index: number): boolean {
  const automated = ({ target, points }: AutoRow) =>
    points.length > 0 && typeof target.owner === 'string' && target.module === SEND_MODULE && target.param === String(index);
  return project.channels.some((c) => c.sends[index] > 0) || project.automation.some(automated);
}

/**
 * Every parameter that automation or a lock moves while the song plays: those of rows with points, and the shared
 * ones (an effect or the output) that notes lock.
 */
export function automatedRefs(project: Project): ParamRef[] {
  const refs = new Map<string, ParamRef>();
  const add = (ref: ParamRef) => refSpec(project, ref) && refs.set(refKey(ref), ref);
  for (const row of project.automation) if (row.points.length > 0) add(row.target);
  for (const pattern of project.patterns) {
    for (const [owner, notes] of Object.entries(pattern.notes)) {
      for (const lock of notes.flatMap((n) => n.locks ?? [])) {
        if (!inNote(lock.target.module)) add({ owner, ...lock.target });
      }
    }
  }
  return [...refs.values()];
}
