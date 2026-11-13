import { expect, test } from 'vitest';
import { envelopeAt, envelopeSegments, releaseSegments, valueAt, type Adsr } from '../../src/core/envelope';

const env: Adsr = { attack: 0.1, decay: 0.4, sustain: 0.5, release: 0.8 };

test('attack is a straight line to 1', () => {
  expect(envelopeAt(env, 0)).toBe(0);
  expect(envelopeAt(env, 0.05)).toBeCloseTo(0.5, 10);
  expect(envelopeAt(env, 0.1)).toBeCloseTo(1, 10);
  expect(envelopeAt(env, 0.05, Infinity, 0.6)).toBeCloseTo(0.8, 10);
});

test('decay approaches the sustain level with time constant decay / 4', () => {
  expect(envelopeAt(env, 0.1 + 0.1)).toBeCloseTo(0.5 + 0.5 * Math.exp(-1), 10);
  expect(envelopeAt(env, 10)).toBeCloseTo(0.5, 10);
});

test('release falls from the level at note end and is exactly 0 at release * 1.25', () => {
  const gate = 1;
  const level = envelopeAt(env, gate);
  expect(envelopeAt(env, gate, gate)).toBeCloseTo(level, 10);
  expect(envelopeAt(env, gate + 0.2, gate)).toBeCloseTo(level * Math.exp(-1), 10);
  expect(envelopeAt(env, gate + 0.8, gate)).toBeCloseTo(level * Math.exp(-4), 10);
  expect(envelopeAt(env, gate + 0.9, gate)).toBeCloseTo(level * Math.exp(-4) * 0.5, 10);
  expect(envelopeAt(env, gate + 1.0, gate)).toBe(0);
  expect(envelopeAt(env, gate + 5, gate)).toBe(0);
  const segs = envelopeSegments(env, gate);
  expect(segs[segs.length - 1].end).toBeCloseTo(gate + 1.0, 12);
});

test('the release tail is the tangent of the exponential, so the curve has no corner', () => {
  const segs = releaseSegments(1, 0, 0.4);
  const h = 1e-6;
  const before = (valueAt(segs, 0.4) - valueAt(segs, 0.4 - h)) / h;
  const after = (valueAt(segs, 0.4 + h) - valueAt(segs, 0.4)) / h;
  expect(after).toBeCloseTo(before, 3);
});

test('a note shorter than the attack releases from the middle of the attack', () => {
  expect(envelopeAt(env, 0.04, 0.04)).toBeCloseTo(0.4, 10);
  expect(envelopeAt(env, 0.04 + 0.2, 0.04)).toBeCloseTo(0.4 * Math.exp(-1), 10);
});

test('minimum attack and release keep zero settings click-free', () => {
  const zero: Adsr = { attack: 0, decay: 0, sustain: 1, release: 0 };
  expect(envelopeAt(zero, 0.0005)).toBeCloseTo(0.5, 10);
  const segs = envelopeSegments(zero, 0.1);
  expect(segs[segs.length - 1].end).toBeCloseTo(0.1 + 1.25 * 0.005, 12);
});

test('the envelope never leaves 0..1 and is continuous', () => {
  const segs = envelopeSegments(env, 0.3);
  let prev = valueAt(segs, 0);
  for (let t = 0; t < 1.5; t += 1e-4) {
    const v = valueAt(segs, t);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
    expect(Math.abs(v - prev)).toBeLessThan(0.002);
    prev = v;
  }
});
