import { expect, test } from 'vitest';
import { decodeSample, renderSound, sliceTimes } from '../../src/audio';
import { preset, presetSamples } from '../../src/presets';
import { BREAK_BPM } from '../../src/presets/samples';
import { SR, adsr, amplitudeAt, finite, freq, maxJump, peak, rms, slice, sound, tone, wav } from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);

test.each([
  ['osc', {}],
  ['osc', { voices: 7, spread: 40, width: 1, noise: 0.3 }],
  ['fm', {}],
  ['noise', { color: 'white' }],
  ['noise', { color: 'pink' }],
  ['noise', { color: 'brown' }],
])('%s %j renders a finite, audible, unclipped note', async (type, params) => {
  const pcm = await renderSound(sound(type, params), {}, { dur: 0.5, tail: 0.5 });
  for (const d of pcm.channels) {
    expect(finite(d)).toBe(true);
    expect(peak(d)).toBeGreaterThan(0.05);
    expect(peak(d)).toBeLessThan(1);
  }
});

test('an osc sine at note 69 is 440 Hz, and pitch +12 doubles it', async () => {
  const a = await renderSound(sound('osc', { wave: 'sine' }, { amp: flat }), {}, { note: 69, vel: 1, dur: 0.5 });
  expect(Math.abs(freq(slice(a.channels[0], 0.05, 0.45)) / 440 - 1)).toBeLessThan(0.01);
  const b = await renderSound(sound('osc', { wave: 'sine', pitch: 12 }, { amp: flat }), {}, { note: 69, vel: 1, dur: 0.5 });
  expect(Math.abs(freq(slice(b.channels[0], 0.05, 0.45)) / 880 - 1)).toBeLessThan(0.01);
});

test('unison voices spread across the stereo field with width', async () => {
  const narrow = await renderSound(sound('osc', { voices: 3, width: 0 }, { amp: flat }), {}, { dur: 0.5 });
  const wide = await renderSound(sound('osc', { voices: 3, width: 1 }, { amp: flat }), {}, { dur: 0.5 });
  const diff = (p: typeof wide) => rms(slice(p.channels[0], 0.1, 0.4).map((v, i) => v - p.channels[1][i + 4410]));
  expect(diff(narrow)).toBeLessThan(1e-6);
  expect(diff(wide)).toBeGreaterThan(0.05);
});

test('fm sidebands follow the Bessel functions of the index', async () => {
  // Carrier 440 Hz, modulator 1320 Hz: components at 440 (J0), 1760 (J1) and 3080 Hz (J2).
  const pcm = await renderSound(sound('fm', { ratio: 3, amount: 1 }, { amp: flat }), {}, { note: 69, vel: 1, dur: 0.6 });
  const d = slice(pcm.channels[0], 0.05, 0.55);
  const c = amplitudeAt(d, 440);
  expect(amplitudeAt(d, 1760) / c).toBeCloseTo(0.4401 / 0.7652, 1);
  expect(amplitudeAt(d, 3080) / c).toBeCloseTo(0.1149 / 0.7652, 1);
  const pure = await renderSound(sound('fm', { ratio: 3, amount: 0 }, { amp: flat }), {}, { note: 69, vel: 1, dur: 0.6 });
  const p = slice(pure.channels[0], 0.05, 0.55);
  expect(amplitudeAt(p, 1760) / amplitudeAt(p, 440)).toBeLessThan(0.001);
});

test('noise colours have similar loudness and get darker from white to brown', async () => {
  const measure = async (color: string) => {
    const pcm = await renderSound(sound('noise', { color }, { amp: flat }), {}, { dur: 1 });
    const d = slice(pcm.channels[0], 0.05, 0.95);
    let crossings = 0;
    for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 !== d[i] < 0) crossings++;
    return { level: rms(d), crossings };
  };
  const [white, pink, brown] = [await measure('white'), await measure('pink'), await measure('brown')];
  for (const n of [pink, brown]) expect(Math.abs(20 * Math.log10(n.level / white.level))).toBeLessThan(1);
  expect(pink.crossings).toBeLessThan(white.crossings / 2);
  expect(brown.crossings).toBeLessThan(pink.crossings / 2);
});

// One second of WAV: 0.5 s of 220 Hz at amplitude 0.5, then 0.5 s of 330 Hz at amplitude 0.25.
const halves = (() => {
  const a = tone(0.5, 220, 0.5);
  const b = tone(0.5, 330, 0.25);
  const all = new Float32Array(a.length + b.length);
  all.set(a);
  all.set(b, a.length);
  return { s1: { name: 'halves.wav', bytes: wav(all) } };
})();

const sampler = (params: Record<string, unknown> = {}, amp = flat) =>
  sound('sample', { sample: 's1', mode: 'gate', ...params } as never, { amp });

