import { expect, test } from 'vitest';
import { extractBlock } from '../../src/core/block';
import {
  CHANNEL_COLORS, emptyProject, MAX_BARS, MAX_TICKS, newMod, newModule, newSound, TICKS_PER_STEP,
} from '../../src/core/defaults';
import {
  FORMAT_VERSION, FormatError, parseBlock, serializeBlock, serializeProject, serializeSound,
} from '../../src/core/fileformat';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import type { Block, Project } from '../../src/core/types';
import { stepNote } from '../support/steps';

function project(): Project {
  const result = emptyProject();
  const sampler = newSound('sample', 'Kick');
  sampler.source.on = true;
  sampler.source.params.sample = 'kick';
  sampler.chain = [newModule('filter')];
  sampler.mods = [{ ...newMod('lfo'), target: { module: sampler.chain[0].id, param: 'cutoff' } }];
  const silent = newSound('sample', 'Silent');
  silent.source.params.sample = 'unused';
  result.channels = [sampler, silent, newSound('fm', 'Bass'), newSound()].map((sound, i) => ({
    id: `c${i}`, sound, color: i, mute: i === 0, solo: false,
  }));
  result.channels[2].sound.source.on = true;
  result.patterns = [{
    id: 'a', name: 'Verse', color: 4, bars: 2,
    notes: { c2: [stepNote(17, 72)], gone: [stepNote(0)], c1: [], c0: [stepNote(0)] },
  }];
  result.samples = {
    kick: { name: 'kïck.wav', bytes: new Uint8Array([0, 127, 128, 255]) },
    unused: { name: 'unused.wav', bytes: new Uint8Array([42]) },
  };
  return result;
}

function block(): Block {
  return extractBlock(project(), 'a')!;
}

function blockFile(block: unknown = { tracks: [] }, samples?: unknown): string {
  return JSON.stringify({ format: 'hadjitron3000/block', version: FORMAT_VERSION, block, samples });
}

test('extracts only channels with notes, in channel order, including muted channels', () => {
  const original = project();
  expect(extractBlock(original, 'a')).toStrictEqual({
    name: 'Verse', color: 4, bars: 2,
    tracks: [
      { sound: original.channels[0].sound, notes: original.patterns[0].notes.c0 },
      { sound: original.channels[2].sound, notes: original.patterns[0].notes.c2 },
    ],
    samples: { kick: original.samples.kick },
  });
});

test('extracted sounds, notes and sample bytes share no mutable objects with the project', () => {
  const original = project();
  const before = structuredClone(original);
  const extracted = extractBlock(original, 'a')!;
  const originals = new Set<object>();
  function collect(value: unknown): void {
    if (typeof value !== 'object' || value === null || originals.has(value)) return;
    originals.add(value);
    if (value instanceof Uint8Array) originals.add(value.buffer);
    for (const child of Object.values(value)) collect(child);
  }
  function check(value: unknown): void {
    if (typeof value !== 'object' || value === null) return;
    expect(originals.has(value)).toBe(false);
    if (value instanceof Uint8Array) expect(originals.has(value.buffer)).toBe(false);
    for (const child of Object.values(value)) check(child);
  }
  collect(original);
  check(extracted);
  const track = extracted.tracks[0];
  track.sound.source.params.pitch = 12;
  track.sound.amp.attack = 1;
  track.sound.out.pan = 1;
  track.sound.chain[0].params.cutoff = 42;
  track.sound.mods[0].target!.param = 'pitch';
  track.notes[0].note = 20;
  extracted.samples.kick.bytes[0] = 99;
  extracted.samples.kick.name = 'changed';
  expect(original).toStrictEqual(before);
});

test('extracts each referenced available sample once and ignores other parameters and inherited samples', () => {
  const original = project();
  original.channels[2].sound = structuredClone(original.channels[0].sound);
  original.channels[0].sound.chain[0].params.sample = 'unused';
  original.channels[0].sound.source.params.other = 'unused';
  expect(Object.keys(extractBlock(original, 'a')!.samples)).toEqual(['kick']);
  original.channels[0].sound.source.params.sample = 'missing';
  original.channels[2].sound.source.params.sample = 'inherited';
  original.samples = Object.create({ inherited: { name: 'inherited.wav', bytes: new Uint8Array([1]) } });
  expect(extractBlock(original, 'a')!.samples).toEqual({});
});

