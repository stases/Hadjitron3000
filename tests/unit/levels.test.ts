import { expect, test } from 'vitest';
import { LEVEL_NAMES, LEVELS, byLevel, levelOf } from '../../src/core/levels';
import { AMP, EFFECTS, FILTER, MODS, MODULES, PLAY, SOURCES } from '../../src/core/modules';

const ids = (specs: readonly { id: string }[]) => specs.map((p) => p.id);

test('the levels are called Basics, Shaping and Deep, and a missing level is Basics', () => {
  expect(LEVELS.map((l) => LEVEL_NAMES[l])).toEqual(['Basics', 'Shaping', 'Deep']);
  expect(levelOf({})).toBe(1);
  expect(levelOf({ level: 3 })).toBe(3);
});

test('every module and every parameter resolves to a level', () => {
  for (const def of Object.values(MODULES)) {
    expect(LEVELS, def.type).toContain(levelOf(def));
    for (const p of def.params) expect(LEVELS, `${def.type} ${p.id}`).toContain(levelOf(p));
  }
});

test('byLevel splits a module by level and keeps table order', () => {
  const osc = byLevel(MODULES.osc.params);
  expect([ids(osc[1]), ids(osc[2]), ids(osc[3])]).toEqual([
    ['wave', 'pitch'],
    ['fine', 'voices', 'spread', 'noise', 'pw', 'wave2', 'pitch2', 'fine2', 'mix2', 'sub', 'subOct'],
    ['shape', 'width', 'shape2'],
  ]);
  expect(ids(byLevel(MODULES.reverb.params)[2])).toEqual(['tone']);
  expect(byLevel(AMP.params)[1]).toEqual(AMP.params);
  const effects = byLevel(EFFECTS);
  expect([effects[1], effects[2], effects[3]].map((defs) => defs.map((d) => d.type))).toEqual([
    ['delay', 'reverb'],
    ['filter', 'drive'],
    [],
  ]);
});

test('every unit has Basics controls, and what the tutorials touch is Basics', () => {
  for (const def of Object.values(MODULES)) {
    if (def !== PLAY) expect(byLevel(def.params)[1].length, def.type).toBeGreaterThan(0);
  }
  // The play controls are part of the Source unit's Shaping section.
  expect(byLevel(PLAY.params)[2]).toEqual(PLAY.params);
  const basics = (type: string, param: string) => levelOf(MODULES[type].params.find((p) => p.id === param)!);
  expect(basics('osc', 'wave')).toBe(1);
  expect(basics('amp', 'sustain')).toBe(1);
  expect(basics(FILTER.type, 'cutoff')).toBe(1);
  expect(basics(FILTER.type, 'reso')).toBe(1);
  expect(basics('delay', 'mix')).toBe(1);
  expect(basics('reverb', 'mix')).toBe(1);
  for (const type of ['osc', FILTER.type, 'delay', 'reverb', 'env']) expect(levelOf(MODULES[type]), type).toBe(1);
  expect(levelOf(MODULES.filter)).toBe(2);
  expect(SOURCES.filter((d) => levelOf(d) === 1).length).toBeGreaterThan(0);
  expect(MODS.filter((d) => levelOf(d) === 1).length).toBeGreaterThan(0);
});
