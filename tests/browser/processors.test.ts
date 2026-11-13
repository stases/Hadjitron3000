// The effects made of custom processors (src/audio/processors): Crusher, Comb, Space and Tape, and the frame that
// loads them.

import { expect, test } from 'vitest';
import { Engine, renderProject, renderSound, ringOut } from '../../src/audio';
import { EFFECT_BUILDERS } from '../../src/audio/modules/effects';
import { loadProcessors } from '../../src/audio/worklet';
import { MODULES } from '../../src/core/modules';
import { defaultParams } from '../../src/core/params';
import type { ModuleInst, Params, Sound } from '../../src/core/types';
import {
  SR, adsr, amplitudeAt, db, effect, finite, freq, maxJump, mod, notes, peak, project, rms, slice, sound,
} from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);
const sine = (chain: ModuleInst[], level = 0) =>
  sound('osc', { wave: 'sine' }, { amp: flat, chain, out: { level } });
// A short burst of white noise, the way a plucked string is excited.
const burst = (chain: ModuleInst[], level = 0) =>
  sound('noise', { color: 'white' }, { amp: adsr(0.001, 0.01, 0, 0.005), chain, out: { level } });
const withParams = (m: ModuleInst, params: Params): ModuleInst => ({ ...m, params: { ...m.params, ...params } });
const diff = (a: Float32Array, b: Float32Array) => a.map((v, i) => v - b[i]);

/** Left and right of a held note from 0.1 s to `to`. */
async function held(s: Sound, note: number, to = 0.6, vel = 0.8): Promise<[Float32Array, Float32Array]> {
  const pcm = await renderSound(s, {}, { note, vel, dur: to + 0.1, tail: 0.1 });
  return [slice(pcm.channels[0], 0.1, to), slice(pcm.channels[1], 0.1, to)];
}

/** One effect alone in an offline context, fed with `input` on both sides; returns the left output. */
async function alone(type: string, params: Params, input: Float32Array, seconds: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * SR), SR);
  expect(await loadProcessors(ctx)).toBe(true);
  const fx = EFFECT_BUILDERS[type](ctx, { ...defaultParams(MODULES[type]), ...params }, 120);
  const buffer = new AudioBuffer({ length: input.length, sampleRate: SR, numberOfChannels: 1 });
  buffer.getChannelData(0).set(input);
  const src = new AudioBufferSourceNode(ctx, { buffer });
  src.connect(fx.input);
  src.start();
  fx.output.connect(ctx.destination);
  return (await ctx.startRendering()).getChannelData(0);
}

/** The frequency between `lo` and `hi` hertz, in steps of `step`, where `d` is loudest. */
function loudest(d: Float32Array, lo: number, hi: number, step: number): number {
  let best = lo;
  for (let f = lo; f <= hi; f += step) if (amplitudeAt(d, f) > amplitudeAt(d, best)) best = f;
  return best;
}

/** The time a tail takes to fall by 60 dB, from a straight line fitted to its level in dB. */
function decayTime(d: Float32Array, from: number, to: number, sr = SR): number {
  const win = (to - from) / 20;
  const pts: [number, number][] = [];
  for (let t = from; t < to; t += win) pts.push([t, db(rms(slice(d, t, t + win, sr)))]);
  const mt = pts.reduce((s, [t]) => s + t, 0) / pts.length;
  const ml = pts.reduce((s, [, l]) => s + l, 0) / pts.length;
  return -60 / (pts.reduce((s, [t, l]) => s + (t - mt) * (l - ml), 0) / pts.reduce((s, [t]) => s + (t - mt) ** 2, 0));
}

/** The note keeps sounding while the chain changes at 0.5 s; the change must not jump more than the sound does. */
async function noClick(s: Sound, changed: ModuleInst[], note = 57) {
  const d = await notes(s, [[note, 0.05, 1.3, 0.8]], 1.4, {
    live: [[0.5, (e) => e.setProject(project([{ id: 'a', sound: { ...s, chain: changed } }]))]],
  });
  const steady = Math.max(maxJump(slice(d, 0.3, 0.5)), maxJump(slice(d, 0.9, 1.1)));
  expect(maxJump(slice(d, 0.5, 0.65)), changed.map((m) => m.type).join()).toBeLessThan(1.25 * steady + 1e-3);
}

