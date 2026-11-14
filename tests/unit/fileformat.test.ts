import { expect, test, vi } from 'vitest';
import {
  CHANNEL_COLORS, emptyProject, MAX_BARS, MAX_SONG_BARS, newChannel, newMod, newModule, newPattern, newSound,
  SONG_LANES, TICKS_PER_STEP,
} from '../../src/core/defaults';
import { extractBlock } from '../../src/core/block';
import { MAX_TICKS } from '../../src/core/meter';
import {
  BLOCK_EXT, FORMAT_VERSION, FormatError, parseBlock, parseProject, parseSound, PROJECT_EXT, readProject, sampleId,
  serializeBlock, serializeProject, serializeSound, SOUND_EXT, soundSampleIds,
} from '../../src/core/fileformat';
import { AMP, EFFECTS, FILTER, MODS, MODULES, OUT, PLAY, SOURCES } from '../../src/core/modules';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import { defaultParams } from '../../src/core/params';
import { DEFAULT_SHAPE, STOCK_SHAPES, encodeShape } from '../../src/core/shape';
import type { Project, SampleData, Sound } from '../../src/core/types';
import { stepNote } from '../support/steps';

function soundFile(sound: unknown = newSound(), samples: unknown = {}): string {
  return JSON.stringify({ format: 'hadjitron3000/sound', version: FORMAT_VERSION, sound, samples });
}

function projectFile(project: unknown = emptyProject(), samples: unknown = {}): string {
  return JSON.stringify({ format: 'hadjitron3000/project', version: FORMAT_VERSION, project, samples });
}

function sound(): Sound {
  const result = newSound('sample', 'Kick');
  result.source.on = true;
  result.source.params.sample = 'kick';
  result.chain = [{ ...newModule('filter'), id: 'filter1', on: false }];
  result.mods = [{ ...newMod('lfo'), id: 'lfo1', target: { module: 'filter1', param: 'cutoff' }, amount: -0.25 }];
  return result;
}

function project(): Project {
  const result = emptyProject();
  result.name = 'Two tracks';
  result.bpm = 137;
  result.swing = 0.3;
  result.master = -3;
  result.channels = [
    {
      ...newChannel('c1', sound(), 2), mute: true, sends: [0.25, 0], duck: { source: 'c2', amount: 0.7, release: 0.4 },
    },
    { ...newChannel('c2', { ...newSound('fm'), source: { ...newSound('fm').source, on: true } }, 5), solo: true },
  ];
  result.patterns = [
    { id: 'a', name: 'A', color: 3, bars: 1, notes: { c1: [{ id: 'n1', start: 0, len: 24, note: 60, vel: 0.7 }] } },
    { id: 'b', name: 'B', color: 0, bars: 2, notes: { c2: [
      { id: 'n1', start: 408, len: 72, note: 65, vel: 0.5 },
      { id: 'n2', start: 408, len: 30, note: 69, vel: 0.5 },
      { id: 'n3', start: 413, len: 5, note: 65, vel: 0.4 },
    ] } },
  ];
  result.song = [
    { id: 's1', pattern: 'a', lane: 0, bar: 0, bars: 1 },
    { id: 's2', pattern: 'b', lane: 2, bar: 0, bars: 4 },
  ];
  result.samples = { kick: { name: 'kick.wav', bytes: new Uint8Array([0, 127, 128, 255]) } };
  result.mixer.buses[1] = { ...result.mixer.buses[1], name: 'Tape', level: -4.5, mute: true };
  result.mixer.master.chain = [{ ...newModule('drive'), id: 'warm', on: false }];
  return result;
}

test('exports the native extensions and format version', () => {
  expect([SOUND_EXT, PROJECT_EXT, BLOCK_EXT, FORMAT_VERSION]).toEqual(['h3s', 'h3k', 'h3b', 3]);
});

test.each([0, 4, 384 * 1024 + 1])('a sampled sound round trips %i bytes exactly', (length) => {
  const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
  const samples = { kick: { name: 'kïck.wav', bytes } };
  const original = sound();
  const text = serializeSound(original, samples);
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  expect(JSON.parse(text)).toMatchObject({ format: 'hadjitron3000/sound', version: 3 });
  const parsed = parseSound(text);
  expect(parsed.sound).toStrictEqual(original);
  expect(parsed.samples.kick.name).toBe('kïck.wav');
  expect(parsed.samples.kick.bytes).toBeInstanceOf(Uint8Array);
  expect(parsed.samples.kick.bytes).toStrictEqual(bytes);
});

test('a project round trips two channels, two patterns with a chord and an off-grid note, and simultaneous placements', () => {
  const original = project();
  const text = serializeProject(original);
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  expect(JSON.parse(text)).toMatchObject({ format: 'hadjitron3000/project', version: 3 });
  expect(JSON.parse(text).project).not.toHaveProperty('samples');
  expect(parseProject(text)).toStrictEqual(original);
});

test('only referenced, available samples are written, once per id', () => {
  const original = project();
  original.samples.unused = { name: 'unused.wav', bytes: new Uint8Array([42]) };
  original.channels[1].sound = sound();
  expect(Object.keys(JSON.parse(serializeProject(original)).samples)).toEqual(['kick']);
  expect(Object.keys(JSON.parse(serializeSound(sound(), original.samples)).samples)).toEqual(['kick']);
  expect(JSON.parse(serializeSound(sound(), {})).samples).toEqual({});
  original.channels[0].sound.source.params.sample = 'missing';
  original.channels[1].sound = newSound();
  expect(JSON.parse(serializeProject(original)).samples).toEqual({});
  expect(JSON.parse(serializeSound(newSound(), original.samples)).samples).toEqual({});
});

test('soundSampleIds uses only non-empty sample parameters of the source', () => {
  const original = sound();
  expect(soundSampleIds(original)).toEqual(['kick']);
  original.source.params.sample = '';
  original.source.params.other = 'not-a-sample';
  original.chain[0].params.sample = 'not-a-source';
  expect(soundSampleIds(original)).toEqual([]);
  expect(soundSampleIds(newSound())).toEqual([]);
});

