import { expect, test } from 'vitest';
import {
  DEFAULT_SHAPE, SHAPE_POINTS, STOCK_SHAPES, decodeShape, encodeShape, shapeHarmonics, smoothShape, strokeShape,
} from '../../src/core/shape';

test('a shape is 64 points stored as two digits each, to 1/2047, with 0 and the ends exact', () => {
  const points = Array.from({ length: SHAPE_POINTS }, (_, i) => Math.sin(i) * 1.2);
  const text = encodeShape(points);
  expect(text).toHaveLength(128);
  const clamped = points.map((v) => Math.max(-1, Math.min(1, v)));
  decodeShape(text)!.forEach((v, i) => expect(Math.abs(v - clamped[i])).toBeLessThan(1 / 2047));
  expect(decodeShape(encodeShape([0, 1, -1, ...Array(61).fill(0)]))!.slice(0, 3)).toEqual([0, 1, -1]);
  expect(decodeShape(DEFAULT_SHAPE)).toEqual(decodeShape(encodeShape(STOCK_SHAPES.sine)));
  for (const bad of ['', 'AA', DEFAULT_SHAPE.slice(1), `${DEFAULT_SHAPE.slice(2)}!!`, `${DEFAULT_SHAPE.slice(2)}__`]) {
    expect(decodeShape(bad), bad).toBeNull();
  }
});

test('a stroke sets the points on a straight line between its ends, either way round', () => {
  const p = Array(SHAPE_POINTS).fill(0);
  strokeShape(p, 10, 1, 6, -1);
  expect(p.slice(5, 12)).toEqual([0, -1, -0.5, 0, 0.5, 1, 0]);
  strokeShape(p, 20, 2, 20, 2);
  expect(p[20]).toBe(1);
});

test('smoothing averages each point with its neighbours round the cycle and keeps a sine nearly as it is', () => {
  const square = smoothShape(STOCK_SHAPES.square);
  expect([square[0], square[1], square[31], square[32], square[33]]).toEqual([0.5, 1, 0.5, -0.5, -1]);
  smoothShape(STOCK_SHAPES.sine).forEach((v, i) => expect(v).toBeCloseTo(STOCK_SHAPES.sine[i], 2));
});

test('the harmonics of drawn stock waves are those of the oscillator, joined by straight lines', () => {
  const sine = shapeHarmonics(STOCK_SHAPES.sine, 128);
  expect(sine.imag[1]).toBeCloseTo(1, 2);
  // Joining the points with lines leaves faint images round every 64th harmonic, 72 dB down.
  for (let k = 2; k <= 128; k++) expect(Math.hypot(sine.real[k], sine.imag[k]), `${k}`).toBeLessThan(3e-4);
  // A saw is the sum of sines of 2 / (pi k), alternating in sign; its drop over one 64th of the cycle softens it a
  // little towards the top.
  const saw = shapeHarmonics(STOCK_SHAPES.sawtooth, 16);
  for (let k = 1; k <= 8; k++) {
    const ratio = saw.imag[k] / ((2 / (Math.PI * k)) * (k % 2 ? 1 : -1));
    expect(Math.abs(ratio - 1), `${k}`).toBeLessThan(0.1);
    expect(Math.abs(saw.real[k]), `${k}`).toBeLessThan(0.05);
  }
  expect(saw.real[0]).toBe(0);
  expect(saw.imag[0]).toBe(0);
});
