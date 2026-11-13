import { expect, test } from 'vitest';
import { MAX_BARS, TICKS_PER_STEP } from '../../src/core/defaults';
import {
  DEFAULT_METER, MAX_TICKS, METERS, barOf, barsToHold, beatOf, beatsBetween, meterText, readMeter,
} from '../../src/core/meter';

test.each([
  ['2/4', 8, [0, 4]],
  ['3/4', 12, [0, 4, 8]],
  ['4/4', 16, [0, 4, 8, 12]],
  ['5/4', 20, [0, 4, 8, 12, 16]],
  ['6/4', 24, [0, 4, 8, 12, 16, 20]],
  ['7/4', 28, [0, 4, 8, 12, 16, 20, 24]],
  ['5/8', 10, [0, 4]],
  ['6/8', 12, [0, 6]],
  ['7/8', 14, [0, 4, 8]],
  ['9/8', 18, [0, 6, 12]],
  ['12/8', 24, [0, 6, 12, 18]],
])('a bar of %s has %i steps in beats starting on %j', (text, steps, beats) => {
  const meter = METERS.find((m) => meterText(m) === text)!;
  expect(barOf(meter)).toEqual({ steps, ticks: steps * TICKS_PER_STEP, beats });
  // Every bar has an even number of steps, so swing pairs start again at each bar.
  expect(steps % 2).toBe(0);
});

test('there are eleven meters, 4/4 first by default, and each bar is one object', () => {
  expect(METERS.map(meterText)).toEqual(['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '5/8', '6/8', '7/8', '9/8', '12/8']);
  expect(DEFAULT_METER).toEqual([4, 4]);
  expect(barOf([7, 8])).toBe(barOf([7, 8]));
  expect(MAX_TICKS).toBe(MAX_BARS * 28 * TICKS_PER_STEP);
});

test('a step falls in the beat that starts on or before it', () => {
  const bar = barOf([7, 8]);
  expect(Array.from({ length: 14 }, (_, s) => beatOf(s, bar))).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
});

test('only the listed meters are read, as copies', () => {
  expect(readMeter([7, 8])).toEqual([7, 8]);
  expect(readMeter([7, 8])).not.toBe(METERS.find((m) => meterText(m) === '7/8'));
  for (const bad of [[4, 2], [8, 4], [7], '7/8', null, undefined, [4, '4']]) expect(readMeter(bad)).toBeNull();
});

test('bars to hold a length are rounded up and kept between one and the most bars', () => {
  const bar = barOf([7, 8]);
  expect(barsToHold(0, bar)).toBe(1);
  expect(barsToHold(336, bar)).toBe(1);
  expect(barsToHold(337, bar)).toBe(2);
  expect(barsToHold(1e9, bar)).toBe(MAX_BARS);
});

test('beatsBetween lists the beats of a range with their downbeats, the count-in included', () => {
  const four = barOf([4, 4]);
  expect(beatsBetween(-384, 0, four)).toEqual([
    { tick: -384, downbeat: true }, { tick: -288, downbeat: false }, { tick: -192, downbeat: false },
    { tick: -96, downbeat: false },
  ]);
  expect(beatsBetween(90, 200, four)).toEqual([{ tick: 96, downbeat: false }, { tick: 192, downbeat: false }]);
  expect(beatsBetween(96, 96, four)).toEqual([]);
  // 7/8 groups its seven eighths four, four and six steps.
  expect(beatsBetween(0, 2 * 336, barOf([7, 8])).map((b) => [b.tick, b.downbeat])).toEqual([
    [0, true], [96, false], [192, false], [336, true], [432, false], [528, false],
  ]);
  expect(beatsBetween(0, 288, barOf([6, 8])).map((b) => b.tick)).toEqual([0, 144]);
});