test('sampleId is the SHA-256 prefix, stable and sensitive to bytes and view bounds', async () => {
  const abc = new TextEncoder().encode('abc');
  expect(await sampleId(abc)).toBe('sba7816bf8f01cfea');
  expect(await sampleId(new Uint8Array(abc))).toBe(await sampleId(abc));
  expect(await sampleId(new Uint8Array())).toBe('se3b0c44298fc1c14');
  expect(await sampleId(new TextEncoder().encode('abd'))).not.toBe(await sampleId(abc));
  expect(await sampleId(new Uint8Array([0, 97, 98, 99, 0]).subarray(1, 4))).toBe(await sampleId(abc));
});

for (const [kind, parse] of [['sound', parseSound], ['project', parseProject]] as const) {
  test.each(['{', '', 'null', '[]', '42', '"text"', '{}', '{"format":"other"}'])(
    `${kind} rejects invalid JSON or a wrong envelope: %s`, (text) => {
      expect(() => parse(text)).toThrow(FormatError);
      expect(() => parse(text)).toThrow(`not a Hadjitron 3000 ${kind} file`);
    },
  );
  test(`${kind} rejects the other native format and newer versions`, () => {
    expect(() => parse(kind === 'sound' ? projectFile() : soundFile())).toThrow(FormatError);
    const text = JSON.stringify({ format: `hadjitron3000/${kind}`, version: FORMAT_VERSION + 1 });
    expect(() => parse(text)).toThrow(FormatError);
    expect(() => parse(text)).toThrow('newer version of Hadjitron 3000');
  });
}

test.each([
  [null, 'sound'], [[], 'sound'],
  [{ ...newSound(), source: undefined }, 'source'],
  [{ ...newSound(), source: [] }, 'source'],
  [{ ...newSound(), chain: {} }, 'chain'],
  [{ ...newSound(), chain: [null] }, 'effect'],
  [{ ...newSound(), mods: {} }, 'modulators'],
  [{ ...newSound(), mods: [null] }, 'mod'],
  [{ ...newSound(), source: { ...newSound().source, params: [] } }, 'parameters'],
  [{ ...newSound(), source: { ...newSound().source, params: null } }, 'parameters'],
  [{ ...newSound(), amp: 7 }, 'amp parameters'],
  [{ ...newSound(), amp: null }, 'amp parameters'],
  [{ ...newSound(), out: [] }, 'out parameters'],
])('rejects a structurally invalid sound %#', (value, message) => {
  expect(() => parseSound(soundFile(value))).toThrow(FormatError);
  expect(() => parseSound(soundFile(value))).toThrow(String(message));
});

test.each([
  [null, 'project'], [[], 'project'],
  [{ ...project(), channels: {} }, 'channels'],
  [{ ...project(), channels: [null] }, 'channel'],
  [{ ...project(), patterns: {} }, 'patterns'],
  [{ ...project(), patterns: null }, 'patterns'],
  [{ ...project(), patterns: [null] }, 'pattern'],
  [{ ...project(), patterns: [{ id: 'a', notes: [] }] }, 'pattern notes'],
  [{ ...project(), patterns: [{ id: 'a', notes: null }] }, 'pattern notes'],
  [{ ...project(), patterns: [{ id: 'a', notes: { c1: {} } }] }, 'notes for channel'],
  [{ ...project(), patterns: [{ id: 'a', notes: { c1: [null] } }] }, 'note'],
  [{ ...project(), patterns: [{ id: 'a', cells: [] }] }, 'pattern notes'],
  [{ ...project(), patterns: [{ id: 'a', cells: { c1: [] } }] }, 'notes for channel'],
  [{ ...project(), patterns: [{ id: 'a', cells: { c1: { 0: null } } }] }, 'step'],
  [{ ...project(), song: {} }, 'song'],
  [{ ...project(), song: null }, 'song'],
])('rejects a structurally invalid project %#', (value, message) => {
  expect(() => parseProject(projectFile(value))).toThrow(FormatError);
  expect(() => parseProject(projectFile(value))).toThrow(String(message));
});

test.each([
  ['source', 'mystery'], ['source', 'filter'], ['source', 'toString'],
  ['chain', 'missing'], ['chain', 'osc'], ['chain', 'amp'],
  ['mods', 'unknown'], ['mods', 'filter'], ['mods', 'out'],
])('rejects unknown or wrong-kind %s module %s by name', (place, type) => {
  const entry = { id: 'm1', type, params: {} };
  const value = { ...newSound(), [place]: place === 'source' ? entry : [entry] };
  expect(() => parseSound(soundFile(value))).toThrow(FormatError);
  expect(() => parseSound(soundFile(value))).toThrow(type);
});

test.each([
  null, [], { kick: null }, { kick: { name: 7, data: '' } },
  { kick: { name: 'kick.wav' } }, { kick: { name: 'kick.wav', data: '%%%invalid%%%' } },
])('rejects malformed sample tables and base64 %#', (samples) => {
  expect(() => parseSound(soundFile(newSound(), samples))).toThrow(FormatError);
  expect(() => parseSound(soundFile(newSound(), samples))).toThrow(/sample/);
  expect(() => parseProject(projectFile(emptyProject(), samples))).toThrow(FormatError);
});

test.each([...SOURCES, ...EFFECTS, ...MODS])('normalizes exactly the parameters of $type', (def) => {
  const original = newSound();
  const entry = { id: 'test', type: def.type, params: { unknown: 'drop' } };
  if (def.kind === 'source') original.source = entry;
  if (def.kind === 'effect') original.chain = [entry];
  if (def.kind === 'mod') original.mods = [{ ...entry, per: 'sound', target: null, amount: 0 }];
  const parsed = parseSound(soundFile(original)).sound;
  const result = def.kind === 'source' ? parsed.source : def.kind === 'effect' ? parsed.chain[0] : parsed.mods[0];
  expect(result.params).toStrictEqual(defaultParams(def));
});

