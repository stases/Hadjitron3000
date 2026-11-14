// Guided steps for the chapters, made from what they change, so each step knows the control it points at, the
// folded section it needs, when it is done and how to do it.

import { refKey, refSpec, soundSpec } from '../../core/automation';
import { TICKS_PER_STEP } from '../../core/defaults';
import { levelOf } from '../../core/levels';
import type { Level } from '../../core/levels';
import { barOf } from '../../core/meter';
import { rackChain } from '../../core/mixer';
import type { MixerRack } from '../../core/mixer';
import { AMP, FILTER, MODULES, OUT, PLAY, paramSpec } from '../../core/modules';
import type { ModuleDef } from '../../core/modules';
import type { NoteExtras } from '../../core/notes';
import { toNorm } from '../../core/params';
import type {
  Channel, Meter, ModInst, Note, ParamRef, ParamValue, Params, Pattern, Scale, Sound,
} from '../../core/types';
import { preset, presetSamples } from '../../presets';
import {
  addAutomation, addChannel, addEffect, addMod as addModulator, addNotes, addPattern, addPlacement, renamePattern,
  renameSound, resizePlacement, setAutomationPoints, setBpm, setDuck, setLane, setMeter, setModAmount, setModPer,
  setModTarget, setNotesExtras, setNotesLock, setNotesVelocity, setParam, setPatternBars, setPlacementFades,
  setRowLoop, setScale, setSend, setSourceType, setSwing, useApp,
} from '../../state/store';
import type { AppState, View } from '../../state/store';
import type { Look, TourStep } from '../tour/tourStore';

/**
 * A unit of a sound: 'source', 'play', 'filter' (the one in every note), 'amp', 'out', an effect as 'fx:delay' or a
 * modulator as 'mod:lfo', with ':2' after it for the second of its type.
 */
export type Unit = string;

interface Resolved {
  module: string; // the module id in the sound
  def: ModuleDef;
  params: Params;
  fold: string; // the type its folds are kept under
}

/** Finds a unit in a sound. */
export function resolve(sound: Sound, unit: Unit): Resolved | null {
  const [kind, type, nth = '1'] = unit.split(':');
  const source = sound.source.type;
  const fixed: Record<string, [ModuleDef, Params, string]> = {
    source: [MODULES[source], sound.source.params, source],
    play: [PLAY, sound.play, source],
    filter: [FILTER, sound.filter, FILTER.type],
    amp: [AMP, sound.amp, AMP.type],
    out: [OUT, sound.out, OUT.type],
  };
  if (Object.hasOwn(fixed, kind)) {
    const [def, params, fold] = fixed[kind];
    return { module: kind, def, params, fold };
  }
  const list = kind === 'fx' ? sound.chain : kind === 'mod' ? sound.mods : [];
  const module = list.filter((m) => m.type === type)[Number(nth) - 1];
  return module ? { module: module.id, def: MODULES[type], params: module.params, fold: type } : null;
}

/** The control a unit's steps point at. */
export function unitTarget(unit: Unit): string {
  const [kind, type] = unit.split(':');
  if (kind === 'fx') return `effect-${type}`;
  if (kind === 'mod') return `mod-${type}`;
  return kind === 'play' ? 'unit-source' : `unit-${kind}`;
}

/** Whether a value is close enough to the one asked for: within a twentieth of the knob's travel, or the same choice. */
export function near(def: ModuleDef, param: string, value: ParamValue, wanted: ParamValue): boolean {
  const spec = paramSpec(def, param);
  if (spec?.kind !== 'float' || typeof value !== 'number' || typeof wanted !== 'number') return value === wanted;
  const travel = (v: number) => (spec.taper === 'log' ? Math.log(v / spec.min) / Math.log(spec.max / spec.min)
    : spec.taper === 'cube' ? Math.cbrt((v - spec.min) / (spec.max - spec.min)) : (v - spec.min) / (spec.max - spec.min));
  return Math.abs(travel(value) - travel(wanted)) <= 0.05;
}

/** Which sound a step is about: the one selected, or one by its name. */
interface Who {
  sound?: string;
}

const channelOf = (state: AppState, who: Who): Channel | undefined => state.project.channels.find((c) =>
  (who.sound === undefined ? c.id === state.channelId : c.sound.name === who.sound));
