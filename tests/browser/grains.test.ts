// The Grains source: a cloud of grains of a sample, rendered by the grains processor.

import { afterEach, expect, test } from 'vitest';
import { Engine, renderSound } from '../../src/audio';
import { rng } from '../../src/audio/random';
import { encodeWav } from '../../src/core/wav';
import type { Params, SampleData, Sound } from '../../src/core/types';
import { SR, adsr, amplitudeAt, finite, mod, notes, peak, project, rms, slice, sound, tone, wav } from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.05);

interface Sampled {
  id: string;
  samples: Record<string, SampleData>;
}

// Decoded samples are kept by id for the whole page, so every sample here has an id of its own.
let count = 0;
function sampled(data: Float32Array | Uint8Array, name: string): Sampled {
  const id = `${name}-${count++}`;
  return { id, samples: { [id]: { name, bytes: data instanceof Uint8Array ? data : wav(data) } } };
}

const grains = (s: Sampled, params: Params = {}, extra: Partial<Sound> = {}) =>
  sound('grains', { sample: s.id, ...params }, { amp: flat, ...extra });

/** Four tones of half a second each, rising: 220, 277.18, 329.63 and 440 Hz. */
const STAIRS = [220, 277.18, 329.63, 440];
const stairs = sampled(Float32Array.from(STAIRS.flatMap((f) => [...tone(0.5, f, 0.5)])), 'stairs');
const sine = sampled(tone(2, 220, 0.5), 'sine');
const noise = (() => {
  const next = rng(5);
  return sampled(Float32Array.from({ length: 2 * SR }, () => 0.3 * next()), 'noise');
})();

/**
 * How far a cloud of one tone is from `f`. Its grains have random phases, so the spectrum of one long stretch is a
 * noisy blob around the tone; averaged over many short stretches (Welch's method) it settles, and its centre of
 * power within 6 % of `f` is the pitch.
 */
function near(d: Float32Array, f: number): number {
  const len = Math.round(0.2 * SR);
  const parts = Array.from({ length: Math.floor(d.length / len) }, (_, k) => d.subarray(k * len, (k + 1) * len));
  let sum = 0;
  let power = 0;
  for (let g = f * 0.94; g <= f * 1.06; g += 1) {
    const p = parts.reduce((s, part) => s + amplitudeAt(part, g) ** 2, 0);
    sum += g * p;
    power += p;
  }
  return Math.abs(sum / power / f - 1);
}

const correlation = (a: Float32Array, b: Float32Array) =>
  a.reduce((s, v, i) => s + v * b[i], 0) / Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));

async function render(s: Sound, from: Sampled, opts: Parameters<typeof renderSound>[2] = {}) {
  return (await renderSound(s, from.samples, { vel: 1, dur: 2, ...opts })).channels;
}

const real = globalThis.AudioWorkletNode;
afterEach(() => {
  globalThis.AudioWorkletNode = real;
});

test('a cloud of a sine plays its pitch times the key, at a steady level without gaps', async () => {
  for (const [note, pitch, f] of [[60, 0, 220], [72, 0, 440], [72, -12, 220], [67, 0, 329.63]]) {
    const [l, r] = await render(grains(sine, { pitch }), sine, { note });
    expect(finite(l) && finite(r)).toBe(true);
    expect(near(slice(l, 0.1, 1.9), f), `${note} ${pitch}`).toBeLessThan(0.005);
    // The grains' random phases make the level wander, but no stretch of 50 ms falls far below the rest.
    const levels = Array.from({ length: 36 }, (_, k) => rms(slice(l, 0.1 + k * 0.05, 0.15 + k * 0.05)));
    const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
    expect(Math.min(...levels) / mean, `${note} ${pitch}`).toBeGreaterThan(0.2);
    expect(peak(l)).toBeLessThan(1);
  }
});