test('coerces supplied parameter values and defaults amp, out and missing params', () => {
  const original = {
    ...newSound('sample'),
    source: { type: 'sample', params: { pitch: 99, fine: -3.6, loop: 'yes', reverse: true, mode: 'bad', junk: 1 } },
    amp: { attack: -2, decay: 99, sustain: 'bad', release: null, junk: true },
    out: { level: 99, pan: -4, junk: false },
    chain: [{ id: 'filter1', type: 'filter' }],
    mods: [{ id: 'lfo1', type: 'lfo', params: { rate: 100, wave: 'triangle' } }],
  };
  const result = parseSound(soundFile(original)).sound;
  expect(result.source.params).toEqual({
    sample: '', pitch: 24, fine: -4, start: 0, end: 1, loop: false, xfade: 0, reverse: true, mode: 'oneshot',
    slices: 'off', sens: 0.5,
  });
  expect(result.amp).toEqual({ attack: 0, decay: 30, sustain: 0.8, release: 0.2 });
  expect(result.out).toEqual({ level: 6, pan: -1 });
  expect(result.chain[0].params).toEqual(defaultParams(MODULES.filter));
  expect(result.mods[0].params).toEqual({
    wave: 'triangle', rate: 40, sync: 'free', fade: 0, retrigger: false, vel: 0,
  });
  const defaults = parseSound(soundFile({ ...newSound(), amp: undefined, out: undefined })).sound;
  expect(defaults.amp).toEqual(defaultParams(AMP));
  expect(defaults.out).toEqual(defaultParams(OUT));
});

test('a sound from before the voice path reads with the filter off, Poly play and modulators of the whole sound', () => {
  const { play: _play, filter: _filter, ...old } = newSound();
  const mods = [{ id: 'env1', type: 'env', params: {}, target: { module: 'source', param: 'pitch' }, amount: 0.5 }];
  const text = JSON.stringify({ format: 'hadjitron3000/sound', version: 2, sound: { ...old, mods } });
  const parsed = parseSound(text).sound;
  expect(parsed.play).toEqual(defaultParams(PLAY));
  expect(parsed.filter).toEqual(defaultParams(FILTER));
  expect(parsed.filter.on).toBe(false);
  expect(parsed.mods[0].per).toBe('sound');
  expect(parsed.mods[0].params.vel).toBe(0);
});

test('the voice path round trips and is always written', () => {
  const original = newSound();
  original.play = { mode: 'legato', glide: 0.12, arp: 'played', rate: '1/8t', octaves: 3, gate: 0.25 };
  original.filter = { ...original.filter, on: true, slope: '24', drive: 0.3, key: 0.5, vel: -0.25 };
  original.source = {
    ...original.source, on: true, params: { ...original.source.params, wave: 'square', pw: 0.3, mix2: 0.5, sub: 0.4 },
  };
  original.mods = [
    { ...newMod('env'), id: 'env1', target: { module: 'filter', param: 'cutoff' } },
    { ...newMod('lfo'), id: 'lfo1', per: 'note', target: { module: 'source', param: 'pw' } },
  ];
  const text = serializeSound(original, {});
  expect(JSON.parse(text).sound.mods.map((m: { per: string }) => m.per)).toEqual(['note', 'note']);
  expect(parseSound(text).sound).toStrictEqual(original);
  const plain = JSON.parse(serializeSound(newSound(), {})).sound;
  expect(plain.play).toEqual(defaultParams(PLAY));
  expect(plain.filter).toEqual(defaultParams(FILTER));
});

test('voice path values are checked like any other parameter', () => {
  const original = {
    ...newSound(),
    play: { mode: 'chords', glide: 9, arp: 'sideways', rate: '1/3', octaves: 0, gate: 2 },
    filter: { on: 'yes', slope: 48, cutoff: 1e6 },
    chain: [{ id: 'filter', type: 'drive' }],
    mods: [{ id: 'm1', type: 'env', per: 'chord', target: { module: 'filter', param: 'cutoff' }, amount: 1 }],
  };
  const parsed = parseSound(soundFile(original)).sound;
  expect(parsed.play).toEqual({ mode: 'poly', glide: 2, arp: 'off', rate: '1/16', octaves: 1, gate: 1 });
  expect(parsed.filter).toEqual({ ...defaultParams(FILTER), cutoff: 20000 });
  // A chain module may not take the id of a fixed unit.
  expect(parsed.chain[0].id).not.toBe('filter');
  expect(parsed.mods[0]).toMatchObject({ per: 'sound', target: { module: 'filter', param: 'cutoff' } });
});

test('sounds from before long movement read with free LFOs, no fade or retrigger, and a sine to draw', () => {
  const old = {
    ...newSound(),
    mods: [{ id: 'lfo1', type: 'lfo', params: { wave: 'sine', rate: 0.25 }, target: { module: 'out', param: 'pan' } }],
  };
  delete (old.source.params as Record<string, unknown>).shape;
  const result = parseSound(soundFile(old)).sound;
  expect(result.mods[0].params).toEqual({
    wave: 'sine', rate: 0.25, sync: 'free', fade: 0, retrigger: false, vel: 0,
  });
  expect(result.source.params.shape).toBe(DEFAULT_SHAPE);
  expect(result.source.params.shape2).toBe(DEFAULT_SHAPE);

  const drawn = newSound();
  const square = encodeShape(STOCK_SHAPES.square);
  drawn.source.params = { ...drawn.source.params, wave: 'draw', shape: square, shape2: 'nope' };
  drawn.mods = [{ ...newMod('drift'), id: 'd1', per: 'note', target: { module: 'filter', param: 'cutoff' } }];
  const back = parseSound(serializeSound(drawn, {})).sound;
  expect(back.source.params.shape).toBe(square);
  expect(back.source.params.shape2).toBe(DEFAULT_SHAPE);
  expect(back.mods).toEqual([{ ...drawn.mods[0], on: true }]);
});

test('defaults a missing sound name and accepts omitted sample tables', () => {
  const text = JSON.stringify({ format: 'hadjitron3000/sound', version: 1, sound: { ...newSound(), name: 7 } });
  const parsed = parseSound(text);
  expect(parsed.sound.name).toBe('New Sound');
  expect(parsed.samples).toEqual({});
});

test('non-finite JSON numbers use finite defaults', () => {
  const original = sound();
  const text = soundFile({
    ...original, source: { ...original.source, params: { pitch: 'overflow' } },
    mods: [{ ...original.mods[0], amount: 'overflow' }],
  }).replaceAll('"overflow"', '1e400');
  const parsed = parseSound(text).sound;
  expect(parsed.source.params.pitch).toBe(0);
  expect(parsed.mods[0].amount).toBe(0);
  expect(parseProject(projectFile({ ...emptyProject(), bpm: 'overflow' }).replace('"overflow"', '1e400')).bpm)
    .toBe(120);
});

