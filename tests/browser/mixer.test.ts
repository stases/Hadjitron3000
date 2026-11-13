import { expect, test } from 'vitest';
import { renderProject, renderSound } from '../../src/audio';
import type { Project } from '../../src/core/types';
import { adsr, amplitudeAt, db, peak, project, rms, slice, sound } from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.05);
const sine = (out = {}) => sound('osc', { wave: 'sine' }, { amp: flat, out });
const level = (pcm: { channels: Float32Array[] }, ch = 0) => rms(slice(pcm.channels[ch], 0.1, 0.4));

test('the output level is in decibels and its bottom is silence', async () => {
  const ref = await renderSound(sine({ level: -6 }), {}, { vel: 1, dur: 0.5 });
  const down = await renderSound(sine({ level: -18 }), {}, { vel: 1, dur: 0.5 });
  expect(db(level(down) / level(ref))).toBeCloseTo(-12, 1);
  const off = await renderSound(sine({ level: -48 }), {}, { vel: 1, dur: 0.5 });
  expect(peak(off.channels[0])).toBe(0);
});

test('pan follows the equal-power law', async () => {
  // At -6 dB a hard-panned full-scale sine stays below the master clipper's knee.
  const left = await renderSound(sine({ pan: -1, level: -6 }), {}, { vel: 1, dur: 0.5 });
  expect(level(left, 1)).toBeLessThan(1e-6);
  expect(level(left, 0)).toBeCloseTo(Math.SQRT1_2 * 10 ** (-6 / 20), 3);
  const right = await renderSound(sine({ pan: 0.5, level: -6 }), {}, { vel: 1, dur: 0.5 });
  expect(level(right, 0) / level(right, 1)).toBeCloseTo(Math.cos((3 * Math.PI) / 8) / Math.sin((3 * Math.PI) / 8), 2);
});

test('mute and solo decide which channels are heard', async () => {
  const two = (a: { mute?: boolean; solo?: boolean }, b: { mute?: boolean; solo?: boolean }): Project =>
    project(
      [
        { id: 'a', sound: sound('osc', { wave: 'sine' }, { amp: flat }), ...a },
        { id: 'b', sound: sound('osc', { wave: 'sine', pitch: 7 }, { amp: flat }), ...b },
      ],
      { a: { 0: { note: 69, vel: 1, len: 4 } }, b: { 0: { note: 69, vel: 1, len: 4 } } },
    );
  const heard = async (p: Project) => {
    const pcm = await renderProject(p, { kind: 'pattern', patternId: p.patterns[0].id }, { tail: 0 });
    const d = slice(pcm.channels[0], 0.1, 0.45);
    return [amplitudeAt(d, 440) > 0.1, amplitudeAt(d, 659.26) > 0.1];
  };
  expect(await heard(two({}, {}))).toEqual([true, true]);
  expect(await heard(two({ mute: true }, {}))).toEqual([false, true]);
  expect(await heard(two({}, { solo: true }))).toEqual([false, true]);
  expect(await heard(two({ solo: true, mute: true }, { solo: true }))).toEqual([true, true]);
  expect(await heard(two({ mute: true }, { mute: true }))).toEqual([false, false]);
});

test('the master clipper passes a quiet signal unchanged and keeps a hot one below full scale', async () => {
  const quiet = await renderSound(sine({ level: -6 }), {}, { vel: 1, dur: 0.5 });
  expect(peak(slice(quiet.channels[0], 0.1, 0.4))).toBeCloseTo(Math.SQRT1_2 * 10 ** (-6 / 20), 4);
  // Below the knee the clipper is linear: +3 dB in gives exactly +3 dB out.
  const louder = await renderSound(sine({ level: -3 }), {}, { vel: 1, dur: 0.5 });
  const g = 10 ** (3 / 20);
  let err = 0;
  for (let i = 0; i < quiet.channels[0].length; i++) err = Math.max(err, Math.abs(louder.channels[0][i] - g * quiet.channels[0][i]));
  expect(err).toBeLessThan(1e-5);

  const hot = await renderSound(sound('osc', { voices: 7, spread: 5 }, { amp: flat, out: { level: 6 } }), {}, { vel: 1, dur: 0.5 });
  const loud = await renderSound(sine({ level: 6 }), {}, { vel: 1, dur: 0.5 });
  for (const pcm of [hot, loud]) {
    expect(peak(pcm.channels[0])).toBeLessThanOrEqual(1);
    expect(peak(pcm.channels[0])).toBeGreaterThan(0.9);
  }
});