test('the sampler plays at the original pitch on note 60 and an octave up on 72', async () => {
  const a = await renderSound(sampler(), halves, { note: 60, vel: 1, dur: 0.4 });
  expect(Math.abs(freq(slice(a.channels[0], 0.05, 0.4)) / 220 - 1)).toBeLessThan(0.01);
  const b = await renderSound(sampler(), halves, { note: 72, vel: 1, dur: 0.2 });
  expect(Math.abs(freq(slice(b.channels[0], 0.02, 0.2)) / 440 - 1)).toBeLessThan(0.01);
  const c = await renderSound(sampler({ pitch: -12 }), halves, { note: 72, vel: 1, dur: 0.4 });
  expect(Math.abs(freq(slice(c.channels[0], 0.05, 0.4)) / 220 - 1)).toBeLessThan(0.01);
});

test('start and end bound the region, reverse plays it backwards', async () => {
  const late = await renderSound(sampler({ start: 0.5 }), halves, { vel: 1, dur: 2 });
  expect(Math.abs(freq(slice(late.channels[0], 0.05, 0.45)) / 330 - 1)).toBeLessThan(0.01);
  expect(late.channels[0].length / 44100).toBeLessThan(0.5 + 0.06);

  const early = await renderSound(sampler({ end: 0.25 }), halves, { vel: 1, dur: 2 });
  expect(early.channels[0].length / 44100).toBeGreaterThan(0.24);
  expect(early.channels[0].length / 44100).toBeLessThan(0.25 + 0.06);

  const rev = await renderSound(sampler({ reverse: true }), halves, { vel: 1, dur: 2 });
  const first = slice(rev.channels[0], 0.05, 0.45);
  const second = slice(rev.channels[0], 0.55, 0.95);
  expect(Math.abs(freq(first) / 330 - 1)).toBeLessThan(0.01);
  expect(Math.abs(freq(second) / 220 - 1)).toBeLessThan(0.01);
  expect(rms(second) / rms(first)).toBeCloseTo(2, 1);
});

test('loop repeats the region for the length of the note', async () => {
  const pcm = await renderSound(sampler({ end: 0.25, loop: true }), halves, { vel: 1, dur: 1.5 });
  const d = pcm.channels[0];
  expect(d.length / 44100).toBeGreaterThan(1.5);
  expect(Math.abs(freq(slice(d, 1.0, 1.4)) / 220 - 1)).toBeLessThan(0.01);
  expect(rms(slice(d, 1.0, 1.4))).toBeGreaterThan(0.2);
});

test('a loop crossfade removes the click at the seam, and without one a loop plays exactly as before', async () => {
  // 223.3 cycles in the second: the loop ends three tenths of a cycle away from where it starts again.
  const odd = { odd: { name: 'odd.wav', bytes: wav(tone(1, 223.3, 0.5)) } };
  const looped = (params: Record<string, unknown>) => sampler({ sample: 'odd', loop: true, ...params });
  const play = async (params: Record<string, unknown>) =>
    (await renderSound(looped(params), odd, { vel: 1, dur: 2.5 })).channels[0];
  const steady = maxJump(slice(await play({}), 0.1, 0.9));
  expect(maxJump(slice(await play({}), 0.1, 2.4))).toBeGreaterThan(10 * steady);
  for (const xfade of [0.05, 0.2, 0.5]) {
    const d = await play({ xfade });
    expect(maxJump(slice(d, 0.1, 2.4)), `${xfade}`).toBeLessThan(1.5 * steady);
    expect(rms(slice(d, 1.2, 2.2)) / rms(slice(d, 0.1, 0.9)), `${xfade}`).toBeGreaterThan(0.8);
  }
  // A sound from before the crossfade has no such parameter.
  const old = looped({});
  delete old.source.params.xfade;
  const before = (await renderSound(old, odd, { vel: 1, dur: 2.5 })).channels[0];
  expect(await play({ xfade: 0 })).toEqual(before);
  const plain = await renderSound(sampler({ sample: 'odd', end: 0.6 }), odd, { vel: 1, dur: 1 });
  expect((await renderSound(sampler({ sample: 'odd', end: 0.6, xfade: 0.3 }), odd, { vel: 1, dur: 1 })).channels[0])
    .toEqual(plain.channels[0]);
});

test('one-shot plays the region out; gate stops at the note end', async () => {
  const oneshot = await renderSound(sampler({ mode: 'oneshot' }), halves, { vel: 1, dur: 0.1 });
  const gate = await renderSound(sampler({ mode: 'gate' }), halves, { vel: 1, dur: 0.1 });
  expect(oneshot.channels[0].length / 44100).toBeGreaterThan(0.99);
  expect(rms(slice(oneshot.channels[0], 0.6, 0.9))).toBeGreaterThan(0.1);
  expect(gate.channels[0].length / 44100).toBeLessThan(0.1 + 1.25 * 0.02 + 0.06);
});

test('a missing sample is silent without an error', async () => {
  const pcm = await renderSound(sound('sample', { sample: 'nope' }), {}, { dur: 0.2, tail: 0.1 });
  expect(peak(pcm.channels[0])).toBe(0);
});

