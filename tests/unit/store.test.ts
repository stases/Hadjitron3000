import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  CHANNEL_COLORS, MAX_BARS, PATTERN_NAMES, STEPS_PER_BAR, emptyProject, newSound, newStep,
} from '../../src/core/defaults';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import type { Channel, SampleData } from '../../src/core/types';
import * as app from '../../src/state/store';

const state = app.useApp.getState;
const project = () => state().project;
const sound = (id: string) => project().channels.find((c) => c.id === id)!.sound;
const pattern = () => project().patterns.find((p) => p.id === state().patternId)!;
const sample: SampleData = { name: 'kick.drum.wav', bytes: new Uint8Array([1, 2, 3]) };

beforeEach(() => {
  app.openProject(emptyProject(), null);
  app.setView('track');
  app.setOctave(3);
});

afterEach(() => {
  vi.useRealTimers();
});

test('initial state and transport scope', () => {
  expect(state()).toEqual({
    project: project(), file: null, dirty: false, view: 'track', channelId: null,
    patternId: project().patterns[0].id, step: null, scope: 'pattern', playing: false,
    octave: 3, past: [], future: [],
  });
  expect(app.playScope(state())).toEqual({ kind: 'pattern', patternId: state().patternId });
  app.setScope('song');
  expect(app.playScope(state())).toEqual({ kind: 'song' });
});

test('project controls clamp their ranges and rename the project', () => {
  app.setBpm(300);
  app.setSwing(2);
  app.setMaster(20);
  expect(project()).toMatchObject({ bpm: 240, swing: 1, master: 6 });
  app.setBpm(1);
  app.setSwing(-2);
  app.setMaster(-100);
  app.renameProject('Song');
  expect(project()).toMatchObject({ bpm: 40, swing: 0, master: -48, name: 'Song' });
  expect(state().dirty).toBe(true);
});

