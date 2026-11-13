import { expect, test } from 'vitest';
import { renderSound } from '../../src/audio';
import type { ModInst, ModuleInst } from '../../src/core/types';
import { adsr, effect, freq, mod, rms, slice, sound } from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);
const sine = (mods: ModInst[], chain: ModuleInst[] = [], wave = 'sine') =>
  sound('osc', { wave }, { amp: flat, mods, chain, out: { level: -6 } });

test('an envelope on the source pitch sweeps it by amount x 48 semitones', async () => {
  // Amount 0.25 is +12 semitones at the top of the envelope.
  const held = await renderSound(sine([mod('env', { module: 'source', param: 'pitch' }, 0.25, adsr(0, 0.1, 1, 0.1))]), {}, { note: 69, dur: 0.5 });
  expect(Math.abs(freq(slice(held.channels[0], 0.05, 0.45)) / 880 - 1)).toBeLessThan(0.01);

  const sweep = sine([mod('env', { module: 'source', param: 'pitch' }, 0.25, adsr(0, 0.2, 0, 0.1))]);
  const pcm = await renderSound(sweep, {}, { note: 69, dur: 1 });
  const d = pcm.channels[0];
  expect(freq(slice(d, 0.002, 0.012))).toBeGreaterThan(800);
  // Halfway down the exponential decay (time constant 50 ms): 440 * 2^exp(-1).
  expect(Math.abs(freq(slice(d, 0.045, 0.055)) / (440 * 2 ** Math.exp(-1)) - 1)).toBeLessThan(0.03);
  expect(Math.abs(freq(slice(d, 0.6, 0.9)) / 440 - 1)).toBeLessThan(0.01);
});

test('an fm envelope on the index brightens the attack', async () => {
  const s = sound('fm', { amount: 0, ratio: 1 }, { amp: flat, mods: [mod('env', { module: 'source', param: 'amount' }, 0.5, adsr(0, 0.3, 0, 0.1))] });
  const pcm = await renderSound(s, {}, { note: 57, dur: 1 });
  const bright = (d: Float32Array) => rms(d.map((v, i) => (i ? v - d[i - 1] : 0))) / rms(d);
  expect(bright(slice(pcm.channels[0], 0.01, 0.05))).toBeGreaterThan(2 * bright(slice(pcm.channels[0], 0.7, 0.9)));
});

test('an lfo on the output level makes a tremolo at its rate', async () => {
  const pcm = await renderSound(sine([mod('lfo', { module: 'out', param: 'level' }, 0.8, { rate: 8 })]), {}, { note: 81, dur: 1.2 });
  const d = slice(pcm.channels[0], 0.05, 1.05);
  const env = Float32Array.from({ length: 200 }, (_, k) => rms(d.subarray(k * 220, k * 220 + 220)));
  const mean = env.reduce((a, b) => a + b) / env.length;
  // Envelope sampled every 5 ms; its frequency is the tremolo rate.
  expect(Math.abs(freq(env.map((v) => v - mean), 200) / 8 - 1)).toBeLessThan(0.05);
  expect(Math.max(...env) / Math.min(...env)).toBeGreaterThan(5);
});

test('an lfo on the filter cutoff changes the brightness over time', async () => {
  const brightness = async (amount: number) => {
    const lfo = mod('lfo', { module: 'f', param: 'cutoff' }, amount, { rate: 4 });
    const filter = { ...effect('filter', { cutoff: 800, reso: 0 }), id: 'f' };
    const pcm = await renderSound(sine([lfo], [filter], 'sawtooth'), {}, { note: 45, dur: 1.1 });
    const d = slice(pcm.channels[0], 0.05, 1.05);
    // Windows of four periods of the 110 Hz saw, so a steady tone measures the same in each.
    const n = Math.round((4 * 44100) / 110);
    return Array.from({ length: Math.floor(d.length / n) }, (_, k) => {
      const w = d.subarray(k * n, k * n + n);
      return rms(w.map((v, i) => (i ? v - w[i - 1] : 0))) / rms(w);
    });
  };
  const still = await brightness(0);
  const moving = await brightness(0.5);
  expect(Math.max(...still) / Math.min(...still)).toBeLessThan(1.1);
  expect(Math.max(...moving) / Math.min(...moving)).toBeGreaterThan(3);
});

test('a bypassed modulator or one without a target does nothing', async () => {
  const dry = await renderSound(sine([]), {}, { dur: 0.3 });
  const off = await renderSound(sine([mod('lfo', { module: 'out', param: 'level' }, 1, {}, false)]), {}, { dur: 0.3 });
  const loose = await renderSound(sine([mod('env', null, 1)]), {}, { dur: 0.3 });
  expect(off.channels[0]).toEqual(dry.channels[0]);
  expect(loose.channels[0]).toEqual(dry.channels[0]);
});
