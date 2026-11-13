import { produce } from 'immer';
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import {
  CHANNEL_COLORS, MAX_BARS, MAX_SONG_BARS, PATTERN_NAMES, SONG_LANES, STEPS_PER_BAR,
  emptyProject, newMod, newModule, newPattern, newSound, uid,
} from '../core/defaults';
import { MODULES, moduleDef, paramSpec } from '../core/modules';
import { MAX_NOTE, MIN_NOTE } from '../core/notes';
import { coerce, defaultParams } from '../core/params';
import type { Block, Channel, ModTarget, ParamValue, PlayScope, Project, SampleData, Sound, Step } from '../core/types';

export type View = 'factory' | 'track' | 'song';
export interface StepRef { channelId: string; index: number }
export interface FileRef { name: string; path: string | null }

export interface AppState {
  project: Project;
  file: FileRef | null;
  dirty: boolean;
  view: View;
  channelId: string | null;
  patternId: string;
  placementId: string | null;
  step: StepRef | null;
  scope: 'pattern' | 'song';
  playing: boolean;
  octave: number;
  past: Project[];
  future: Project[];
}

function initialState(project: Project, file: FileRef | null): AppState {
  return {
    project, file, dirty: false, view: 'track', channelId: project.channels[0]?.id ?? null,
    patternId: project.patterns[0].id, placementId: null, step: null, scope: 'pattern', playing: false,
    octave: 3, past: [], future: [],
  };
}

export const useApp: UseBoundStore<StoreApi<AppState>> = create(() => initialState(emptyProject(), null));