const soundOf = (state: AppState, who: Who) => channelOf(state, who)?.sound;

interface Opts extends Who {
  title?: string;
}

/** The parts every step about a sound shares: its words, its view, and the sound it selects. */
const about = (text: string, opts: Opts, view: View = 'factory') =>
  ({ title: opts.title, text, view, select: opts.sound === undefined ? undefined : { sound: opts.sound } });

/**
 * Set controls of a unit. Done when each is close enough to the value asked for, so a knob turned by hand to
 * about the right place counts. In beginner mode the step opens the sections the controls are folded into.
 */
export function set(unit: Unit, values: Params, text: string, opts: Opts = {}): TourStep {
  const ids = Object.keys(values);
  return {
    ...about(text, opts),
    target: unitTarget(unit),
    unfold: (state) => {
      const sound = soundOf(state, opts);
      const r = sound && resolve(sound, unit);
      if (!r) return [];
      const levels = new Set(ids.map((id) => levelOf(paramSpec(r.def, id)!)));
      return [...levels].filter((l) => l > 1).map((l): [string, Level] => [r.fold, l]);
    },
    done: ({ state }) => {
      const sound = soundOf(state, opts);
      const r = sound && resolve(sound, unit);
      return !!r && ids.every((id) => near(r.def, id, r.params[id], values[id]));
    },
    act: (state) => {
      const channel = channelOf(state, opts)!;
      const r = resolve(channel.sound, unit)!;
      for (const id of ids) setParam(channel.id, r.module, id, values[id]);
    },
  };
}

/** Change the kind of source. */
export function source(type: string, text: string, opts: Opts = {}): TourStep {
  return {
    ...about(text, opts),
    target: 'unit-source',
    done: ({ state }) => soundOf(state, opts)?.source.type === type,
    act: (state) => setSourceType(channelOf(state, opts)!.id, type),
  };
}

const count = (list: { type: string }[] | undefined, type: string) => list?.filter((m) => m.type === type).length ?? 0;

interface AddOpts extends Opts {
  /** How many more of it the sound has than when the steps began, once the step is done: 2 for a second one. */
  more?: number;
}

/** Whether a sound has `more` more modules of a type in a list than it had when the steps began. */
const added = ({ state, start }: Look, list: 'chain' | 'mods', type: string, opts: AddOpts) =>
  count(soundOf(state, opts)?.[list], type) - count(soundOf({ ...state, project: start }, opts)?.[list], type)
    >= (opts.more ?? 1);

/** Add an effect to the end of the chain. */
export function addFx(type: string, text: string, opts: AddOpts = {}): TourStep {
  return {
    ...about(text, opts),
    target: 'add-effect',
    done: (look) => added(look, 'chain', type, opts),
    act: (state) => addEffect(channelOf(state, opts)!.id, type),
  };
}

/** Add a modulator. */
export function addMod(type: string, text: string, opts: AddOpts = {}): TourStep {
  return {
    ...about(text, opts),
    target: 'add-modulator',
    done: (look) => added(look, 'mods', type, opts),
    act: (state) => addModulator(channelOf(state, opts)!.id, type),
  };
}

/**
 * Point a modulator at a control of another unit, by an amount from -1 to 1, and say whether it works on each note
 * or the whole sound. Done when the target is right and the amount within a tenth.
 */
export function point(mod: Unit, to: [Unit, string], amount: number, text: string,
  opts: Opts & { per?: ModInst['per'] } = {}): TourStep {
  const found = (state: AppState) => {
    const sound = soundOf(state, opts);
    const m = sound && resolve(sound, mod);
    const t = sound && resolve(sound, to[0]);
    return m && t ? { sound, mod: sound.mods.find((x) => x.id === m.module)!, module: t.module } : null;
  };
  return {
    ...about(text, opts),
    target: unitTarget(mod),
    unfold: (state) => (opts.per && opts.per !== found(state)?.mod.per ? [[mod.split(':')[1], 2]] : []),
    done: ({ state }) => {
      const f = found(state);
      return !!f && f.mod.target?.module === f.module && f.mod.target.param === to[1]
        && Math.abs(f.mod.amount - amount) <= 0.1 && (!opts.per || f.mod.per === opts.per);
    },
    act: (state) => {
      const f = found(state)!;
      const channel = channelOf(state, opts)!.id;
      setModTarget(channel, f.mod.id, { module: f.module, param: to[1] });
      setModAmount(channel, f.mod.id, amount);
      if (opts.per) setModPer(channel, f.mod.id, opts.per);
    },
  };
}