test('repairs missing, duplicate and reserved ids across effects and modulators', () => {
  const original = {
    ...newSound(), source: { ...newSound().source, id: 'wrong', on: false },
    chain: ['keep', 'keep', '', 'source', 'amp', 'out', undefined, 7].map((id) => ({ type: 'filter', id })),
    mods: ['keep', 'mod1', 'mod1', 'source', 'amp', 'out', '', undefined].map((id) => ({ type: 'lfo', id })),
  };
  const parsed = parseSound(soundFile(original)).sound;
  const ids = [parsed.source.id, 'amp', 'out', ...parsed.chain.map((m) => m.id), ...parsed.mods.map((m) => m.id)];
  expect(parsed.source.id).toBe('source');
  expect(parsed.source.on).toBe(false);
  expect(parsed.chain[0].id).toBe('keep');
  expect(parsed.mods[1].id).toBe('mod1');
  expect(new Set(ids).size).toBe(ids.length);
  expect(parsed.chain.slice(1).every((m) => /^m_/.test(m.id))).toBe(true);
  expect([...parsed.chain, ...parsed.mods].every((m) => m.on === true)).toBe(true);
});

test('generated ids avoid collisions with existing ids later in the sound', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.5);
  try {
    const result = parseSound(soundFile({
      ...newSound(), chain: [{ type: 'filter' }, { type: 'filter', id: 'm_00000000' }],
    })).sound;
    expect(result.chain[0].id).not.toBe('m_00000000');
    expect(result.chain[1].id).toBe('m_00000000');
  } finally {
    random.mockRestore();
  }
});

test.each([undefined, null, 0, 'false', true, false])('on defaults to true unless explicitly false: %s', (on) => {
  const parsed = parseSound(soundFile({
    ...newSound(), chain: [{ type: 'filter', on }], mods: [{ type: 'lfo', on }],
  })).sound;
  expect(parsed.chain[0].on).toBe(on !== false);
  expect(parsed.mods[0].on).toBe(on !== false);
});

test.each([
  [{ module: 'source', param: 'pitch' }, true],
  [{ module: 'filter1', param: 'cutoff' }, true],
  [{ module: 'out', param: 'pan' }, true],
  [{ module: 'out', param: 'level' }, true],
  [{ module: 'amp', param: 'attack' }, false],
  [{ module: 'lfo1', param: 'rate' }, false],
  [{ module: 'missing', param: 'pitch' }, false],
  [{ module: 'source', param: 'missing' }, false],
  [{ module: 'source', param: 'fine' }, false],
  [{ module: 'source', param: 'sample' }, false],
  [{ module: 'source', param: 'mode' }, false],
  [{ module: 'source', param: 'loop' }, false],
  [{ module: 'constructor', param: 'pitch' }, false],
  [{ module: 1, param: 'pitch' }, false],
  [{ module: 'source', param: 1 }, false],
  [null, false], ['source.pitch', false], [[], false], [{}, false],
])('retains only existing, modulatable float targets %#', (target, valid) => {
  const original = sound();
  const parsed = parseSound(soundFile({ ...original, mods: [{ ...original.mods[0], target }] })).sound;
  expect(parsed.mods[0].target).toEqual(valid ? target : null);
});

test.each([[2, 1], [-2, -1], [0.25, 0.25], ['1', 0], [null, 0], [undefined, 0]])(
  'clamps modulation amount %s to %s', (amount, expected) => {
    const parsed = parseSound(soundFile({ ...newSound(), mods: [{ type: 'env', amount }] })).sound;
    expect(parsed.mods[0].amount).toBe(expected);
  },
);

test('missing samples become empty references in sounds and project channels', () => {
  expect(parseSound(serializeSound(sound(), {})).sound.source.params.sample).toBe('');
  const original = project();
  original.samples = {};
  expect(parseProject(serializeProject(original)).channels[0].sound.source.params.sample).toBe('');
  const sampler = sound();
  sampler.source.params.sample = 'constructor';
  expect(parseSound(soundFile(sampler)).sound.source.params.sample).toBe('');
});

test.each([
  [{ name: 7, bpm: 'bad', swing: null, master: false }, { name: 'Untitled', bpm: 120, swing: 0, master: 0 }],
  [{ name: '', bpm: -1, swing: -1, master: -99 }, { name: '', bpm: 40, swing: 0, master: -48 }],
  [{ bpm: 999, swing: 2, master: 99 }, { bpm: 240, swing: 1, master: 6 }],
])('normalizes project scalars %#', (input, expected) => {
  expect(parseProject(projectFile({ ...emptyProject(), ...input }))).toMatchObject(expected);
});

test.each(['channels', 'patterns'] as const)('%s requires unique, non-empty string ids', (key) => {
  const original = project();
  const entry = original[key][0];
  for (const id of ['', undefined, null, 7]) {
    const text = projectFile({ ...original, [key]: [{ ...entry, id }] });
    expect(() => parseProject(text)).toThrow(FormatError);
    expect(() => parseProject(text)).toThrow('missing id');
  }
  const text = projectFile({ ...original, [key]: [entry, { ...entry }] });
  expect(() => parseProject(text)).toThrow(FormatError);
  expect(() => parseProject(text)).toThrow(/Duplicate/);
});

test.each([
  [{ color: -2, mute: 'true', solo: 1 }, { color: 0, mute: false, solo: false }],
  [{ color: 99, mute: true, solo: true }, { color: CHANNEL_COLORS - 1, mute: true, solo: true }],
  [{ color: 2.6 }, { color: 3, mute: false, solo: false }],
  [{ color: 'bad' }, { color: 0, mute: false, solo: false }],
])('normalizes channel mixer fields %#', (input, expected) => {
  const channel = { id: 'c1', sound: newSound(), ...input };
  expect(parseProject(projectFile({ ...emptyProject(), channels: [channel] })).channels[0]).toMatchObject(expected);
});

