import { expect, test } from 'vitest';
import { renderSound } from '../../src/audio';
import { adsrOf, envelopeAt } from '../../src/core/envelope';
import { adsr, maxJump, peak, rms, slice, sound } from './helpers';

const CENTRE = Math.SQRT1_2; // a mono source through a centred equal-power panner

test('the measured amp envelope follows envelopeAt', async () => {
  const amp = adsr(0.1, 0.2, 0.5, 0.3);
  const gate = 0.6;
  const pcm = await renderSound(sound('osc', { wave: 'sine' }, { amp }), {}, { note: 81, vel: 1, dur: gate });
  const d = pcm.channels[0];
  // RMS over four periods of 880 Hz, as a level relative to a full-scale sine.
  const level = (t: number) => (rms(slice(d, t - 2 / 880, t + 2 / 880)) * Math.SQRT2) / CENTRE;
  for (const t of [0.025, 0.05, 0.09, 0.15, 0.2, 0.3, 0.5, 0.6, 0.65, 0.7, 0.8, 0.9]) {
    expect(level(t), `at ${t} s`).toBeCloseTo(envelopeAt(adsrOf(amp), t, gate), 1);
    expect(Math.abs(level(t) - envelopeAt(adsrOf(amp), t, gate)), `at ${t} s`).toBeLessThan(0.02);
  }
  // Exactly silent from release * 1.25 after the note end.
  const end = gate + 1.25 * 0.3;
  expect(peak(slice(d, end + 1 / 44100, d.length / 44100))).toBe(0);
  expect(d.length / 44100).toBeLessThan(end + 0.06);
});

test('a low sine starts and stops without a click', async () => {
  // A 55 Hz sine at this level moves at most 2 pi 55 0.707 / 44100 = 0.0055 per sample.
  for (const amp of [adsr(0, 0.3, 0.8, 0), adsr(0.002, 0.3, 0.8, 0.2)]) {
    const pcm = await renderSound(sound('osc', { wave: 'sine' }, { amp }), {}, { note: 33, vel: 1, dur: 0.1234 });
    expect(maxJump(pcm.channels[0])).toBeLessThan(0.012);
  }
});

test('velocity scales the level by vel squared', async () => {
  const s = sound('osc', { wave: 'sine' }, { amp: adsr(0.002, 0.1, 1, 0.05) });
  const full = await renderSound(s, {}, { vel: 1, dur: 0.3 });
  const half = await renderSound(s, {}, { vel: 0.5, dur: 0.3 });
  expect(peak(slice(full.channels[0], 0.1, 0.3))).toBeCloseTo(CENTRE, 3);
  expect(rms(slice(half.channels[0], 0.1, 0.3)) / rms(slice(full.channels[0], 0.1, 0.3))).toBeCloseTo(0.25, 3);
});
