// The kinds of sounds the app is for, checked by numbers: level, spectrum, no clipping, no clicks.

import { expect, test } from 'vitest';
import { renderProject, renderSound } from '../../src/audio';
import { adsr, amplitudeAt, db, effect, finite, freq, maxJump, mod, peak, project, rms, slice, sound } from './helpers';

test('kick: a sine with a fast downward pitch envelope', async () => {
  const kick = sound('osc', { wave: 'sine' }, {
    amp: adsr(0.001, 0.3, 0, 0.05),
    mods: [mod('env', { module: 'source', param: 'pitch' }, 0.5, adsr(0, 0.06, 0, 0.05))],
    out: { level: -3 },
  });
  const pcm = await renderSound(kick, {}, { note: 36, vel: 1, dur: 0.25 });
  const d = pcm.channels[0];
  expect(finite(d)).toBe(true);
  expect(peak(d)).toBeLessThan(1);
  expect(db(rms(slice(d, 0, 0.15)))).toBeGreaterThan(-16);
  expect(freq(slice(d, 0.001, 0.02))).toBeGreaterThan(150);
  expect(Math.abs(freq(slice(d, 0.12, 0.24)) / 65.41 - 1)).toBeLessThan(0.03);
  expect(maxJump(d)).toBeLessThan(0.05);
  expect(d.length / 44100).toBeLessThan(0.25 + 0.0625 + 0.06);
});

test('hat: noise through a high pass with a short decay', async () => {
  const hat = sound('noise', { color: 'white' }, {
    amp: adsr(0.001, 0.04, 0, 0.03),
    chain: [effect('filter', { mode: 'highpass', cutoff: 7000, reso: 0.2 })],
    out: { level: -6 },
  });
  const pcm = await renderSound(hat, {}, { vel: 0.9, dur: 0.05 });
  const d = pcm.channels[0];
  expect(peak(d)).toBeLessThan(1);
  expect(peak(d)).toBeGreaterThan(0.05);
  expect(freq(slice(d, 0, 0.05))).toBeGreaterThan(6000);
  expect(amplitudeAt(slice(d, 0, 0.05), 500)).toBeLessThan(0.05 * amplitudeAt(slice(d, 0, 0.05), 10000));
  expect(d.length / 44100).toBeLessThan(0.2);
});

test('fm bell: inharmonic partials that ring out', async () => {
  const bell = sound('fm', { ratio: 3.5, amount: 1 }, {
    amp: adsr(0.001, 2, 0, 1),
    mods: [mod('env', { module: 'source', param: 'amount' }, 0.25, adsr(0, 1, 0, 1))],
    out: { level: -6 },
  });
  const pcm = await renderSound(bell, {}, { note: 72, vel: 0.9, dur: 0.5, tail: 3 });
  const d = pcm.channels[0];
  expect(finite(d)).toBe(true);
  expect(peak(d)).toBeLessThan(1);
  // Carrier 523 Hz, modulator 1831 Hz: a partial at 1308 Hz, not a multiple of the carrier.
  const early = slice(d, 0.02, 0.22);
  expect(amplitudeAt(early, 1308.1) / amplitudeAt(early, 523.25)).toBeGreaterThan(0.3);
  expect(db(rms(slice(d, 0.4, 0.5)) / rms(early))).toBeLessThan(-1);
  expect(db(rms(slice(d, 0.4, 0.5)) / rms(early))).toBeGreaterThan(-12);
});

test('pad: a detuned saw chord through low pass, delay and reverb', async () => {
  const pad = sound('osc', { wave: 'sawtooth', voices: 5, spread: 20, width: 0.8 }, {
    amp: adsr(0.3, 0.5, 0.7, 1),
    chain: [effect('filter', { cutoff: 1500, reso: 0.2 }), effect('delay'), effect('reverb')],
    out: { level: -6 },
  });
  const p = project([{ id: 'pad', sound: pad }], {
    pad: { 0: { note: 48, vel: 0.8, len: 16 }, 1: { note: 52, vel: 0.8, len: 15 }, 2: { note: 55, vel: 0.8, len: 14 } },
  });
  const pcm = await renderProject(p, { kind: 'pattern', patternId: p.patterns[0].id });
  const [l, r] = pcm.channels;
  expect(finite(l) && finite(r)).toBe(true);
  expect(Math.max(peak(l), peak(r))).toBeLessThan(0.95);
  const body = slice(l, 0.5, 2);
  expect(db(rms(body))).toBeGreaterThan(-30);
  expect(db(rms(body))).toBeLessThan(-8);
  // Wide: the sides differ.
  const side = rms(slice(l, 0.5, 2).map((v, i) => v - r[i + 22050]));
  expect(side).toBeGreaterThan(0.1 * rms(body));
  // Dark: little energy two octaves above the cutoff.
  expect(amplitudeAt(body, 6000)).toBeLessThan(0.01 * amplitudeAt(body, 130.81));
  // The reverb rings out after the release and the render ends when it has.
  expect(l.length / 44100).toBeGreaterThan(2 + 1.25);
  expect(l.length / 44100).toBeLessThan(2 + 6);
  expect(peak(l.subarray(l.length - 2205))).toBeLessThan(1e-4);
});