test.each([[0, 1], [99, MAX_BARS], [2.6, 3], ['bad', 1]])('normalizes pattern bars %s', (bars, expected) => {
  const parsed = parseProject(projectFile({ ...emptyProject(), patterns: [{ id: 'a', name: 5, bars, notes: {} }] }));
  expect(parsed.patterns[0]).toEqual({ id: 'a', name: '', color: 0, bars: expected, notes: {} });
});

test('normalizes notes, sorts them and drops rows of missing channels, empty rows and repeated notes', () => {
  const notes = {
    c1: [
      { id: 'x', start: 30, len: 0, note: 72, vel: 2 },
      { id: 'x', start: 30, len: 5, note: 64, vel: 0.5 },
      { id: 'y', start: 30, len: 5, note: 72, vel: 0.5 },
      { id: 'z', start: 0.4, len: 2.6, note: 59.5, vel: 0.25, extra: 1 },
      { id: 'w', start: MAX_TICKS, len: 1, note: 60, vel: 1 },
    ],
    c2: [],
    gone: [{ id: 'g', start: 0, len: 1, note: 60, vel: 1 }],
  };
  const parsed = parseProject(projectFile({ ...project(), patterns: [{ id: 'a', bars: 1, notes }] }));
  expect(parsed.patterns[0].notes).toEqual({ c1: [
    { id: 'z', start: 0, len: 3, note: 60, vel: 0.25 },
    { id: expect.stringMatching(/^n_/), start: 30, len: 5, note: 64, vel: 0.5 },
    { id: 'x', start: 30, len: 1, note: 72, vel: 1 },
  ] });
});

test('version 2 steps become notes: step i starts at tick 24 i and lengths are counted in ticks', () => {
  const original = project();
  const cells = {
    c1: {
      0: { note: -5, vel: -1, len: -3 },
      1: { note: 999, vel: 4, len: 999 },
      2: { note: 60.6, vel: 0.123, len: 2.7, extra: 1 },
      3: { note: 'bad', vel: null, len: 'bad' },
      500: { note: 72, vel: 1, len: 1 },
      '-1': null, '1.5': null, 'NaN': null, 'Infinity': null, '': null, 'nope': null, '9007199254740992': null,
    },
    gone: null,
  };
  const text = JSON.stringify({
    format: 'hadjitron3000/project', version: 2, project: { ...original, patterns: [{ id: 'a', bars: 1, cells }] },
  });
  const step = (i: number, note: number, vel: number, len: number) =>
    ({ id: expect.stringMatching(/^n_/), start: i * TICKS_PER_STEP, len: len * TICKS_PER_STEP, note, vel });
  expect(parseProject(text).patterns[0].notes).toEqual({ c1: [
    step(0, MIN_NOTE, 0, 1), step(1, MAX_NOTE, 1, MAX_BARS * 16), step(2, 61, 0.123, 3), step(3, 60, 0.8, 1),
    step(500, 72, 1, 1),
  ] });
});

// The shapes of versions 1 and 2, written out as those versions saved them.
const OLD_SOUND = { ...newSound('osc', 'Bass') };
const OLD_PATTERNS = [
  { id: 'a', name: 'A', color: 1, bars: 2, cells: {
    c1: { 0: { note: 60, vel: 0.8, len: 1 }, 4: { note: 63, vel: 0.5, len: 3 }, 31: { note: 70, vel: 1, len: 1 } },
    c2: { 2: { note: 48, vel: 0.7, len: 16 } },
  } },
  { id: 'b', name: 'B', color: 2, bars: 8, cells: { c1: { 127: { note: 72, vel: 0.9, len: 2 } } } },
];
const note = (start: number, len: number, note: number, vel: number) =>
  ({ id: expect.any(String), start, len, note, vel });
const NEW_NOTES = [
  { c1: [note(0, 24, 60, 0.8), note(96, 72, 63, 0.5), note(744, 24, 70, 1)], c2: [note(48, 384, 48, 0.7)] },
  { c1: [note(3048, 48, 72, 0.9)] },
];

test.each([1, 2])('a version %i project converts its steps to notes without loss', (version) => {
  const channels = ['c1', 'c2'].map((id) => ({ id, sound: OLD_SOUND, color: 0, mute: false, solo: false }));
  const song = version === 1 ? ['a', 'b'] : [{ id: 's1', pattern: 'a', lane: 0, bar: 0, bars: 2 }];
  const parsed = parseProject(JSON.stringify({
    format: 'hadjitron3000/project', version,
    project: { name: 'Old', bpm: 120, swing: 0, master: 0, channels, patterns: OLD_PATTERNS, song },
  }));
  expect(parsed.patterns.map((p) => p.notes)).toEqual(NEW_NOTES);
  expect(parsed.patterns.map(({ notes: _, ...p }) => p)).toEqual(OLD_PATTERNS.map(({ cells: _, ...p }) => p));
  const again = parseProject(serializeProject(parsed));
  expect(again).toStrictEqual(parsed);
  expect(JSON.parse(serializeProject(parsed)).version).toBe(3);
});

test('a stored session in the old shape opens with notes', () => {
  const channels = ['c1', 'c2'].map((id) => ({ id, sound: OLD_SOUND, color: 0, mute: false, solo: false }));
  const stored = { name: 'Old', bpm: 120, swing: 0, master: 0, channels, patterns: OLD_PATTERNS, song: [] };
  const parsed = readProject(stored, {});
  expect(parsed.patterns.map((p) => p.notes)).toEqual(NEW_NOTES);
});

test.each([1, 2])('a version %i block converts its steps to notes without loss', (version) => {
  const tracks = [OLD_PATTERNS[0].cells.c1, OLD_PATTERNS[0].cells.c2].map((steps) => ({ sound: OLD_SOUND, steps }));
  const block = { name: 'Old', bars: 2, tracks };
  const parsed = parseBlock(JSON.stringify({ format: 'hadjitron3000/block', version, block }));
  expect(parsed.tracks.map((t) => t.notes)).toEqual([NEW_NOTES[0].c1, NEW_NOTES[0].c2]);
  expect(parsed.bars).toBe(2);
});

test.each([[], undefined])('a project without patterns receives an empty pattern A: %s', (patterns) => {
  const parsed = parseProject(projectFile({ ...emptyProject(), patterns, song: ['missing'] }));
  expect(parsed.patterns).toEqual([{ id: expect.any(String), name: 'A', color: 0, bars: 1, notes: {} }]);
  expect(parsed.patterns[0].id).not.toBe('');
  expect(parsed.song).toEqual([]);
});