test('extracts an empty block and returns null for a missing pattern', () => {
  const original = project();
  original.patterns[0].notes = {};
  expect(extractBlock(original, 'a')).toEqual({ name: 'Verse', color: 4, bars: 2, tracks: [], samples: {} });
  expect(extractBlock(original, 'missing')).toBeNull();
});

test.each([0, 4, 384 * 1024 + 1])('a block round trips ordered tracks and %i sampled bytes', (length) => {
  const original = block();
  original.samples.kick.bytes = Uint8Array.from({ length }, (_, i) => i % 256);
  const text = serializeBlock(original);
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  expect(JSON.parse(text)).toEqual({
    format: 'hadjitron3000/block', version: 3,
    block: { name: original.name, color: original.color, bars: original.bars, tracks: original.tracks },
    samples: { kick: { name: 'kïck.wav', data: expect.any(String) } },
  });
  const parsed = parseBlock(text);
  expect(parsed).toStrictEqual(original);
  expect(parsed.samples.kick.bytes).toBeInstanceOf(Uint8Array);
});

test('serializes only referenced available samples and clears unavailable references when parsing', () => {
  const original = block();
  original.samples.unused = { name: 'unused.wav', bytes: new Uint8Array([42]) };
  original.tracks.push(structuredClone(original.tracks[0]));
  expect(Object.keys(JSON.parse(serializeBlock(original)).samples)).toEqual(['kick']);
  original.samples = {};
  const parsed = parseBlock(serializeBlock(original));
  expect(parsed.samples).toEqual({});
  expect(parsed.tracks[0].sound.source.params.sample).toBe('');
  expect(parsed.tracks[2].sound.source.params.sample).toBe('');
});

test.each([
  [{}, { name: 'Block', color: 0, bars: 1 }],
  [{ name: 7, color: 'bad', bars: null }, { name: 'Block', color: 0, bars: 1 }],
  [{ name: '', color: -3, bars: 0 }, { name: '', color: 0, bars: 1 }],
  [{ color: 99, bars: 99 }, { name: 'Block', color: CHANNEL_COLORS - 1, bars: MAX_BARS }],
  [{ color: 2.6, bars: 3.6 }, { name: 'Block', color: 3, bars: 4 }],
])('normalizes block metadata and defaults omitted samples %#', (input, expected) => {
  expect(parseBlock(blockFile({ ...input, tracks: [] }))).toEqual({ ...expected, tracks: [], samples: {} });
});

test('normalizes notes with the same rules as project patterns', () => {
  const notes = [
    { id: 'a', start: -1, len: 1, note: 60, vel: 1 },
    { id: 'b', start: 0, len: -2, note: -1, vel: -3 },
    { id: 'b', start: 3.4, len: 99999, note: 999, vel: 99 },
    { start: 5, len: 'bad', note: 60.6, vel: 0.123, extra: true },
    { id: 7, start: 5, len: 2, note: 61, vel: 1 },
    { start: 'bad', note: 72 },
    { id: 'c', start: MAX_TICKS - 1, len: 1, note: 72, vel: 1 },
    { id: 'd', start: MAX_TICKS, len: 1, note: 72, vel: 1 },
    { id: 'e', start: 2, note: 'bad', vel: null },
  ];
  const parsed = parseBlock(blockFile({ tracks: [{ sound: newSound(), notes }] }));
  expect(parsed.tracks[0].notes).toEqual([
    { id: 'b', start: 0, len: 1, note: MIN_NOTE, vel: 0 },
    { id: 'e', start: 2, len: TICKS_PER_STEP, note: 60, vel: 0.8 },
    { id: expect.stringMatching(/^n_/), start: 3, len: MAX_TICKS, note: MAX_NOTE, vel: 1 },
    { id: expect.stringMatching(/^n_/), start: 5, len: TICKS_PER_STEP, note: 61, vel: 0.123 },
    { id: 'c', start: MAX_TICKS - 1, len: 1, note: 72, vel: 1 },
  ]);
});

