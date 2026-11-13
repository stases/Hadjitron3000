import { expect, test } from 'vitest';
import { renderProject, renderSound } from '../../src/audio';
import { TICKS_PER_STEP } from '../../src/core/defaults';
import type { ModuleInst, Params } from '../../src/core/types';
import { adsr, amplitudeAt, db, effect, freq, onset, peak, project, rms, slice, sound } from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);
const sineThrough = (chain: ModuleInst[], params: Params = {}) => sound('osc', { wave: 'sine', ...params }, { amp: flat, chain, out: { level: -6 } });
// A 5 ms blip of 1 kHz: short enough to see each repeat on its own.
const blip = (chain: ModuleInst[]) => sound('osc', { wave: 'sine' }, { amp: adsr(0.001, 0.1, 1, 0), chain, out: { level: -6 } });

async function sineLevel(chain: ModuleInst[], note: number): Promise<number> {
  const pcm = await renderSound(sineThrough(chain), {}, { note, vel: 1, dur: 0.4, tail: 0.2 });
  return rms(slice(pcm.channels[0], 0.15, 0.35));
}

test('the low pass keeps the bass and removes the treble, the high pass the opposite', async () => {
  // Note 33 is 55 Hz, note 105 is 3520 Hz: three octaves above and below 440 Hz.
  const lp = [effect('filter', { mode: 'lowpass', cutoff: 440, reso: 0 })];
  const hp = [effect('filter', { mode: 'highpass', cutoff: 440, reso: 0 })];
  const bp = [effect('filter', { mode: 'bandpass', cutoff: 440, reso: 0.5 })];
  const [low, high, mid] = [await sineLevel([], 33), await sineLevel([], 105), await sineLevel([], 69)];
  expect(db((await sineLevel(lp, 33)) / low)).toBeGreaterThan(-1);
  expect(db((await sineLevel(lp, 105)) / high)).toBeLessThan(-30);
  expect(db((await sineLevel(hp, 105)) / high)).toBeGreaterThan(-1);
  expect(db((await sineLevel(hp, 33)) / low)).toBeLessThan(-30);
  expect(db((await sineLevel(bp, 69)) / mid)).toBeGreaterThan(-1);
  expect(db((await sineLevel(bp, 105)) / high)).toBeLessThan(-12);
});

test('resonance boosts the cutoff frequency', async () => {
  const at = (reso: number) => sineLevel([effect('filter', { mode: 'lowpass', cutoff: 440, reso })], 69);
  expect(db((await at(0.5)) / (await at(0)))).toBeGreaterThan(9);
});

test('a bypassed effect does nothing', async () => {
  const dry = await renderSound(sineThrough([]), {}, { dur: 0.3 });
  const off = await renderSound(sineThrough([effect('filter', { cutoff: 100 }, false), effect('reverb', {}, false)]), {}, { dur: 0.3 });
  expect(off.channels[0]).toEqual(dry.channels[0]);
});

test('the delay repeats at the synced time for the tempo and at the free time', async () => {
  const firstRepeat = async (params: Params, bpm: number) => {
    const p = project([{ id: 'a', sound: blip([effect('delay', { feedback: 0, mix: 1, tone: 20000, ...params })]) }], { a: { 0: { note: 81, vel: 1, len: 1 } } }, { bpm });
    // A 64th note at the tempo is the length of the blip; the pattern is short enough not to retrigger.
    p.patterns[0].notes.a[0].len = Math.round((0.04 / (15 / bpm)) * TICKS_PER_STEP);
    const pcm = await renderProject(p, { kind: 'pattern', patternId: p.patterns[0].id }, { tail: 0 });
    return onset(pcm.channels[0], 0.1);
  };
  expect(await firstRepeat({ sync: '1/4' }, 120)).toBeCloseTo(0.5, 3);
  expect(await firstRepeat({ sync: '1/8d' }, 100)).toBeCloseTo(0.45, 3);
  expect(await firstRepeat({ sync: 'free', time: 0.3 }, 100)).toBeCloseTo(0.3, 3);
});

test('feedback makes further, quieter repeats; ping pong alternates sides', async () => {
  const render = async (pingpong: boolean) => {
    const s = blip([effect('delay', { sync: 'free', time: 0.25, feedback: 0.5, mix: 1, tone: 20000, pingpong })]);
    const pcm = await renderSound(s, {}, { note: 81, vel: 1, dur: 0.04, tail: 1.5 });
    // Windowed level around each repeat, left and right.
    return [1, 2, 3].map((k) => pcm.channels.map((d) => peak(slice(d, k * 0.25, k * 0.25 + 0.04))));
  };
  const straight = await render(false);
  expect(straight[0][0]).toBeGreaterThan(0.1);
  expect(db(straight[1][0] / straight[0][0])).toBeCloseTo(-6, 0);
  expect(db(straight[2][0] / straight[1][0])).toBeCloseTo(-6, 0);
  for (const [l, r] of straight) expect(l).toBeCloseTo(r, 6);

  const pp = await render(true);
  expect(pp[0][1]).toBeLessThan(pp[0][0] * 0.001);
  expect(pp[1][0]).toBeLessThan(pp[1][1] * 0.001);
  expect(pp[2][1]).toBeLessThan(pp[2][0] * 0.001);
  expect(db(pp[1][1] / pp[0][0])).toBeCloseTo(-6, 0);
});

