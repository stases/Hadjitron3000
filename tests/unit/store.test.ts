import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  CHANNEL_COLORS, MAX_BARS, MAX_SONG_BARS, PATTERN_NAMES, SONG_LANES, TICKS_PER_STEP,
  emptyProject, newMod, newModule, newNote, newSound,
} from '../../src/core/defaults';
import { MAX_TICKS } from '../../src/core/meter';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import type { Block, Channel, NoteInit, SampleData } from '../../src/core/types';
import * as app from '../../src/state/store';
import { stepNote } from '../support/steps';

const T = TICKS_PER_STEP;
const state = app.useApp.getState;
const project = () => state().project;
const sound = (id: string) => project().channels.find((c) => c.id === id)!.sound;
const pattern = () => project().patterns.find((p) => p.id === state().patternId)!;
/** Put a one-step note on step `step` of a row; returns its id. */
const put = (p: string, channelId: string, step: number, note = 60) =>
  app.addNote(p, channelId, newNote(step * T, note));
/** The notes of a row of the current block, without their ids. */
const row = (channelId: string): NoteInit[] => (pattern().notes[channelId] ?? []).map(({ id: _, ...n }) => n);
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
    patternId: project().patterns[0].id, placementId: null, step: null, scope: 'pattern', playing: false,
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
  expect(project().channels[0]).toEqual({
    id: first, sound: original, color: 0, mute: false, solo: false, sends: [0, 0],
    duck: { source: null, amount: 0.5, release: 0.25 },
  });
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

test('removing channels clears all pattern notes and selects the next, previous, or no channel', () => {
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const c = app.addChannel(newSound());
  const first = state().patternId;
  put(first, b, 0);
  const second = app.addPattern()!;
  put(second, b, 2);
  put(second, a, 1);
  app.selectStep({ channelId: b, index: 0 });
  app.removeChannel(b);
  expect(state().channelId).toBe(c);
  expect(state().step).toBeNull();
  expect(project().patterns.map((p) => p.notes[b])).toEqual([undefined, undefined]);
  expect(row(a)).toEqual([newNote(T)]);
  app.removeChannel(c);
  expect(state().channelId).toBe(a);
  app.removeChannel(a);
  expect(state().channelId).toBeNull();
});

test('duplicating a channel deep copies the sound, preserves mixer settings, and does not copy notes', () => {
  const a = app.addChannel(newSound('fm', 'Bell'));
  const b = app.addChannel(newSound());
  app.addEffect(a, 'filter');
  app.addMod(a, 'lfo');
  app.setChannel(a, { mute: true, solo: true });
  put(state().patternId, a, 0);
  const original = sound(a);
  const copy = app.duplicateChannel(a)!;
  expect(project().channels.map((c) => c.id)).toEqual([a, copy, b]);
  expect(project().channels[1]).toMatchObject({ color: 2, mute: true, solo: true });
  expect(sound(copy)).toEqual({ ...original, name: 'Bell 2' });
  expect(sound(copy)).not.toBe(original);
  expect(sound(copy).source.params).not.toBe(original.source.params);
  expect(sound(copy).chain[0]).not.toBe(original.chain[0]);
  expect(sound(copy).mods[0]).not.toBe(original.mods[0]);
  expect(pattern().notes[copy]).toBeUndefined();
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

test('replacing and renaming sounds preserves the channel and its notes', () => {
  const a = app.addChannel(newSound(), { old: sample });
  app.setChannel(a, { color: 5, mute: true });
  put(state().patternId, a, 0);
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
  expect(sound(a).mods[0].params.rate).toBe(0.002);
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
    { module: filter, param: 'cutoff' }, { module: 'filter', param: 'cutoff' }, { module: 'source', param: 'pw' },
  ]) {
    app.setModTarget(a, mod, target);
    expect(sound(a).mods[0].target).toEqual(target);
  }
  for (const target of [
    { module: 'source', param: 'fine' }, { module: 'source', param: 'wave' },
    { module: 'source', param: 'missing' }, { module: 'missing', param: 'pitch' },
    { module: 'amp', param: 'attack' }, { module: mod, param: 'rate' }, { module: 'filter', param: 'reso' },
    { module: 'play', param: 'glide' }, null,
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

test('the voice filter, the play controls and where a modulator works are set like any other part', () => {
  const a = app.addChannel(newSound());
  app.setParam(a, 'filter', 'on', true);
  app.setParam(a, 'filter', 'cutoff', 99999);
  app.setParam(a, 'filter', 'slope', '24');
  app.setParam(a, 'play', 'mode', 'legato');
  app.setParam(a, 'play', 'glide', -1);
  app.setParam(a, 'play', 'missing', 1);
  app.setParam(a, 'play', 'arp', 'updown');
  app.setParam(a, 'play', 'octaves', 7);
  expect(sound(a).filter).toMatchObject({ on: true, cutoff: 20000, slope: '24' });
  expect(sound(a).play).toEqual({ mode: 'legato', glide: 0, arp: 'updown', rate: '1/16', octaves: 4, gate: 0.5 });
  const env = app.addMod(a, 'env')!;
  expect(sound(a).mods[0].per).toBe('note');
  app.setModPer(a, env, 'sound');
  expect(sound(a).mods[0].per).toBe('sound');
  app.undo();
  expect(sound(a).mods[0].per).toBe('note');
});

test('notes are added in range, kept sorted, refused on the same start and pitch, and empty rows are removed', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const before = state();
  app.moveNotes(p, a, ['missing'], 24, 1);
  expect(state()).toBe(before);
  const first = app.addNote(p, a, { start: 30.4, len: 0, note: -10, vel: 2 })!;
  expect(first).toMatch(/^n_/);
  expect(pattern().notes[a]).toEqual([{ id: first, start: 30, len: 1, note: MIN_NOTE, vel: 1 }]);
  const chord = [64, 67, 60].map((note) => app.addNote(p, a, newNote(0, note))!);
  expect(row(a).map((n) => [n.start, n.note])).toEqual([[0, 60], [0, 64], [0, 67], [30, MIN_NOTE]]);
  const history = state().past.length;
  expect(app.addNote(p, a, { ...newNote(0, 64), vel: 0.1 })).toBeNull();
  for (const start of [-1, MAX_TICKS, NaN]) expect(app.addNote(p, a, newNote(start))).toBeNull();
  expect(app.addNote(p, a, { ...newNote(), len: Infinity })).toBeNull();
  expect(app.addNote('missing', a, newNote())).toBeNull();
  expect(app.addNote(p, 'missing', newNote())).toBeNull();
  expect(state().past).toHaveLength(history);
  app.addNote(p, a, { start: MAX_TICKS - 1, len: MAX_TICKS * 2, note: 200, vel: -1 });
  expect(row(a).at(-1)).toEqual({ start: MAX_TICKS - 1, len: MAX_TICKS, note: MAX_NOTE, vel: 0 });
  app.removeNotes(p, a, [...chord, first]);
  expect(row(a)).toHaveLength(1);
  app.removeNotes(p, a, pattern().notes[a].map((n) => n.id));
  expect(pattern().notes).toEqual({});
});

test('a set of notes moves, resizes and takes a pitch and a velocity together, inside the ranges', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const [x, y, z] = [[0, 60], [0, 64], [36, 62]].map(([start, note]) => app.addNote(p, a, newNote(start, note))!);
  app.moveNotes(p, a, [x, y], 13, 2);
  expect(row(a).map((n) => [n.start, n.note])).toEqual([[13, 62], [13, 66], [36, 62]]);
  app.moveNotes(p, a, [x, y], -100, -100);
  expect(row(a).map((n) => [n.start, n.note])).toEqual([[0, MIN_NOTE], [0, MIN_NOTE + 4], [36, 62]]);
  app.moveNotes(p, a, [x, y, z], MAX_TICKS, 0.6);
  expect(row(a).map((n) => [n.start, n.note])).toEqual([
    [MAX_TICKS - 37, MIN_NOTE + 1], [MAX_TICKS - 37, MIN_NOTE + 5], [MAX_TICKS - 1, 63],
  ]);
  app.moveNotes(p, a, [x, y, z], -MAX_TICKS, 0);
  app.resizeNotes(p, a, [x, z], -30);
  expect(row(a).map((n) => n.len)).toEqual([1, 24, 1]);
  app.resizeNotes(p, a, [x, y], 23.6);
  expect(row(a).map((n) => n.len)).toEqual([25, 48, 1]);
  app.setNotesVelocity(p, a, [x, z], 1.5);
  expect(row(a).map((n) => n.vel)).toEqual([1, 0.8, 1]);
  app.setNotesPitch(p, a, [z], 59.6);
  expect(row(a).map((n) => n.note)).toEqual([MIN_NOTE + 1, MIN_NOTE + 5, 60]);
  expect(pattern().notes[a].map((n) => n.id)).toEqual([x, y, z]);
});

test('an edit that would put two notes of a row on the same start and pitch does nothing', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const [x, y] = [[0, 60], [24, 60]].map(([start, note]) => app.addNote(p, a, newNote(start, note))!);
  const z = app.addNote(p, a, newNote(24, 64))!;
  const before = state();
  app.moveNotes(p, a, [x], 24);
  app.moveNotes(p, a, [z], 0, -4);
  app.setNotesPitch(p, a, [y, z], 62);
  expect(state()).toBe(before);
  app.moveNotes(p, a, [x, y], 24);
  expect(row(a).map((n) => [n.start, n.note])).toEqual([[24, 60], [24, 64], [48, 60]]);
});

test('several notes are added in one change, leaving out those outside the range or on a taken start and pitch', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const x = put(p, a, 0)!;
  const history = state().past.length;
  const added = app.addNotes(p, a, [
    newNote(0, 60), newNote(0, 64), newNote(12, 60), newNote(12, 60), newNote(MAX_TICKS), { ...newNote(), len: NaN },
  ]);
  expect(added).toHaveLength(2);
  expect(state().past).toHaveLength(history + 1);
  expect(pattern().notes[a].map((n) => [n.id, n.start, n.note])).toEqual([
    [x, 0, 60], [added[0], 0, 64], [added[1], 12, 60],
  ]);
  expect(app.addNotes(p, a, [newNote(0, 60)])).toEqual([]);
  expect(app.addNotes(p, 'missing', [newNote(48)])).toEqual([]);
  expect(app.addNotes('missing', a, [newNote(48)])).toEqual([]);
  expect(state().past).toHaveLength(history + 1);
});