test('the crusher at 16 bits and the full rate passes the sound unchanged', async () => {
  // A stereo pass-through for reference: the width at 100 %, which also turns the mono note into two sides.
  const [ref] = await held(sine([effect('width')]), 69);
  for (const mix of [0, 0.5, 1]) {
    const [l] = await held(sine([effect('crusher', { bits: 16, rate: 48000, mix })]), 69);
    expect(peak(diff(l, ref)), `mix ${mix}`).toBeLessThan(1e-6);
  }
});

test('fewer bits add the noise floor of their step, and a low rate holds samples and folds high notes down', async () => {
  // A 440 Hz sine of amplitude 0.64: rounding to steps of 2^(1 - bits) adds noise of step / sqrt(12).
  const [clean] = await held(sine([effect('crusher', { bits: 16, rate: 48000 })]), 69);
  for (const bits of [4, 8]) {
    const [l] = await held(sine([effect('crusher', { bits, rate: 48000 })]), 69);
    const expected = 2 ** (1 - bits) / Math.sqrt(12);
    expect(rms(diff(l, clean)) / expected, `${bits} bits`).toBeGreaterThan(0.8);
    expect(rms(diff(l, clean)) / expected, `${bits} bits`).toBeLessThan(1.25);
  }
  // At 1 kHz every value is held for 44.1 samples.
  const [held1k] = await held(sine([effect('crusher', { bits: 16, rate: 1000 })]), 57);
  let changes = 0;
  for (let i = 1; i < held1k.length; i++) if (held1k[i] !== held1k[i - 1]) changes++;
  expect(held1k.length / changes).toBeCloseTo(44.1, 0);
  // A 2960 Hz sine (note 102) sampled 4000 times a second sounds at 4000 - 2960 = 1040 Hz.
  const [folded] = await held(sine([effect('crusher', { bits: 16, rate: 4000 })]), 102);
  const [straight] = await held(sine([effect('crusher', { bits: 16, rate: 48000 })]), 102);
  expect(amplitudeAt(folded, 1040)).toBeGreaterThan(0.2);
  expect(amplitudeAt(straight, 1040)).toBeLessThan(0.001);
});

test('a modulator moves the crusher rate in octaves', async () => {
  const crusher = effect('crusher', { bits: 16, rate: 1000 });
  const s = sine([crusher]);
  // An envelope held at full: amount 0.25 is one octave up, so values change twice as often.
  const up = { ...s, mods: [mod('env', { module: crusher.id, param: 'rate' }, 0.25, adsr(0, 0, 1, 0))] };
  const [l] = await held(up, 57);
  let changes = 0;
  for (let i = 1; i < l.length; i++) if (l[i] !== l[i - 1]) changes++;
  expect(l.length / changes).toBeCloseTo(22.05, 0);
});

test('the comb rings at its frequency, and an octave lower with negative feedback', async () => {
  for (const [f, damp] of [[220, 0], [220, 0.6], [1000, 0.3]]) {
    const pcm = await renderSound(burst([effect('comb', { freq: f, feedback: 0.95, damp, mix: 1 })]), {}, {
      vel: 1, dur: 0.01, tail: 1,
    });
    const ring = slice(pcm.channels[0], 0.1, 0.6);
    // Within 6 cents.
    expect(Math.abs(loudest(ring, f * 0.95, f * 1.05, f / 2000) / f - 1), `${f} Hz, damp ${damp}`).toBeLessThan(0.0035);
    expect(amplitudeAt(ring, f) / amplitudeAt(ring, f * 1.5)).toBeGreaterThan(10);
  }
  const pcm = await renderSound(burst([effect('comb', { freq: 220, feedback: -0.95, damp: 0, mix: 1 })]), {}, {
    vel: 1, dur: 0.01, tail: 1,
  });
  const hollow = slice(pcm.channels[0], 0.1, 0.6);
  // Peaks at 110, 330, 550 Hz; nothing at 220 and 440 Hz.
  expect(amplitudeAt(hollow, 110) / amplitudeAt(hollow, 220)).toBeGreaterThan(10);
  expect(amplitudeAt(hollow, 330) / amplitudeAt(hollow, 440)).toBeGreaterThan(10);
});