export function playScope(state: AppState): PlayScope {
  return state.scope === 'song' ? { kind: 'song' } : { kind: 'pattern', patternId: state.patternId };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
let lastChange: { key: string; time: number } | null = null;

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return false;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

function repair(state: AppState): AppState {
  const hasChannel = (id: string) => state.project.channels.some((c) => c.id === id);
  return {
    ...state,
    channelId: state.channelId === null || hasChannel(state.channelId)
      ? state.channelId : state.project.channels[0]?.id ?? null,
    patternId: state.project.patterns.some((p) => p.id === state.patternId)
      ? state.patternId : state.project.patterns[0].id,
    placementId: state.project.song.some((p) => p.id === state.placementId) ? state.placementId : null,
    step: state.step && hasChannel(state.step.channelId) ? state.step : null,
  };
}

function edit(
  recipe: (project: Project) => void,
  key?: string,
  selection: Partial<Pick<AppState, 'channelId' | 'patternId' | 'placementId' | 'step'>> = {},
): void {
  useApp.setState((state) => {
    const project = produce(state.project, recipe);
    if (equal(project, state.project)) return state;
    const time = Date.now();
    const merge = key !== undefined && lastChange?.key === key && time - lastChange.time < 800;
    lastChange = key === undefined ? null : { key, time };
    return repair({
      ...state, ...selection, project, dirty: true,
      past: merge ? state.past : [...state.past, state.project].slice(-100), future: [],
    });
  });
}

function editSound(channelId: string, recipe: (sound: Sound) => void, key?: string): void {
  edit((project) => {
    const channel = project.channels.find((c) => c.id === channelId);
    if (channel) recipe(channel.sound);
  }, key);
}

function nextColor(items: { color: number }[]): number {
  const counts = Array<number>(CHANNEL_COLORS).fill(0);
  for (const item of items) counts[item.color]++;
  return counts.indexOf(Math.min(...counts));
}

function move<T>(items: T[], from: number, to: number): void {
  if (from < 0 || !Number.isFinite(to)) return;
  const index = clamp(Math.round(to), 0, items.length - 1);
  if (from !== index) items.splice(index, 0, items.splice(from, 1)[0]);
}

export function setBpm(bpm: number): void {
  edit((p) => { p.bpm = clamp(bpm, 40, 240); }, 'bpm');
}

export function setSwing(swing: number): void {
  edit((p) => { p.swing = clamp(swing, 0, 1); }, 'swing');
}

export function setMaster(db: number): void {
  edit((p) => { p.master = clamp(db, -48, 6); }, 'master');
}

export function renameProject(name: string): void {
  edit((p) => { p.name = name; }, 'name');
}

function mergeSamples(target: Record<string, SampleData>, samples?: Record<string, SampleData>): void {
  for (const [id, sample] of Object.entries(samples ?? {})) {
    if (!Object.hasOwn(target, id)) target[id] = sample;
  }
}

export function addChannel(sound: Sound, samples?: Record<string, SampleData>): string {
  const id = uid('c');
  edit((p) => {
    p.channels.push({ id, sound, color: nextColor(p.channels), mute: false, solo: false });
    mergeSamples(p.samples, samples);
  }, undefined, { channelId: id });
  return id;
}

export function addSampleChannel(id: string, sample: SampleData): string {
  const sound = newSound('sample', sample.name.replace(/\.[^.]+$/, ''));
  sound.source.params.sample = id;
  return addChannel(sound, { [id]: sample });
}

export function removeChannel(channelId: string): void {
  const state = useApp.getState();
  const index = state.project.channels.findIndex((c) => c.id === channelId);
  if (index < 0) return;
  const channel = state.project.channels[index + 1] ?? state.project.channels[index - 1];
  edit((p) => {
    p.channels.splice(index, 1);
    for (const pattern of p.patterns) delete pattern.cells[channelId];
  }, undefined, state.channelId === channelId ? { channelId: channel?.id ?? null } : {});
}

export function duplicateChannel(channelId: string): string | null {
  const state = useApp.getState();
  const index = state.project.channels.findIndex((c) => c.id === channelId);
  if (index < 0) return null;
  const copy = structuredClone(state.project.channels[index]);
  copy.id = uid('c');
  copy.sound.name += ' 2';
  copy.color = nextColor(state.project.channels);
  edit((p) => { p.channels.splice(index + 1, 0, copy); }, undefined, { channelId: copy.id });
  return copy.id;
}

export function moveChannel(channelId: string, toIndex: number): void {
  edit((p) => { move(p.channels, p.channels.findIndex((c) => c.id === channelId), toIndex); });
}

export function setChannel(channelId: string, patch: Partial<Pick<Channel, 'mute' | 'solo' | 'color'>>): void {
  edit((p) => {
    const channel = p.channels.find((c) => c.id === channelId);
    if (!channel) return;
    if (patch.mute !== undefined) channel.mute = patch.mute;
    if (patch.solo !== undefined) channel.solo = patch.solo;
    if (patch.color !== undefined) channel.color = clamp(Math.round(patch.color), 0, CHANNEL_COLORS - 1);
  });
}

export function replaceSound(channelId: string, sound: Sound, samples?: Record<string, SampleData>): void {
  edit((p) => {
    const channel = p.channels.find((c) => c.id === channelId);
    if (!channel) return;
    if (!equal(channel.sound, sound)) channel.sound = sound;
    mergeSamples(p.samples, samples);
  });
}

export function renameSound(channelId: string, name: string): void {
  editSound(channelId, (sound) => { sound.name = name; }, JSON.stringify(['name', channelId]));
}

function validTarget(sound: Sound, target: ModTarget): boolean {
  if (!['source', 'out', ...sound.chain.map((m) => m.id)].includes(target.module)) return false;
  const def = moduleDef(sound, target.module);
  const spec = def && paramSpec(def, target.param);
  return spec?.kind === 'float' && !!spec.mod;
}

export function setSourceType(channelId: string, type: string): void {
  const def = MODULES[type];
  if (def?.kind !== 'source') return;
  editSound(channelId, (sound) => {
    if (sound.source.type === type) return;
    const oldDef = moduleDef(sound, 'source');
    const params = defaultParams(def);
    for (const spec of def.params) {
      if (oldDef && paramSpec(oldDef, spec.id)) params[spec.id] = coerce(spec, sound.source.params[spec.id]);
    }
    sound.source = { id: 'source', type, params };
    for (const mod of sound.mods) {
      if (mod.target?.module === 'source' && !validTarget(sound, mod.target)) mod.target = null;
    }
  });
}

export function setParam(channelId: string, moduleId: string, paramId: string, value: ParamValue): void {
  editSound(channelId, (sound) => {
    const def = moduleDef(sound, moduleId);
    const spec = def && paramSpec(def, paramId);
    if (!spec) return;
    const params = moduleId === 'source' ? sound.source.params
      : moduleId === 'amp' ? sound.amp : moduleId === 'out' ? sound.out
        : (sound.chain.find((m) => m.id === moduleId) ?? sound.mods.find((m) => m.id === moduleId))?.params;
    if (params) params[paramId] = coerce(spec, value);
  }, JSON.stringify(['param', channelId, moduleId, paramId]));
}

export function setSample(channelId: string, id: string, sample: SampleData): void {
  edit((p) => {
    const sound = p.channels.find((c) => c.id === channelId)?.sound;
    if (sound?.source.type !== 'sample') return;
    if (!Object.hasOwn(p.samples, id)) p.samples[id] = sample;
    sound.source.params.sample = id;
  });
}

export function addEffect(channelId: string, type: string, index?: number): string | null {
  if (MODULES[type]?.kind !== 'effect' || !useApp.getState().project.channels.some((c) => c.id === channelId)) {
    return null;
  }
  const module = newModule(type);
  editSound(channelId, (sound) => {
    const at = index === undefined ? sound.chain.length : clamp(Math.round(index), 0, sound.chain.length);
    sound.chain.splice(at, 0, module);
  });
  return module.id;
}

export function moveEffect(channelId: string, moduleId: string, toIndex: number): void {
  editSound(channelId, (sound) => { move(sound.chain, sound.chain.findIndex((m) => m.id === moduleId), toIndex); });
}

export function addMod(channelId: string, type: string): string | null {
  if (MODULES[type]?.kind !== 'mod' || !useApp.getState().project.channels.some((c) => c.id === channelId)) {
    return null;
  }
  const mod = newMod(type);
  editSound(channelId, (sound) => { sound.mods.push(mod); });
  return mod.id;
}

export function removeModule(channelId: string, moduleId: string): void {
  editSound(channelId, (sound) => {
    const index = sound.chain.findIndex((m) => m.id === moduleId);
    if (index >= 0) {
      sound.chain.splice(index, 1);
      for (const mod of sound.mods) if (mod.target?.module === moduleId) mod.target = null;
    } else {
      const modIndex = sound.mods.findIndex((m) => m.id === moduleId);
      if (modIndex >= 0) sound.mods.splice(modIndex, 1);
    }
  });
}

export function setModuleOn(channelId: string, moduleId: string, on: boolean): void {
  editSound(channelId, (sound) => {
    const module = sound.chain.find((m) => m.id === moduleId) ?? sound.mods.find((m) => m.id === moduleId);
    if (module) module.on = on;
  });
}

export function setModTarget(channelId: string, modId: string, target: ModTarget | null): void {
  editSound(channelId, (sound) => {
    const mod = sound.mods.find((m) => m.id === modId);
    if (mod) mod.target = target && validTarget(sound, target) ? target : null;
  });
}

export function setModAmount(channelId: string, modId: string, amount: number): void {
  editSound(channelId, (sound) => {
    const mod = sound.mods.find((m) => m.id === modId);
    if (mod) mod.amount = clamp(amount, -1, 1);
  }, JSON.stringify(['amount', channelId, modId]));
}

function validIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < MAX_BARS * STEPS_PER_BAR;
}

