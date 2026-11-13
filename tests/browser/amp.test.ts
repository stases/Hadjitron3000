import { expect, test } from 'vitest';
import { renderSound, type Engine } from '../../src/audio';
import { adsrOf, envelopeAt } from '../../src/core/envelope';
import type { Params } from '../../src/core/types';
import { adsr, amplitudeAt, maxJump, notes, peak, project, rms, slice, sound } from './helpers';

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

test('a 30 s attack reaches full level at 30 s and a 30 s release still sounds at 20 s', async () => {
  const sr = 3000;
  const level = (d: Float32Array, t: number) => (rms(slice(d, t - 0.25, t + 0.25, sr)) * Math.SQRT2) / CENTRE;
  const render = (amp: Params, dur: number, tail?: number) =>
    renderSound(sound('osc', { wave: 'sine' }, { amp }), {}, { note: 45, vel: 1, dur, tail, sampleRate: sr });
  const swell = (await render(adsr(30, 1, 1, 0.1), 32, 0)).channels[0];
  expect(level(swell, 15)).toBeCloseTo(0.5, 2);
  expect(level(swell, 29)).toBeCloseTo(29 / 30, 2);
  expect(level(swell, 31)).toBeCloseTo(1, 2);

  const amp = adsr(0.002, 0.1, 1, 30);
  const fall = (await render(amp, 0.5)).channels[0];
  expect(level(fall, 20)).toBeCloseTo(envelopeAt(adsrOf(amp), 20, 0.5), 2);
  expect(level(fall, 20)).toBeGreaterThan(0.05);
  // The render's tail covers the whole release, which ends at 1.25 times its time.
  expect(fall.length / sr).toBeGreaterThan(30);
  expect(fall.length / sr).toBeLessThan(0.5 + 37.5 + 0.06);
});

test('a 30 s release gives way to voice stealing, transport stop and mute', async () => {
  const sr = 8000;
  const s = sound('osc', { wave: 'sine' }, { amp: adsr(0.002, 0.1, 1, 30), out: { level: -30 } });
  const muted = project([{ id: 'a', sound: s, mute: true }]);
  const actions: [string, (e: Engine) => void][] = [['stop', (e) => e.stopAll()], ['mute', (e) => e.setProject(muted)]];
  for (const [what, run] of actions) {
    const d = await notes(s, [[57, 0, 0.3]], 1.5, { sampleRate: sr, live: [[0.6, run]] });
    expect(rms(slice(d, 0.4, 0.55, sr)), what).toBeGreaterThan(0.005);
    expect(peak(slice(d, 0.7, 1.5, sr)), what).toBeLessThan(1e-5);
  }
  // A low note, then 24 high ones: the 25th voice takes the place of the low note, which is still in its release.
  const high: [number, number, number][] = Array.from({ length: 24 }, (_, i) => [93, 0.2 + i * 0.01, 0.05]);
  const d = await notes(s, [[45, 0, 0.1], ...high], 0.8, { sampleRate: sr });
  const low = (t: number) => amplitudeAt(slice(d, t, t + 0.15, sr), 110, sr);
  expect(low(0.6) / low(0.2)).toBeLessThan(0.01);
});