test('a version 1 song, a list of pattern ids, becomes placements one after another in the first lane', () => {
  const parsed = parseProject(JSON.stringify({
    format: 'hadjitron3000/project', version: 1, project: { ...project(), song: ['b', 'missing', 'a', 'b'] },
  }));
  expect(parsed.song).toEqual([
    { id: expect.any(String), pattern: 'b', lane: 0, bar: 0, bars: 2 },
    { id: expect.any(String), pattern: 'a', lane: 0, bar: 2, bars: 1 },
    { id: expect.any(String), pattern: 'b', lane: 0, bar: 3, bars: 2 },
  ]);
  expect(new Set(parsed.song.map((placement) => placement.id)).size).toBe(3);
});

test('drops missing patterns and overlapping placements only in the same lane', () => {
  const song = [
    { id: 'missing', pattern: 'gone', lane: 0, bar: 0, bars: 10 },
    { id: 'keep', pattern: 'a', lane: 0, bar: 2, bars: 2 },
    { id: 'overlap', pattern: 'b', lane: 0, bar: 1, bars: 2 },
    { id: 'inside', pattern: 'b', lane: 0, bar: 3, bars: 1 },
    { id: 'cover', pattern: 'b', lane: 0, bar: 0, bars: 8 },
    { id: 'other', pattern: 'b', lane: 1, bar: 2, bars: 2 },
    { id: 'before', pattern: 'a', lane: 0, bar: 0, bars: 2 },
    { id: 'after', pattern: 'b', lane: 0, bar: 4, bars: 2 },
  ];
  expect(parseProject(projectFile({ ...project(), song })).song).toEqual([song[1], song[5], song[6], song[7]]);
});

test.each([
  [{ lane: -2, bar: -9, bars: 0 }, { lane: 0, bar: 0, bars: 1 }],
  [{ lane: 99, bar: 999, bars: 999 }, { lane: SONG_LANES - 1, bar: MAX_SONG_BARS - 1, bars: 1 }],
  [{ lane: 0, bar: 0, bars: 999 }, { lane: 0, bar: 0, bars: MAX_SONG_BARS }],
  [{ lane: 1.6, bar: 2.6, bars: 3.6 }, { lane: 2, bar: 3, bars: 4 }],
  [{ lane: 'bad', bar: null, bars: false }, { lane: 0, bar: 0, bars: 2 }],
  [{}, { lane: 0, bar: 0, bars: 2 }],
])('normalizes placement lane and timeline bounds %#', (input, expected) => {
  const song = [{ id: 's1', pattern: 'b', ...input }];
  expect(parseProject(projectFile({ ...project(), song })).song).toEqual([{ id: 's1', pattern: 'b', ...expected }]);
});

test('repairs duplicate, empty and missing placement ids', () => {
  const song = ['keep', 'keep', '', undefined, null, 7].map((id, bar) => ({ id, pattern: 'a', bar }));
  const parsed = parseProject(projectFile({ ...project(), song })).song;
  expect(parsed[0].id).toBe('keep');
  expect(new Set(parsed.map((placement) => placement.id)).size).toBe(song.length);
  expect(parsed.slice(1).every((placement) => /^s_/.test(placement.id))).toBe(true);
  expect(parsed.map(({ id: _id, ...placement }) => placement)).toEqual(
    song.map((_, bar) => ({ pattern: 'a', lane: 0, bar, bars: 1 })),
  );
});

test('generated placement ids avoid both existing and later ids', () => {
  const original = project();
  const random = vi.spyOn(Math, 'random')
    .mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValue(0.25);
  try {
    const song = [
      { pattern: 'a', bar: 0 },
      { id: 's_00000000', pattern: 'a', bar: 1 },
      { id: 's_00000000', pattern: 'a', bar: 2 },
    ];
    const parsed = parseProject(projectFile({ ...original, song })).song;
    expect(parsed[1].id).toBe('s_00000000');
    expect(new Set(parsed.map((placement) => placement.id)).size).toBe(3);
    expect(parsed.every((placement) => /^s_/.test(placement.id))).toBe(true);
  } finally {
    random.mockRestore();
  }
});

test('unknown fields are stripped at every level of the returned document', () => {
  const original = project();
  const text = serializeProject(original);
  const withExtras: unknown = JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { ...value, extra: 'discard' };
    return value;
  });
  // Dictionary entries are data, not extra fields; remove the deliberately invalid entries from those tables.
  const raw = withExtras as {
    project: Project & { extra: string };
    samples: Record<string, { name: string; data: string; extra: string }>;
  };
  delete raw.samples.extra;
  for (const pattern of raw.project.patterns) delete pattern.notes.extra;
  expect(parseProject(JSON.stringify(raw))).toStrictEqual(original);
});

test('dictionary ids such as __proto__ survive without prototype lookup or mutation', () => {
  const original = project();
  original.channels[0].id = '__proto__';
  original.channels[0].sound.source.params.sample = '__proto__';
  original.samples = Object.fromEntries([['__proto__', { name: 'kick.wav', bytes: new Uint8Array([255]) }]]);
  original.patterns = [{ ...newPattern('A'), notes: Object.fromEntries([['__proto__', [stepNote(0)]]]) }];
  original.song = [{ id: 's1', pattern: original.patterns[0].id, lane: 0, bar: 0, bars: 1 }];
  expect(parseProject(serializeProject(original))).toStrictEqual(original);
  const samples: Record<string, SampleData> = Object.create({ kick: { name: 'inherited', bytes: new Uint8Array() } });
  expect(JSON.parse(serializeSound(sound(), samples)).samples).toEqual({});
});