test('notes take new values by id together, in range, and not at all when two would share start and pitch', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const [x, y, z] = [[0, 60], [0, 64], [36, 62]].map(([start, note]) => app.addNote(p, a, newNote(start, note))!);
  const at = (id: string) => pattern().notes[a].find((n) => n.id === id)!;
  app.updateNotes(p, a, [{ ...at(x), start: 50, len: 12.4 }, { ...at(y), start: -5, note: 200, vel: 3 }]);
  expect(row(a)).toEqual([
    { start: 0, len: 24, note: MAX_NOTE, vel: 1 }, { start: 36, len: 24, note: 62, vel: 0.8 },
    { start: 50, len: 12, note: 60, vel: 0.8 },
  ]);
  const before = state();
  app.updateNotes(p, a, [{ ...at(x), start: 36, note: 62 }]);
  app.updateNotes(p, a, [{ ...at(z), len: Infinity }]);
  app.updateNotes(p, a, [{ ...at(z), id: 'missing' }]);
  expect(state()).toBe(before);
  app.updateNotes(p, a, [{ ...at(x), start: 36 }, { ...at(z), start: 50 }]);
  expect(row(a).map((n) => [n.start, n.note])).toEqual([[0, MAX_NOTE], [36, 60], [50, 62]]);
});

test('pattern length is bounded while hidden notes survive shortening', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  app.setPatternBars(p, 99);
  expect(pattern().bars).toBe(MAX_BARS);
  expect(MAX_BARS).toBe(32);
  const last = put(p, a, MAX_TICKS / T - 1)!;
  app.setPatternBars(p, -5);
  expect(pattern().bars).toBe(1);
  expect(row(a)).toEqual([newNote(MAX_TICKS - T)]);
  app.setNotesVelocity(p, a, [last], 0.2);
  expect(row(a)[0].vel).toBe(0.2);
  app.clearPattern(p);
  expect(pattern().notes).toEqual({});
});

