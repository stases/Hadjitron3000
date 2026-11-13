import { expect, test } from 'vitest';
import { TICKS_PER_STEP } from '../../src/core/defaults';
import { barOf } from '../../src/core/meter';
import { heardTick, quantize, takeNote } from '../../src/core/record';
import { stepSeconds, tickTime, timeTick } from '../../src/core/sequencer';

const T = TICKS_PER_STEP;
const FOUR = barOf([4, 4]);
const SEVEN = barOf([7, 8]);

test('timeTick undoes tickTime at any swing, before and after tick 0', () => {
  for (const swing of [0, 0.3, 0.75, 1]) {
    for (let tick = -400; tick < 800; tick += 7.5) {
      expect(timeTick(tickTime(tick, 120, swing), 120, swing)).toBeCloseTo(tick, 9);
    }
  }
  // With full swing the second sixteenth of a pair starts three quarters of a pair in.
  expect(timeTick(1.5 * stepSeconds(120), 120, 1)).toBeCloseTo(T, 9);
});

test('a note is placed where the loop was heard: the output latency before the moment it was played', () => {
  const clock = { origin: 10, bpm: 120, swing: 0 };
  // At 120 BPM a sixteenth is 0.125 s; played at 10.55 s with 50 ms of latency, the listener heard step 4.
  expect(heardTick(clock, 10.55, 0.05)).toBeCloseTo(4 * T, 9);
  expect(heardTick(clock, 10.55, 0)).toBeCloseTo(4.4 * T, 9);
  // During a count-in, before the origin, the tick is negative.
  expect(heardTick(clock, 9.5, 0)).toBeCloseTo(-4 * T, 9);
  // With swing the tick follows the warp, so playing exactly on a swung sixteenth gives that sixteenth.
  const swung = { ...clock, swing: 0.5 };
  expect(heardTick(swung, 10 + 0.05 + tickTime(3 * T, 120, 0.5), 0.05)).toBeCloseTo(3 * T, 9);
});

test('without swing quantize goes to the nearest grid line of the bar, in 4/4 and 7/8', () => {
  expect(quantize(30, T, FOUR, 120, 0)).toBe(24);
  expect(quantize(37, T, FOUR, 120, 0)).toBe(48);
  expect(quantize(36, T, FOUR, 120, 0)).toBe(24); // a tie goes earlier
  expect(quantize(-5, T, FOUR, 120, 0)).toBe(0);
  expect(quantize(20, 32, FOUR, 120, 0)).toBe(32);
  expect(quantize(383, 12, FOUR, 120, 0)).toBe(384);
  // In 7/8 a bar is 336 ticks; triplet eighths (32) do not divide it, so the lines start again with each bar and
  // the next bar's downbeat stays on the grid.
  expect(quantize(330, 32, SEVEN, 120, 0)).toBe(336);
  expect(quantize(345, 32, SEVEN, 120, 0)).toBe(336);
  expect(quantize(318, 32, SEVEN, 120, 0)).toBe(320);
  expect(quantize(336 + 70, 32, SEVEN, 120, 0)).toBe(336 + 64);
  expect(quantize(13 * T + 13, T, SEVEN, 120, 0)).toBe(14 * T);
});

test('with swing quantize finds the line heard nearest, not the one drawn nearest', () => {
  // Fully swung, a pair of sixteenths sounds 1.5 + 0.5 steps long. Sixteenth triplets lie at 16 and 32 ticks, heard
  // 1 and 1.67 steps in; the halfway point by ear is tick 21.3, while drawn it is 24.
  expect(quantize(22, 16, FOUR, 120, 1)).toBe(32);
  expect(quantize(22, 16, FOUR, 120, 0)).toBe(16);
  expect(quantize(21, 16, FOUR, 120, 1)).toBe(16);
  // Eighth triplets at 32 and 64 ticks: heard halfway at tick 53.3, drawn at 48.
  expect(quantize(50, 32, FOUR, 120, 1)).toBe(32);
  expect(quantize(50, 32, FOUR, 120, 0)).toBe(64);
  // On sixteenths the warp is straight between the lines, so drawn and heard agree.
  expect(quantize(13, T, FOUR, 120, 1)).toBe(T);
  expect(quantize(11, T, FOUR, 120, 1)).toBe(0);
  // In 7/8 the swing pairs and the grid start again with each bar: lines at 336 and 368 are heard halfway at 349.3.
  expect(quantize(350, 32, SEVEN, 120, 1)).toBe(368);
  expect(quantize(350, 32, SEVEN, 120, 0)).toBe(336);
  // A note played by ear on the swung line, inverted with the same warp, lands exactly on it.
  const heard = timeTick(tickTime(3 * T, 120, 0.6) + 0.004, 120, 0.6);
  expect(quantize(heard, T, FOUR, 120, 0.6)).toBe(3 * T);
});

const grid = (unit: number, length: number, bar = FOUR) => ({ unit, bar, bpm: 120, swing: 0, length });

test('a played note lands in the block with its held length, quantized or not', () => {
  expect(takeNote(30, 70, grid(T, 768), 60, 0.5)).toEqual({ start: 24, len: 48, note: 60, vel: 0.5 });
  // Lengths become whole grid units, at least one.
  expect(takeNote(30, 33, grid(T, 768), 60, 1)).toEqual({ start: 24, len: 24, note: 60, vel: 1 });
  expect(takeNote(30.4, 33, grid(0, 768), 60, 1)).toEqual({ start: 30, len: 3, note: 60, vel: 1 });
  expect(takeNote(30.4, 30.6, grid(0, 768), 60, 1)).toEqual({ start: 30, len: 1, note: 60, vel: 1 });
});

test('notes wrap with the loop, are cut at its end, and the count-in writes nothing', () => {
  // The third pass of a one-bar block.
  expect(takeNote(2 * 384 + 100, 2 * 384 + 130, grid(0, 384), 62, 1)).toMatchObject({ start: 100, len: 30 });
  // Held across the loop end: cut where the block ends.
  expect(takeNote(300, 500, grid(T, 384), 62, 1)).toMatchObject({ start: 288, len: 96 });
  expect(takeNote(370, 380, grid(0, 384), 62, 1)).toMatchObject({ start: 370, len: 10 });
  // Played a hair before the loop comes round, quantize puts it on the downbeat of the next pass.
  expect(takeNote(380, 420, grid(T, 384), 62, 1)).toMatchObject({ start: 0, len: 48 });
  // Played just before the first downbeat, quantize keeps it; earlier in the count-in it is dropped.
  expect(takeNote(-6, 20, grid(T, 384), 62, 1)).toMatchObject({ start: 0, len: 24 });
  expect(takeNote(-30, 20, grid(T, 384), 62, 1)).toBeNull();
  expect(takeNote(-1, 20, grid(0, 384), 62, 1)).toBeNull();
  // In 7/8 a two-bar block is 672 ticks long.
  expect(takeNote(672 + 330, 672 + 400, grid(T, 672, SEVEN), 62, 1)).toMatchObject({ start: 336, len: 72 });
});
