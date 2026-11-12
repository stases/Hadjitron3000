import { expect, test } from 'vitest';
import { newMod, newModule, newSound } from '../../src/core/defaults';
import { AMP, EFFECTS, MODS, MODULES, moduleDef, modTargets, OUT, paramSpec, SOURCES } from '../../src/core/modules';

test('MODULES contains exactly all definitions under their types', () => {
  const defs = [...SOURCES, AMP, ...EFFECTS, ...MODS, OUT];
  expect(Object.keys(MODULES)).toEqual(defs.map((def) => def.type));
  expect(new Set(defs.map((def) => def.type)).size).toBe(defs.length);
  for (const def of defs) expect(MODULES[def.type]).toBe(def);
});

test.each(Object.values(MODULES))('$type has unique parameter ids and valid defaults', (def) => {
  expect(new Set(def.params.map((p) => p.id)).size).toBe(def.params.length);
  for (const p of def.params) {
    expect(paramSpec(def, p.id)).toBe(p);
    if (p.kind === 'float') {
      expect(p.def).toBeGreaterThanOrEqual(p.min);
      expect(p.def).toBeLessThanOrEqual(p.max);
      if (p.taper === 'log') expect(p.min).toBeGreaterThan(0);
    } else if (p.kind === 'choice') {
      expect(p.options.map(([value]) => value)).toContain(p.def);
    } else if (p.kind === 'bool') {
      expect(typeof p.def).toBe('boolean');
    }
  }
  expect(paramSpec(def, 'missing')).toBeUndefined();
});

test('moduleDef resolves every location in a sound', () => {
  const sound = newSound('fm');
  sound.chain = [{ ...newModule('filter'), id: 'filter1' }];
  sound.mods = [{ ...newMod('lfo'), id: 'lfo1' }];
  expect(moduleDef(sound, 'source')).toBe(MODULES.fm);
  expect(moduleDef(sound, 'amp')).toBe(AMP);
  expect(moduleDef(sound, 'out')).toBe(OUT);
  expect(moduleDef(sound, 'filter1')).toBe(MODULES.filter);
  expect(moduleDef(sound, 'lfo1')).toBe(MODULES.lfo);
  expect(moduleDef(sound, 'missing')).toBeUndefined();
});

test('modTargets follows signal order and numbers repeated effects', () => {
  const sound = newSound();
  sound.chain = [
    { ...newModule('filter'), id: 'f1' },
    { ...newModule('drive'), id: 'd1' },
    { ...newModule('filter'), id: 'f2', on: false },
    { ...newModule('delay'), id: 'delay1' },
  ];
  sound.mods = [newMod('lfo')];
  expect(modTargets(sound)).toEqual([
    { module: 'source', param: 'pitch', label: 'Source · Pitch' },
    { module: 'f1', param: 'cutoff', label: 'Filter · Cutoff' },
    { module: 'f2', param: 'cutoff', label: 'Filter 2 · Cutoff' },
    { module: 'delay1', param: 'time', label: 'Delay · Free time' },
    { module: 'delay1', param: 'mix', label: 'Delay · Mix' },
    { module: 'out', param: 'level', label: 'Output · Level' },
    { module: 'out', param: 'pan', label: 'Output · Pan' },
  ]);
});