// A ramp from 0 to 1 over a second: every sample says where in the file it is.
const ramp = { ramp: { name: 'ramp.wav', bytes: wav(Float32Array.from({ length: SR }, (_, i) => i / SR)) } };
const sliced = (params: Record<string, unknown> = {}) =>
  sound('sample', { sample: 'ramp', slices: '8', mode: 'oneshot', ...params } as never, { amp: adsr(0, 0.1, 1, 0.01) });
// A mono sound reaches each side 3 dB down; the amp envelope takes a millisecond to open even at no attack.
const side = (d: Float32Array, t: number) => d[Math.round(t * SR)] / Math.SQRT1_2;

test('equal slices start at their line and end at the next, one per key from C3 up, at the sample\'s pitch', async () => {
  for (const k of [0, 3, 7]) {
    const d = (await renderSound(sliced(), ramp, { note: 60 + k, vel: 1, dur: 0.05 })).channels[0];
    expect(side(d, 0.002), `slice ${k + 1}`).toBeCloseTo(k / 8 + 0.002, 3);
    expect(side(d, 0.1), `slice ${k + 1}`).toBeCloseTo(k / 8 + 0.1, 3);
    expect(peak(slice(d, 0.126, 0.2)), `slice ${k + 1}`).toBe(0);
  }
  for (const note of [59, 68]) {
    expect(peak((await renderSound(sliced(), ramp, { note, vel: 1, dur: 0.05, tail: 0.2 })).channels[0])).toBe(0);
  }
  // Pitch still applies: an octave up plays the slice twice as fast.
  const up = (await renderSound(sliced({ pitch: 12 }), ramp, { note: 62, vel: 1, dur: 0.05 })).channels[0];
  expect(side(up, 0.05)).toBeCloseTo(0.25 + 0.1, 3);
  expect(peak(slice(up, 0.064, 0.2))).toBe(0);
});

test('slices cut the region between Start and End, play while held in Gate, and backwards with Reverse', async () => {
  const region = (await renderSound(sliced({ start: 0.5, slices: '4' }), ramp, { note: 61, vel: 1, dur: 0.05 })).channels[0];
  expect(side(region, 0.002)).toBeCloseTo(0.627, 3);
  expect(peak(slice(region, 0.126, 0.2))).toBe(0);
  const gate = (await renderSound(sliced({ mode: 'gate' }), ramp, { note: 60, vel: 1, dur: 0.05 })).channels[0];
  expect(gate.length / SR).toBeLessThan(0.05 + 1.25 * 0.01 + 0.06);
  expect(peak(slice(gate, 0.07, 0.2))).toBe(0);
  const back = (await renderSound(sliced({ reverse: true }), ramp, { note: 61, vel: 1, dur: 0.05 })).channels[0];
  expect(side(back, 0.002)).toBeCloseTo(0.248, 3);
  expect(side(back, 0.1)).toBeCloseTo(0.15, 3);
});

test('with Slices off, and in a sound from before slices, the sampler plays exactly as it did', async () => {
  const old = sampler({ start: 0.2, end: 0.7, pitch: 3 });
  delete old.source.params.slices;
  delete old.source.params.sens;
  const before = (await renderSound(old, halves, { note: 64, vel: 1, dur: 0.5 })).channels[0];
  const now = (await renderSound(sampler({ start: 0.2, end: 0.7, pitch: 3, slices: 'off' }), halves, {
    note: 64, vel: 1, dur: 0.5,
  })).channels[0];
  expect(now).toEqual(before);
});

test('Hits cuts the factory break at its hits, and a note plays from its hit', async () => {
  const samples = presetSamples('Chopped Break');
  const [[id, data]] = Object.entries(samples);
  const buffer = await decodeSample(id, data.bytes);
  const bounds = sliceTimes(buffer, { start: 0, end: 1, slices: 'hits', sens: 0.5 })!;
  const steps = [0, 2, 4, 6, 7, 8, 10, 11, 12, 14, 15].map((s) => (s * 60) / BREAK_BPM / 4);
  expect(bounds).toHaveLength(steps.length + 1);
  steps.forEach((t, k) => expect(Math.abs(bounds[k] - t), `hit ${k}`).toBeLessThan(0.003));
  // The fifth hit, a soft kick, is the region from its line to the next.
  const hits = { ...preset('Chopped Break'), amp: adsr(0, 0.1, 1, 0.01) };
  hits.source.params = { ...hits.source.params, slices: 'hits' };
  const region = { slices: 'off', start: bounds[4] / buffer.duration, end: bounds[5] / buffer.duration };
  const plain = { ...hits, source: { ...hits.source, params: { ...hits.source.params, ...region } } };
  const a = (await renderSound(hits, samples, { note: 64, vel: 1, dur: 0.05 })).channels[0];
  const b = (await renderSound(plain, samples, { note: 60, vel: 1, dur: 0.05 })).channels[0];
  expect(peak(a.map((v, i) => v - b[i]))).toBeLessThan(1e-3);
  expect(rms(a)).toBeGreaterThan(0.02);
});