function normalizeStep(step: Step): Step {
  return {
    note: clamp(Math.round(step.note), MIN_NOTE, MAX_NOTE),
    vel: clamp(step.vel, 0, 1), len: Math.max(1, Math.round(step.len)),
  };
}

export function setStep(patternId: string, channelId: string, index: number, step: Step | null): void {
  if (!validIndex(index)) return;
  edit((p) => {
    const pattern = p.patterns.find((pattern) => pattern.id === patternId);
    if (!pattern || !p.channels.some((c) => c.id === channelId)) return;
    if (step) {
      (pattern.cells[channelId] ??= {})[index] = normalizeStep(step);
    } else if (pattern.cells[channelId]?.[index]) {
      delete pattern.cells[channelId][index];
      if (Object.keys(pattern.cells[channelId]).length === 0) delete pattern.cells[channelId];
    }
  });
}

export function patchStep(patternId: string, channelId: string, index: number, patch: Partial<Step>): void {
  if (!validIndex(index)) return;
  edit((p) => {
    const pattern = p.patterns.find((pattern) => pattern.id === patternId);
    if (!pattern || !p.channels.some((c) => c.id === channelId)) return;
    const cell = pattern.cells[channelId]?.[index];
    if (cell) {
      pattern.cells[channelId][index] = normalizeStep({ ...cell, ...patch });
    }
  }, JSON.stringify(['step', patternId, channelId, index]));
}