/** Add a factory sound to the project, under a name of its own when `as` is given. */
export function newSound(name: string, text: string, opts: { as?: string; title?: string } = {}): TourStep {
  const called = opts.as ?? name;
  return {
    title: opts.title,
    text,
    target: 'new-sound',
    view: 'factory',
    done: ({ state }) => state.project.channels.some((c) => c.sound.name === called),
    act: () => {
      const id = addChannel(preset(name), presetSamples(name));
      if (opts.as) renameSound(id, opts.as);
    },
  };
}

const blockOf = (state: AppState, name: string): Pattern | undefined =>
  state.project.patterns.find((p) => p.name === name);
const rowOf = (state: AppState, block: string, sound: string): Note[] => {
  const channel = channelOf(state, { sound });
  return (channel && blockOf(state, block)?.notes[channel.id]) ?? [];
};

/** A new block with a name and a length. */
export function newBlock(name: string, bars: number, text: string, opts: { title?: string } = {}): TourStep {
  return {
    title: opts.title,
    text,
    target: 'block-bar',
    view: 'track',
    done: ({ state }) => blockOf(state, name)?.bars === bars,
    act: () => {
      const id = addPattern()!;
      renamePattern(id, name);
      setPatternBars(id, bars);
    },
  };
}

/** A note as the steps write it: [step, note, length in steps, velocity]. */
export type StepNote = readonly [step: number, note: number, len?: number, vel?: number];

const toNote = ([step, note, len = 1, vel = 0.8]: StepNote) =>
  ({ start: Math.round(step * TICKS_PER_STEP), len: Math.round(len * TICKS_PER_STEP), note, vel });

/** Steps of a drum row from a string: x a hit, X an accent, o a ghost note. */
export function beat(row: string, note = 60): StepNote[] {
  const vel: Record<string, number> = { x: 0.8, X: 1, o: 0.4 };
  return [...row].flatMap((ch, i) => (vel[ch] ? [[i, note, 1, vel[ch]] as const] : []));
}

/**
 * Write notes into a row of a block, in the grid or, with `roll`, in the piano roll. Done once the row has a note at
 * the start and pitch of each, however long or loud the reader made them.
 */
export function write(block: string, sound: string, list: readonly StepNote[], text: string,
  opts: Opts & { roll?: boolean } = {}): TourStep {
  const wanted = list.map(toNote);
  return {
    title: opts.title,
    text,
    target: opts.roll ? 'roll' : `row-${sound}`,
    view: 'track',
    select: { block, sound, roll: !!opts.roll },
    done: ({ state }) => {
      const row = rowOf(state, block, sound);
      return wanted.every((w) => row.some((n) => n.start === w.start && n.note === w.note));
    },
    act: (state) => addNotes(blockOf(state, block)!.id, channelOf(state, { sound })!.id, wanted),
  };
}

/** Give the notes of a row that start on some steps the same extras, selected in the piano roll. */
export function extras(block: string, sound: string, steps: readonly number[], values: NoteExtras, text: string,
  opts: Opts = {}): TourStep {
  const chosen = (state: AppState) => rowOf(state, block, sound).filter((n) =>
    steps.includes(n.start / TICKS_PER_STEP));
  const level: Level = values.ratchet !== undefined ? 3 : 2;
  return {
    title: opts.title,
    text,
    target: 'inspector',
    view: 'track',
    select: { block, sound, roll: true },
    unfold: () => [['note', level]],
    done: ({ state }) => {
      const notes = chosen(state);
      return notes.length === steps.length && notes.every((n) => Object.entries(values)
        .every(([key, v]) => (n[key as keyof Note] ?? (key === 'chance' ? 100 : key === 'ratchet' ? 1 : false)) === v));
    },
    act: (state) => setNotesExtras(blockOf(state, block)!.id, channelOf(state, { sound })!.id,
      chosen(state).map((n) => n.id), values),
  };
}

