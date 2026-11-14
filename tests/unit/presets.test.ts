import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { fitFades } from '../../src/core/arrangement';
import { cleanPoints, refLabel, validLocks } from '../../src/core/automation';
import { SONG_LANES, TICKS_PER_STEP } from '../../src/core/defaults';
import { MODULES, moduleDef, paramSpec } from '../../src/core/modules';
import {
  parseBlock, parseProject, parseSound, serializeBlock, serializeProject, serializeSound,
} from '../../src/core/fileformat';
import { barOf } from '../../src/core/meter';
import { eventsBetween, loopSteps } from '../../src/core/sequencer';
import { PRESET_GROUPS, preset, presetSamples } from '../../src/presets';
import { EXAMPLES } from '../../src/presets/examples';
import { demoProject, factoryBlocks, starterProject } from '../../src/presets/projects';

const names = PRESET_GROUPS.flatMap((g) => g.names);
const SOUNDS = new URL('../../src/presets/sounds/', import.meta.url);

test('every factory sound file is listed once, loads, keeps its name and survives a save and a load', () => {
  expect(new Set(names).size).toBe(names.length);
  expect(readdirSync(SOUNDS).map((f) => f.replace(/\.h3s$/, '')).sort()).toEqual([...names].sort());
  for (const name of names) {
    const sound = preset(name);
    expect(sound.name).toBe(name);
    expect(MODULES[sound.source.type].kind).toBe('source');
    expect(parseSound(serializeSound(sound, presetSamples(name))).sound, name).toEqual(sound);
  }
});

test('the library has the groups of the kinds of music the app is for, none of them crowded', () => {
  expect(PRESET_GROUPS.map((g) => g.label)).toEqual([
    'Drums', 'Percussion', 'Bass', 'Keys', 'Leads', 'Pads', 'Textures', 'Risers',
  ]);
  expect(names.length).toBeGreaterThanOrEqual(70);
  expect(names.length).toBeLessThanOrEqual(85);
  for (const group of PRESET_GROUPS) expect(group.names.length, group.label).toBeLessThanOrEqual(20);
});