test('damping in the comb makes the high harmonics die sooner', async () => {
  const fade = async (damp: number, harmonic: number) => {
    const pcm = await renderSound(burst([effect('comb', { freq: 220, feedback: 0.98, damp, mix: 1 })]), {}, {
      vel: 1, dur: 0.01, tail: 1,
    });
    const d = pcm.channels[0];
    return db(amplitudeAt(slice(d, 0.35, 0.45), 220 * harmonic) / amplitudeAt(slice(d, 0.05, 0.15), 220 * harmonic));
  };
  // Over 0.3 s the fundamental falls by about the same amount either way, the eighth harmonic much faster.
  expect(Math.abs((await fade(0.6, 1)) - (await fade(0, 1)))).toBeLessThan(6);
  expect(await fade(0.6, 8)).toBeLessThan((await fade(0, 8)) - 20);
});

test('the comb stays bounded at 98 % feedback, either sign', async () => {
  // A long sine right on the resonance and on the octave-down one, at a level that keeps clear of the clipper.
  for (const [feedback, note] of [[0.98, 57], [-0.98, 45]]) {
    const s = sine([effect('comb', { freq: 220, feedback, damp: 0, mix: 1 })], -30);
    const d = await notes(s, [[note, 0, 4]], 4);
    expect(finite(d)).toBe(true);
    const late = rms(slice(d, 3, 4));
    expect(Math.abs(db(late / rms(slice(d, 2, 3)))), `${feedback}`).toBeLessThan(0.5);
    expect(peak(d)).toBeLessThan(0.7);
  }
});

test('Space falls by 60 dB in about its size, with its two sides uncorrelated', async () => {
  for (const size of [1, 4]) {
    const pcm = await renderSound(burst([effect('space', { size, tone: 20000, mix: 1 })]), {}, {
      vel: 1, dur: 0.01, tail: size * 1.5,
    });
    const [l, r] = pcm.channels;
    const t = decayTime(l, 0.15, 0.15 + size / 2);
    expect(t, `size ${size}`).toBeGreaterThan(size / 1.4);
    expect(t, `size ${size}`).toBeLessThan(size * 1.4);
    const a = slice(l, 0.2, 0.2 + size / 2);
    const b = slice(r, 0.2, 0.2 + size / 2);
    const corr = a.reduce((s, v, i) => s + v * b[i], 0) / Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
    expect(Math.abs(corr)).toBeLessThan(0.2);
  }
});

test('frozen, Space holds its tail for at least 20 s without input and lets no new sound in', async () => {
  const sr = 16000;
  const space = effect('space', { size: 2, tone: 6000, mix: 1 });
  const s = sound('osc', { wave: 'sawtooth' }, { amp: flat, chain: [space], out: { level: -12 } });
  const frozen = { ...s, chain: [withParams(space, { freeze: true })] };
  // A note at 110 Hz into the tail, frozen at 0.85 s, then one at 233 Hz on top.
  const render = (freeze: boolean) => notes(s, [[45, 0, 0.8, 0.6], [58, 4, 1, 0.6]], 26, {
    sampleRate: sr, live: freeze ? [[0.85, (e) => e.setProject(project([{ id: 'a', sound: frozen }]))]] : [],
  });
  const held = await render(true);
  const at = (t: number, f?: number) => {
    const d = slice(held, t, t + 1, sr);
    return f ? amplitudeAt(d, f, sr) : rms(d);
  };
  expect(finite(held)).toBe(true);
  expect(Math.abs(db(at(24) / at(2)))).toBeLessThan(3);
  // The second note is heard dry while it plays, and the tail after it holds the first note only.
  expect(at(4, 233.08)).toBeGreaterThan(20 * at(2, 233.08));
  expect(at(8, 233.08)).toBeLessThan(2 * at(2, 233.08));
  expect(Math.abs(db(at(8) / at(2)))).toBeLessThan(2);
  const free = await render(false);
  expect(rms(slice(free, 24, 25, sr))).toBeLessThan(1e-5);
});