/** Set how hard the notes of a row that start on some steps are played, in the piano roll. Done within a tenth. */
export function velocity(block: string, sound: string, steps: readonly number[], vel: number, text: string,
  opts: Opts = {}): TourStep {
  const chosen = (state: AppState) => rowOf(state, block, sound).filter((n) =>
    steps.includes(n.start / TICKS_PER_STEP));
  return {
    title: opts.title,
    text,
    target: 'inspector',
    view: 'track',
    select: { block, sound, roll: true },
    done: ({ state }) => {
      const notes = chosen(state);
      return notes.length === steps.length && notes.every((n) => Math.abs(n.vel - vel) <= 0.1);
    },
    act: (state) => setNotesVelocity(blockOf(state, block)!.id, channelOf(state, { sound })!.id,
      chosen(state).map((n) => n.id), vel),
  };
}

/**
 * Lock a control of a sound's unit, such as ['amp', 'decay'], to a value of their own, in the control's units, on the
 * notes of a row that start on some steps, in a slot of the inspector's Deep (0 for Lock 1). Done within a twentieth.
 */
export function lock(block: string, sound: string, steps: readonly number[], slot: number, [unit, param]: [Unit, string],
  value: number, text: string, opts: Opts = {}): TourStep {
  const chosen = (state: AppState) => rowOf(state, block, sound).filter((n) =>
    steps.includes(n.start / TICKS_PER_STEP));
  const wanted = (state: AppState) => {
    const s = channelOf(state, { sound })?.sound;
    const r = s && resolve(s, unit);
    const spec = r && soundSpec(s, { module: r.module, param });
    return spec ? { target: { module: r.module, param }, value: toNorm(spec, value) } : null;
  };
  return {
    title: opts.title,
    text,
    target: 'inspector',
    view: 'track',
    select: { block, sound, roll: true },
    unfold: () => [['note', 3]],
    done: ({ state }) => {
      const w = wanted(state);
      const notes = chosen(state);
      return !!w && notes.length === steps.length && notes.every((n) => n.locks?.some((l) =>
        l.target.module === w.target.module && l.target.param === param && Math.abs(l.value - w.value) <= 0.05));
    },
    act: (state) => setNotesLock(blockOf(state, block)!.id, channelOf(state, { sound })!.id,
      chosen(state).map((n) => n.id), slot, wanted(state)),
  };
}

/** What a row of automation moves: a sound's unit or its sends ('send', param '0' or '1'), or a bus or the master. */
export type Moves = { sound: string; unit: Unit; param: string } | { rack: MixerRack; unit: Unit; param: string };

/** The reference a row of automation names, in the project as it is now. */
function refOf(state: AppState, moves: Moves): ParamRef | null {
  const { project } = state;
  if ('sound' in moves) {
    const channel = channelOf(state, { sound: moves.sound });
    if (!channel) return null;
    if (moves.unit === 'send') return { owner: channel.id, module: 'send', param: moves.param };
    const r = resolve(channel.sound, moves.unit);
    return r && { owner: channel.id, module: r.module, param: moves.param };
  }
  if (moves.unit === 'out') return { owner: { rack: moves.rack }, module: 'out', param: 'level' };
  const module = rackChain(project.mixer, moves.rack).find((m) => m.type === moves.unit.replace('fx:', ''));
  return module ? { owner: { rack: moves.rack }, module: module.id, param: moves.param } : null;
}

const rowFor = (state: AppState, moves: Moves) => {
  const ref = refOf(state, moves);
  return ref ? state.project.automation.find((r) => refKey(r.target) === refKey(ref)) : undefined;
};

/** Add a row of automation under the lanes of the Song, a Deep control. */
export function automate(moves: Moves, text: string, opts: { title?: string } = {}): TourStep {
  return {
    title: opts.title,
    text,
    target: 'add-automation',
    view: 'song',
    unfold: () => [['song', 3]],
    done: ({ state }) => !!rowFor(state, moves),
    act: (state) => addAutomation(refOf(state, moves)!),
  };
}

/**
 * Give the `n`th row of automation its points: [bar from 0, value in the control's units]. Done when it has as many,
 * each within half a beat and a twentieth of the control's travel.
 */