test('adding channels preserves supplied sounds, merges samples and balances colors', () => {
  const original = newSound();
  const first = app.addChannel(original, { kick: sample });
  expect(first).toMatch(/^c_/);
  expect(project().channels[0]).toEqual({ id: first, sound: original, color: 0, mute: false, solo: false });
  expect(sound(first)).toBe(original);
  expect(project().samples.kick).toBe(sample);
  for (let i = 1; i < CHANNEL_COLORS + 2; i++) app.addChannel(newSound());
  expect(project().channels.map((c) => c.color)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  expect(state().channelId).toBe(project().channels.at(-1)!.id);
  app.removeChannel(project().channels[3].id);
  const replacement = app.addChannel(newSound(), { snare: { ...sample, name: 'snare.wav' } });
  expect(project().channels.find((c) => c.id === replacement)!.color).toBe(3);
  expect(Object.keys(project().samples)).toEqual(['kick', 'snare']);
});

test('sample channels use the filename stem and sampler source', () => {
  const id = app.addSampleChannel('kick', sample);
  expect(sound(id)).toMatchObject({ name: 'kick.drum', source: { type: 'sample', params: { sample: 'kick' } } });
  expect(project().samples.kick).toBe(sample);
  expect(state().past).toHaveLength(1);
  app.undo();
  expect(project().samples).toEqual({});
  expect(project().channels).toEqual([]);
  const extensionless = app.addSampleChannel('plain', { ...sample, name: 'kick' });
  expect(sound(extensionless).name).toBe('kick');
});

test('sample imports retain existing entries by content id across all sample actions', () => {
  const a = app.addSampleChannel('kick', sample);
  const samples = project().samples;
  const repeated = structuredClone(sample);
  const second = app.addChannel(newSound('sample'), { kick: repeated });
  expect(project().samples).toBe(samples);
  expect(project().samples.kick).toBe(sample);
  app.replaceSound(second, newSound('sample', 'Replacement'), { kick: repeated, extra: repeated });
  expect(project().samples.kick).toBe(sample);
  expect(project().samples.extra).toBe(repeated);
  app.setSample(second, 'kick', repeated);
  expect(sound(second).source.params.sample).toBe('kick');
  expect(project().samples.kick).toBe(sample);
  const before = state();
  const renamed = { ...repeated, name: 'renamed.wav' };
  app.setSample(a, 'kick', renamed);
  app.replaceSound(a, sound(a), { kick: renamed });
  expect(state()).toBe(before);
  expect(project().samples.kick).toBe(sample);
});

test('removing channels clears all pattern cells and selects the next, previous, or no channel', () => {
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const c = app.addChannel(newSound());
  const first = state().patternId;
  app.setStep(first, b, 0, newStep());
  const second = app.addPattern()!;
  app.setStep(second, b, 2, newStep());
  app.setStep(second, a, 1, newStep());
  app.selectStep({ channelId: b, index: 0 });
  app.removeChannel(b);
  expect(state().channelId).toBe(c);
  expect(state().step).toBeNull();
  expect(project().patterns.map((p) => p.cells[b])).toEqual([undefined, undefined]);
  expect(pattern().cells[a][1]).toEqual(newStep());
  app.removeChannel(c);
  expect(state().channelId).toBe(a);
  app.removeChannel(a);
  expect(state().channelId).toBeNull();
});

test('duplicating a channel deep copies the sound, preserves mixer settings, and does not copy cells', () => {
  const a = app.addChannel(newSound('fm', 'Bell'));
  const b = app.addChannel(newSound());
  app.addEffect(a, 'filter');
  app.addMod(a, 'lfo');
  app.setChannel(a, { mute: true, solo: true });
  app.setStep(state().patternId, a, 0, newStep());
  const original = sound(a);
  const copy = app.duplicateChannel(a)!;
  expect(project().channels.map((c) => c.id)).toEqual([a, copy, b]);
  expect(project().channels[1]).toMatchObject({ color: 2, mute: true, solo: true });
  expect(sound(copy)).toEqual({ ...original, name: 'Bell 2' });
  expect(sound(copy)).not.toBe(original);
  expect(sound(copy).source.params).not.toBe(original.source.params);
  expect(sound(copy).chain[0]).not.toBe(original.chain[0]);
  expect(sound(copy).mods[0]).not.toBe(original.mods[0]);
  expect(pattern().cells[copy]).toBeUndefined();
  expect(state().channelId).toBe(copy);
});

test('moving channels clamps insertion positions and channel patches are restricted', () => {
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const c = app.addChannel(newSound());
  app.moveChannel(a, 99);
  expect(project().channels.map((channel) => channel.id)).toEqual([b, c, a]);
  app.moveChannel(a, -1);
  expect(project().channels.map((channel) => channel.id)).toEqual([a, b, c]);
  app.setChannel(a, { mute: true, solo: true, color: 50, id: 'wrong' } as Partial<Channel>);
  expect(project().channels[0]).toMatchObject({ id: a, mute: true, solo: true, color: 7 });
  app.setChannel(a, { color: -1 });
  expect(project().channels[0].color).toBe(0);
});

test('replacing and renaming sounds preserves the channel and its cells', () => {
  const a = app.addChannel(newSound(), { old: sample });
  app.setChannel(a, { color: 5, mute: true });
  app.setStep(state().patternId, a, 0, newStep());
  const before = pattern();
  const replacement = newSound('fm', 'FM');
  app.replaceSound(a, replacement, { next: sample });
  expect(sound(a)).toBe(replacement);
  expect(project().channels[0]).toMatchObject({ id: a, color: 5, mute: true });
  expect(pattern()).toBe(before);
  expect(Object.keys(project().samples)).toEqual(['old', 'next']);
  const channel = project().channels[0];
  app.replaceSound(a, structuredClone(replacement), { extra: sample });
  expect(project().channels[0]).toBe(channel);
  expect(project().samples.extra).toBe(sample);
  app.renameSound(a, 'Renamed');
  expect(sound(a).name).toBe('Renamed');
});

test('source changes keep common parameters, initialize defaults, and clear stale targets', () => {
  const a = app.addChannel(newSound('fm'));
  app.setParam(a, 'source', 'pitch', 7);
  app.setParam(a, 'source', 'fine', -23);
  const pitchMod = app.addMod(a, 'lfo')!;
  const amountMod = app.addMod(a, 'env')!;
  const outMod = app.addMod(a, 'lfo')!;
  app.setModTarget(a, pitchMod, { module: 'source', param: 'pitch' });
  app.setModTarget(a, amountMod, { module: 'source', param: 'amount' });
  app.setModTarget(a, outMod, { module: 'out', param: 'pan' });
  app.setSourceType(a, 'osc');
  expect(sound(a).source).toEqual({
    id: 'source', type: 'osc', params: { ...newSound().source.params, pitch: 7, fine: -23 },
  });
  expect(sound(a).mods.map((m) => m.target)).toEqual([
    { module: 'source', param: 'pitch' }, null, { module: 'out', param: 'pan' },
  ]);
  app.setSourceType(a, 'noise');
  expect(sound(a).mods[0].target).toBeNull();
});

test('source changes coerce carried values with the new parameter specs', () => {
  const original = newSound('fm');
  original.source.params.pitch = 100;
  original.source.params.fine = 'invalid';
  const a = app.addChannel(original);
  app.setSourceType(a, 'osc');
  expect(sound(a).source.params).toMatchObject({ pitch: 24, fine: 0 });
  const fractional = newSound('fm');
  fractional.source.params.pitch = 1.7;
  fractional.source.params.fine = -101;
  app.replaceSound(a, fractional);
  app.setSourceType(a, 'sample');
  expect(sound(a).source.params).toMatchObject({ pitch: 2, fine: -100 });
});

test('parameters use each module definition and changes structurally share untouched objects', () => {
  const a = app.addChannel(newSound());
  app.addChannel(newSound());
  const filter = app.addEffect(a, 'filter')!;
  const mod = app.addMod(a, 'lfo')!;
  app.addPattern();
  const before = project();
  app.setParam(a, 'source', 'pitch', 100);
  expect(sound(a).source.params.pitch).toBe(24);
  expect(project()).not.toBe(before);
  expect(project().channels).not.toBe(before.channels);
  expect(project().channels[0]).not.toBe(before.channels[0]);
  expect(project().channels[1]).toBe(before.channels[1]);
  expect(project().channels[1].sound).toBe(before.channels[1].sound);
  expect(project().patterns).toBe(before.patterns);
  project().patterns.forEach((p, index) => { expect(p).toBe(before.patterns[index]); });
  expect(sound(a).chain).toBe(before.channels[0].sound.chain);
  expect(before.channels[0].sound.source.params.pitch).toBe(0);
  app.setParam(a, 'amp', 'attack', -1);
  app.setParam(a, 'out', 'pan', 2);
  app.setParam(a, filter, 'cutoff', 30000);
  app.setParam(a, mod, 'rate', 0);
  app.setParam(a, 'source', 'wave', 'invalid');
  app.setParam(a, 'source', 'fine', 1.7);
  expect(sound(a).amp.attack).toBe(0);
  expect(sound(a).out.pan).toBe(1);
  expect(sound(a).chain[0].params.cutoff).toBe(20000);
  expect(sound(a).mods[0].params.rate).toBe(0.02);
  expect(sound(a).source.params).toMatchObject({ wave: 'sawtooth', fine: 2 });
});

test('setSample only works for samplers and sampler parameters use coercion', () => {
  const a = app.addChannel(newSound());
  const before = state();
  app.setSample(a, 'ignored', sample);
  expect(state()).toBe(before);
  app.setSourceType(a, 'sample');
  app.setSample(a, 'kick', sample);
  expect(project().samples.kick).toBe(sample);
  expect(sound(a).source.params.sample).toBe('kick');
  const sampled = state();
  app.setSample(a, 'kick', structuredClone(sample));
  expect(state()).toBe(sampled);
  app.setParam(a, 'source', 'loop', true);
  expect(sound(a).source.params.loop).toBe(true);
  app.setParam(a, 'source', 'loop', 'wrong');
  app.setParam(a, 'source', 'sample', 42);
  expect(sound(a).source.params.loop).toBe(false);
  expect(sound(a).source.params.sample).toBe('');
});

test('effects and modulators validate kinds, insert, move, bypass, and remove', () => {
  const a = app.addChannel(newSound());
  expect(app.addEffect(a, 'osc')).toBeNull();
  expect(app.addEffect(a, 'unknown')).toBeNull();
  expect(app.addMod(a, 'filter')).toBeNull();
  expect(app.addMod(a, 'unknown')).toBeNull();
  const filter = app.addEffect(a, 'filter')!;
  const delay = app.addEffect(a, 'delay', 0)!;
  const drive = app.addEffect(a, 'drive', 99)!;
  expect(sound(a).chain.map((m) => m.id)).toEqual([delay, filter, drive]);
  expect(sound(a).chain[1]).toMatchObject({ type: 'filter', params: { cutoff: 2000 }, on: true });
  app.moveEffect(a, drive, -10);
  app.moveEffect(a, delay, 99);
  expect(sound(a).chain.map((m) => m.id)).toEqual([drive, filter, delay]);
  const lfo = app.addMod(a, 'lfo')!;
  const env = app.addMod(a, 'env')!;
  expect(sound(a).mods.map((m) => m.id)).toEqual([lfo, env]);
  expect(sound(a).mods[0]).toMatchObject({ type: 'lfo', target: null, amount: 0.5, on: true });
  app.setModuleOn(a, filter, false);
  app.setModuleOn(a, lfo, false);
  expect(sound(a).chain[1].on).toBe(false);
  expect(sound(a).mods[0].on).toBe(false);
  app.setModTarget(a, lfo, { module: filter, param: 'cutoff' });
  app.setModTarget(a, env, { module: 'out', param: 'level' });
  app.removeModule(a, filter);
  expect(sound(a).mods[0].target).toBeNull();
  expect(sound(a).mods[1].target).toEqual({ module: 'out', param: 'level' });
  expect(sound(a).chain.map((m) => m.id)).toEqual([drive, delay]);
  app.undo();
  expect(sound(a).mods[0].target).toEqual({ module: filter, param: 'cutoff' });
  app.removeModule(a, lfo);
  expect(sound(a).mods.map((m) => m.id)).toEqual([env]);
});

test('mod targets require a modulatable float on source, output, or an effect', () => {
  const a = app.addChannel(newSound());
  const filter = app.addEffect(a, 'filter')!;
  const mod = app.addMod(a, 'lfo')!;
  for (const target of [
    { module: 'source', param: 'pitch' }, { module: 'out', param: 'pan' },
    { module: filter, param: 'cutoff' },
  ]) {
    app.setModTarget(a, mod, target);
    expect(sound(a).mods[0].target).toEqual(target);
  }
  for (const target of [
    { module: 'source', param: 'fine' }, { module: 'source', param: 'wave' },
    { module: 'source', param: 'missing' }, { module: 'missing', param: 'pitch' },
    { module: 'amp', param: 'attack' }, { module: mod, param: 'rate' }, null,
  ]) {
    app.setModTarget(a, mod, { module: 'source', param: 'pitch' });
    app.setModTarget(a, mod, target);
    expect(sound(a).mods[0].target).toBeNull();
  }
  app.setModAmount(a, mod, 3);
  expect(sound(a).mods[0].amount).toBe(1);
  app.setModAmount(a, mod, -3);
  expect(sound(a).mods[0].amount).toBe(-1);
});

test('steps normalize, patch only existing cells, and remove empty channel maps', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const before = state();
  app.patchStep(p, a, 0, { note: 80 });
  expect(state()).toBe(before);
  app.setStep(p, a, 0, { note: -10, vel: 2, len: 0 });
  expect(pattern().cells[a][0]).toEqual({ note: MIN_NOTE, vel: 1, len: 1 });
  app.patchStep(p, a, 0, { note: 200, vel: -1, len: 2.8 });
  expect(pattern().cells[a][0]).toEqual({ note: MAX_NOTE, vel: 0, len: 3 });
  app.patchStep(p, a, 0, { note: 60.6 });
  expect(pattern().cells[a][0]).toEqual({ note: 61, vel: 0, len: 3 });
  app.setStep(p, a, 1, newStep());
  app.setStep(p, a, 0, null);
  expect(pattern().cells[a]).toEqual({ 1: newStep() });
  app.setStep(p, a, 1, null);
  expect(pattern().cells).toEqual({});
});