test('the reverb tail is 60 dB down after about its size, then silent', async () => {
  for (const size of [0.5, 2]) {
    const s = blip([effect('reverb', { size, tone: 20000, mix: 1 })]);
    const pcm = await renderSound(s, {}, { note: 81, vel: 1, dur: 0.01, tail: 2 * size + 1 });
    const d = pcm.channels[0];
    // Fit a line to the level in dB along the tail: its slope gives the time to fall 60 dB.
    const win = size / 20;
    const pts: [number, number][] = [];
    for (let t = 0.05; t < 0.9 * size; t += win) pts.push([t, db(rms(slice(d, t, t + win)))]);
    const mt = pts.reduce((s, [t]) => s + t, 0) / pts.length;
    const ml = pts.reduce((s, [, l]) => s + l, 0) / pts.length;
    const slope = pts.reduce((s, [t, l]) => s + (t - mt) * (l - ml), 0) / pts.reduce((s, [t]) => s + (t - mt) ** 2, 0);
    expect(-60 / slope).toBeGreaterThan(size / 1.5);
    expect(-60 / slope).toBeLessThan(size * 1.5);
    const ref = rms(slice(d, 0.05, 0.05 + win));
    // Decorrelated sides: the tail differs between left and right.
    expect(rms(slice(d, 0.05, size / 2).map((v, i) => v - pcm.channels[1][i + 2205]))).toBeGreaterThan(ref * 0.1);
    expect(d.length / 44100).toBeLessThan(size + 0.15);
  }
});

test('drive mixes dry and wet in time, without comb filtering', async () => {
  for (const note of [57, 81, 93, 100, 105]) {
    const level = async (chain: ModuleInst[]) => {
      const pcm = await renderSound(sound('osc', { wave: 'sine' }, { amp: flat, chain }), {}, { note, vel: 0.5, dur: 0.3 });
      return rms(slice(pcm.channels[0], 0.1, 0.25));
    };
    const half = await level([effect('drive', { amount: 0, mix: 0.5, tone: 20000 })]);
    expect(Math.abs(db(half / (await level([])))), `note ${note}`).toBeLessThan(0.3);
  }
});

test('drive at amount 0 is near clean unity gain, and each shape changes the waveform', async () => {
  // Velocity 0.5 puts a -12 dBFS sine into the drive.
  const render = async (chain: ModuleInst[]) => {
    const pcm = await renderSound(sound('osc', { wave: 'sine' }, { amp: flat, chain }), {}, { note: 57, vel: 0.5, dur: 0.4 });
    return slice(pcm.channels[0], 0.1, 0.35);
  };
  const dry = await render([]);
  // Everything that is not the 220 Hz fundamental, relative to it.
  const thd = (d: Float32Array) => {
    const f = amplitudeAt(d, 220) / Math.SQRT2;
    return Math.sqrt(Math.max(rms(d) ** 2 - f * f, 0)) / f;
  };
  const clean = await render([effect('drive', { amount: 0, tone: 20000, mix: 1 })]);
  expect(Math.abs(db(rms(clean) / rms(dry)))).toBeLessThan(0.5);
  expect(thd(clean)).toBeLessThan(0.01);
  expect(Math.abs(freq(clean) / 220 - 1)).toBeLessThan(0.01);

  // At full drive soft and hard both approach a square wave, so the shapes are compared halfway.
  const shaped: Float32Array[] = [];
  for (const shape of ['soft', 'hard', 'fold']) {
    for (const amount of [0.25, 0.5, 0.75, 1]) {
      const d = await render([effect('drive', { shape, amount, tone: 20000, mix: 1 })]);
      expect(Math.abs(db(rms(d) / rms(dry))), `${shape} ${amount}`).toBeLessThan(6);
      if (amount === 0.5) shaped.push(d);
    }
    expect(thd(shaped[shaped.length - 1]), shape).toBeGreaterThan(0.1);
  }
  const differ = (a: Float32Array, b: Float32Array) => rms(a.map((v, i) => v - b[i])) / rms(a);
  expect(differ(shaped[0], shaped[1])).toBeGreaterThan(0.03);
  expect(differ(shaped[1], shaped[2])).toBeGreaterThan(0.03);
  expect(differ(shaped[0], shaped[2])).toBeGreaterThan(0.03);
});
