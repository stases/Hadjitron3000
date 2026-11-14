// The compressor, EQ, chorus, phaser, ring modulator and width, and the delay's low cut.

import { expect, test } from 'vitest';
import { renderSound, ringOut } from '../../src/audio';
import type { ModuleInst, Params, Sound } from '../../src/core/types';
import { preset } from '../../src/presets';
import {
  adsr, amplitudeAt, db, effect, expectEnergy, freq, maxJump, notes, peak, project, rms, slice, sound,
} from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);
const sine = (chain: ModuleInst[], extra: Params = {}) =>
  sound('osc', { wave: 'sine', ...extra }, { amp: flat, chain, out: { level: -6 } });
// Three saws spread across the stereo field: left and right differ at every frequency.
const stereo = (chain: ModuleInst[]) =>
  sound('osc', { wave: 'sawtooth', voices: 3, spread: 40, width: 1 }, { amp: flat, chain, out: { level: -12 } });
const withParams = (m: ModuleInst, params: Params): ModuleInst => ({ ...m, params: { ...m.params, ...params } });

/** Left and right of a held note, from 0.15 s to 0.55 s. */
async function held(s: Sound, note: number, vel = 1): Promise<[Float32Array, Float32Array]> {
  const pcm = await renderSound(s, {}, { note, vel, dur: 0.6, tail: 0.1 });
  return [slice(pcm.channels[0], 0.15, 0.55), slice(pcm.channels[1], 0.15, 0.55)];
}

const level = async (s: Sound, note: number, vel = 1) => rms((await held(s, note, vel))[0]);
const sum = (a: Float32Array, b: Float32Array, sign = 1) => a.map((v, i) => v + sign * b[i]);

/**
 * Change a held note's chain at 0.5 s, live, and check that the biggest step between neighbouring samples just
 * after the change is no bigger than the steps of the sound before it and once it has settled: a click would be.
 */
async function noClick(s: Sound, changed: ModuleInst[], note = 57) {
  const next = { ...s, chain: changed };
  const d = await notes(s, [[note, 0.05, 1.3, 0.8]], 1.4, {
    live: [[0.5, (e) => e.setProject(project([{ id: 'a', sound: next }]))]],
  });
  const steady = Math.max(maxJump(slice(d, 0.3, 0.5)), maxJump(slice(d, 0.9, 1.1)));
  expect(maxJump(slice(d, 0.5, 0.65)), changed.map((m) => m.type).join()).toBeLessThan(1.25 * steady + 1e-3);
}

test('sounds made before these effects render exactly as before', async () => {
  // Length and energy of both channels, measured on the commit before the low cut and the shared mix helper.
  const pinned = [
    ['Kick', 28562, 165.230476325, 165.230476325],
    ['Acid Bass', 27616, 124.545175734, 124.545175734],
    ['Clap', 35161, 2.476198285, 2.51677446],
    ['Trance Pluck', 135561, 10.885523636, 13.11868042],
    ['Glass Draw', 125401, 75.038310042, 75.069875677],
    ['Glass Pad', 254130, 67.581597927, 88.49498188],
  ] as const;
  for (const [name, length, left, right] of pinned) {
    const pcm = await renderSound(preset(name), {}, { note: 48, dur: 0.5 });
    expect(pcm.channels[0].length, name).toBe(length);
    expectEnergy(pcm.channels[0], left, name);
    expectEnergy(pcm.channels[1], right, name);
  }
});

test('the compressor turns a loud sine down by the ratio above the threshold and leaves a quiet one alone', async () => {
  // At velocity 1 the sine peaks at 0 dBFS where it enters the chain, at 0.5 at -12 dBFS, at 0.1 at -40 dBFS.
  // Ratio 1 compresses nothing, so it is the reference with the compressor's stereo output.
  const comp = (params: Params) =>
    sine([effect('compressor', { threshold: -18, attack: 0.002, release: 0.05, ...params })]);
  const reduction = async (params: Params, vel: number) =>
    db((await level(comp(params), 57, vel)) / (await level(comp({ ratio: 1 }), 57, vel)));
  expect(await reduction({ ratio: 4 }, 1)).toBeCloseTo(-13.5, 0);
  expect(await reduction({ ratio: 4 }, 0.5)).toBeCloseTo(-4.5, 0);
  expect(await reduction({ ratio: 20 }, 1)).toBeCloseTo(-17.1, 0);
  expect(await reduction({ ratio: 4, threshold: -30 }, 1)).toBeCloseTo(-22.5, 0);
  expect(Math.abs(await reduction({ ratio: 4 }, 0.1))).toBeLessThan(0.05);
  expect(Math.abs(await reduction({ ratio: 20, threshold: -36 }, 0.1))).toBeLessThan(0.05);

  // Make-up adds its gain after compressing.
  expect(db((await level(comp({ makeup: 6 }), 57)) / (await level(comp({}), 57)))).toBeCloseTo(6, 1);
});

