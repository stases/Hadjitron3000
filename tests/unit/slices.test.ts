import { expect, test } from 'vitest';
import { rng } from '../../src/audio/random';
import { BREAK_BPM } from '../../src/presets/samples';
import { detectOnsets, riseFor, sliceBounds, sliceNotes } from '../../src/core/slices';

const SR = 44100;

/** `seconds` of silence with `hit` added at each of `times`, scaled by its level. */
function pattern(seconds: number, hits: [time: number, hit: Float32Array, level: number][]): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (const [time, hit, level] of hits) {
    const at = Math.round(time * SR);
    hit.forEach((v, i) => {
      if (at + i < out.length) out[at + i] += level * v;
    });
  }
  return out;
}

const noise = rng(9);
const decay = (seconds: number, tau: number, wave: (t: number) => number) =>
  Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => wave(i / SR) * Math.exp(-i / SR / tau));
// A kick that falls from 150 to 50 Hz, a noisy snare and a short bright hat.
const kick = () => {
  let phase = 0;
  return decay(0.4, 0.15, (t) => Math.sin((phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / SR)));
};
const snare = () => decay(0.25, 0.08, (t) => 0.5 * Math.sin(2 * Math.PI * 190 * t) + 0.5 * noise());
const hat = () => {
  let last = 0;
  return decay(0.08, 0.02, () => {
    const n = noise();
    const d = n - last;
    last = n;
    return 0.4 * d;
  });
};

const near = (found: number[], want: number[], ms: number) =>
  found.length === want.length && found.every((t, i) => Math.abs(t - want[i]) <= ms / 1000);

test('single clicks are found where they are, within a millisecond, and silence has none', () => {
  const times = [0.1, 0.35, 0.36 + 0.05, 0.8];
  const click = Float32Array.from({ length: 30 }, (_, i) => (i % 2 ? -1 : 1) * 0.8 * (1 - i / 30));
  const found = detectOnsets([pattern(1, times.map((t) => [t, click, 1]))], SR).map((o) => o.time);
  expect(near(found, times, 1), found.join()).toBe(true);
  expect(detectOnsets([new Float32Array(SR)], SR)).toEqual([]);
});

test('the hits of a drum pattern are found within 3 ms, hats on the tails of kicks included', () => {
  // Sixteenths at 128 BPM: kicks on the beats, a snare on two and four, hats on the off-beat sixteenths.
  const step = 60 / 128 / 4;
  const hits: [number, Float32Array, number][] = [];
  for (let s = 0; s < 32; s++) {
    if (s % 4 === 0) hits.push([s * step, kick(), 1]);
    if (s % 8 === 4) hits.push([s * step, snare(), 0.8]);
    if (s % 2 === 1) hits.push([s * step, hat(), 0.5]);
  }
  const want = [...new Set(hits.map(([t]) => t))].sort((a, b) => a - b);
  const data = pattern(32 * step + 0.3, hits);
  const found = detectOnsets([data, data], SR).filter((o) => o.rise >= riseFor(0.5)).map((o) => o.time);
  expect(near(found, want, 3), found.map((t) => t.toFixed(4)).join()).toBe(true);
});

test('sensitivity decides how small a hit makes a slice', () => {
  // A burst of noise fading out, and a softer one on its tail, which lifts the level by about 4.5 dB.
  const burst = (level: number) => decay(0.6, 0.3, () => level * noise());
  const data = pattern(1, [[0.1, burst(0.3), 1], [0.4, burst(0.15), 1]]);
  const onsets = detectOnsets([data], SR);
  const at = (sens: number) => sliceBounds(0, 1, 'hits', onsets, sens)!.slice(1, -1).map((t) => Math.round(t * 100));
  expect(at(1)).toEqual([10, 40]);
  expect(at(0.5)).toEqual([10]);
  expect(at(0)).toEqual([10]);
});

test('finding the hits of ten seconds of stereo takes a few milliseconds', () => {
  const step = 0.125;
  const hits: [number, Float32Array, number][] = Array.from({ length: 80 }, (_, k) => [k * step, k % 2 ? hat() : kick(), 1]);
  const data = pattern(10, hits);
  detectOnsets([data, data], SR);
  const t0 = performance.now();
  detectOnsets([data, data.slice()], SR);
  const ms = performance.now() - t0;
  console.log(`hits of 10 s of stereo: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(200);
});

test('equal slices cut the region evenly, hits cut it at the onsets inside it, Off does not cut', () => {
  expect(sliceBounds(1, 3, '4', [], 0.5)).toEqual([1, 1.5, 2, 2.5, 3]);
  expect(sliceBounds(0, 1, 'off', [], 0.5)).toBeNull();
  const onsets = [0.2, 0.5, 0.505, 0.9, 1.4].map((time) => ({ time, rise: 20 }));
  // A hit on the region's start or end, or past it, makes no sliver.
  expect(sliceBounds(0.5, 1.2, 'hits', onsets, 0.5)).toEqual([0.5, 0.9, 1.2]);
  expect(sliceBounds(0.5, 1.2, 'hits', onsets, 0)).toEqual([0.5, 1.2]);
});

test('slices are laid out as notes from C3 up, on the nearest step at the tempo, each lasting to the next', () => {
  // At 120 BPM a step is 0.125 s.
  const { notes, ticks } = sliceNotes([1, 1.25, 1.4, 1.74, 2], 1, 120);
  expect(notes).toEqual([
    { start: 0, len: 48, note: 60, vel: 0.8 },
    { start: 48, len: 24, note: 61, vel: 0.8 },
    { start: 72, len: 72, note: 62, vel: 0.8 },
    { start: 144, len: 48, note: 63, vel: 0.8 },
  ]);
  expect(ticks).toBe(192);
  // Played an octave up, they come twice as fast.
  expect(sliceNotes([0, 0.5, 1], 2, 120).notes.map((n) => n.start)).toEqual([0, 48]);
  // Two slices on the same step both stay, a step long each.
  expect(sliceNotes([0, 0.01, 0.5], 1, 120).notes.map((n) => [n.start, n.len])).toEqual([[0, 24], [0, 96]]);
});

test('the hits of the factory break are its steps', async () => {
  const { factorySample } = await import('../../src/presets/samples');
  const bytes = factorySample('break').sample.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const data = Float32Array.from({ length: (bytes.length - 44) / 2 }, (_, i) => view.getInt16(44 + 2 * i, true) / 32768);
  const step = 60 / BREAK_BPM / 4;
  const found = detectOnsets([data], SR).filter((o) => o.rise >= riseFor(0.5)).map((o) => o.time);
  expect(near(found, [0, 2, 4, 6, 7, 8, 10, 11, 12, 14, 15].map((s) => s * step), 3), found.join()).toBe(true);
});