test('version 2 steps become notes with the old rules', () => {
  const steps = {
    0: { note: -1, vel: -3, len: -2 },
    1: { note: 999, vel: 99, len: 999 },
    2: { note: 60.6, vel: 0.123, len: 2.7, extra: true },
    3: { note: 'bad', vel: null, len: 'bad' },
    500: { note: 72, vel: 1, len: 1 },
    '9007199254740991': { note: 72, vel: 1, len: 1 },
    '-1': null, '1.5': null, 'NaN': null, 'Infinity': null, '': null, ' ': null, 'nope': null,
    '9007199254740992': null,
  };
  const block = { tracks: [{ sound: newSound(), steps }] };
  const file = JSON.stringify({ format: 'hadjitron3000/block', version: 2, block });
  const step = (i: number, note: number, vel: number, len: number) =>
    ({ id: expect.any(String), start: i * TICKS_PER_STEP, len: len * TICKS_PER_STEP, note, vel });
  expect(parseBlock(file).tracks[0].notes).toEqual([
    step(0, MIN_NOTE, 0, 1), step(1, MAX_NOTE, 1, MAX_BARS * 16), step(2, 61, 0.123, 3), step(3, 60, 0.8, 1),
    step(500, 72, 1, 1),
  ]);
});

test('normalizes track sounds and strips unknown fields at every level', () => {
  const original = block();
  const raw = JSON.parse(serializeBlock(original), (_key, value: unknown) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ...value, extra: 'discard' } : value;
  });
  delete raw.samples.extra;
  expect(parseBlock(JSON.stringify(raw))).toStrictEqual(original);
  raw.block.tracks[0].sound.source.params.pitch = 99;
  raw.block.tracks[0].sound.mods[0].target = { module: 'missing', param: 'cutoff' };
  const parsed = parseBlock(JSON.stringify(raw));
  expect(parsed.tracks[0].sound.source.params.pitch).toBe(24);
  expect(parsed.tracks[0].sound.mods[0].target).toBeNull();
});

test.each(['{', '', 'null', '[]', '42', '"text"', '{}', '{"format":"other"}',
  serializeSound(newSound(), {}), serializeProject(emptyProject()),
])('rejects invalid JSON and other formats %#', (text) => {
  expect(() => parseBlock(text)).toThrow(FormatError);
  expect(() => parseBlock(text)).toThrow('This is not a Hadjitron 3000 block file.');
});

test('rejects a newer block version with a readable error', () => {
  const text = JSON.stringify({ format: 'hadjitron3000/block', version: FORMAT_VERSION + 1 });
  expect(() => parseBlock(text)).toThrow(FormatError);
  expect(() => parseBlock(text)).toThrow('This file was made by a newer version of Hadjitron 3000.');
});

test.each([
  [undefined, 'block'], [null, 'block'], [[], 'block'], [{}, 'tracks'], [{ tracks: {} }, 'tracks'],
  [{ tracks: [null] }, 'track'], [{ tracks: [[]] }, 'track'],
  [{ tracks: [{ notes: [] }] }, 'sound'],
  [{ tracks: [{ sound: { ...newSound(), source: { type: 'unknown' } }, notes: [] }] }, 'Unknown source'],
  [{ tracks: [{ sound: newSound() }] }, 'notes'],
  [{ tracks: [{ sound: newSound(), notes: {} }] }, 'notes'],
  [{ tracks: [{ sound: newSound(), notes: null }] }, 'notes'],
  [{ tracks: [{ sound: newSound(), notes: [null] }] }, 'note'],
  [{ tracks: [{ sound: newSound(), steps: [] }] }, 'steps'],
  [{ tracks: [{ sound: newSound(), steps: { 0: null } }] }, 'step 0'],
])('rejects structurally invalid blocks %#', (value, message) => {
  const text = JSON.stringify({ format: 'hadjitron3000/block', version: FORMAT_VERSION, block: value });
  expect(() => parseBlock(text)).toThrow(FormatError);
  expect(() => parseBlock(text)).toThrow(String(message));
});

test.each([null, [], { kick: null }, { kick: { name: 7, data: '' } },
  { kick: { name: 'kick.wav' } }, { kick: { name: 'kick.wav', data: '%%%invalid%%%' } },
])('rejects invalid block samples %#', (samples) => {
  expect(() => parseBlock(blockFile({ tracks: [] }, samples))).toThrow(FormatError);
  expect(() => parseBlock(blockFile({ tracks: [] }, samples))).toThrow(/sample/);
});
