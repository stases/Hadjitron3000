import { expect, test } from 'vitest';
import { newSound } from '../../src/core/defaults';
import { noteFreq } from '../../src/core/notes';
import { DIVISIONS, fundamental, sweep, timebase } from '../../src/core/scope';
import type { Sound } from '../../src/core/types';

const SR = 48000;
const N = 32768;

/** `wave` of a phase in cycles, sampled at SR from phase `phase0`. */
const signal = (f: number, phase0: number, wave: (cycles: number) => number) =>
  Float32Array.from({ length: N }, (_, i) => wave(phase0 + (f * i) / SR));
const sine = (cycles: number) => Math.sin(2 * Math.PI * cycles);
/** The phase in cycles, from 0 to 1, of a sample position in a signal made by `signal`. */
const phaseAt = (f: number, phase0: number, p: number) => (((phase0 + (f * p) / SR) % 1) + 1) % 1;
const cyclic = (phase: number) => Math.min(phase, 1 - phase);

const withSource = (type: string, params: Record<string, number> = {}): Sound => {
  const s = newSound(type);
  return { ...s, source: { ...s.source, params: { ...s.source.params, ...params } } };
};

test('the fundamental follows the note and the source tuning, and is unknown for noise and samples', () => {
  expect(fundamental(withSource('osc', { pitch: 0, fine: 0 }), 69)).toBeCloseTo(440, 9);
  expect(fundamental(withSource('osc', { pitch: -12, fine: 0 }), 69)).toBeCloseTo(220, 9);
  expect(fundamental(withSource('fm', { pitch: 0, fine: 100 }), 60)).toBeCloseTo(noteFreq(61), 9);
  expect(fundamental(withSource('noise'), 60)).toBeNull();
  expect(fundamental(withSource('sample'), 60)).toBeNull();
});

test('with a second oscillator or a sub the fundamental is the lowest pitch that sounds', () => {
  expect(fundamental(withSource('osc', { mix2: 0.5, pitch2: -7 }), 69)).toBeCloseTo(noteFreq(62), 9);
  expect(fundamental(withSource('osc', { mix2: 0.5, pitch2: 12 }), 69)).toBeCloseTo(440, 9);
  // At full mix only the second oscillator sounds.
  expect(fundamental(withSource('osc', { mix2: 1, pitch2: 12 }), 69)).toBeCloseTo(880, 9);
  expect(fundamental(withSource('osc', { mix2: 0, pitch2: -12 }), 69)).toBeCloseTo(440, 9);
  expect(fundamental(withSource('osc', { sub: 0.3, subOct: -2, pitch: 1 }), 69)).toBeCloseTo(noteFreq(70 - 24), 9);
  expect(fundamental(withSource('osc', { sub: 0, subOct: -2 }), 69)).toBeCloseTo(440, 9);
});

test('the timebase is a 1-2-5 step that shows between 2.5 and 6.25 cycles', () => {
  expect(timebase(440)).toBe(1e-3);
  expect(timebase(null)).toBe(2e-3);
  for (let note = 24; note <= 108; note++) {
    const f = noteFreq(note);
    const cycles = DIVISIONS * timebase(f) * f;
    expect(cycles, `note ${note}`).toBeGreaterThanOrEqual(2.5);
    expect(cycles, `note ${note}`).toBeLessThan(6.25);
  }
  expect(timebase(5)).toBe(2e-2);
});

test('a sweep starts on the latest rising zero crossing that leaves room for it, to a fraction of a sample', () => {
  for (const [f, phase0] of [[440, 0], [61.7, 0.3], [1234.5, 0.77], [3000, 0.5]]) {
    const length = Math.round(SR * DIVISIONS * timebase(f));
    const { start, length: shown } = sweep(signal(f, phase0, sine), length);
    expect(shown).toBe(length);
    expect(start + length).toBeLessThanOrEqual(N - 1);
    expect(start + length).toBeGreaterThan(N - 1 - SR / f);
    expect(cyclic(phaseAt(f, phase0, start))).toBeLessThan(1e-3);
  }
});

test('the trace stands still: every buffer of a steady wave triggers at the same phase', () => {
  const f = 187.3;
  const length = Math.round(SR * DIVISIONS * timebase(f));
  for (let k = 0; k < 20; k++) {
    const phase0 = k * 0.137;
    // A saw falls through zero once per cycle and rises through it once, half a cycle later.
    const saw = (c: number) => 2 * ((((c + 0.5) % 1) + 1) % 1) - 1;
    expect(cyclic(phaseAt(f, phase0, sweep(signal(f, phase0, saw), length).start))).toBeLessThan(1e-4);
  }
});

test('hysteresis ignores a shallow dip through zero in the middle of the cycle', () => {
  // A sine with a notch at its crest deep enough to cross zero: a second rising crossing just after a quarter cycle.
  const notched = (c: number) => sine(c) - 1.05 * Math.exp(-(((((c % 1) + 1) % 1) - 0.25) ** 2) / 0.0005);
  const f = 220;
  const length = Math.round(SR * DIVISIONS * timebase(f));
  for (let k = 0; k < 10; k++) {
    const phase0 = k * 0.093;
    const s = signal(f, phase0, notched);
    expect(cyclic(phaseAt(f, phase0, sweep(s, length).start))).toBeLessThan(1e-3);
  }
});

test('without a trigger the sweep shows the latest samples, and it never takes more than half the buffer', () => {
  expect(sweep(new Float32Array(N), 1000)).toEqual({ start: N - 1 - 1000, length: 1000 });
  expect(sweep(new Float32Array(N).fill(0.5), 1000)).toEqual({ start: N - 1 - 1000, length: 1000 });
  expect(sweep(signal(5, 0, sine), N).length).toBe(N / 2);
});