test('a project writes its meter always and note extras only where they are set, and reads them back', () => {
  const original = project();
  original.meter = [7, 8];
  original.patterns[1].notes.c2[0] = { ...original.patterns[1].notes.c2[0], chance: 40, ratchet: 3, slide: true };
  original.patterns[1].notes.c2[2] = { ...original.patterns[1].notes.c2[2], hold: true };
  const text = serializeProject(original);
  const written = JSON.parse(text).project;
  expect(written.meter).toEqual([7, 8]);
  expect(written.patterns[1].notes.c2).toEqual([
    { id: 'n1', start: 408, len: 72, note: 65, vel: 0.5, chance: 40, ratchet: 3, slide: true },
    { id: 'n2', start: 408, len: 30, note: 69, vel: 0.5 },
    { id: 'n3', start: 413, len: 5, note: 65, vel: 0.4, hold: true },
  ]);
  expect(parseProject(text)).toStrictEqual(original);
  expect(JSON.parse(serializeProject(project())).project.meter).toEqual([4, 4]);
});

test('files without a meter or with one that is not offered read as 4/4', () => {
  const old = { ...project(), meter: undefined };
  expect(parseProject(projectFile(old)).meter).toEqual([4, 4]);
  for (const meter of [[4, 2], [11, 8], '7/8', [7, 8, 1]]) {
    expect(parseProject(projectFile({ ...project(), meter })).meter).toEqual([4, 4]);
  }
  expect(parseProject(projectFile({ ...project(), meter: [12, 8] })).meter).toEqual([12, 8]);
  const v1 = { name: 'Old', bpm: 120, channels: [], patterns: [], song: [] };
  expect(parseProject(JSON.stringify({ format: 'hadjitron3000/project', version: 1, project: v1 })).meter)
    .toEqual([4, 4]);
});

test.each([
  [{ chance: 50 }, { chance: 50 }],
  [{ chance: 0 }, { chance: 1 }],
  [{ chance: 33.4 }, { chance: 33 }],
  [{ chance: 100 }, {}],
  [{ chance: 250 }, {}],
  [{ chance: '50' }, {}],
  [{ ratchet: 8 }, { ratchet: 8 }],
  [{ ratchet: 1 }, {}],
  [{ ratchet: 5 }, {}],
  [{ slide: true, hold: true }, { slide: true, hold: true }],
  [{ slide: false, hold: 'yes' }, {}],
])('note extras %j read as %j', (extras, expected) => {
  const file = project();
  file.patterns[0].notes.c1[0] = { ...file.patterns[0].notes.c1[0], ...extras } as never;
  expect(parseProject(projectFile(file)).patterns[0].notes.c1[0])
    .toEqual({ id: 'n1', start: 0, len: 24, note: 60, vel: 0.7, ...expected });
});

test('a block keeps the extras of its notes and carries no meter', () => {
  const notes = [
    { id: 'n1', start: 0, len: 24, note: 60, vel: 0.7, ratchet: 4, hold: true },
    { id: 'n2', start: 24, len: 24, note: 62, vel: 0.7 },
  ];
  const text = serializeBlock({ name: 'B', color: 1, bars: 2, tracks: [{ sound: newSound(), notes }], samples: {} });
  expect(JSON.parse(text).block).not.toHaveProperty('meter');
  expect(JSON.parse(text).block.tracks[0].notes).toEqual(notes);
  expect(parseBlock(text).tracks[0].notes).toEqual(notes);
});

test('lanes are always written; fades and mutes only where they are set, and all of them read back', () => {
  const plain = project();
  const written = JSON.parse(serializeProject(plain)).project;
  expect(written.lanes).toEqual(Array(SONG_LANES).fill({ level: 0, mute: false }));
  expect(written.song).toEqual([
    { id: 's1', pattern: 'a', lane: 0, bar: 0, bars: 1 },
    { id: 's2', pattern: 'b', lane: 2, bar: 0, bars: 4 },
  ]);
  expect(parseProject(serializeProject(plain))).toStrictEqual(plain);

  const mixed = project();
  mixed.song[1] = { ...mixed.song[1], fadeIn: 1, fadeOut: 2, mutes: ['c1', 'c2'] };
  mixed.lanes[2] = { level: -12.5, mute: true };
  const text = serializeProject(mixed);
  expect(JSON.parse(text).project.song[1]).toEqual({
    id: 's2', pattern: 'b', lane: 2, bar: 0, bars: 4, fadeIn: 1, fadeOut: 2, mutes: ['c1', 'c2'],
  });
  expect(parseProject(text)).toStrictEqual(mixed);
});

test('a project from before lanes and fades opens with its lanes at 0 dB and nothing faded or muted', () => {
  const old = { ...project(), lanes: undefined };
  const parsed = parseProject(projectFile(old));
  expect(parsed.lanes).toEqual(Array(SONG_LANES).fill({ level: 0, mute: false }));
  expect(parsed.song.map((s) => Object.keys(s))).toEqual(Array(2).fill(['id', 'pattern', 'lane', 'bar', 'bars']));
  const v1 = { name: 'Old', bpm: 120, channels: [], patterns: [{ id: 'a', name: 'A', bars: 2 }], song: ['a', 'a'] };
  const first = parseProject(JSON.stringify({ format: 'hadjitron3000/project', version: 1, project: v1 }));
  expect(first.lanes).toHaveLength(SONG_LANES);
  expect(first.song.map((s) => Object.keys(s))).toEqual(Array(2).fill(['id', 'pattern', 'lane', 'bar', 'bars']));
});

test.each([
  [{ fadeIn: 2, fadeOut: 3 }, { fadeIn: 2, fadeOut: 2 }],
  [{ fadeIn: 9, fadeOut: 1 }, { fadeIn: 4 }],
  [{ fadeIn: 1.6, fadeOut: -2 }, { fadeIn: 2 }],
  [{ fadeIn: 0, fadeOut: '2' }, {}],
  [{ mutes: ['c2', 'missing', 'c1', 'c2', 3] }, { mutes: ['c1', 'c2'] }],
  [{ mutes: [] }, {}],
  [{ mutes: 'c1' }, {}],
])('placement fields %j read as %j', (extra, expected) => {
  const file = project();
  file.song[1] = { ...file.song[1], ...extra } as never;
  expect(parseProject(projectFile(file)).song[1])
    .toEqual({ id: 's2', pattern: 'b', lane: 2, bar: 0, bars: 4, ...expected });
});