test('a factory sound file carries no mixer settings and no samples (the sampled ones get theirs from code)', () => {
  for (const name of names) {
    const file = JSON.parse(readFileSync(new URL(`${name}.h3s`, SOUNDS), 'utf8'));
    expect(Object.keys(file.sound).sort(), name).toEqual(
      expect.arrayContaining(['amp', 'chain', 'mods', 'name', 'out', 'source']),
    );
    expect(Object.keys(file.sound).every((k) => ['name', 'source', 'play', 'filter', 'amp', 'chain', 'mods', 'out']
      .includes(k)), name).toBe(true);
    expect(file.samples, name).toEqual({});
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

test('the starter, the demo and the examples survive a save and a load unchanged', () => {
  for (const project of [starterProject(), demoProject(), ...EXAMPLES.map((e) => e.project())]) {
    expect(parseProject(serializeProject(project)), project.name).toEqual(project);
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

test('each example is a short song of four to six blocks that plays every one of its sounds', () => {
  const bars: Record<string, number> = { Techno: 32, Trance: 32, Acid: 24, Experimental: 24, Organic: 32, Ambient: 32 };
  expect(EXAMPLES.map((e) => e.name)).toEqual(Object.keys(bars));
  for (const { name, project } of EXAMPLES) {
    const p = project();
    expect(p.name).toBe(name);
    expect(p.scale, name).toBeDefined();
    expect(p.patterns.length, name).toBeGreaterThanOrEqual(4);
    expect(p.patterns.length, name).toBeLessThanOrEqual(6);
    const steps = loopSteps(p, { kind: 'song' });
    expect(steps / barOf(p.meter).steps, name).toBe(bars[name]);
    const events = eventsBetween(p, { kind: 'song' }, 0, steps * TICKS_PER_STEP);
    for (const channel of p.channels) {
      expect(events.some((e) => e.channelId === channel.id), `${name}: ${channel.sound.name}`).toBe(true);
    }
    for (const pattern of p.patterns) {
      expect(p.song.some((s) => s.pattern === pattern.id), `${name}: ${pattern.name} is in the song`).toBe(true);
    }
  }
});

test('the mixer and the lanes of every example are valid', () => {
  for (const { name, project } of EXAMPLES) {
    const p = project();
    const ids = p.channels.map((c) => c.id);
    expect(p.mixer.buses.map((b) => b.name), name).toEqual(['Room', 'Echo']);
    for (const c of p.channels) {
      expect(c.sends.every((s) => s >= 0 && s <= 1), `${name}: ${c.sound.name}`).toBe(true);
      if (c.duck.source !== null) {
        expect(ids.filter((id) => id !== c.id), `${name}: ${c.sound.name}`).toContain(c.duck.source);
        expect(c.duck.amount).toBeGreaterThan(0);
      }
    }
    expect(p.lanes, name).toHaveLength(SONG_LANES);
    for (let lane = 0; lane < SONG_LANES; lane++) {
      const row = p.song.filter((s) => s.lane === lane).sort((a, b) => a.bar - b.bar);
      for (let i = 1; i < row.length; i++) {
        expect(row[i].bar, `${name}, lane ${lane}`).toBeGreaterThanOrEqual(row[i - 1].bar + row[i - 1].bars);
      }
    }
    for (const s of p.song) {
      expect(fitFades(s.bars, s.fadeIn ?? 0, s.fadeOut ?? 0), name).toEqual({
        ...(s.fadeIn && { fadeIn: s.fadeIn }), ...(s.fadeOut && { fadeOut: s.fadeOut }),
      });
      if (s.mutes) expect(s.mutes, name).toEqual(ids.filter((id) => s.mutes!.includes(id)));
    }
  }
  const ambient = EXAMPLES.find((e) => e.name === 'Ambient')!.project();
  expect(ambient.song.every((s) => s.fadeIn || s.fadeOut)).toBe(true);
  for (const name of ['Techno', 'Trance']) {
    expect(EXAMPLES.find((e) => e.name === name)!.project().channels.some((c) => c.duck.source), name).toBe(true);
  }
});

test('the automation rows and the locks of the examples move controls their sounds have', () => {
  const rows: Record<string, string[]> = {
    Techno: ['Dark Drone · Filter · Cutoff'], Trance: ['Choir Pad · Filter · Cutoff'],
    Ambient: ['Cloud Pad · Source · Position'],
  };
  for (const { name, project } of EXAMPLES) {
    const p = project();
    expect(p.automation.map((row) => refLabel(p, row.target)), name).toEqual(rows[name] ?? []);
    for (const { points } of p.automation) expect(cleanPoints(points), name).toEqual(points);
    let locked = 0;
    for (const pattern of p.patterns) {
      for (const [id, row] of Object.entries(pattern.notes)) {
        const { sound } = p.channels.find((c) => c.id === id)!;
        for (const { locks } of row.filter((n) => n.locks)) {
          expect(validLocks(sound, locks!), `${name}: ${sound.name}`).toEqual(locks);
          locked++;
        }
      }
    }
    expect(locked, name).toBe(name === 'Experimental' ? 5 : 0);
  }
});

test('the Block Library offers the demo blocks and the blocks of each example, grouped by song', () => {
  const groups = factoryBlocks();
  expect(groups.map((g) => g.label)).toEqual(['Welcome', ...EXAMPLES.map((e) => e.name)]);
  expect(groups[0].blocks.map((b) => b.name)).toEqual([
    'Beat', 'Bass', 'Keys', 'Pads', 'Break', 'Bass up', 'Keys up', 'Pads up',
  ]);
  for (const { label, blocks } of groups) {
    for (const block of blocks) {
      const where = `${label}: ${block.name}`;
      expect(parseBlock(serializeBlock(block)), where).toEqual(block);
      expect(block.bars, where).toBeGreaterThanOrEqual(1);
      expect(block.bars, where).toBeLessThanOrEqual(8);
      expect(block.tracks.length, where).toBeGreaterThan(0);
      const length = block.bars * 16 * TICKS_PER_STEP;
      for (const track of block.tracks) {
        expect(names, where).toContain(track.sound.name);
        expect(track.notes.length, where).toBeGreaterThan(0);
        for (const n of track.notes) {
          expect(n.start + n.len, `${where}: ${track.sound.name}`).toBeLessThanOrEqual(length);
        }
        if (track.loop !== undefined) expect(track.loop, where).toBeLessThan(block.bars * 16);
      }
    }
  }
});

test('the blocks of an example only use the sounds of their project', () => {
  for (const { name, project } of EXAMPLES) {
    const p = project();
    const ids = new Set(p.channels.map((c) => c.id));
    for (const pattern of p.patterns) {
      expect(Object.keys(pattern.notes).every((id) => ids.has(id)), `${name}: ${pattern.name}`).toBe(true);
      expect(Object.keys(pattern.loops ?? {}).every((id) => Object.hasOwn(pattern.notes, id)), pattern.name).toBe(true);
    }
  }
});
