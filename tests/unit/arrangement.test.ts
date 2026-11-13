import { expect, test } from 'vitest';
import { fadeGain, fitFades, laneGain, noteCurve } from '../../src/core/arrangement';

const L = 1000;

test('a fade-in rises from silence to full gain along a quarter sine, and a fade-out is its mirror image', () => {
  expect(fadeGain(0, L, 400, 0)).toBe(0);
  expect(fadeGain(400, L, 400, 0)).toBe(1);
  expect(fadeGain(200, L, 400, 0)).toBeCloseTo(Math.SQRT1_2, 12);
  expect(fadeGain(100, L, 400, 0)).toBeCloseTo(Math.sin(Math.PI / 8), 12);
  let last = -1;
  for (let t = 0; t <= 400; t += 10) {
    const g = fadeGain(t, L, 400, 0);
    expect(g).toBeGreaterThan(last);
    // Equal power: the fade-in and the matching fade-out add up to a constant power.
    expect(g ** 2 + fadeGain(L - 400 + t, L, 0, 400) ** 2).toBeCloseTo(1, 12);
    expect(fadeGain(L - t, L, 0, 400)).toBeCloseTo(g, 12);
    last = g;
  }
  expect(fadeGain(600, L, 400, 400)).toBe(1);
  expect(fadeGain(L, L, 0, 400)).toBe(0);
});

test('before a fade-in and after a fade-out the gain is 0; without them it is 1', () => {
  expect(fadeGain(-10, L, 400, 0)).toBe(0);
  expect(fadeGain(L + 10, L, 0, 400)).toBe(0);
  expect(fadeGain(L + 10, L, 400, 0)).toBe(1);
  expect(fadeGain(500, L, 0, 0)).toBe(1);
});

test('a fade-in and a fade-out that meet or overlap in a short placement multiply', () => {
  // Meeting in the middle: full gain only at that one point.
  expect(fadeGain(L / 2, L, L / 2, L / 2)).toBe(1);
  expect(fadeGain(L / 4, L, L / 2, L / 2)).toBeCloseTo(Math.SQRT1_2, 12);
  expect(fadeGain(3 * L / 4, L, L / 2, L / 2)).toBeCloseTo(Math.SQRT1_2, 12);
  // Each over the whole placement: silent at both ends and half power at its middle.
  expect(fadeGain(0, L, L, L)).toBe(0);
  expect(fadeGain(L, L, L, L)).toBe(0);
  expect(fadeGain(L / 2, L, L, L)).toBeCloseTo(0.5, 12);
});

test('fades are whole bars inside the placement, the fade-in first, and absent at 0', () => {
  expect(fitFades(8, 2, 3)).toEqual({ fadeIn: 2, fadeOut: 3 });
  expect(fitFades(8, 0, 0)).toEqual({});
  expect(fitFades(8, 0, 2)).toEqual({ fadeOut: 2 });
  expect(fitFades(2, 2, 2)).toEqual({ fadeIn: 2 });
  expect(fitFades(3, 2, 2)).toEqual({ fadeIn: 2, fadeOut: 1 });
  expect(fitFades(4, 1.4, 2.6)).toEqual({ fadeIn: 1, fadeOut: 3 });
  expect(fitFades(4, -3, 9)).toEqual({ fadeOut: 4 });
});

test('a lane plays at its level in dB, and not at all when muted or at the bottom', () => {
  expect(laneGain({ level: 0, mute: false })).toBe(1);
  expect(laneGain({ level: -12, mute: false })).toBeCloseTo(10 ** (-12 / 20), 12);
  expect(laneGain({ level: 6, mute: false })).toBeCloseTo(1.995, 3);
  expect(laneGain({ level: -48, mute: false })).toBe(0);
  expect(laneGain({ level: 0, mute: true })).toBe(0);
});

test('a curve samples the fade at its breakpoints, times the lane, in seconds from the note', () => {
  const shape = { length: 800, fadeIn: 160, fadeOut: 0, level: 0.5 };
  const time = (t: number) => t / 100;
  const curve = noteCurve(shape, 0, 40, time);
  // The note ends inside the fade-in, so its curve runs on to the fade's end.
  expect(curve).toHaveLength(17);
  expect(curve[0]).toEqual([0, 0]);
  expect(curve.at(-1)).toEqual([1.6, 0.5]);
  for (const [at, gain] of curve) expect(gain).toBeCloseTo(0.5 * fadeGain(at * 100, 800, 160, 0), 12);
  // Starting halfway into the fade, the first point is where the note starts.
  const later = noteCurve(shape, 80, 400, time);
  expect(later[0][0]).toBe(0);
  expect(later[0][1]).toBeCloseTo(0.5 * Math.SQRT1_2, 12);
  expect(later.map(([at]) => Math.round(at * 100) / 100)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 3.2]);
  // A note that does not meet a fade has one point.
  expect(noteCurve(shape, 200, 300, time)).toEqual([[0, 0.5]]);
});