test.each([
  [[{ level: -6, mute: true }], [{ level: -6, mute: true }, ...Array(3).fill({ level: 0, mute: false })]],
  [[{ level: 40 }, { level: -90, mute: 'yes' }, {}, { level: 'loud' }, { level: 3 }],
    [{ level: 6, mute: false }, { level: -48, mute: false }, { level: 0, mute: false }, { level: 0, mute: false }]],
  [[], Array(4).fill({ level: 0, mute: false })],
])('lanes %j read as %j', (lanes, expected) => {
  expect(parseProject(projectFile({ ...project(), lanes })).lanes).toEqual(expected);
});

test('lanes that are not a list are refused with a readable message', () => {
  expect(() => parseProject(projectFile({ ...project(), lanes: { level: 0 } }))).toThrow(FormatError);
  expect(() => parseProject(projectFile({ ...project(), lanes: [3] }))).toThrow('Invalid lane: expected an object.');
});

test('a block carries no lanes, fades or mutes', () => {
  const block = { name: 'B', color: 1, bars: 2, tracks: [{ sound: newSound(), notes: [] }], samples: {} };
  const text = serializeBlock(block);
  expect(Object.keys(JSON.parse(text).block)).toEqual(['name', 'color', 'bars', 'tracks']);
});

test('a project from before the mixer gets the default buses, sends nothing and ducks nothing', () => {
  const { mixer: _, ...old } = project();
  const channels = old.channels.map(({ sends: _s, duck: _d, ...c }) => c);
  const parsed = parseProject(projectFile({ ...old, channels }));
  expect(parsed.channels.map((c) => [c.sends, c.duck])).toEqual([
    [[0, 0], { source: null, amount: 0.5, release: 0.25 }],
    [[0, 0], { source: null, amount: 0.5, release: 0.25 }],
  ]);
  const { buses, master } = parsed.mixer;
  expect(buses.map((b) => [b.name, b.level, b.mute, b.chain.map((m) => [m.type, m.params.mix])])).toEqual([
    ['Room', 0, false, [['reverb', 1]]],
    ['Echo', 0, false, [['delay', 1]]],
  ]);
  expect(master.chain).toEqual([]);
});

test('the mixer and the channels\' sends and ducking are kept in range', () => {
  const original = project();
  const channels = [
    { ...original.channels[0], sends: [2, -1], duck: { source: 'c1', amount: 3, release: 0 } },
    { ...original.channels[1], sends: 'loud', duck: { source: 'gone', amount: 'x', release: 99 } },
  ];
  const mixer = {
    buses: [{ name: 'A very long bus name', chain: [{ type: 'delay', params: { mix: 5 } }], level: 40, mute: 'yes' }],
    master: { chain: [{ id: 'x', type: 'reverb' }, { id: 'x', type: 'filter' }] },
  };
  const parsed = parseProject(projectFile({ ...original, channels, mixer }));
  expect(parsed.channels.map((c) => [c.sends, c.duck])).toEqual([
    [[1, 0], { source: null, amount: 1, release: 0.02 }],
    [[0, 0], { source: null, amount: 0.5, release: 4 }],
  ]);
  const [a, b] = parsed.mixer.buses;
  expect([a.name, a.level, a.mute, a.chain[0].params.mix]).toEqual(['A very long ', 6, false, 1]);
  expect(a.chain[0].id).toMatch(/^m_/);
  expect(b.name).toBe('Echo');
  const ids = parsed.mixer.master.chain.map((m) => m.id);
  expect(ids[0]).toBe('x');
  expect(new Set(ids).size).toBe(2);
  expect(() => parseProject(projectFile({ ...original, mixer: { master: { chain: [{ type: 'lfo' }] } } })))
    .toThrow('Unknown effect module: lfo.');
});

test('blocks and sounds carry no sends or ducking', () => {
  const original = project();
  const block = JSON.parse(serializeBlock(extractBlock(original, 'a')!)).block;
  expect(Object.keys(block.tracks[0])).toEqual(['sound', 'notes']);
  expect(JSON.parse(serializeSound(original.channels[0].sound, {})).sound).not.toHaveProperty('sends');
});

test('a scale and rows of their own length are written only when set, and read back', () => {
  const plain = JSON.parse(serializeProject(project())).project;
  expect(plain).not.toHaveProperty('scale');
  expect(plain.patterns.every((p: object) => !('loops' in p))).toBe(true);
  const original = project();
  original.scale = { root: 9, type: 'dorian' };
  original.patterns[1].loops = { c2: 5 };
  const text = serializeProject(original);
  expect(JSON.parse(text).project.scale).toEqual({ root: 9, type: 'dorian' });
  expect(JSON.parse(text).project.patterns[1].loops).toEqual({ c2: 5 });
  expect(parseProject(text)).toStrictEqual(original);
});

test('a scale that is not offered and loops of missing rows or no number are left out; loop lengths are whole', () => {
  for (const scale of [{ root: 13, type: 'major' }, { root: 2, type: 'lydianish' }, 'C major', null]) {
    expect(parseProject(projectFile({ ...project(), scale }))).not.toHaveProperty('scale');
  }
  const file = project();
  (file.patterns[1] as unknown as { loops: unknown }).loops = { c1: 4.6, c2: 'five', gone: 3 };
  expect(parseProject(projectFile(file)).patterns[1].loops).toEqual({ c1: 5 });
  (file.patterns[1] as unknown as { loops: unknown }).loops = { c1: 0, c2: 1e9 };
  expect(parseProject(projectFile(file)).patterns[1].loops).toEqual({ c1: 1, c2: MAX_TICKS / TICKS_PER_STEP });
  (file.patterns[1] as unknown as { loops: unknown }).loops = { c1: 'x' };
  expect(parseProject(projectFile(file)).patterns[1]).not.toHaveProperty('loops');
});

test('a block keeps the loop of a row of its own length, and a project lends it to the block', () => {
  const original = project();
  original.patterns[1].loops = { c2: 7 };
  const block = extractBlock(original, 'b')!;
  expect(block.tracks.map((t) => t.loop)).toEqual([7]);
  const text = serializeBlock(block);
  expect(JSON.parse(text).block.tracks[0].loop).toBe(7);
  expect(parseBlock(text)).toStrictEqual(block);
  const plain = extractBlock(project(), 'b')!;
  expect(JSON.parse(serializeBlock(plain)).block.tracks[0]).not.toHaveProperty('loop');
});