export function setPatternBars(patternId: string, bars: number): void {
  edit((p) => {
    const pattern = p.patterns.find((pattern) => pattern.id === patternId);
    if (pattern) pattern.bars = clamp(Math.round(bars), 1, MAX_BARS);
  });
}

export function renamePattern(patternId: string, name: string): void {
  const trimmed = name.trim().slice(0, 24).trimEnd();
  if (!trimmed) return;
  edit((p) => {
    const pattern = p.patterns.find((pattern) => pattern.id === patternId);
    if (pattern) pattern.name = trimmed;
  }, JSON.stringify(['patternName', patternId]));
}

export function setPatternColor(patternId: string, color: number): void {
  if (!Number.isFinite(color)) return;
  edit((p) => {
    const pattern = p.patterns.find((pattern) => pattern.id === patternId);
    if (pattern) pattern.color = clamp(Math.round(color), 0, CHANNEL_COLORS - 1);
  });
}

function insertPattern(copyId?: string): string | null {
  const state = useApp.getState();
  if (state.project.patterns.length >= PATTERN_NAMES.length) return null;
  const name = [...PATTERN_NAMES].find((letter) => !state.project.patterns.some((p) => p.name === letter));
  const source = state.project.patterns.find((p) => p.id === (copyId ?? state.patternId));
  if (!name || !source) return null;
  const pattern = newPattern(name, copyId === undefined ? nextColor(state.project.patterns) : source.color);
  pattern.bars = source.bars;
  if (copyId !== undefined) pattern.cells = structuredClone(source.cells);
  edit((p) => { p.patterns.push(pattern); }, undefined, { patternId: pattern.id, step: null });
  return pattern.id;
}

export function addPattern(): string | null {
  return insertPattern();
}

export function duplicatePattern(patternId: string): string | null {
  return insertPattern(patternId);
}

export function insertBlock(block: Block): string | null {
  if (useApp.getState().project.patterns.length >= PATTERN_NAMES.length) return null;
  const copy = structuredClone(block);
  const pattern = newPattern(copy.name, copy.color);
  pattern.bars = copy.bars;
  edit((p) => {
    const used = new Set<string>();
    for (const track of copy.tracks) {
      let channel = p.channels.find((c) => !used.has(c.id) && equal(c.sound, track.sound));
      if (!channel) {
        channel = { id: uid('c'), sound: track.sound, color: nextColor(p.channels), mute: false, solo: false };
        p.channels.push(channel);
      }
      used.add(channel.id);
      for (const [index, step] of Object.entries(track.steps)) {
        if (validIndex(Number(index))) (pattern.cells[channel.id] ??= {})[Number(index)] = normalizeStep(step);
      }
    }
    p.patterns.push(pattern);
    mergeSamples(p.samples, copy.samples);
  }, undefined, { patternId: pattern.id, step: null });
  return pattern.id;
}

export function removePattern(patternId: string): void {
  const state = useApp.getState();
  const index = state.project.patterns.findIndex((p) => p.id === patternId);
  if (index < 0 || state.project.patterns.length === 1) return;
  const neighbour = state.project.patterns[index + 1] ?? state.project.patterns[index - 1];
  edit((p) => {
    p.patterns.splice(index, 1);
    p.song = p.song.filter((placement) => placement.pattern !== patternId);
  }, undefined, state.patternId === patternId ? { patternId: neighbour.id, step: null } : {});
}

export function clearPattern(patternId: string): void {
  edit((p) => {
    const pattern = p.patterns.find((pattern) => pattern.id === patternId);
    if (pattern) pattern.cells = {};
  });
}

function validPosition(lane: number, bar: number): boolean {
  return Number.isInteger(lane) && lane >= 0 && lane < SONG_LANES
    && Number.isInteger(bar) && bar >= 0 && bar < MAX_SONG_BARS;
}

function placementRoom(project: Project, lane: number, bar: number, skipId?: string): number {
  let end = MAX_SONG_BARS;
  for (const placement of project.song) {
    if (placement.id === skipId || placement.lane !== lane) continue;
    if (placement.bar <= bar && bar < placement.bar + placement.bars) return 0;
    if (placement.bar > bar) end = Math.min(end, placement.bar);
  }
  return end - bar;
}