test('pattern length is bounded while hidden cells survive shortening', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  app.setPatternBars(p, 99);
  expect(pattern().bars).toBe(MAX_BARS);
  app.setStep(p, a, MAX_BARS * STEPS_PER_BAR - 1, newStep());
  app.setPatternBars(p, -5);
  expect(pattern().bars).toBe(1);
  expect(pattern().cells[a][127]).toEqual(newStep());
  app.patchStep(p, a, 127, { vel: 0.2 });
  expect(pattern().cells[a][127].vel).toBe(0.2);
  app.clearPattern(p);
  expect(pattern().cells).toEqual({});
});

test('patterns use unused names, new patterns use current bars, and duplicates copy source bars and cells', () => {
  const a = app.addChannel(newSound());
  const first = state().patternId;
  app.setPatternBars(first, 3);
  app.setStep(first, a, 2, newStep());
  const song = project().song;
  const second = app.addPattern()!;
  expect(pattern()).toMatchObject({ id: second, name: 'B', bars: 3, cells: {} });
  app.setPatternBars(second, 2);
  const copy = app.duplicatePattern(first)!;
  expect(pattern()).toMatchObject({ id: copy, name: 'C', bars: 3, cells: { [a]: { 2: newStep() } } });
  expect(pattern().cells).not.toBe(project().patterns[0].cells);
  expect(pattern().cells[a][2]).not.toBe(project().patterns[0].cells[a][2]);
  expect(project().song).toBe(song);
  app.removePattern(second);
  app.addPattern();
  expect(pattern().name).toBe('B');
  while (project().patterns.length < PATTERN_NAMES.length) expect(app.addPattern()).not.toBeNull();
  const before = state();
  expect(app.addPattern()).toBeNull();
  expect(app.duplicatePattern(first)).toBeNull();
  expect(state()).toBe(before);
});

