import { expect, test } from 'vitest';
import { MODULES } from '../../src/core/modules';
import type { FloatSpec, ParamSpec, Unit } from '../../src/core/modules';
import { coerce, defaultParams, formatAmount, formatValue, fromNorm, snap, toNorm } from '../../src/core/params';
import { DEFAULT_SHAPE, STOCK_SHAPES, encodeShape } from '../../src/core/shape';

const floats = Object.values(MODULES).flatMap((def) => def.params
  .filter((p): p is FloatSpec => p.kind === 'float').map((spec) => ({ label: `${def.type}.${spec.id}`, spec })));

test.each(floats)('$label round trips knob positions and is monotonic', ({ spec }) => {
  const values = [spec.min, spec.max, spec.def, ...[0.1, 0.25, 0.5, 0.73].map((t) =>
    spec.min + (spec.max - spec.min) * t)].sort((a, b) => a - b);
  let last = -Infinity;
  for (const value of values) {
    const t = toNorm(spec, value);
    expect(fromNorm(spec, t)).toBe(snap(spec, value));
    expect(t).toBeGreaterThanOrEqual(last);
    last = t;
  }
  expect(toNorm(spec, spec.min - 1)).toBeCloseTo(0, 12);
  expect(toNorm(spec, spec.max + 1)).toBeCloseTo(1, 12);
  expect(fromNorm(spec, -1)).toBe(spec.min);
  expect(fromNorm(spec, 2)).toBe(spec.max);
});

const float: FloatSpec = { kind: 'float', id: 'test', label: 'Test', min: -10, max: 10, def: 2 };

test('snap rounds to steps, removes floating point noise and clamps', () => {
  expect(snap({ ...float, step: 0.1 }, 0.26)).toBe(0.3);
  expect(snap({ ...float, step: 0.1 }, -0.26)).toBe(-0.3);
  expect(snap({ ...float, step: 1 }, 1.5)).toBe(2);
  expect(snap(float, 0.123456789)).toBe(0.123457);
  expect(snap(float, -100)).toBe(-10);
  expect(snap(float, 100)).toBe(10);
});

test('coerce validates every parameter kind', () => {
  expect(coerce({ ...float, step: 1 }, 3.6)).toBe(4);
  expect(coerce(float, 99)).toBe(10);
  expect(coerce(float, -99)).toBe(-10);
  for (const v of ['3', null, undefined, NaN, Infinity, -Infinity, true]) expect(coerce(float, v)).toBe(2);
  const choice: ParamSpec = { kind: 'choice', id: 'c', label: 'Choice', options: [['a', 'A'], ['b', 'B']], def: 'a' };
  expect(coerce(choice, 'b')).toBe('b');
  for (const v of ['x', 1, null]) expect(coerce(choice, v)).toBe('a');
  const bool: ParamSpec = { kind: 'bool', id: 'b', label: 'Bool', def: true };
  expect(coerce(bool, false)).toBe(false);
  expect(coerce(bool, true)).toBe(true);
  for (const v of [0, 'false', null]) expect(coerce(bool, v)).toBe(true);
  const sample: ParamSpec = { kind: 'sample', id: 's', label: 'Sample' };
  expect(coerce(sample, 'sample-id')).toBe('sample-id');
  expect(coerce(sample, '')).toBe('');
  for (const v of [123, false, null]) expect(coerce(sample, v)).toBe('');
});

test.each(Object.values(MODULES))('defaultParams includes exactly the defaults for $type', (def) => {
  const expected = Object.fromEntries(def.params.map((p) => [p.id, p.kind === 'sample' ? '' : p.def]));
  expect(defaultParams(def)).toEqual(expected);
});

test.each<[Unit, number, string]>([
  ['Hz', 2, '2.00 Hz'], ['Hz', 20, '20.0 Hz'], ['Hz', 200, '200 Hz'],
  ['Hz', 1234, '1.23 kHz'], ['Hz', 12500, '12.5 kHz'],
  ['s', 0.002, '2.0 ms'], ['s', 0.02, '20 ms'], ['s', 1.25, '1.25 s'],
  ['dB', -10, '-inf dB'], ['dB', -6, '-6.0 dB'], ['dB', 3, '+3.0 dB'], ['dB', 0, '0.0 dB'],
  ['%', 0.256, '26 %'], ['st', 12, '+12 st'], ['st', -12, '-12 st'], ['ct', 5, '+5 ct'], ['oct', -2, '-2 oct'],
  ['x', 1.5, '×1.50'], ['pan', 0, 'C'], ['pan', -0.25, 'L 25'], ['pan', 0.4, 'R 40'],
  ['', 2.5, '2.50'],
])('formatValue formats %s value %s', (unit, value, expected) => {
  expect(formatValue({ ...float, unit }, value)).toBe(expected);
});

test('formatValue handles unitless steps and non-numeric parameters', () => {
  expect(formatValue({ ...float, step: 1 }, 3)).toBe('3');
  expect(formatValue(float, 3)).toBe('3.00');
  const choice: ParamSpec = { kind: 'choice', id: 'c', label: 'C', options: [['a', 'Alpha']], def: 'a' };
  expect(formatValue(choice, 'a')).toBe('Alpha');
  expect(formatValue(choice, 'missing')).toBe('missing');
  const bool: ParamSpec = { kind: 'bool', id: 'b', label: 'B', def: false };
  expect(formatValue(bool, true)).toBe('On');
  expect(formatValue(bool, false)).toBe('Off');
  const sample: ParamSpec = { kind: 'sample', id: 's', label: 'S' };
  expect(formatValue(sample, '')).toBe('None');
  expect(formatValue(sample, 'kick')).toBe('kick');
});

test('formatAmount uses modulation span, sign, precision and units', () => {
  expect(formatAmount(float, 1)).toBe('');
  const pitch = { ...float, mod: { depth: 4800, span: 48, unit: 'st' } };
  expect(formatAmount(pitch, 0.75)).toBe('+36 st');
  expect(formatAmount(pitch, -0.5)).toBe('-24 st');
  expect(formatAmount(pitch, 0)).toBe('0 st');
  expect(formatAmount(pitch, 0.003)).toBe('+0.1 st');
  expect(formatAmount({ ...float, mod: { depth: 6000, span: 5, unit: 'oct' } }, 0.5)).toBe('+2.5 oct');
  expect(formatAmount({ ...float, mod: { depth: 12, span: 12, unit: '' } }, -0.5)).toBe('-6.0');
});

test('a rate below 0.1 Hz shows the seconds of one cycle, and a drawn shape is checked', () => {
  const rate = MODULES.lfo.params.find((p) => p.id === 'rate')!;
  expect(formatValue(rate, 0.002)).toBe('500 s');
  expect(formatValue(rate, 0.05)).toBe('20.0 s');
  expect(formatValue(rate, 0.1)).toBe('0.10 Hz');
  const shape = MODULES.osc.params.find((p) => p.id === 'shape')!;
  expect(coerce(shape, 'not a drawing')).toBe(DEFAULT_SHAPE);
  expect(coerce(shape, encodeShape(STOCK_SHAPES.square))).toBe(encodeShape(STOCK_SHAPES.square));
  expect(formatValue(shape, DEFAULT_SHAPE)).toBe('Drawn');
});