test('without spray, pitch spray and width the cloud repeats at the grain rate, and spray breaks that', async () => {
  // 80 ms grains, four at once: one starts every 882 samples.
  const hop = 882 / SR;
  const still = { size: 0.08, density: 4, spray: 0, pspray: 0, width: 0 };
  const [l] = await render(grains(noise, still), noise, { dur: 1 });
  const body = slice(l, 0.2, 0.8);
  const shifted = slice(l, 0.2 + hop, 0.8 + hop);
  expect(peak(body.map((v, i) => v - shifted[i]))).toBeLessThan(1e-4);
  expect(rms(body)).toBeGreaterThan(0.05);
  const [sprayed] = await render(grains(noise, { ...still, spray: 0.2 }), noise, { dur: 1 });
  const a = slice(sprayed, 0.2, 0.8);
  const b = slice(sprayed, 0.2 + hop, 0.8 + hop);
  expect(rms(a.map((v, i) => v - b[i]))).toBeGreaterThan(0.3 * rms(a));
});

test('Position picks the part of the sample, and a modulator moves it', async () => {
  // Long grains from the middle of each tone, so the measurement settles.
  const at = { spray: 0.02, size: 0.25 };
  for (const [k, f] of STAIRS.entries()) {
    const [l] = await render(grains(stairs, { ...at, position: 0.125 + 0.25 * k }), stairs);
    expect(near(slice(l, 0.1, 1.9), f), `position ${k}`).toBeLessThan(0.005);
  }
  // An envelope in every note, held at full: amount 0.25 moves Position a quarter of the sample on.
  for (const [k, f] of STAIRS.entries()) {
    const held = { ...mod('env', { module: 'source', param: 'position' }, 0.25 * k, adsr(0, 0, 1, 0)), per: 'note' as const };
    const [l] = await render(grains(stairs, { ...at, position: 0.125 }, { mods: [held] }), stairs);
    expect(near(slice(l, 0.1, 1.9), f), `moved ${k}`).toBeLessThan(0.005);
  }
});

test('Size and Density set how many grains start each second', async () => {
  const dc = sampled(new Float32Array(2 * SR).fill(0.5), 'dc');
  const rate = async (size: number, density: number) => {
    const [l] = await render(grains(dc, { size, density, spray: 0, width: 0 }), dc, { dur: 1.2 });
    const d = slice(l, 0.1, 1.1);
    const top = peak(d);
    let bumps = 0;
    for (let i = 1; i < d.length - 1; i++) if (d[i] > 0.5 * top && d[i] >= d[i - 1] && d[i] > d[i + 1]) bumps++;
    return bumps;
  };
  expect(Math.abs((await rate(0.05, 1)) - 20)).toBeLessThanOrEqual(1);
  expect(Math.abs((await rate(0.1, 1)) - 10)).toBeLessThanOrEqual(1);
  expect(Math.abs((await rate(0.1, 0.5)) - 5)).toBeLessThanOrEqual(1);
});

test('Width spreads the grains apart, and at 0 both sides are the same', async () => {
  const [l0, r0] = await render(grains(noise, { width: 0 }), noise, { dur: 1 });
  expect(peak(l0.map((v, i) => v - r0[i]))).toBeLessThan(1e-6);
  // Every grain at its own place between the sides at equal power: the sides keep 1/π over 1/2 in common.
  const [l1, r1] = await render(grains(noise, { width: 1 }), noise, { dur: 1 });
  expect(correlation(slice(l1, 0.1, 0.9), slice(r1, 0.1, 0.9))).toBeLessThan(0.7);
});

test('every note gets a cloud of its own, and a render is the same every time', async () => {
  const s = grains(noise, { spray: 0.5, pspray: 300, width: 1, reverse: 0.3 });
  const play = () => notes(s, [[60, 0, 0.8], [60, 1, 0.8]], 2, { samples: noise.samples });
  const first = await play();
  const a = slice(first, 0.1, 0.7);
  const b = slice(first, 1.1, 1.7);
  expect(rms(a.map((v, i) => v - b[i]))).toBeGreaterThan(0.5 * rms(a));
  expect(await play()).toEqual(first);
});

test('the cloud runs through the release and ends with the amp envelope', async () => {
  const [l] = await render(grains(sine, {}, { amp: adsr(0.002, 0.1, 1, 0.3) }), sine, { dur: 0.5 });
  expect(rms(slice(l, 0.55, 0.6))).toBeGreaterThan(0.1 * rms(slice(l, 0.3, 0.45)));
  expect(l.length / SR).toBeLessThan(0.5 + 1.25 * 0.3 + 0.06);
});