export function curve(n: number, moves: Moves, points: readonly (readonly [number, number])[], text: string,
  opts: { title?: string } = {}): TourStep {
  const wanted = (state: AppState) => {
    const ref = refOf(state, moves);
    const spec = ref && refSpec(state.project, ref);
    const bar = barOf(state.project.meter).ticks;
    return spec ? points.map(([at, v]): [number, number] => [Math.round(at * bar), toNorm(spec, v)]) : [];
  };
  return {
    title: opts.title,
    text,
    target: `auto-${n}`,
    view: 'song',
    unfold: () => [['song', 3]],
    done: ({ state }) => {
      const row = rowFor(state, moves);
      const w = wanted(state);
      const slack = barOf(state.project.meter).ticks / 8;
      return !!row && row.points.length === w.length && row.points.every(([t, v], i) =>
        Math.abs(t - w[i][0]) <= slack && Math.abs(v - w[i][1]) <= 0.05);
    },
    act: (state) => setAutomationPoints(rowFor(state, moves)!.id, wanted(state)),
  };
}

/** Set the tempo and, when given, the swing. */
export function tempo(bpm: number, text: string, opts: { swing?: number; title?: string } = {}): TourStep {
  return {
    title: opts.title,
    text,
    target: 'tempo',
    done: ({ state }) => Math.abs(state.project.bpm - bpm) < 1
      && (opts.swing === undefined || Math.abs(state.project.swing - opts.swing) <= 0.05),
    act: () => {
      setBpm(bpm);
      if (opts.swing !== undefined) setSwing(opts.swing);
    },
  };
}

/** Set the time signature, a Deep control of the transport. */
export function meter(m: Meter, text: string, opts: { title?: string } = {}): TourStep {
  return {
    title: opts.title,
    text,
    target: 'meter',
    unfold: () => [['transport', 3]],
    done: ({ state }) => state.project.meter[0] === m[0] && state.project.meter[1] === m[1],
    act: () => setMeter(m),
  };
}

/** Give a row of a block a length of its own, in steps, a Deep control of the grid. */
export function loop(block: string, sound: string, steps: number, text: string, opts: Opts = {}): TourStep {
  return {
    title: opts.title,
    text,
    target: `row-${sound}`,
    view: 'track',
    select: { block, sound, roll: false },
    unfold: () => [['grid', 3]],
    done: ({ state }) => {
      const channel = channelOf(state, { sound });
      return !!channel && blockOf(state, block)?.loops?.[channel.id] === steps;
    },
    act: (state) => setRowLoop(blockOf(state, block)!.id, channelOf(state, { sound })!.id, steps),
  };
}

/** Give the project a scale, in the toolbar of the piano roll, open on a sound's row. */
export function scale(key: Scale, sound: string, text: string, opts: { title?: string } = {}): TourStep {
  return {
    title: opts.title,
    text,
    target: 'roll-tools',
    view: 'track',
    select: { sound, roll: true },
    unfold: () => [['roll', 2]],
    done: ({ state }) => state.project.scale?.root === key.root && state.project.scale.type === key.type,
    act: () => setScale(key),
  };
}

/** A placement as the steps make it: [block, lane, first bar, bars, fade in, fade out]. */
export type Place = readonly [block: string, lane: number, bar: number, bars: number, fadeIn?: number, fadeOut?: number];

/** Place blocks in the song. Done once each sits in its lane at its bar for its length, with its fades. */
export function place(list: readonly Place[], text: string, opts: { title?: string } = {}): TourStep {
  const fades = list.some(([, , , , i, o]) => i || o);
  const found = (state: AppState, [name, lane, bar]: Place) => state.project.song.find((s) =>
    s.lane === lane && s.bar === bar && s.pattern === blockOf(state, name)?.id);
  return {
    title: opts.title,
    text,
    target: 'timeline',
    view: 'song',
    unfold: () => (fades ? [['placement', 2]] : []),
    done: ({ state }) => list.every((p) => {
      const s = found(state, p);
      return !!s && s.bars === p[3] && (s.fadeIn ?? 0) === (p[4] ?? 0) && (s.fadeOut ?? 0) === (p[5] ?? 0);
    }),
    act: () => {
      for (const p of list) {
        const state = useApp.getState();
        const [name, lane, bar, bars, fadeIn = 0, fadeOut = 0] = p;
        const id = found(state, p)?.id ?? addPlacement(blockOf(state, name)!.id, lane, bar)!;
        resizePlacement(id, bars);
        if (fadeIn || fadeOut) setPlacementFades(id, fadeIn, fadeOut);
      }
    },
  };
}