test('missing entities and invalid grid indices do nothing and create no history', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const before = state();
  app.removeChannel('missing');
  expect(app.duplicateChannel('missing')).toBeNull();
  app.moveChannel('missing', 0);
  app.setChannel('missing', { mute: true });
  app.replaceSound('missing', newSound(), { missing: sample });
  app.renameSound('missing', 'No');
  app.setSourceType('missing', 'fm');
  app.setSourceType(a, 'filter');
  app.setSourceType(a, 'unknown');
  app.setParam('missing', 'source', 'pitch', 3);
  app.setParam(a, 'missing', 'pitch', 3);
  app.setParam(a, 'source', 'missing', 3);
  app.setSample('missing', 'sample', sample);
  expect(app.addEffect('missing', 'filter')).toBeNull();
  expect(app.addMod('missing', 'lfo')).toBeNull();
  app.moveEffect(a, 'missing', 0);
  app.moveEffect('missing', 'missing', 0);
  app.removeModule(a, 'missing');
  app.removeModule(a, 'source');
  app.setModuleOn(a, 'source', false);
  app.setModuleOn(a, 'missing', false);
  app.setModTarget(a, 'missing', { module: 'out', param: 'pan' });
  app.setModAmount(a, 'missing', 1);
  app.setStep('missing', a, 0, newStep());
  app.setStep(p, 'missing', 0, newStep());
  for (const index of [-1, 0.5, 128, NaN, Infinity]) app.setStep(p, a, index, newStep());
  app.patchStep('missing', a, 0, { vel: 1 });
  app.patchStep(p, 'missing', 0, { vel: 1 });
  app.setPatternBars('missing', 2);
  expect(app.duplicatePattern('missing')).toBeNull();
  app.removePattern('missing');
  app.clearPattern('missing');
  expect(state()).toBe(before);
});