test('the compressor mixes dry and wet in time, without comb filtering', async () => {
  for (const note of [57, 81, 93, 100]) {
    const quiet = async (mix: number) => level(sine([effect('compressor', { mix })]), note, 0.1);
    expect(Math.abs(db((await quiet(0.5)) / (await quiet(1)))), `note ${note}`).toBeLessThan(0.1);
  }
  // Half wet and half dry, a loud note is turned down less than by the compressor alone.
  const loud = async (mix: number, ratio = 8) => level(sine([effect('compressor', { mix, ratio })]), 57);
  const full = db((await loud(1)) / (await loud(1, 1)));
  const half = db((await loud(0.5)) / (await loud(0.5, 1)));
  expect(half).toBeGreaterThan(full + 6);
  expect(half).toBeLessThan(-3);
});

test('the EQ is transparent at 0 dB and boosts and cuts each band where it should', async () => {
  const dry = (await held(sine([]), 69))[0];
  const flatEq = (await held(sine([effect('eq')]), 69))[0];
  expect(peak(sum(flatEq, dry, -1))).toBeLessThan(peak(dry) * 1e-4);

  // Quietly, so that a boost stays clear of the master's soft clipper.
  const gain = async (params: Params, note: number) =>
    db((await level(sine([effect('eq', params)]), note, 0.3)) / (await level(sine([]), note, 0.3)));
  // Notes 21, 33, 69, 84 and 105 are 27.5 Hz, 55 Hz, 440 Hz, 1047 Hz and 3520 Hz; 117 is 7040 Hz.
  // The shelves are gentle: +12 dB at 200 Hz is +10 dB at 55 Hz and the full 12 an octave further down.
  expect(await gain({ low: 12 }, 21)).toBeCloseTo(12, 0);
  expect(await gain({ low: 12 }, 33)).toBeGreaterThan(9);
  expect(Math.abs(await gain({ low: 12 }, 84))).toBeLessThan(1);
  expect(await gain({ high: -12 }, 117)).toBeLessThan(-9);
  expect(Math.abs(await gain({ high: -12 }, 69))).toBeLessThan(1);
  expect(await gain({ mid: 12 }, 84)).toBeCloseTo(12, 0);
  expect(Math.abs(await gain({ mid: 12 }, 33))).toBeLessThan(1);
  expect(await gain({ mid: -12, freq: 440 }, 69)).toBeCloseTo(-12, 0);
  expect(await gain({ mid: -12, freq: 440 }, 105)).toBeGreaterThan(-3);
  // A low cut at 220 Hz takes two octaves below it down by about 24 dB and keeps the middle.
  expect(await gain({ lowcut: 220 }, 33)).toBeLessThan(-20);
  expect(Math.abs(await gain({ lowcut: 220 }, 84))).toBeLessThan(0.5);
});

test('the chorus wobbles the pitch and spreads it out, and at depth 0 it is a clean, steady copy', async () => {
  const windows = (d: Float32Array) => Array.from({ length: 8 }, (_, i) => freq(slice(d, 0.05 * i, 0.05 * i + 0.05)));
  const [still, stillR] = await held(sine([effect('chorus', { depth: 0, mix: 1, spread: 0 })]), 69);
  for (const f of windows(still)) expect(f).toBeCloseTo(440, 0);
  expect(peak(sum(still, stillR, -1))).toBeLessThan(1e-6);
  const levels = Array.from({ length: 8 }, (_, i) => rms(slice(still, 0.05 * i, 0.05 * i + 0.05)));
  expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(1.001);

  const [l, r] = await held(sine([effect('chorus', { depth: 1, rate: 3, mix: 1, spread: 1 })]), 69);
  const fs = windows(l);
  expect(Math.max(...fs) - Math.min(...fs)).toBeGreaterThan(20);
  expect(rms(sum(l, r, -1))).toBeGreaterThan(0.5 * rms(l));
});

