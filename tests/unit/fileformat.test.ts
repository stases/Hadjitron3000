import { expect, test, vi } from 'vitest';
import {
  CHANNEL_COLORS, emptyProject, MAX_BARS, newMod, newModule, newPattern, newSound,
} from '../../src/core/defaults';
import {
  FORMAT_VERSION, FormatError, parseProject, parseSound, PROJECT_EXT, sampleId,
  serializeProject, serializeSound, SOUND_EXT, soundSampleIds,
} from '../../src/core/fileformat';
import { AMP, EFFECTS, MODS, MODULES, OUT, SOURCES } from '../../src/core/modules';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import { defaultParams } from '../../src/core/params';
import type { Project, SampleData, Sound } from '../../src/core/types';

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
    { id: 'c1', sound: sound(), color: 2, mute: true, solo: false },
    { id: 'c2', sound: { ...newSound('fm'), source: { ...newSound('fm').source, on: true } },
      color: 5, mute: false, solo: true },
  ];
  result.patterns = [
    { id: 'a', name: 'A', bars: 1, cells: { c1: { 0: { note: 60, vel: 0.7, len: 1 } } } },
    { id: 'b', name: 'B', bars: 2, cells: { c2: { 17: { note: 65, vel: 0.5, len: 3 } } } },
  ];
  result.song = ['a', 'b', 'a'];
  result.samples = { kick: { name: 'kick.wav', bytes: new Uint8Array([0, 127, 128, 255]) } };
  return result;
}

test('exports the native extensions and format version', () => {
  expect([SOUND_EXT, PROJECT_EXT, FORMAT_VERSION]).toEqual(['h3s', 'h3k', 1]);
});

test.each([0, 4, 384 * 1024 + 1])('a sampled sound round trips %i bytes exactly', (length) => {
  const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
  const samples = { kick: { name: 'kïck.wav', bytes } };
  const original = sound();
  const text = serializeSound(original, samples);
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  expect(JSON.parse(text)).toMatchObject({ format: 'hadjitron3000/sound', version: 1 });
  const parsed = parseSound(text);
  expect(parsed.sound).toStrictEqual(original);
  expect(parsed.samples.kick.name).toBe('kïck.wav');
  expect(parsed.samples.kick.bytes).toBeInstanceOf(Uint8Array);
  expect(parsed.samples.kick.bytes).toStrictEqual(bytes);
});

test('a project round trips two channels, two patterns and a repeated song', () => {
  const original = project();
  const text = serializeProject(original);
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  expect(JSON.parse(text)).toMatchObject({ format: 'hadjitron3000/project', version: 1 });
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
  [{ ...project(), patterns: [{ id: 'a', cells: [] }] }, 'cells'],
  [{ ...project(), patterns: [{ id: 'a', cells: null }] }, 'cells'],
  [{ ...project(), patterns: [{ id: 'a', cells: { c1: [] } }] }, 'cells for channel'],
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
  if (def.kind === 'mod') original.mods = [{ ...entry, target: null, amount: 0 }];
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
    sample: '', pitch: 24, fine: -4, start: 0, end: 1, loop: false, reverse: true, mode: 'oneshot',
  });
  expect(result.amp).toEqual({ attack: 0, decay: 5, sustain: 0.8, release: 0.2 });
  expect(result.out).toEqual({ level: 6, pan: -1 });
  expect(result.chain[0].params).toEqual(defaultParams(MODULES.filter));
  expect(result.mods[0].params).toEqual({ wave: 'triangle', rate: 40 });
  const defaults = parseSound(soundFile({ ...newSound(), amp: undefined, out: undefined })).sound;
  expect(defaults.amp).toEqual(defaultParams(AMP));
  expect(defaults.out).toEqual(defaultParams(OUT));
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
  const parsed = parseProject(projectFile({ ...emptyProject(), patterns: [{ id: 'a', name: 5, bars, cells: {} }] }));
  expect(parsed.patterns[0]).toEqual({ id: 'a', name: '', bars: expected, cells: {} });
});

test('normalizes steps, drops invalid indices and drops cells for missing channels', () => {
  const original = project();
  const cells = {
    c1: {
      0: { note: -5, vel: -1, len: -3 },
      1: { note: 999, vel: 4, len: 999 },
      2: { note: 60.6, vel: 0.123, len: 2.7, extra: 1 },
      3: { note: 'bad', vel: null, len: 'bad' },
      500: { note: 72, vel: 1, len: 1 },
      '-1': null, '1.5': null, 'NaN': null, 'Infinity': null, '': null, 'nope': null,
    },
    gone: null,
  };
  const parsed = parseProject(projectFile({ ...original, patterns: [{ id: 'a', bars: 1, cells }] }));
  expect(parsed.patterns[0].cells).toEqual({ c1: {
    0: { note: MIN_NOTE, vel: 0, len: 1 },
    1: { note: MAX_NOTE, vel: 1, len: 128 },
    2: { note: 61, vel: 0.123, len: 3 },
    3: { note: 60, vel: 0.8, len: 1 },
    500: { note: 72, vel: 1, len: 1 },
  } });
});

test.each([[], undefined])('a project without patterns receives an empty pattern A: %s', (patterns) => {
  const parsed = parseProject(projectFile({ ...emptyProject(), patterns, song: ['missing'] }));
  expect(parsed.patterns).toEqual([{ id: expect.any(String), name: 'A', bars: 1, cells: {} }]);
  expect(parsed.patterns[0].id).not.toBe('');
  expect(parsed.song).toEqual([]);
});

test('song keeps only existing pattern ids, in order and including repetitions', () => {
  const parsed = parseProject(projectFile({ ...project(), song: ['b', 'missing', 1, null, 'a', 'b'] }));
  expect(parsed.song).toEqual(['b', 'a', 'b']);
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
  for (const pattern of raw.project.patterns) {
    delete pattern.cells.extra;
    for (const steps of Object.values(pattern.cells)) delete (steps as Record<string, unknown>).extra;
  }
  expect(parseProject(JSON.stringify(raw))).toStrictEqual(original);
});

test('dictionary ids such as __proto__ survive without prototype lookup or mutation', () => {
  const original = project();
  original.channels[0].id = '__proto__';
  original.channels[0].sound.source.params.sample = '__proto__';
  original.samples = Object.fromEntries([['__proto__', { name: 'kick.wav', bytes: new Uint8Array([255]) }]]);
  original.patterns = [{ ...newPattern('A'), cells: Object.fromEntries([
    ['__proto__', { 0: { note: 60, vel: 1, len: 1 } }],
  ]) }];
  original.song = [original.patterns[0].id];
  expect(parseProject(serializeProject(original))).toStrictEqual(original);
  const samples: Record<string, SampleData> = Object.create({ kick: { name: 'inherited', bytes: new Uint8Array() } });
  expect(JSON.parse(serializeSound(sound(), samples)).samples).toEqual({});
});