test('unchanged values and equivalent replacement objects preserve the project and history', () => {
  const a = app.addChannel(newSound());
  const effect = app.addEffect(a, 'filter')!;
  const mod = app.addMod(a, 'lfo')!;
  const p = state().patternId;
  app.setModTarget(a, mod, { module: effect, param: 'cutoff' });
  app.setStep(p, a, 0, newStep());
  app.markSaved({ name: 'saved.h3k', path: null });
  const before = state();
  app.setBpm(120);
  app.setSwing(0);
  app.setMaster(0);
  app.renameProject('Untitled');
  app.renameSound(a, 'New Sound');
  app.moveChannel(a, 0);
  app.moveEffect(a, effect, 0);
  app.setChannel(a, { mute: false, solo: false, color: 0 });
  app.setSourceType(a, 'osc');
  app.setParam(a, 'source', 'pitch', 0);
  app.setModAmount(a, mod, 0.5);
  app.setModTarget(a, mod, { module: effect, param: 'cutoff' });
  app.setModuleOn(a, effect, true);
  app.setStep(p, a, 0, newStep());
  app.patchStep(p, a, 0, { note: 60 });
  app.setStep(p, a, 1, null);
  app.setPatternBars(p, 1);
  app.replaceSound(a, structuredClone(sound(a)));
  expect(state()).toBe(before);
  app.clearPattern(p);
  const cleared = state();
  app.clearPattern(p);
  expect(state()).toBe(cleared);
});