test('patterns use unused names, new patterns use current bars, and duplicates copy source bars and notes', () => {
  const a = app.addChannel(newSound());
  const first = state().patternId;
  app.setPatternBars(first, 3);
  put(first, a, 2);
  const song = project().song;
  const second = app.addPattern()!;
  expect(pattern()).toMatchObject({ id: second, name: 'B', bars: 3, notes: {} });
  app.setPatternBars(second, 2);
  const copy = app.duplicatePattern(first)!;
  expect(pattern()).toMatchObject({ id: copy, name: 'C', bars: 3, notes: project().patterns[0].notes });
  expect(row(a)).toEqual([newNote(2 * T)]);
  expect(pattern().notes).not.toBe(project().patterns[0].notes);
  expect(pattern().notes[a][0]).not.toBe(project().patterns[0].notes[a][0]);
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
  expect(app.addNote('missing', a, newNote())).toBeNull();
  expect(app.addNote(p, 'missing', newNote())).toBeNull();
  for (const start of [-1, MAX_TICKS, NaN, Infinity]) expect(app.addNote(p, a, newNote(start))).toBeNull();
  app.removeNotes(p, a, ['missing']);
  app.moveNotes('missing', a, ['missing'], 1, 1);
  app.resizeNotes(p, 'missing', ['missing'], 1);
  app.setNotesPitch(p, a, [], 61);
  app.setNotesVelocity(p, a, ['missing'], 1);
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
  const note = put(p, a, 0)!;
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
  expect(put(p, a, 0)).toBeNull();
  app.moveNotes(p, a, [note], 0, 0);
  app.setNotesPitch(p, a, [note], 60);
  app.setNotesVelocity(p, a, [note], 0.8);
  app.resizeNotes(p, a, [note], 0);
  app.removeNotes(p, a, ['missing']);
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
  put(state().patternId, a, 0);
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

test('merge keys distinguish parameters, modules, channels, modulators, and notes', () => {
  vi.useFakeTimers();
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const mod = app.addMod(a, 'lfo')!;
  const otherMod = app.addMod(a, 'lfo')!;
  const p = state().patternId;
  const x = put(p, a, 0)!;
  const y = put(p, a, 1)!;
  app.openProject(project(), null);
  const edits = [
    () => app.setParam(a, 'source', 'pitch', 1),
    () => app.setParam(b, 'source', 'pitch', 1),
    () => app.setParam(b, 'source', 'fine', 1),
    () => app.setParam(a, 'amp', 'attack', 1),
    () => app.setModAmount(a, mod, 0.1),
    () => app.setModAmount(a, otherMod, 0.1),
    () => app.setNotesVelocity(p, a, [x], 0.1),
    () => app.setNotesVelocity(p, a, [y], 0.1),
    () => app.setNotesVelocity(p, a, [x, y], 0.2),
    () => app.setNotesPitch(p, a, [x, y], 50),
    () => app.moveNotes(p, a, [x, y], 0, 1),
    () => app.resizeNotes(p, a, [x, y], 1),
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
  const x = put(p, a, 0)!;
  app.openProject(project(), null);
  const bursts = [
    () => { app.setBpm(130); app.setBpm(140); },
    () => { app.setSwing(0.1); app.setSwing(0.2); },
    () => { app.setMaster(-1); app.setMaster(-2); },
    () => { app.renameProject('One'); app.renameProject('Two'); },
    () => { app.renameSound(a, 'One'); app.renameSound(a, 'Two'); },
    () => { app.setModAmount(a, mod, 0.1); app.setModAmount(a, mod, 0.2); },
    () => { app.setNotesVelocity(p, a, [x], 0.1); app.setNotesVelocity(p, a, [x], 0.2); },
    () => { app.moveNotes(p, a, [x], 0, 1); app.moveNotes(p, a, [x], 0, 1); },
    () => { app.resizeNotes(p, a, [x], 1); app.resizeNotes(p, a, [x], 1); },
  ];
  bursts.forEach((burst, index) => {
    burst();
    expect(state().past).toHaveLength(index + 1);
  });
  app.setChannel(a, { mute: true });
  app.setNotesVelocity(p, a, [x], 0.3);
  expect(state().past).toHaveLength(11);
  put(p, a, 1);
  put(p, a, 2);
  app.removeNotes(p, a, [x]);
  expect(state().past).toHaveLength(14);
});

test('history keeps only the newest 100 previous projects', () => {
  const a = app.addChannel(newSound());
  app.openProject(project(), null);
  for (let i = 1; i <= 105; i++) app.addNote(state().patternId, a, newNote(i));
  expect(state().past).toHaveLength(100);
  expect(state().past[0].patterns[0].notes[a]).toHaveLength(5);
  for (let i = 0; i < 100; i++) app.undo();
  expect(pattern().notes[a]).toHaveLength(5);
  expect(state().future).toHaveLength(100);
  for (let i = 0; i < 100; i++) app.redo();
  expect(pattern().notes[a]).toHaveLength(105);
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
  app.addPlacement(state().patternId, 0, 0);
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
    patternId: opened.patterns[0].id, placementId: null, step: null, scope: 'pattern', playing: false,
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

test('block names trim, truncate and merge per block, with undo and redo', () => {
  vi.useFakeTimers();
  const first = state().patternId;
  const second = app.addPattern()!;
  app.openProject(project(), null);
  const before = project();
  app.renamePattern(first, '  Intro  ');
  expect(pattern().name).toBe('Intro');
  app.renamePattern(first, '  A very long name for this block  ');
  expect(pattern().name).toBe('A very long name for thi');
  expect(state().past).toEqual([before]);
  const renamed = project();
  app.undo();
  expect(project()).toBe(before);
  app.redo();
  expect(project()).toBe(renamed);
  app.renamePattern(second, 'Outro');
  expect(state().past).toHaveLength(2);
  const unchanged = state();
  app.renamePattern(first, '   ');
  app.renamePattern(first, ` ${pattern().name} `);
  app.renamePattern('missing', 'No');
  expect(state()).toBe(unchanged);
  app.renamePattern(first, `${'x'.repeat(23)} tail`);
  expect(pattern().name).toBe('x'.repeat(23));
});

test('block colors round and clamp, reject nonfinite values, and undo and redo', () => {
  const id = state().patternId;
  for (const [input, expected] of [[2.6, 3], [99, CHANNEL_COLORS - 1], [-2, 0]]) {
    const before = project();
    app.setPatternColor(id, input);
    expect(pattern().color).toBe(expected);
    const after = project();
    app.undo();
    expect(project()).toBe(before);
    app.redo();
    expect(project()).toBe(after);
  }
  const unchanged = state();
  for (const value of [0, NaN, Infinity, -Infinity]) app.setPatternColor(id, value);
  app.setPatternColor('missing', 2);
  expect(state()).toBe(unchanged);
});

test('new blocks balance block colors and duplicates keep their source color, with undo and redo', () => {
  const first = state().patternId;
  app.addChannel(newSound());
  app.setChannel(state().channelId!, { color: 1 });
  for (let i = 1; i < CHANNEL_COLORS + 2; i++) app.addPattern();
  expect(project().patterns.map((p) => p.color)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  app.removePattern(project().patterns[3].id);
  const before = project();
  const added = app.addPattern()!;
  expect(pattern()).toMatchObject({ id: added, name: 'D', color: 3 });
  const after = project();
  app.undo();
  expect(project()).toBe(before);
  app.redo();
  expect(project()).toBe(after);
  app.setPatternColor(first, 6);
  const beforeCopy = project();
  const copy = app.duplicatePattern(first)!;
  expect(pattern()).toMatchObject({ id: copy, name: 'K', color: 6 });
  const afterCopy = project();
  app.undo();
  expect(project()).toBe(beforeCopy);
  app.redo();
  expect(project()).toBe(afterCopy);
});

test('block limits apply even when custom names leave unused letters', () => {
  const block: Block = { name: 'Custom', color: 2, bars: 1, tracks: [], samples: {} };
  while (project().patterns.length < PATTERN_NAMES.length) expect(app.insertBlock(block)).not.toBeNull();
  app.renamePattern(project().patterns[0].id, 'Another custom name');
  const before = state();
  expect(app.addPattern()).toBeNull();
  expect(app.duplicatePattern(state().patternId)).toBeNull();
  expect(app.insertBlock(block)).toBeNull();
  expect(state()).toBe(before);
});

test('adding placements rounds positions, selects their block, fits gaps and supports undo and redo', () => {
  const first = state().patternId;
  const channel = app.addChannel(newSound());
  app.setPatternBars(first, 8);
  const next = app.addPlacement(first, 0, 5)!;
  const later = app.addPlacement(first, 0, 20)!;
  app.addPattern();
  app.selectStep({ channelId: channel, index: 0 });
  const before = project();
  const id = app.addPlacement(first, 0.2, 1.6)!;
  expect(project().song).toEqual([
    { id: next, pattern: first, lane: 0, bar: 5, bars: 8 },
    { id: later, pattern: first, lane: 0, bar: 20, bars: 8 },
    { id, pattern: first, lane: 0, bar: 2, bars: 3 },
  ]);
  expect(state()).toMatchObject({ placementId: id, patternId: first, step: null });
  const after = project();
  app.undo();
  expect(project()).toBe(before);
  expect(state().placementId).toBeNull();
  app.redo();
  expect(project()).toBe(after);
  expect(app.addPlacement(first, 1, 2)).not.toBeNull();
  expect(app.addPlacement(first, 0, 13)).not.toBeNull();
  const end = app.addPlacement(first, SONG_LANES - 1, MAX_SONG_BARS - 2)!;
  expect(project().song.find((p) => p.id === end)?.bars).toBe(2);
});

test('invalid or occupied placement positions do nothing and preserve redo history', () => {
  const p = state().patternId;
  app.setPatternBars(p, 4);
  const id = app.addPlacement(p, 0, 2)!;
  app.renameProject('Changed');
  app.undo();
  const before = state();
  for (const [lane, bar] of [
    [-1, 0], [SONG_LANES, 0], [0, -1], [0, MAX_SONG_BARS],
    [NaN, 0], [Infinity, 0], [0, NaN], [0, Infinity], [0, -Infinity],
  ]) {
    expect(app.addPlacement(p, lane, bar)).toBeNull();
    app.movePlacement(id, lane, bar);
  }
  for (const bar of [2, 3, 5]) expect(app.addPlacement(p, 0, bar)).toBeNull();
  expect(app.addPlacement('missing', 1, 0)).toBeNull();
  app.movePlacement('missing', 0, 0);
  app.resizePlacement('missing', 2);
  app.removePlacement('missing');
  app.selectPlacement('missing');
  app.movePlacement(id, 0, 2);
  app.resizePlacement(id, 4);
  for (const bars of [NaN, Infinity, -Infinity]) app.resizePlacement(id, bars);
  expect(state()).toBe(before);
});

test('moves keep length, reject overlaps in either direction and permit adjacent and cross-lane placements', () => {
  const p = state().patternId;
  app.setPatternBars(p, 4);
  const id = app.addPlacement(p, 0, 0)!;
  app.addPlacement(p, 0, 6);
  const before = state();
  for (const bar of [3, 5, 6, 8, MAX_SONG_BARS - 3]) app.movePlacement(id, 0, bar);
  expect(state()).toBe(before);
  app.movePlacement(id, 0, 2);
  expect(project().song[0]).toMatchObject({ lane: 0, bar: 2, bars: 4 });
  app.movePlacement(id, 0, 10);
  expect(project().song[0]).toMatchObject({ bar: 10, bars: 4 });
  app.movePlacement(id, 0.6, 5.6);
  expect(project().song[0]).toMatchObject({ lane: 1, bar: 6, bars: 4 });
  app.movePlacement(id, 1, MAX_SONG_BARS - 4);
  expect(project().song[0]).toMatchObject({ bar: MAX_SONG_BARS - 4, bars: 4 });
});

test('resizing rounds and clamps to the next placement or timeline end', () => {
  const p = state().patternId;
  const id = app.addPlacement(p, 0, 2)!;
  app.addPlacement(p, 0, 10);
  app.addPlacement(p, 0, 6);
  app.addPlacement(p, 1, 3);
  app.resizePlacement(id, 100);
  expect(project().song[0].bars).toBe(4);
  const before = state();
  app.resizePlacement(id, 1000);
  expect(state()).toBe(before);
  app.resizePlacement(id, 2.6);
  expect(project().song[0].bars).toBe(3);
  app.resizePlacement(id, -10);
  expect(project().song[0].bars).toBe(1);
  app.movePlacement(id, 2, MAX_SONG_BARS - 3);
  app.resizePlacement(id, MAX_SONG_BARS);
  expect(project().song[0].bars).toBe(3);
});

test.each(['move', 'resize'] as const)('%s drags merge per placement with undo, redo and timeout', (action) => {
  vi.useFakeTimers();
  const p = state().patternId;
  const id = app.addPlacement(p, 0, 0)!;
  const other = app.addPlacement(p, 1, 0)!;
  app.openProject(project(), null);
  const change = (target: string, value: number) => action === 'move'
    ? app.movePlacement(target, 2, value) : app.resizePlacement(target, value);
  const before = project();
  change(id, 2);
  vi.advanceTimersByTime(700);
  change(id, 3);
  vi.advanceTimersByTime(700);
  change(id, 4);
  expect(state().past).toEqual([before]);
  const after = project();
  app.undo();
  expect(project()).toBe(before);
  app.redo();
  expect(project()).toBe(after);
  change(id, 5);
  change(other, 8);
  expect(state().past).toHaveLength(3);
  vi.advanceTimersByTime(800);
  change(other, 9);
  expect(state().past).toHaveLength(4);
});

test('move and resize merge keys are distinct and unchanged calls add no history', () => {
  vi.useFakeTimers();
  const id = app.addPlacement(state().patternId, 0, 0)!;
  app.openProject(project(), null);
  app.movePlacement(id, 1, 2);
  app.resizePlacement(id, 3);
  expect(state().past).toHaveLength(2);
  const before = state();
  app.movePlacement(id, 1.1, 2.1);
  app.resizePlacement(id, 3.1);
  expect(state()).toBe(before);
  app.undo();
  expect(project().song[0]).toMatchObject({ lane: 1, bar: 2, bars: 1 });
  app.undo();
  expect(project().song[0]).toMatchObject({ lane: 0, bar: 0, bars: 1 });
});

test('placement selection switches blocks, clears steps, and leaves the document and history untouched', () => {
  const first = state().patternId;
  const channel = app.addChannel(newSound());
  const id = app.addPlacement(first, 0, 0)!;
  app.addPattern();
  app.selectStep({ channelId: channel, index: 0 });
  app.markSaved({ name: 'saved.h3k', path: null });
  const before = state();
  app.setView('song');
  app.selectPlacement(id);
  expect(state()).toMatchObject({ view: 'song', placementId: id, patternId: first, step: null, dirty: false });
  app.selectPlacement(null);
  expect(state()).toMatchObject({ placementId: null, patternId: first });
  expect(project()).toBe(before.project);
  expect(state().past).toBe(before.past);
  expect(state().future).toBe(before.future);
});

test('removing placements repairs selection, preserves other placements, and supports undo and redo', () => {
  const p = state().patternId;
  const other = app.addPlacement(p, 1, 0)!;
  const id = app.addPlacement(p, 0, 0)!;
  const before = project();
  app.removePlacement(other);
  expect(state().placementId).toBe(id);
  app.undo();
  expect(project()).toBe(before);
  app.removePlacement(id);
  expect(project().song.map((s) => s.id)).toEqual([other]);
  expect(state().placementId).toBeNull();
  const after = project();
  app.undo();
  expect(project()).toBe(before);
  app.selectPlacement(id);
  app.redo();
  expect(project()).toBe(after);
  expect(state().placementId).toBeNull();
});

test('removing a block removes its placements and repairs selections, with undo and redo', () => {
  const first = state().patternId;
  const keep = app.addPlacement(first, 0, 0)!;
  const second = app.addPattern()!;
  app.addPlacement(second, 1, 0);
  const selected = app.addPlacement(second, 2, 0)!;
  const before = project();
  app.removePattern(second);
  expect(project().song.map((s) => s.id)).toEqual([keep]);
  expect(state()).toMatchObject({ patternId: first, placementId: null });
  const after = project();
  app.undo();
  expect(project()).toBe(before);
  app.selectPlacement(selected);
  app.redo();
  expect(project()).toBe(after);
  expect(state()).toMatchObject({ patternId: first, placementId: null });
  const unchanged = state();
  app.removePattern(first);
  expect(state()).toBe(unchanged);
});

test('inserting a block reuses the first identical unused sounds and adds balanced channels in one undo step', () => {
  const original = newSound('fm', 'Bell');
  original.chain.push(newModule('filter'));
  original.mods.push(newMod('lfo'));
  const a = app.addChannel(original, { old: sample });
  const b = app.addChannel(structuredClone(original));
  const different = structuredClone(original);
  different.chain[0].params.cutoff = 4321;
  const c = app.addChannel(different);
  app.setChannel(a, { mute: true, solo: true });
  const fresh = newSound('sample', 'Kick');
  fresh.source.params.sample = 'kick';
  const block: Block = {
    name: 'Imported beat', color: 6, bars: 3,
    tracks: [original, original, original, fresh].map((sound, index) => ({
      sound: structuredClone(sound), notes: [stepNote(index, 60 + index)],
    })),
    samples: { kick: structuredClone(sample), old: { name: 'duplicate.wav', bytes: new Uint8Array([9]) } },
  };
  app.selectStep({ channelId: c, index: 0 });
  const before = project();
  const history = state().past.length;
  const id = app.insertBlock(block)!;
  const channels = project().channels;
  expect(channels).toHaveLength(5);
  expect(channels.map((channel) => channel.color)).toEqual([0, 1, 2, 3, 4]);
  expect(channels[0]).toBe(before.channels[0]);
  expect(channels[3]).toMatchObject({ sound: original, mute: false, solo: false });
  expect(channels[4].sound).toEqual(fresh);
  expect(pattern()).toEqual({
    id, name: block.name, color: block.color, bars: block.bars,
    notes: {
      [a]: [stepNote(0, 60)], [b]: [stepNote(1, 61)],
      [channels[3].id]: [stepNote(2, 62)], [channels[4].id]: [stepNote(3, 63)],
    },
  });
  expect(state()).toMatchObject({ patternId: id, step: null });
  expect(project().samples.old).toBe(sample);
  expect(project().samples.kick).toEqual(sample);
  expect(state().past).toHaveLength(history + 1);
  const after = project();
  app.undo();
  expect(project()).toBe(before);
  expect(state().patternId).toBe(before.patterns[0].id);
  app.redo();
  expect(project()).toBe(after);
});

test('inserting a block normalizes notes and deeply isolates all imported data', () => {
  const importedSound = newSound();
  importedSound.chain.push(newModule('filter'));
  importedSound.mods.push(newMod('lfo'));
  const block: Block = {
    name: 'Long block name kept as supplied', color: 5, bars: 2,
    tracks: [{
      sound: importedSound,
      notes: [
        { id: 'a', start: 0, len: 0, note: -5, vel: 2 }, { id: 'b', start: 24, len: 66.8, note: 200, vel: -1 },
        { id: 'c', start: 48, len: 24, note: 60.6, vel: 0.4 }, { ...stepNote(0), id: 'd' },
        { ...stepNote(0), id: 'last', start: MAX_TICKS - 1 },
        { ...stepNote(0), id: 'e', start: MAX_TICKS }, { ...stepNote(0), id: 'f', start: -1 },
      ],
    }],
    samples: { kick: structuredClone(sample) },
  };
  const original = structuredClone(block);
  app.insertBlock(block);
  const channel = project().channels[0];
  expect(pattern()).toMatchObject({ name: block.name, color: 5, bars: 2 });
  expect(pattern().notes[channel.id]).toEqual([
    { id: 'a', start: 0, len: 1, note: MIN_NOTE, vel: 1 }, { ...stepNote(0), id: 'd' },
    { id: 'b', start: 24, len: 67, note: MAX_NOTE, vel: 0 }, { id: 'c', start: 48, len: 24, note: 61, vel: 0.4 },
    { ...stepNote(0), id: 'last', start: MAX_TICKS - 1 },
  ]);
  expect(block).toEqual(original);
  expect(channel.sound).not.toBe(importedSound);
  expect(channel.sound.source.params).not.toBe(importedSound.source.params);
  expect(channel.sound.chain[0].params).not.toBe(importedSound.chain[0].params);
  expect(channel.sound.mods[0]).not.toBe(importedSound.mods[0]);
  expect(pattern().notes[channel.id]).not.toBe(block.tracks[0].notes);
  expect(pattern().notes[channel.id][4]).not.toBe(block.tracks[0].notes[4]);
  expect(project().samples.kick).not.toBe(block.samples.kick);
  expect(project().samples.kick.bytes.buffer).not.toBe(block.samples.kick.bytes.buffer);
  block.tracks[0].sound.source.params.pitch = 12;
  block.tracks[0].sound.chain[0].params.cutoff = 500;
  block.tracks[0].sound.mods[0].amount = 0.1;
  block.tracks[0].notes[4].note = 80;
  block.samples.kick.bytes[0] = 99;
  expect(channel.sound).toEqual(original.tracks[0].sound);
  expect(pattern().notes[channel.id][4].note).toBe(60);
  expect(project().samples.kick.bytes[0]).toBe(1);
});

test('removing a channel keeps imported blocks and their placements valid, with undo and redo', () => {
  const id = app.insertBlock({
    name: 'Beat', color: 2, bars: 2,
    tracks: [
      { sound: newSound(), notes: [stepNote(0)] },
      { sound: newSound('fm'), notes: [stepNote(1, 65)] },
    ],
    samples: {},
  })!;
  app.addPlacement(id, 0, 0);
  const song = project().song;
  const channel = project().channels[0].id;
  app.selectStep({ channelId: channel, index: 0 });
  const before = project();
  app.removeChannel(channel);
  expect(project().song).toBe(song);
  expect(pattern().notes[channel]).toBeUndefined();
  expect(Object.keys(pattern().notes)).toEqual([project().channels[0].id]);
  expect(state().step).toBeNull();
  expect(state().placementId).toBe(song[0].id);
  const after = project();
  app.undo();
  expect(project()).toBe(before);
  app.redo();
  expect(project()).toBe(after);
  app.removeChannel(project().channels[0].id);
  expect(pattern().notes).toEqual({});
  expect(project().song).toBe(song);
});

test('a gesture is one undo step: a paint stroke of several notes', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  app.openProject(project(), null);
  const before = project();
  app.beginGesture();
  for (const step of [0, 1, 2, 3]) put(p, a, step);
  app.commitGesture();
  expect(row(a)).toHaveLength(4);
  expect(state().past).toEqual([before]);
  app.undo();
  expect(project()).toBe(before);
  app.redo();
  expect(row(a)).toHaveLength(4);
});

test('a gesture is one undo step however long it pauses, and the next change starts a new one', () => {
  vi.useFakeTimers();
  const p = state().patternId;
  app.setPatternBars(p, 2);
  const id = app.addPlacement(p, 0, 0)!;
  app.openProject(project(), null);
  const before = project();
  app.beginGesture();
  app.movePlacement(id, 0, 1);
  vi.advanceTimersByTime(2000);
  app.movePlacement(id, 1, 3);
  vi.advanceTimersByTime(2000);
  app.resizePlacement(id, 4);
  app.commitGesture();
  expect(state().past).toEqual([before]);
  app.movePlacement(id, 1, 4);
  expect(state().past).toHaveLength(2);
  app.undo();
  app.undo();
  expect(project()).toBe(before);
});

test('a gesture without a change adds no history, and an undo inside a gesture keeps the history whole', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  app.openProject(project(), null);
  const before = state();
  app.beginGesture();
  app.selectStep({ channelId: a, index: 0 });
  app.commitGesture();
  expect(state().past).toBe(before.past);
  put(p, a, 0);
  const one = project();
  app.beginGesture();
  put(p, a, 1);
  app.undo();
  put(p, a, 2);
  app.commitGesture();
  expect(state().past).toEqual([before.project, one]);
});

test('duplicating a placement puts a copy of the same length right after it in one undo step', () => {
  const p = state().patternId;
  app.setPatternBars(p, 2);
  const id = app.addPlacement(p, 1, 3)!;
  app.resizePlacement(id, 5);
  app.addPlacement(p, 1, 11);
  app.openProject(project(), null);
  const before = project();
  const copy = app.duplicatePlacement(id)!;
  expect(project().song.find((s) => s.id === copy)).toEqual({ id: copy, pattern: p, lane: 1, bar: 8, bars: 3 });
  expect(state()).toMatchObject({ placementId: copy, patternId: p });
  expect(state().past).toEqual([before]);
  expect(app.duplicatePlacement(copy)).toBeNull();
  expect(app.duplicatePlacement('missing')).toBeNull();
  app.undo();
  expect(project()).toBe(before);
  const end = app.addPlacement(p, 0, MAX_SONG_BARS - 2)!;
  expect(app.duplicatePlacement(end)).toBeNull();
});

test('extras are set on several notes in one undo step, kept by other edits, and default values take them away', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const [x, y, z] = [[0, 60], [0, 64], [48, 62]].map(([start, note]) => app.addNote(p, a, newNote(start, note))!);
  const steps = state().past.length;
  app.setNotesExtras(p, a, [x, y], { chance: 40 });
  app.setNotesExtras(p, a, [x, y], { chance: 25.4 });
  expect(state().past.length).toBe(steps + 1);
  app.setNotesExtras(p, a, [y, z], { ratchet: 4, slide: true, hold: true });
  expect(pattern().notes[a].map(({ id: _, ...n }) => n)).toEqual([
    { ...newNote(0, 60), chance: 25 },
    { ...newNote(0, 64), chance: 25, ratchet: 4, slide: true, hold: true },
    { ...newNote(48, 62), ratchet: 4, slide: true, hold: true },
  ]);
  expect(state().past.length).toBe(steps + 2);
  app.moveNotes(p, a, [x, y, z], 24, 1);
  app.resizeNotes(p, a, [z], 12);
  app.updateNotes(p, a, [{ ...pattern().notes[a][0], vel: 0.5 }]);
  expect(pattern().notes[a].map((n) => [n.chance, n.ratchet, n.hold])).toEqual([
    [25, undefined, undefined], [25, 4, true], [undefined, 4, true],
  ]);
  app.setNotesExtras(p, a, [x, y, z], { chance: 100, ratchet: 1, slide: false, hold: false });
  for (const n of pattern().notes[a]) expect(Object.keys(n)).toEqual(['id', 'start', 'len', 'note', 'vel']);
  app.setNotesExtras(p, a, [x], { ratchet: 5 });
  expect(pattern().notes[a][0]).not.toHaveProperty('ratchet');
  app.undo();
  expect(pattern().notes[a][1]).toMatchObject({ chance: 25, ratchet: 4, slide: true, hold: true });
});

test('a new meter keeps every note at its tick, gives each block the bars that hold it, and is one undo step', () => {
  const a = app.addChannel(newSound());
  const first = state().patternId;
  app.setPatternBars(first, 2);
  app.addNote(first, a, { ...newNote(31 * T), len: 2 * T });
  const second = app.addPattern()!;
  app.setPatternBars(second, 1);
  app.addNote(second, a, newNote(0));
  app.addNote(second, a, newNote(40 * T));
  app.addPlacement(first, 0, 3);
  const before = project();
  const steps = state().past.length;
  app.setMeter([7, 8]);
  expect(project().meter).toEqual([7, 8]);
  // 2 bars of 4/4 are 32 steps and the note ends on step 33: three bars of 14 steps. 16 steps need two bars; the
  // note past the end of the one-bar block stays where it is and does not count.
  expect(project().patterns.map((pt) => pt.bars)).toEqual([3, 2]);
  expect(project().patterns.map((pt) => pt.notes)).toEqual(before.patterns.map((pt) => pt.notes));
  expect(project().song).toEqual(before.song);
  expect(state().past.length).toBe(steps + 1);
  // Each change keeps at least the length before it: 672 ticks of 7/8 need two bars of 12/8.
  app.setMeter([12, 8]);
  expect(project().patterns.map((pt) => pt.bars)).toEqual([2, 2]);
  app.setMeter([2, 4]);
  expect(project().patterns.map((pt) => pt.bars)).toEqual([6, 6]);
  const now = project();
  app.setMeter([2, 4]);
  app.setMeter([3, 3] as never);
  expect(project()).toBe(now);
  app.undo();
  app.undo();
  app.undo();
  expect(project()).toEqual(before);
});

test('fades are whole bars inside their placement, merge while a stepper repeats, and undo', () => {
  vi.useFakeTimers();
  const p = state().patternId;
  const id = app.addPlacement(p, 0, 0)!;
  app.resizePlacement(id, 8);
  const placement = () => project().song.find((s) => s.id === id)!;
  const before = state().past.length;
  app.setPlacementFades(id, 1, 0);
  app.setPlacementFades(id, 2.4, 0);
  app.setPlacementFades(id, 2, 3);
  expect(placement()).toMatchObject({ fadeIn: 2, fadeOut: 3 });
  expect(state().past.length).toBe(before + 1);
  vi.advanceTimersByTime(1000);
  app.setPlacementFades(id, 9, 9);
  expect(placement()).toMatchObject({ fadeIn: 8 });
  expect(placement()).not.toHaveProperty('fadeOut');
  app.setPlacementFades(id, Number.NaN, 1);
  expect(placement().fadeIn).toBe(8);
  vi.advanceTimersByTime(1000);
  app.setPlacementFades(id, 0, 0);
  expect(Object.keys(placement())).toEqual(['id', 'pattern', 'lane', 'bar', 'bars']);
  app.undo();
  expect(placement()).toMatchObject({ fadeIn: 8 });
  app.undo();
  expect(placement()).toMatchObject({ fadeIn: 2, fadeOut: 3 });
  app.undo();
  expect(placement()).not.toHaveProperty('fadeIn');
});

test('shortening a placement shortens its fades, the fade-out first, and a longer one keeps them', () => {
  const p = state().patternId;
  const id = app.addPlacement(p, 0, 0)!;
  app.resizePlacement(id, 8);
  app.setPlacementFades(id, 3, 4);
  const placement = () => project().song.find((s) => s.id === id)!;
  app.resizePlacement(id, 12);
  expect(placement()).toMatchObject({ bars: 12, fadeIn: 3, fadeOut: 4 });
  app.resizePlacement(id, 5);
  expect(placement()).toMatchObject({ bars: 5, fadeIn: 3, fadeOut: 2 });
  app.resizePlacement(id, 2);
  expect(placement()).toMatchObject({ bars: 2, fadeIn: 2 });
  expect(placement()).not.toHaveProperty('fadeOut');
});

test('a resize drag gives the fades back as far as they fit, in one undo step', () => {
  const p = state().patternId;
  const id = app.addPlacement(p, 0, 0)!;
  app.resizePlacement(id, 8);
  app.setPlacementFades(id, 2, 4);
  const placement = () => project().song.find((s) => s.id === id)!;
  const before = project();
  app.beginGesture();
  for (const bars of [6, 3, 1, 4, 8]) {
    app.resizePlacement(id, bars);
    app.setPlacementFades(id, 2, 4);
  }
  app.commitGesture();
  expect(placement()).toMatchObject({ bars: 8, fadeIn: 2, fadeOut: 4 });
  expect(state().past.at(-1)).toBe(before);
});

test('a sound is muted in one placement only, the list keeps channel order, and undo brings it back', () => {
  const [a, b, c] = [newSound(), newSound('fm'), newSound()].map((s) => app.addChannel(s));
  const p = state().patternId;
  const first = app.addPlacement(p, 0, 0)!;
  const second = app.addPlacement(p, 0, 1)!;
  const mutes = (id: string) => project().song.find((s) => s.id === id)!.mutes;
  app.setPlacementMute(first, c, true);
  app.setPlacementMute(first, a, true);
  app.setPlacementMute(first, a, true);
  app.setPlacementMute(first, 'missing', true);
  app.setPlacementMute('missing', b, true);
  expect(mutes(first)).toEqual([a, c]);
  expect(mutes(second)).toBeUndefined();
  const muted = project();
  app.setPlacementMute(first, a, false);
  app.setPlacementMute(first, c, false);
  expect(project().song.find((s) => s.id === first)).not.toHaveProperty('mutes');
  app.undo();
  app.undo();
  expect(project()).toBe(muted);
  // Removing a sound takes it out of the mutes, and the list goes when it is empty.
  app.removeChannel(a);
  expect(mutes(first)).toEqual([c]);
  app.removeChannel(c);
  expect(project().song.find((s) => s.id === first)).not.toHaveProperty('mutes');
});

test('a duplicated placement copies its fades and mutes, fitted to the room it gets', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const id = app.addPlacement(p, 0, 0)!;
  app.resizePlacement(id, 6);
  app.setPlacementFades(id, 2, 3);
  app.setPlacementMute(id, a, true);
  const copy = app.duplicatePlacement(id)!;
  expect(project().song.find((s) => s.id === copy)).toEqual({
    id: copy, pattern: p, lane: 0, bar: 6, bars: 6, fadeIn: 2, fadeOut: 3, mutes: [a],
  });
  expect(project().song.find((s) => s.id === copy)!.mutes).not.toBe(project().song.find((s) => s.id === id)!.mutes);
  app.addPlacement(p, 1, 16);
  app.movePlacement(project().song.at(-1)!.id, 0, 16);
  const short = app.duplicatePlacement(copy)!;
  expect(project().song.find((s) => s.id === short)).toMatchObject({ bar: 12, bars: 4, fadeIn: 2, fadeOut: 2 });
});

test('lanes have a level in dB down to silence and a mute, a turned level is one undo step', () => {
  vi.useFakeTimers();
  expect(project().lanes).toEqual(Array(SONG_LANES).fill({ level: 0, mute: false }));
  const before = state().past.length;
  app.setLane(1, { level: -3 });
  app.setLane(1, { level: -12.5 });
  expect(state().past.length).toBe(before + 1);
  app.setLane(2, { mute: true });
  app.setLane(3, { level: 20 });
  app.setLane(0, { level: -100 });
  app.setLane(0, { level: Number.NaN });
  app.setLane(SONG_LANES, { mute: true });
  expect(project().lanes).toEqual([
    { level: -48, mute: false }, { level: -12.5, mute: false }, { level: 0, mute: true }, { level: 6, mute: false },
  ]);
  expect(state().past.length).toBe(before + 4);
  app.undo();
  app.undo();
  app.undo();
  expect(project().lanes[1]).toEqual({ level: -12.5, mute: false });
  expect(project().lanes[2].mute).toBe(false);
});

test('sends, ducking and the bus faders keep their ranges, and a knob turned is one undo step', () => {
  vi.useFakeTimers();
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const steps = state().past.length;
  app.setSend(a, 0, 0.2);
  app.setSend(a, 0, 0.4);
  app.setSend(a, 1, 7);
  app.setSend(a, 2, 0.5);
  app.setSend(a, 0, NaN);
  expect(project().channels[0].sends).toEqual([0.4, 1]);
  expect(state().past.length).toBe(steps + 2);
  app.setDuck(a, { source: b, amount: 2, release: 0 });
  expect(project().channels[0].duck).toEqual({ source: b, amount: 1, release: 0.02 });
  app.setDuck(a, { source: a });
  app.setDuck(b, { source: 'missing', release: 99 });
  expect(project().channels.map((c) => c.duck)).toEqual([
    { source: null, amount: 1, release: 0.02 },
    { source: null, amount: 0.5, release: 4 },
  ]);
  app.setDuck(b, { source: a });
  app.setBus(0, { name: '  Hall with a long name ', level: 20, mute: true });
  app.setBus(1, { name: '   ', level: -100 });
  app.setBus(2, { mute: true });
  expect(project().mixer.buses.map((bus) => [bus.name, bus.level, bus.mute])).toEqual([
    ['Hall with a', 6, true],
    ['Echo', -48, false],
  ]);
  // Taking the source away leaves the channel that ducked to it without a source.
  app.removeChannel(a);
  expect(project().channels[0].duck.source).toBeNull();
  app.undo();
  expect(project().channels[1].duck.source).toBe(a);
});

test('the racks of the buses and the master take effects like a sound does, fully wet on a bus', () => {
  const master = { rack: 'master' } as const;
  const room = { rack: 0 } as const;
  expect(app.addEffect(master, 'lfo')).toBeNull();
  const filter = app.addEffect(master, 'filter')!;
  const delay = app.addEffect(master, 'delay', 0)!;
  expect(project().mixer.master.chain.map((m) => [m.id, m.params.mix])).toEqual([[delay, 0.3], [filter, undefined]]);
  app.moveEffect(master, delay, 1);
  expect(project().mixer.master.chain.map((m) => m.id)).toEqual([filter, delay]);
  app.setParam(master, delay, 'feedback', 2);
  app.setParam(master, delay, 'nothing', 2);
  app.setParam(master, 'missing', 'feedback', 0.1);
  app.setModuleOn(master, filter, false);
  expect(project().mixer.master.chain.map((m) => [m.on, m.params.feedback])).toEqual([
    [false, undefined],
    [true, 0.95],
  ]);
  app.removeModule(master, filter);
  expect(project().mixer.master.chain.map((m) => m.id)).toEqual([delay]);
  const drive = app.addEffect(room, 'drive')!;
  const echo = app.addEffect({ rack: 1 }, 'reverb', 0)!;
  expect(project().mixer.buses[0].chain.map((m) => m.type)).toEqual(['reverb', 'drive']);
  expect(project().mixer.buses[1].chain.map((m) => [m.id, m.params.mix])).toEqual([[echo, 1], [expect.any(String), 1]]);
  app.removeModule(room, drive);
  app.undo();
  expect(project().mixer.buses[0].chain.map((m) => m.id)).toContain(drive);
});

test('a sound from a library or a block starts with no sends and no ducking', () => {
  const a = app.addChannel(newSound());
  app.setSend(a, 0, 0.5);
  app.setDuck(a, { source: app.addChannel(newSound()) });
  app.insertBlock({ name: 'X', color: 0, bars: 1, tracks: [{ sound: newSound('noise'), notes: [] }], samples: {} });
  expect(project().channels.at(-1)).toMatchObject({ sends: [0, 0], duck: { source: null } });
  const copy = app.duplicateChannel(a)!;
  expect(project().channels.find((c) => c.id === copy)?.sends).toEqual([0.5, 0]);
});

test('the scale is set and taken away in one undo step each, and leaves the notes alone', () => {
  const a = app.addChannel(newSound());
  put(state().patternId, a, 0, 61);
  app.setScale({ root: 2, type: 'minor' });
  expect(project().scale).toEqual({ root: 2, type: 'minor' });
  expect(row(a)[0].note).toBe(61);
  app.setScale({ root: 14, type: 'minor' });
  expect(project()).not.toHaveProperty('scale');
  app.undo();
  expect(project().scale).toEqual({ root: 2, type: 'minor' });
  app.undo();
  expect(project()).not.toHaveProperty('scale');
});

test('Fit to Scale moves the chosen notes onto the nearest scale notes, merging collisions, in one step', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  const ids = [60, 61, 63, 66, 70].map((n) => put(p, a, 0, n)!);
  const later = put(p, a, 4, 61)!;
  const before = state().past.length;
  app.fitToScale(p, a, ids);
  expect(state().past.length).toBe(before);
  app.setScale({ root: 0, type: 'major' });
  app.fitToScale(p, a, ids);
  // C# lands on C, which is there already, and goes; D# to D, F# to F, A# to A; the later C# was not chosen.
  expect(row(a).map((n) => [n.start, n.note])).toEqual([[0, 60], [0, 62], [0, 65], [0, 69], [4 * T, 61]]);
  expect(state().past.length).toBe(before + 2);
  app.fitToScale(p, a, [later]);
  expect(row(a).at(-1)!.note).toBe(60);
  app.undo();
  app.undo();
  expect(row(a).map((n) => n.note)).toEqual([60, 61, 63, 66, 70, 61]);
});

test('a row of its own length is set in steps below the block, follows block and channel, is copied', () => {
  const a = app.addChannel(newSound());
  const b = app.addChannel(newSound());
  const p = state().patternId;
  app.setRowLoop(p, a, 5.4);
  expect(pattern().loops).toEqual({ [a]: 5 });
  app.setRowLoop(p, b, 0);
  expect(pattern().loops).toEqual({ [a]: 5, [b]: 1 });
  // As long as the block or longer is no loop of its own.
  app.setRowLoop(p, b, 16);
  expect(pattern().loops).toEqual({ [a]: 5 });
  app.setRowLoop(p, b, 99);
  expect(pattern().loops).toEqual({ [a]: 5 });
  app.setPatternBars(p, 2);
  app.setRowLoop(p, b, 20);
  expect(pattern().loops).toEqual({ [a]: 5, [b]: 20 });
  // Shortening the block drops a loop that is no longer shorter than it.
  app.setPatternBars(p, 1);
  expect(pattern().loops).toEqual({ [a]: 5 });
  // Another meter keeps loops in steps.
  app.setMeter([5, 8]);
  expect(pattern().loops).toEqual({ [a]: 5 });
  const copy = app.duplicatePattern(p)!;
  expect(project().patterns.find((x) => x.id === copy)!.loops).toEqual({ [a]: 5 });
  app.removeChannel(a);
  expect(project().patterns.map((x) => x.loops)).toEqual([undefined, undefined]);
  app.undo();
  app.setRowLoop(p, a, null);
  expect(project().patterns.map((x) => x.loops)).toEqual([undefined, { [a]: 5 }]);
});

test('a block with a looped row is inserted with its loop', () => {
  const block: Block = {
    name: 'Drift', color: 2, bars: 1, samples: {},
    tracks: [{ sound: newSound(), notes: [stepNote(0)], loop: 5 }, { sound: newSound('fm'), notes: [stepNote(2)] }],
  };
  const id = app.insertBlock(block)!;
  const inserted = project().patterns.find((p) => p.id === id)!;
  expect(inserted.loops).toEqual({ [project().channels[0].id]: 5 });
});

test('a row replaced again and again with one take is one undo step, until something else changes', () => {
  const a = app.addChannel(newSound());
  const p = state().patternId;
  put(p, a, 0, 60);
  const base = pattern().notes[a];
  const before = state().past.length;
  const take = {};
  app.replaceNotes(p, a, [...base, newNote(T, 62)], take);
  app.replaceNotes(p, a, [...base, newNote(2 * T, 64), newNote(3 * T, 65)], take);
  expect(row(a).map((n) => n.note)).toEqual([60, 64, 65]);
  expect(pattern().notes[a][0].id).toBe(base[0].id);
  expect(state().past.length).toBe(before + 1);
  app.undo();
  expect(row(a).map((n) => n.note)).toEqual([60]);
  app.redo();
  app.replaceNotes(p, a, [], take);
  expect(pattern().notes).not.toHaveProperty(a);
  expect(state().past.length).toBe(before + 2);
});

test('replaceRow puts new notes in place of a row\'s in one undo step, lengthening the block when asked', () => {
  const id = app.addChannel(newSound('sample'));
  const p = pattern().id;
  put(p, id, 3, 50);
  const before = project();
  const notes: NoteInit[] = [0, 1, 2, 3].map((k) => ({ start: k * 16 * T, len: 16 * T, note: 60 + k, vel: 0.8 }));
  app.replaceRow(p, id, notes, 4);
  expect(pattern().bars).toBe(4);
  expect(row(id)).toEqual(notes);
  app.undo();
  expect(project()).toBe(before);
  // A block is never made shorter, nor longer than the longest; notes past its end are left out.
  app.replaceRow(p, id, notes, 2);
  expect(pattern().bars).toBe(2);
  expect(row(id)).toEqual(notes.slice(0, 2));
  app.replaceRow(p, id, notes, 1);
  expect(pattern().bars).toBe(2);
  app.replaceRow(p, id, notes, MAX_BARS + 5);
  expect(pattern().bars).toBe(MAX_BARS);
});

test('setSample loads a sample into a Sampler or Grains source and leaves other sources alone', () => {
  const grains = app.addChannel(newSound('grains'));
  const osc = app.addChannel(newSound('osc'));
  app.setSample(grains, 's123', sample);
  app.setSample(osc, 's456', sample);
  expect(sound(grains).source.params.sample).toBe('s123');
  expect(project().samples).toEqual({ s123: sample });
});