test('Shimmer feeds the tail back an octave up, and stays bounded', async () => {
  const tail = async (shimmer: number) => {
    const s = sine([effect('space', { size: 8, tone: 8000, mix: 1, shimmer })], -12);
    const d = await notes(s, [[69, 0, 0.5]], 3.5);
    return slice(d, 2.5, 3.5);
  };
  const plain = await tail(0);
  const bright = await tail(0.8);
  const octave = (d: Float32Array) => amplitudeAt(d, 880) / amplitudeAt(d, 440);
  expect(octave(bright)).toBeGreaterThan(10 * octave(plain));
  expect(amplitudeAt(bright, 1760)).toBeGreaterThan(amplitudeAt(plain, 1760));

  // Full shimmer on the longest size under a long, loud input: the tail stops growing and stays finite.
  const s = sound('noise', { color: 'pink' }, {
    amp: flat, chain: [effect('space', { size: 60, tone: 20000, mix: 1, shimmer: 1 })], out: { level: -36 },
  });
  const sr = 16000;
  const d = await notes(s, [[60, 0, 10]], 14, { sampleRate: sr });
  expect(finite(d)).toBe(true);
  expect(peak(d)).toBeLessThan(0.7);
  expect(db(rms(slice(d, 8, 10, sr)) / rms(slice(d, 4, 6, sr)))).toBeLessThan(3);
});

test('wow and flutter move the pitch by their depth, at their speed', async () => {
  const tape = (params: Params) => sine([effect('tape', { hiss: 0, sat: 0, age: 0, wow: 0, flutter: 0, ...params })]);
  // Note 83 is 987.77 Hz. The pitch in windows short enough to follow the wander.
  const deviation = async (params: Params, win: number) => {
    const [l] = await held(tape(params), 83, 6.1);
    const fs = Array.from({ length: Math.floor(5.9 / win) }, (_, i) => freq(slice(l, win * i, win * (i + 1))));
    return Math.max(...fs.map((f) => Math.abs(f / 987.77 - 1)));
  };
  // Wow at full swings by up to 1.2 %, flutter by up to 0.3 %; neither moves a still tape.
  expect(await deviation({}, 0.05)).toBeLessThan(0.0002);
  const wow = await deviation({ wow: 1 }, 0.05);
  expect(wow).toBeGreaterThan(0.008);
  expect(wow).toBeLessThan(0.013);
  expect(await deviation({ wow: 0.5 }, 0.05)).toBeCloseTo(wow / 2, 3);
  const flutter = await deviation({ flutter: 1 }, 0.01);
  expect(flutter).toBeGreaterThan(0.0015);
  expect(flutter).toBeLessThan(0.0045);
});

test('the tape hiss has its level while the sound plays and goes when it stops', async () => {
  const tape = (hiss: number) => sine([effect('tape', { hiss, sat: 0, age: 0 })]);
  const pcm = async (hiss: number) => (await renderSound(tape(hiss), {}, { note: 57, vel: 0.8, dur: 1, tail: 3 })).channels[0];
  const quiet = await pcm(0);
  const full = await pcm(1);
  const half = await pcm(0.5);
  // Full hiss is 0.02 RMS before the age filter, which at its newest takes a little of the top.
  const noise = rms(slice(diff(full, quiet), 0.2, 0.9));
  expect(noise).toBeGreaterThan(0.015);
  expect(noise).toBeLessThan(0.021);
  expect(rms(slice(diff(half, quiet), 0.2, 0.9)) / noise).toBeCloseTo(0.25, 1);
  expect(full.length / SR).toBeLessThan(1 + 2.5);
  expect(peak(full.subarray(full.length - 2205))).toBeLessThan(1e-4);
});

test('tape saturation squashes loud notes only, and age takes the highs', async () => {
  const level = async (params: Params, note: number, vel: number) =>
    rms((await held(sine([effect('tape', { wow: 0, flutter: 0, hiss: 0, sat: 0, age: 0, ...params })]), note, 0.6, vel))[0]);
  expect(db((await level({ sat: 1 }, 57, 1)) / (await level({}, 57, 1)))).toBeLessThan(-3);
  expect(Math.abs(db((await level({ sat: 1 }, 57, 0.05)) / (await level({}, 57, 0.05))))).toBeLessThan(0.2);
  expect(db((await level({ age: 1 }, 105, 0.8)) / (await level({}, 105, 0.8)))).toBeLessThan(-6);
  expect(Math.abs(db((await level({ age: 1 }, 45, 0.8)) / (await level({}, 45, 0.8))))).toBeLessThan(0.5);
});