test('undo and redo restore exact project snapshots and new edits discard redo', () => {
  const snapshots = [project()];
  const a = app.addChannel(newSound());
  snapshots.push(project());
  app.setBpm(140);
  snapshots.push(project());
  app.setStep(state().patternId, a, 0, newStep());
  snapshots.push(project());
  for (let i = 2; i >= 0; i--) {
    app.undo();
    expect(project()).toBe(snapshots[i]);
  }
  const undone = state();
  app.undo();
  expect(state()).toBe(undone);
  for (let i = 1; i <= 3; i++) {
    app.redo();
    expect(project()).toBe(snapshots[i]);
  }
  const redone = state();
  app.redo();
  expect(state()).toBe(redone);
  app.undo();
  app.setSwing(0.5);
  expect(state().future).toEqual([]);
  expect(state().dirty).toBe(true);
});

test('parameter bursts merge using the time of the last change, and expire at 800 ms', () => {
  vi.useFakeTimers();
  const a = app.addChannel(newSound());
  app.openProject(project(), null);
  const before = project();
  app.setParam(a, 'source', 'pitch', 1);
  vi.advanceTimersByTime(700);
  app.setParam(a, 'source', 'pitch', 2);
  vi.advanceTimersByTime(700);
  app.setParam(a, 'source', 'pitch', 3);
  expect(state().past).toEqual([before]);
  const burst = project();
  vi.advanceTimersByTime(800);
  app.setParam(a, 'source', 'pitch', 4);
  expect(state().past).toEqual([before, burst]);
  app.undo();
  expect(project()).toBe(burst);
  app.undo();
  expect(project()).toBe(before);
  app.redo();
  expect(project()).toBe(burst);
  app.setParam(a, 'source', 'pitch', 5);
  expect(state().past).toHaveLength(2);
});

test('merge keys distinguish parameters, modules, channels, modulators, and cells', () => {
  vi.useFakeTimers();
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const mod = app.addMod(a, 'lfo')!;
  const otherMod = app.addMod(a, 'lfo')!;
  const p = state().patternId;
  app.setStep(p, a, 0, newStep());
  app.setStep(p, a, 1, newStep());
  app.openProject(project(), null);
  const edits = [
    () => app.setParam(a, 'source', 'pitch', 1),
    () => app.setParam(b, 'source', 'pitch', 1),
    () => app.setParam(b, 'source', 'fine', 1),
    () => app.setParam(a, 'amp', 'attack', 1),
    () => app.setModAmount(a, mod, 0.1),
    () => app.setModAmount(a, otherMod, 0.1),
    () => app.patchStep(p, a, 0, { vel: 0.1 }),
    () => app.patchStep(p, a, 1, { vel: 0.1 }),
  ];
  edits.forEach((edit, index) => {
    edit();
    expect(state().past).toHaveLength(index + 1);
  });
});

test('all continuous actions merge but discrete actions break merging', () => {
  vi.useFakeTimers();
  const a = app.addChannel(newSound());
  const mod = app.addMod(a, 'lfo')!;
  const p = state().patternId;
  app.setStep(p, a, 0, newStep());
  app.openProject(project(), null);
  const bursts = [
    () => { app.setBpm(130); app.setBpm(140); },
    () => { app.setSwing(0.1); app.setSwing(0.2); },
    () => { app.setMaster(-1); app.setMaster(-2); },
    () => { app.renameProject('One'); app.renameProject('Two'); },
    () => { app.renameSound(a, 'One'); app.renameSound(a, 'Two'); },
    () => { app.setModAmount(a, mod, 0.1); app.setModAmount(a, mod, 0.2); },
    () => { app.patchStep(p, a, 0, { vel: 0.1 }); app.patchStep(p, a, 0, { vel: 0.2 }); },
  ];
  bursts.forEach((burst, index) => {
    burst();
    expect(state().past).toHaveLength(index + 1);
  });
  app.setChannel(a, { mute: true });
  app.patchStep(p, a, 0, { vel: 0.3 });
  expect(state().past).toHaveLength(9);
  app.setStep(p, a, 0, newStep(61));
  app.setStep(p, a, 0, newStep(62));
  expect(state().past).toHaveLength(11);
});