/** Set a lane of the song: its level in dB, within a dB and a half, and whether it is muted. Lanes count from 1. */
export function lane(n: number, values: { level?: number; mute?: boolean }, text: string, opts: { title?: string } = {},
): TourStep {
  return {
    title: opts.title,
    text,
    target: `lane-${n}`,
    view: 'song',
    done: ({ state }) => {
      const l = state.project.lanes[n - 1];
      return (values.level === undefined || Math.abs(l.level - values.level) <= 1.5)
        && (values.mute === undefined || l.mute === values.mute);
    },
    act: () => setLane(n - 1, values),
  };
}

/** Set how loud a sound is in the mix and where it sits, in the Mixer. */
export function mix(sound: string, values: { level?: number; pan?: number }, text: string, opts: Opts = {}): TourStep {
  return { ...set('out', values, text, { ...opts, sound }), view: 'mixer', target: `strip-${sound}` };
}

/** Send a sound to the Room (bus A) and the Echo (bus B). */
export function send(sound: string, sends: [number, number], text: string, opts: Opts = {}): TourStep {
  return {
    ...about(text, { ...opts, sound }, 'mixer'),
    target: `strip-${sound}`,
    done: ({ state }) => {
      const c = channelOf(state, { sound });
      return !!c && c.sends.every((v, i) => Math.abs(v - sends[i]) <= 0.1);
    },
    act: (state) => sends.forEach((v, i) => setSend(channelOf(state, { sound })!.id, i, v)),
  };
}

/** Make a sound dip whenever another one plays. */
export function duck(sound: string, by: string, amount: number, release: number, text: string, opts: Opts = {},
): TourStep {
  return {
    ...about(text, { ...opts, sound }, 'mixer'),
    target: `strip-${sound}`,
    unfold: () => [['mixer', 2]],
    done: ({ state }) => {
      const c = channelOf(state, { sound });
      return !!c && c.duck.source === channelOf(state, { sound: by })?.id && Math.abs(c.duck.amount - amount) <= 0.1
        && Math.abs(Math.log(c.duck.release / release)) <= 0.4;
    },
    act: (state) => setDuck(channelOf(state, { sound })!.id, {
      source: channelOf(state, { sound: by })!.id, amount, release,
    }),
  };
}

/** Add an effect to a bus or the master, with some of its controls set. */
export function rackFx(rack: MixerRack, type: string, values: Params, text: string, opts: { title?: string } = {},
): TourStep {
  const chain = (state: AppState) =>
    (rack === 'master' ? state.project.mixer.master.chain : state.project.mixer.buses[rack].chain);
  const def = MODULES[type];
  return {
    title: opts.title,
    text,
    target: rack === 'master' ? 'master' : `bus-${rack}`,
    view: 'mixer',
    unfold: () => (rack === 'master' ? [['mixer', 2]] : []),
    done: ({ state }) => chain(state).some((m) => m.type === type
      && Object.entries(values).every(([id, v]) => near(def, id, m.params[id], v))),
    act: () => {
      const id = addEffect({ rack }, type)!;
      for (const [param, v] of Object.entries(values)) setParam({ rack }, id, param, v);
    },
  };
}

/** A step to read, or to press something the store cannot see, such as Play or a key of the piano. */
export function look(text: string, opts: { title?: string; target?: string; view?: View; press?: boolean } = {},
): TourStep {
  return { title: opts.title, text, target: opts.target, view: opts.view, done: opts.press ? 'press' : undefined };
}

/** A step done when something about the app is true, which the reader can do however they like. */
export function when(text: string, done: (look: Look) => boolean, act: (state: AppState) => void,
  opts: { title?: string; target?: string; view?: View } = {}): TourStep {
  return { ...opts, text, done, act };
}