test('turning the knobs of the processor effects while a note sounds does not click', async () => {
  const crusher = effect('crusher', { bits: 16, rate: 48000 });
  await noClick(sine([crusher], -6), [withParams(crusher, { bits: 6, rate: 3000, mix: 0.5 })]);
  const comb = effect('comb', { feedback: 0.5, mix: 0.3 });
  await noClick(sine([comb], -6), [withParams(comb, { freq: 900, feedback: -0.9, damp: 0.8, mix: 0.8 })]);
  const space = effect('space');
  await noClick(sine([space], -6), [withParams(space, { size: 30, tone: 1000, mix: 0.9, shimmer: 0.5, freeze: true })]);
  const tape = effect('tape');
  await noClick(sine([tape], -6), [withParams(tape, { wow: 1, flutter: 1, hiss: 0.5, sat: 1, age: 1 })]);
});

test('every processor gives silence for silence, and stays finite for DC and broken input', async () => {
  const n = SR;
  const silence = new Float32Array(n);
  const dc = new Float32Array(n).fill(0.5);
  // NaN and infinities, then an ordinary sine, which must come through again.
  const broken = Float32Array.from({ length: n }, (_, i) =>
    i < 1000 ? [NaN, Infinity, -Infinity][i % 3] : 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));
  const settings: Record<string, Params> = {
    crusher: {}, comb: { feedback: 0.98 }, space: { size: 60, shimmer: 1, mix: 1 }, tape: { hiss: 1, wow: 1, flutter: 1 },
  };
  for (const [type, params] of Object.entries(settings)) {
    expect(peak(await alone(type, params, silence, 1)), type).toBe(0);
    const steady = await alone(type, params, dc, 1);
    expect(finite(steady) && peak(steady) < 20, type).toBe(true);
    const fixed = await alone(type, params, broken, 1);
    expect(finite(fixed), type).toBe(true);
    expect(rms(slice(fixed, 0.5, 1)), type).toBeGreaterThan(0.05);
  }
});

test('when the processors cannot be loaded, the engine plays on with those effects passing the sound through', async () => {
  const ctx = new OfflineAudioContext(2, SR, SR);
  ctx.audioWorklet.addModule = () => Promise.reject(new Error('no worklets here'));
  const engine = new Engine(ctx);
  engine.setProject(project([{ id: 'a', sound: sine([effect('crusher', { bits: 2, rate: 1000 })]) }]));
  await engine.ready();
  expect(await loadProcessors(ctx)).toBe(false);
  engine.play('a', 69, 0.8, 0, 0.6);
  const out = (await ctx.startRendering()).getChannelData(0);
  const [ref] = await held(sine([effect('width')]), 69);
  expect(peak(diff(slice(out, 0.1, 0.6), ref))).toBeLessThan(1e-6);
});

test('an export renders the processor effects, and a frozen Space rings out for the longest tail', async () => {
  const crushed = sine([effect('crusher', { bits: 2, rate: 48000 })]);
  const p = project([{ id: 'a', sound: crushed }], { a: { 0: { note: 69, vel: 0.8, len: 16 } } });
  const pcm = await renderProject(p, { kind: 'pattern', patternId: p.patterns[0].id }, { tail: 0 });
  // Two bits leave three levels on each side of the amp envelope's swell.
  const body = slice(pcm.channels[0], 0.1, 1.5);
  expect(new Set(body).size).toBeLessThanOrEqual(3);
  expect(rms(body)).toBeGreaterThan(0.2);

  // Space rings until its tail is 80 dB down, a third longer than its size.
  const pad = (params: Params) => ({ ...sine([effect('space', params)]), amp: adsr(0.01, 0.1, 1, 0) });
  expect(ringOut([pad({ size: 6 })], 120)).toBeCloseTo(8, 6);
  expect(ringOut([pad({ size: 30 })], 120)).toBeCloseTo(40, 6);
  expect(ringOut([pad({ size: 30, shimmer: 0.5 })], 120)).toBe(60);
  expect(ringOut([pad({ size: 2, freeze: true })], 120)).toBe(60);
  expect(ringOut([sine([effect('comb', { freq: 100, feedback: -0.9 })])], 120)).toBe(6);
  const ringing = { ...sine([effect('comb', { freq: 30, feedback: 0.98 })]), amp: adsr(0.01, 0.1, 1, 0) };
  expect(ringOut([ringing], 120)).toBeCloseTo(Math.log(1e-4) / Math.log(0.98) / 30, 6);
});