test('glide and pitch modulators move the pitch of the grains', async () => {
  const at = { spray: 0.05, size: 0.25 };
  const mono = { ...grains(sine, at), play: { mode: 'mono', glide: 0.1 } };
  const d = await notes(mono, [[60, 0, 1.5], [72, 1.5, 1.5]], 3, { samples: sine.samples });
  expect(near(slice(d, 0.1, 1.45), 220)).toBeLessThan(0.005);
  expect(near(slice(d, 1.75, 2.95), 440)).toBeLessThan(0.005);
  // An envelope in every note held at full, amount 0.25: twelve semitones up.
  const up = { ...mod('env', { module: 'source', param: 'pitch' }, 0.25, adsr(0, 0, 1, 0)), per: 'note' as const };
  const [l] = await render(grains(sine, at, { mods: [up] }), sine);
  expect(near(slice(l, 0.1, 1.9), 440)).toBeLessThan(0.005);
});

test('a voice made before the processors are in the context is silent, and the next ones play', async () => {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const engine = new Engine(ctx);
  engine.setProject(project([{ id: 'a', sound: grains(sine) }], {}, { samples: sine.samples }));
  engine.play('a', 60, 1, 0, 0.3);
  await engine.ready();
  engine.play('a', 60, 1, 0.5, 0.3);
  const out = (await ctx.startRendering()).getChannelData(0);
  expect(peak(slice(out, 0, 0.45))).toBe(0);
  expect(rms(slice(out, 0.55, 0.75))).toBeGreaterThan(0.05);

  const broken = new OfflineAudioContext(2, SR, SR);
  broken.audioWorklet.addModule = () => Promise.reject(new Error('no worklets here'));
  const silent = new Engine(broken);
  silent.setProject(project([{ id: 'a', sound: grains(sine) }], {}, { samples: sine.samples }));
  await silent.ready();
  silent.play('a', 60, 1, 0, 0.5);
  expect(peak((await broken.startRendering()).getChannelData(0))).toBe(0);
});

test('a long sample reaches each audio context once, however many voices play it', async () => {
  const sent: { channels?: Float32Array[] }[] = [];
  globalThis.AudioWorkletNode = class extends real {
    constructor(ctx: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      if (name === 'grains') sent.push(options!.processorOptions);
      super(ctx, name, options);
    }
  };
  const minute = Float32Array.from({ length: 60 * SR }, (_, i) => 0.3 * Math.sin(i / 7));
  const long = sampled(encodeWav({ sampleRate: SR, channels: [minute, minute] }), 'long');
  const chord: [number, number, number][] = [48, 52, 55, 60, 64, 67, 71, 72].map((n, i) => [n, i * 0.05, 0.5]);
  for (const _ of [0, 1]) {
    const d = await notes(grains(long), chord, 1, { samples: long.samples });
    expect(rms(slice(d, 0.4, 0.5))).toBeGreaterThan(0.05);
  }
  expect(sent).toHaveLength(16);
  const carrying = sent.filter((o) => o.channels);
  expect(carrying).toHaveLength(2);
  expect(carrying[0].channels!.map((c) => c.length)).toEqual([60 * SR, 60 * SR]);
}, 30_000);

test('eight voices of sixty grains each render well faster than real time', async () => {
  const s = grains(noise, { size: 0.25, density: 60, spray: 0.5, pspray: 200, width: 1, reverse: 0.3 });
  const chord: [number, number, number][] = [48, 52, 55, 60, 64, 67, 71, 72].map((n) => [n, 0, 4]);
  await notes(s, [[60, 0, 0.1]], 0.2, { samples: noise.samples });
  // The best of three renders, as the other test files render alongside this one.
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    const d = await notes(s, chord, 4, { samples: noise.samples });
    best = Math.min(best, performance.now() - t0);
    expect(finite(d)).toBe(true);
  }
  const speed = 4 / (best / 1000);
  console.log(`8 voices x 61 grains: ${speed.toFixed(1)}x real time`);
  // About 3x on a 2017 Xeon with nothing else running; the rest of the browser tests on the same machine can take
  // half of that.
  expect(speed).toBeGreaterThan(1.5);
}, 30_000);