test('the phaser notches the sound where its all-passes turn it over, and the notches move', async () => {
  // With the sweep still, four stages around 600 Hz notch near 248 Hz (note 59) and pass 600 Hz (note 74);
  // eight stages notch near 119 Hz (note 46) instead.
  const still = (params: Params) => sine([effect('phaser', { depth: 0, feedback: 0, mix: 0.5, ...params })]);
  const gain = async (params: Params, note: number) =>
    db((await level(still(params), note)) / (await level(sine([]), note)));
  expect(await gain({}, 59)).toBeLessThan(-20);
  expect(Math.abs(await gain({}, 74))).toBeLessThan(1);
  expect(await gain({ stages: '8' }, 46)).toBeLessThan(-20);
  expect(await gain({ stages: '8' }, 59)).toBeGreaterThan(-6);
  // Feedback lifts the peaks between the notches.
  expect((await gain({ feedback: 0.6 }, 74)) - (await gain({}, 74))).toBeGreaterThan(3);

  const sweep = async (depth: number) => {
    const pcm = await renderSound(sine([effect('phaser', { depth, rate: 1, feedback: 0, mix: 0.5 })]), {}, {
      note: 59, vel: 1, dur: 2.2, tail: 0.1,
    });
    const levels = Array.from({ length: 40 }, (_, i) => db(rms(slice(pcm.channels[0], 0.1 + 0.05 * i, 0.15 + 0.05 * i))));
    return Math.max(...levels) - Math.min(...levels);
  };
  expect(await sweep(0)).toBeLessThan(0.5);
  expect(await sweep(0.7)).toBeGreaterThan(10);
});

test('a synced phaser sweeps once per note value at the tempo', async () => {
  // One bar at 120 bpm is 2 s, at 90 bpm 2.67 s.
  const render = async (params: Params, bpm: number) => {
    const s = sine([effect('phaser', { depth: 0.7, ...params })]);
    return notes(s, [[59, 0, 2]], 2.2, { bpm });
  };
  expect(await render({ sync: '1bar' }, 120)).toEqual(await render({ rate: 0.5 }, 120));
  expect(await render({ sync: '1bar' }, 90)).toEqual(await render({ rate: 0.375 }, 90));
  expect(await render({ sync: '1bar' }, 90)).not.toEqual(await render({ rate: 0.5 }, 90));
});

test('the ring modulator makes sum and difference tones, and a tremolo at a few hertz', async () => {
  // A 440 Hz sine (note 69) times 300 Hz: 140 Hz and 740 Hz, and no 440 Hz.
  const [d] = await held(sine([effect('ring', { freq: 300, mix: 1 })]), 69);
  const a = amplitudeAt(d, 140);
  expect(amplitudeAt(d, 740) / a).toBeCloseTo(1, 1);
  expect(amplitudeAt(d, 440) / a).toBeLessThan(0.01);
  expect(rms(d) / a).toBeCloseTo(1, 1);

  // At 4 Hz and half mix the gain is (1 + sin) / 2: full a sixteenth of a second after the carrier starts at 0,
  // silent a quarter cycle later, every quarter second.
  const pcm = await renderSound(sine([effect('ring', { freq: 4, mix: 0.5 })]), {}, { note: 69, vel: 1, dur: 1, tail: 0 });
  const at = (t: number) => rms(slice(pcm.channels[0], t - 0.01, t + 0.01));
  for (const k of [1, 2, 3]) {
    expect(db(at(0.0625 + 0.25 * k) / at(0.1875 + 0.25 * k))).toBeGreaterThan(20);
  }
});