/** A note of 0.1 s at step 0, a sine or `s`, sent half to bus A, which holds `bus`, with `master` on the master. */
function mixed(bus: ModuleInst[], master: ModuleInst[] = [], send = 0.5, s = sine([], -12)) {
  const p = project([{ id: 'a', sound: s, sends: [send, 0] }], { a: { 0: { note: 69, vel: 1, len: 0.8 } } });
  p.mixer.buses[0] = { ...p.mixer.buses[0], chain: bus };
  p.mixer.master = { ...p.mixer.master, chain: master };
  return p;
}

const exported = async (p: ReturnType<typeof mixed>, tail?: number) =>
  renderProject(p, { kind: 'pattern', patternId: p.patterns[0].id }, { tail });

test('Space on a bus is there from the first sample of an export, wet alone at full Mix and dry at none', async () => {
  const dry = (await exported(mixed([], [], 0), 1)).channels[0];
  const added = async (mix: number) => {
    const wet = (await exported(mixed([effect('space', { size: 2, mix })]), 1)).channels[0];
    return wet.map((v, i) => v - dry[i]);
  };
  // Fully wet, nothing comes back before the shortest line of the network; a pass-through would echo the note at once.
  const tail = await added(1);
  expect(peak(slice(tail, 0, 0.025))).toBe(0);
  expect(rms(slice(tail, 0.1, 0.5))).toBeGreaterThan(0.01);
  const none = await added(0);
  expect(peak(none.map((v, i) => v - 0.5 * dry[i]))).toBeLessThan(1e-6);
});

test('the tail of an export lets Space and the comb on a bus ring out', async () => {
  const seconds = async (bus: ModuleInst[]) =>
    (await exported(mixed(bus, [], 0.5, sound('noise', {}, { amp: flat, out: { level: -12 } })))).channels[0].length / SR;
  // The note's block lasts 2 s, and a render goes on for 6 s at least before the silence is trimmed; these ring
  // past that, so the tail the export gave them was longer.
  expect(await seconds([])).toBeLessThan(2 + 1);
  expect(await seconds([effect('space', { size: 20, tone: 20000, mix: 1 })]), 'space').toBeGreaterThan(2 + 6 + 0.2);
  expect(await seconds([effect('comb', { freq: 30, feedback: 0.98, damp: 0, mix: 1 })]), 'comb')
    .toBeGreaterThan(2 + 6 + 0.2);
}, 30_000);

test('a crusher on the master crushes the whole mix, and a rebuilt master rack has it at once', async () => {
  const crusher = effect('crusher', { bits: 2, rate: 48000 });
  const body = slice((await exported(mixed([], [crusher]), 0)).channels[0], 0.02, 0.09);
  expect(new Set(body).size).toBeLessThanOrEqual(3);
  expect(rms(body)).toBeGreaterThan(0.1);

  // A change of structure at 0.5 s builds a new rack beside the old one and crossfades to it.
  const p = mixed([], [crusher]);
  const ctx = new OfflineAudioContext(2, 1.5 * SR, SR);
  const engine = new Engine(ctx);
  engine.setProject(p);
  await engine.ready();
  engine.play('a', 69, 1, 0, 1.4);
  void ctx.suspend(0.5).then(() => {
    engine.setProject({ ...p, mixer: { ...p.mixer, master: { ...p.mixer.master, chain: [effect('eq'), crusher] } } });
    return ctx.resume();
  });
  const out = (await ctx.startRendering()).getChannelData(0);
  expect(finite(out)).toBe(true);
  expect(new Set(slice(out, 0.7, 1.3)).size).toBeLessThanOrEqual(3);
  expect(rms(slice(out, 0.7, 1.3))).toBeGreaterThan(0.1);
});