test('history keeps only the newest 100 previous projects', () => {
  const a = app.addChannel(newSound());
  app.openProject(project(), null);
  for (let i = 1; i <= 105; i++) app.setStep(state().patternId, a, 0, { ...newStep(), len: i });
  expect(state().past).toHaveLength(100);
  expect(state().past[0].patterns[0].cells[a][0].len).toBe(5);
  for (let i = 0; i < 100; i++) app.undo();
  expect(pattern().cells[a][0].len).toBe(5);
  expect(state().future).toHaveLength(100);
  for (let i = 0; i < 100; i++) app.redo();
  expect(pattern().cells[a][0].len).toBe(105);
  expect(state().past).toHaveLength(100);
});

test('undo and redo repair channel, pattern and step selections', () => {
  const a = app.addChannel(newSound());
  app.selectStep({ channelId: a, index: 0 });
  app.undo();
  expect(state().channelId).toBeNull();
  expect(state().step).toBeNull();
  app.redo();
  app.selectChannel(a);
  const b = app.addChannel(newSound());
  app.selectStep({ channelId: b, index: 0 });
  app.undo();
  expect(state().channelId).toBe(a);
  expect(state().step).toBeNull();
  const first = state().patternId;
  const second = app.addPattern()!;
  app.undo();
  expect(state().patternId).toBe(first);
  app.redo();
  app.selectPattern(second);
  app.undo();
  expect(state().patternId).toBe(first);
  app.redo();
  app.removeChannel(a);
  app.undo();
  app.selectChannel(a);
  app.redo();
  expect(state().channelId).toBeNull();
});

test('opening preserves view and octave while resetting other state, and saving preserves history', () => {
  const a = app.addChannel(newSound());
  app.addPattern();
  app.setView('factory');
  app.setOctave(6);
  app.setScope('song');
  app.setPlaying(true);
  app.selectStep({ channelId: a, index: 0 });
  app.setBpm(150);
  app.undo();
  const opened = project();
  const file = { name: 'opened.h3k', path: '/music/opened.h3k' };
  app.openProject(opened, file);
  expect(state()).toEqual({
    project: opened, file, dirty: false, view: 'factory', channelId: a,
    patternId: opened.patterns[0].id, step: null, scope: 'pattern', playing: false,
    octave: 6, past: [], future: [],
  });
  app.setBpm(130);
  const history = state().past;
  const savedProject = project();
  const savedFile = { name: 'saved.h3k', path: null };
  app.markSaved(savedFile);
  expect(state()).toMatchObject({ file: savedFile, dirty: false });
  expect(project()).toBe(savedProject);
  expect(state().past).toBe(history);
  app.setBpm(140);
  expect(state().past).toHaveLength(2);
  app.undo();
  expect(project()).toBe(savedProject);
  expect(state().dirty).toBe(true);
  app.markSaved(savedFile);
  app.redo();
  expect(state().dirty).toBe(true);
});

test('interface actions leave the document, history and clean status untouched and reject missing selections', () => {
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const p = app.addPattern()!;
  app.openProject(project(), null);
  const before = state();
  app.setView('factory');
  app.selectChannel(b);
  expect(state().channelId).toBe(b);
  app.selectStep({ channelId: a, index: 2 });
  expect(state().channelId).toBe(a);
  expect(state().step).toEqual({ channelId: a, index: 2 });
  app.selectPattern(p);
  expect(state().patternId).toBe(p);
  expect(state().step).toBeNull();
  app.selectChannel(null);
  expect(state().channelId).toBeNull();
  app.selectChannel('missing');
  app.selectPattern('missing');
  app.selectStep({ channelId: 'missing', index: 0 });
  app.selectStep({ channelId: a, index: -1 });
  expect(state().channelId).toBeNull();
  expect(state().patternId).toBe(p);
  expect(state().step).toBeNull();
  app.selectStep({ channelId: b, index: 0 });
  app.selectStep(null);
  expect(state().step).toBeNull();
  app.setScope('song');
  app.setPlaying(true);
  app.setOctave(20);
  expect(state().octave).toBe(6);
  app.setOctave(-1);
  expect(state().octave).toBe(0);
  expect(state()).toMatchObject({ view: 'factory', scope: 'song', playing: true, dirty: false });
  expect(project()).toBe(before.project);
  expect(state().past).toBe(before.past);
  expect(state().future).toBe(before.future);
});