export function addPlacement(patternId: string, lane: number, bar: number): string | null {
  lane = Math.round(lane);
  bar = Math.round(bar);
  if (!validPosition(lane, bar)) return null;
  const project = useApp.getState().project;
  const pattern = project.patterns.find((p) => p.id === patternId);
  const room = placementRoom(project, lane, bar);
  if (!pattern || room === 0) return null;
  const id = uid('s');
  edit((p) => {
    p.song.push({ id, pattern: patternId, lane, bar, bars: Math.min(pattern.bars, room) });
  }, undefined, { placementId: id, patternId, step: null });
  return id;
}

export function movePlacement(placementId: string, lane: number, bar: number): void {
  lane = Math.round(lane);
  bar = Math.round(bar);
  if (!validPosition(lane, bar)) return;
  edit((p) => {
    const placement = p.song.find((s) => s.id === placementId);
    if (!placement || placementRoom(p, lane, bar, placementId) < placement.bars) return;
    placement.lane = lane;
    placement.bar = bar;
  }, JSON.stringify(['movePlacement', placementId]));
}

export function resizePlacement(placementId: string, bars: number): void {
  if (!Number.isFinite(bars)) return;
  edit((p) => {
    const placement = p.song.find((s) => s.id === placementId);
    if (placement) {
      placement.bars = clamp(Math.round(bars), 1, placementRoom(p, placement.lane, placement.bar, placementId));
    }
  }, JSON.stringify(['resizePlacement', placementId]));
}

export function removePlacement(placementId: string): void {
  edit((p) => {
    const index = p.song.findIndex((s) => s.id === placementId);
    if (index >= 0) p.song.splice(index, 1);
  });
}

export function undo(): void {
  const state = useApp.getState();
  if (state.past.length === 0) return;
  lastChange = null;
  useApp.setState(repair({
    ...state, project: state.past[state.past.length - 1], past: state.past.slice(0, -1),
    future: [state.project, ...state.future], dirty: true,
  }));
}

export function redo(): void {
  const state = useApp.getState();
  if (state.future.length === 0) return;
  lastChange = null;
  useApp.setState(repair({
    ...state, project: state.future[0], past: [...state.past, state.project].slice(-100),
    future: state.future.slice(1), dirty: true,
  }));
}

export function openProject(project: Project, file: FileRef | null): void {
  lastChange = null;
  const { view, octave } = useApp.getState();
  useApp.setState({ ...initialState(project, file), view, octave }, true);
}

export function markSaved(file: FileRef): void {
  lastChange = null;
  useApp.setState({ file, dirty: false });
}

/** Show a view. Play plays what is on screen: the song in the Song view, the current block in the Track view. */
export function setView(view: View): void {
  const { scope } = useApp.getState();
  useApp.setState({ view, scope: view === 'song' ? 'song' : view === 'track' ? 'pattern' : scope });
}

export function selectChannel(channelId: string | null): void {
  if (channelId === null || useApp.getState().project.channels.some((c) => c.id === channelId)) {
    useApp.setState({ channelId });
  }
}

export function selectPattern(patternId: string): void {
  if (useApp.getState().project.patterns.some((p) => p.id === patternId)) {
    useApp.setState({ patternId, step: null });
  }
}

export function selectPlacement(placementId: string | null): void {
  if (placementId === null) useApp.setState({ placementId });
  else {
    const placement = useApp.getState().project.song.find((p) => p.id === placementId);
    if (placement) useApp.setState({ placementId, patternId: placement.pattern, step: null });
  }
}

export function selectStep(step: StepRef | null): void {
  if (step === null) useApp.setState({ step });
  else if (validIndex(step.index) && useApp.getState().project.channels.some((c) => c.id === step.channelId)) {
    useApp.setState({ step, channelId: step.channelId });
  }
}

export function setScope(scope: 'pattern' | 'song'): void {
  useApp.setState({ scope });
}

export function setPlaying(playing: boolean): void {
  useApp.setState({ playing });
}

export function setOctave(octave: number): void {
  useApp.setState({ octave: clamp(Math.round(octave), 0, 6) });
}