test('width 0 is mono, 100 % is unchanged, 200 % doubles the side, and bass mono keeps the bass centred', async () => {
  const [l, r] = await held(stereo([]), 57);
  const side = rms(sum(l, r, -1));
  const mid = rms(sum(l, r));
  expect(side).toBeGreaterThan(0.2 * mid);

  const [l0, r0] = await held(stereo([effect('width', { width: 0 })]), 57);
  expect(peak(sum(l0, r0, -1))).toBeLessThan(1e-6);
  expect(rms(sum(l0, r0)) / mid).toBeCloseTo(1, 3);

  const [l1, r1] = await held(stereo([effect('width')]), 57);
  expect(peak(sum(l1, l, -1))).toBeLessThan(1e-5);
  expect(peak(sum(r1, r, -1))).toBeLessThan(1e-5);

  const [l2, r2] = await held(stereo([effect('width', { width: 2 })]), 57);
  expect(rms(sum(l2, r2, -1)) / side).toBeCloseTo(2, 2);
  expect(rms(sum(l2, r2)) / mid).toBeCloseTo(1, 3);

  // A tone at 55 Hz (note 33) loses its side with Bass Mono at 300 Hz; one at 1760 Hz (note 93) keeps it.
  const sideAt = async (note: number, bass: number) => {
    const [a, b] = await held(sound('osc', { wave: 'sine', voices: 3, spread: 40, width: 1 }, {
      amp: flat, chain: [effect('width', { width: 2, bass })], out: { level: -12 },
    }), note);
    return rms(sum(a, b, -1)) / rms(sum(a, b));
  };
  expect(db((await sideAt(33, 300)) / (await sideAt(33, 20)))).toBeLessThan(-20);
  expect(Math.abs(db((await sideAt(93, 300)) / (await sideAt(93, 20))))).toBeLessThan(0.5);
});

test('the delay low cut leaves the first repeat whole and thins every later one', async () => {
  // A 5 ms blip of 110 Hz (note 45) with repeats every 0.25 s.
  const repeats = async (lowcut: number) => {
    const s = sound('osc', { wave: 'sine' }, {
      amp: adsr(0.001, 0.1, 1, 0),
      chain: [effect('delay', { sync: 'free', time: 0.25, feedback: 0.7, mix: 1, tone: 20000, lowcut })],
      out: { level: -6 },
    });
    const pcm = await renderSound(s, {}, { note: 45, vel: 1, dur: 0.04, tail: 1.2 });
    return [1, 2, 3].map((k) => peak(slice(pcm.channels[0], k * 0.25, k * 0.25 + 0.06)));
  };
  const whole = await repeats(20);
  const thin = await repeats(400);
  expect(db(thin[0] / whole[0])).toBeCloseTo(0, 1);
  expect(db(thin[1] / whole[1])).toBeLessThan(-6);
  expect(db(thin[2] / whole[2])).toBeLessThan(db(thin[1] / whole[1]) - 3);
});

test('turning the new controls while a note sounds does not click', async () => {
  const s = (m: ModuleInst) => sine([m]);
  const comp = effect('compressor', { attack: 0.002 });
  await noClick(s(comp), [withParams(comp, { threshold: -40, ratio: 12, makeup: 12, mix: 0.5 })]);
  const eq = effect('eq');
  await noClick(s(eq), [withParams(eq, { low: 12, mid: -12, freq: 300, high: 12, lowcut: 300 })]);
  const chorus = effect('chorus');
  await noClick(s(chorus), [withParams(chorus, { depth: 1, rate: 4, spread: 0, mix: 1 })]);
  const phaser = effect('phaser');
  await noClick(s(phaser), [withParams(phaser, { stages: '8', feedback: 0.8, depth: 1, mix: 0.8 })]);
  const ring = effect('ring', { freq: 30, mix: 0 });
  await noClick(s(ring), [withParams(ring, { mix: 1 })]);
  const width = effect('width');
  await noClick(stereo([width]), [withParams(width, { width: 0, bass: 300 })]);
  const delay = effect('delay', { feedback: 0.6, mix: 0.5 });
  await noClick(s(delay), [withParams(delay, { lowcut: 800 })]);
});

test('a render rings out for the short tails of the chorus, the compressor and the phaser', () => {
  // A long release, so the tail is above the 6 s minimum.
  const base = { ...sine([]), amp: adsr(0.002, 0.1, 1, 8) };
  const tail = (type: string) => ringOut([{ ...base, chain: [effect(type)] }], 120) - ringOut([base], 120);
  expect(tail('phaser')).toBeCloseTo(0.25, 6);
  expect(tail('chorus')).toBeCloseTo(0.015, 6);
  expect(tail('compressor')).toBeCloseTo(0.006, 6);
  for (const type of ['eq', 'ring', 'width']) expect(tail(type), type).toBe(0);
});
