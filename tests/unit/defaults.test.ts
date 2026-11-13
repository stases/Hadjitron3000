import { expect, test } from 'vitest';
import { emptyProject, newMod, newModule, newNote, newPattern, newSound, uid } from '../../src/core/defaults';
import { AMP, EFFECTS, MODS, OUT, SOURCES } from '../../src/core/modules';
import { defaultParams } from '../../src/core/params';

test.each(SOURCES)('newSound creates the exact defaults for $type', (def) => {
  expect(newSound(def.type, 'Test')).toEqual({
    name: 'Test',
    source: { id: 'source', type: def.type, params: defaultParams(def) },
    amp: defaultParams(AMP),
    chain: [],
    mods: [],
    out: defaultParams(OUT),
  });
  expect(Object.keys(newSound(def.type).source.params)).toEqual(def.params.map((p) => p.id));
});

test('fresh documents have independent parameter objects', () => {
  const first = newSound();
  const second = newSound();
  first.source.params.pitch = 12;
  first.amp.attack = 2;
  first.out.pan = 1;
  expect(second.source.params.pitch).toBe(0);
  expect(second.amp.attack).toBe(0.002);
  expect(second.out.pan).toBe(0);
});

test('an empty project contains one pattern and an empty song', () => {
  const project = emptyProject();
  expect(project).toEqual({
    name: 'Untitled', bpm: 120, swing: 0, master: 0, channels: [], samples: {},
    patterns: [{ id: expect.any(String), name: 'A', color: 0, bars: 1, notes: {} }],
    song: [],
  });
});

test('module and modulator factories use their definitions', () => {
  for (const def of [...EFFECTS, ...MODS]) {
    expect(newModule(def.type)).toEqual({
      id: expect.stringMatching(/^m_/), type: def.type, params: defaultParams(def), on: true,
    });
  }
  expect(newMod('lfo')).toMatchObject({ type: 'lfo', target: null, amount: 0.5, on: true });
});

test('pattern and note factories supply editable defaults', () => {
  expect(newPattern('B')).toEqual({ id: expect.stringMatching(/^p_/), name: 'B', color: 0, bars: 1, notes: {} });
  expect(newPattern('C', 5)).toEqual({ id: expect.stringMatching(/^p_/), name: 'C', color: 5, bars: 1, notes: {} });
  expect(newNote()).toEqual({ start: 0, len: 24, note: 60, vel: 0.8 });
  expect(newNote(48, 72)).toEqual({ start: 48, len: 24, note: 72, vel: 0.8 });
});

test('uid preserves the prefix and generates distinct ids', () => {
  const ids = Array.from({ length: 1000 }, () => uid('test'));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => /^test_[a-z0-9]{8}$/.test(id))).toBe(true);
});
