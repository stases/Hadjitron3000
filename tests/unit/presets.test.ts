import { expect, test } from 'vitest';
import { MODULES, moduleDef, paramSpec } from '../../src/core/modules';
import { parseProject, serializeProject } from '../../src/core/fileformat';
import { TICKS_PER_STEP } from '../../src/core/defaults';
import { eventsBetween, loopSteps } from '../../src/core/sequencer';
import { PRESET_GROUPS, preset } from '../../src/presets';
import { demoProject, starterProject } from '../../src/presets/projects';

const names = PRESET_GROUPS.flatMap((g) => g.names);

test('every listed factory sound loads and keeps its name', () => {
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) {
    const sound = preset(name);
    expect(sound.name).toBe(name);
    expect(MODULES[sound.source.type].kind).toBe('source');
  }
});

test('every modulator of a factory sound points at a real target', () => {
  for (const name of names) {
    const sound = preset(name);
    for (const mod of sound.mods) {
      expect(mod.target, `${name}: ${mod.id}`).not.toBeNull();
      const spec = paramSpec(moduleDef(sound, mod.target!.module)!, mod.target!.param);
      expect(spec?.kind === 'float' && spec.mod, `${name}: ${mod.id}`).toBeTruthy();
    }
  }
});

test('the starter and demo projects survive a save and a load unchanged', () => {
  for (const project of [starterProject(), demoProject()]) {
    expect(parseProject(serializeProject(project))).toEqual(project);
  }
});

test('the demo song plays notes on every channel', () => {
  const demo = demoProject();
  const events = eventsBetween(demo, { kind: 'song' }, 0, loopSteps(demo, { kind: 'song' }) * TICKS_PER_STEP);
  expect(loopSteps(demo, { kind: 'song' })).toBe(256);
  for (const channel of demo.channels) {
    expect(events.some((e) => e.channelId === channel.id), channel.sound.name).toBe(true);
  }
});

test('the starter sends nothing, the demo its keys and pads to the Room with drier reverbs of their own', () => {
  expect(starterProject().channels.every((c) => c.sends[0] === 0 && c.sends[1] === 0)).toBe(true);
  const demo = demoProject();
  expect(demo.mixer.buses.map((b) => b.name)).toEqual(['Room', 'Echo']);
  const sent = demo.channels.filter((c) => c.sends[0] > 0);
  expect(sent.map((c) => c.sound.name)).toEqual(['Kalimba', 'Warm Pad', 'Glass Pad', 'Bell']);
  for (const c of sent) {
    const mix = (s: typeof c.sound) => s.chain.find((m) => m.type === 'reverb')!.params.mix as number;
    expect(mix(c.sound)).toBeLessThan(mix(preset(c.sound.name)));
  }
});
