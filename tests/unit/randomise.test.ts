import { expect, test } from 'vitest';
import { barOf } from '../../src/core/meter';
import { RANDOM_GRIDS, randomNotes } from '../../src/core/randomise';
import type { RandomSettings } from '../../src/core/randomise';
import { inScale } from '../../src/core/scale';

const BAR = barOf([4, 4]);
const settings = (change: Partial<RandomSettings> = {}): RandomSettings => ({
  density: 0.5, grid: 24, centre: 60, range: 7, length: 0, velocity: 0, ratchet: 0, chance: 0, seed: 1234, ...change,
});

test('the same seed gives the same notes, another seed others', () => {
  const a = randomNotes(settings(), undefined, BAR, 0, 2 * BAR.ticks);
  expect(randomNotes(settings(), undefined, BAR, 0, 2 * BAR.ticks)).toEqual(a);
  expect(randomNotes(settings({ seed: 1235 }), undefined, BAR, 0, 2 * BAR.ticks)).not.toEqual(a);
});

test('density is the share of grid lines that get a note, on the chosen grid, restarting every bar', () => {
  for (const { ticks } of RANDOM_GRIDS) {
    const lines = Math.ceil(BAR.ticks / ticks) * 2;
    for (const density of [0, 0.25, 0.5, 1]) {
      const notes = randomNotes(settings({ grid: ticks, density }), undefined, BAR, 0, 2 * BAR.ticks);
      expect(notes).toHaveLength(Math.round(density * lines));
      expect(new Set(notes.map((n) => n.start)).size).toBe(notes.length);
      for (const n of notes) expect((n.start % BAR.ticks) % ticks).toBe(0);
    }
  }
  // In 5/8 the eighth-note triplets start again on every bar of 240 ticks.
  const five = barOf([5, 8]);
  const starts = randomNotes(settings({ grid: 32, density: 1 }), undefined, five, 0, 2 * five.ticks)
    .map((n) => n.start);
  expect(starts.filter((t) => t >= 240).slice(0, 2)).toEqual([240, 272]);
  // A range fills only from its start to its end, and no note reaches past it.
  const part = randomNotes(settings({ density: 1, length: 1 }), undefined, BAR, 100, 300);
  expect(part.map((n) => n.start)).toEqual([120, 144, 168, 192, 216, 240, 264, 288]);
  expect(part.every((n) => n.start + n.len <= 300)).toBe(true);
});

test('pitches stay inside the range around the centre and in the scale, chromatic without one', () => {
  const scale = { root: 2, type: 'minpent' };
  const notes = randomNotes(settings({ density: 1, range: 12, centre: 62, seed: 7 }), scale, BAR, 0, 4 * BAR.ticks);
  expect(notes.every((n) => n.note >= 50 && n.note <= 74 && inScale(n.note, scale))).toBe(true);
  expect(new Set(notes.map((n) => n.note)).size).toBeGreaterThan(6);
  const chromatic = randomNotes(settings({ density: 1, range: 2, seed: 7 }), undefined, BAR, 0, 4 * BAR.ticks);
  expect(new Set(chromatic.map((n) => n.note))).toEqual(new Set([58, 59, 60, 61, 62]));
  const major = { root: 0, type: 'major' } as const;
  expect(randomNotes(settings({ density: 1, range: 0, centre: 61 }), major, BAR, 0, 96)).toEqual([]);
});

test('length, velocity, ratchets and chances vary only as far as asked, and are off by default', () => {
  const plain = randomNotes(settings({ density: 1 }), undefined, BAR, 0, 4 * BAR.ticks);
  expect(plain.every((n) => n.len === 24 && n.vel === 0.8)).toBe(true);
  expect(plain.every((n) => n.ratchet === undefined && n.chance === undefined)).toBe(true);
  const wild = randomNotes(
    settings({ density: 1, length: 1, velocity: 1, ratchet: 0.5, chance: 0.5 }), undefined, BAR, 0, 4 * BAR.ticks,
  );
  expect(new Set(wild.map((n) => n.len))).toEqual(new Set([24, 48, 72, 96]));
  expect(Math.min(...wild.map((n) => n.vel))).toBeGreaterThanOrEqual(0.4);
  expect(new Set(wild.map((n) => n.vel)).size).toBeGreaterThan(10);
  const ratchets = wild.filter((n) => n.ratchet !== undefined);
  expect(ratchets.length / wild.length).toBeGreaterThan(0.3);
  expect(ratchets.length / wild.length).toBeLessThan(0.7);
  expect(new Set(ratchets.map((n) => n.ratchet))).toEqual(new Set([2, 3, 4]));
  expect(new Set(wild.flatMap((n) => (n.chance ? [n.chance] : [])))).toEqual(new Set([25, 50, 75]));
});
