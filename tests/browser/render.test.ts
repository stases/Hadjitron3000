import { expect, test } from 'vitest';
import { decodeSample, encodeMp3, renderProject, renderSound } from '../../src/audio';
import { TICKS_PER_STEP } from '../../src/core/defaults';
import { tickTime } from '../../src/core/sequencer';
import type { Project } from '../../src/core/types';
import { adsr, db, onset, project, rms, slice, sound, SR } from './helpers';

const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

const STEPS = [0, 3, 4, 9, 14];
const blips = (bpm: number, swing: number): Project =>
  project(
    [{ id: 'a', sound: sound('osc', { wave: 'sine' }, { amp: adsr(0.001, 0.1, 1, 0), out: { level: -6 } }) }],
    { a: Object.fromEntries(STEPS.map((s) => [s, { note: 81, vel: 1, len: 0.5 }])) },
    { bpm, swing },
  );
const scopeOf = (p: Project) => ({ kind: 'pattern', patternId: p.patterns[0].id }) as const;

test('note onsets land on the sequencer times, with and without swing', async () => {
  for (const [bpm, swing] of [
    [100, 0],
    [137, 0.6],
  ]) {
    const p = blips(bpm, swing);
    // Two loops at 100 bpm put steps 20 and 30 on 3.0 s and 4.5 s, where the renderer pauses to schedule.
    const pcm = await renderProject(p, scopeOf(p), { tail: 0, loops: 2 });
    for (const s of [...STEPS, ...STEPS.map((x) => x + 16)]) {
      const expected = tickTime(s * TICKS_PER_STEP, bpm, swing);
      expect(Math.abs(onset(pcm.channels[0], expected - 0.01) - expected), `step ${s} at ${bpm} bpm`).toBeLessThan(0.001);
    }
  }
});

test('tail 0 renders exactly the loop, loops 2 doubles it, and trailing silence is trimmed', async () => {
  const p = blips(100, 0);
  const loop = Math.round(16 * (15 / 100) * SR);
  const one = await renderProject(p, scopeOf(p), { tail: 0 });
  expect(one.channels[0].length).toBe(loop);
  const two = await renderProject(p, scopeOf(p), { tail: 0, loops: 2 });
  expect(two.channels[0].length).toBe(2 * loop);
  const second = two.channels[0].subarray(loop);
  expect(maxDiff(second, two.channels[0].subarray(0, loop))).toBeLessThan(1e-4);

  // A note on the last step rings 0.3 s past the loop end; the 6 s tail is cut to that plus 50 ms.
  const last = { id: 'n', start: 15 * TICKS_PER_STEP, len: TICKS_PER_STEP, note: 81, vel: 1 };
  const late = { ...p, patterns: [{ ...p.patterns[0], notes: { a: [last] } }] };
  late.channels = [{ ...p.channels[0], sound: { ...p.channels[0].sound, amp: adsr(0.001, 0.1, 1, 0.3) } }];
  const trimmed = await renderProject(late, scopeOf(late));
  const seconds = trimmed.channels[0].length / SR;
  expect(seconds).toBeGreaterThan(2.4 + 0.375);
  expect(seconds).toBeLessThan(2.4 + 0.375 + 0.06);
});

test('an export of a 7/8 block lasts its fourteen steps a bar, and its notes fall on them', async () => {
  const p = blips(100, 0);
  p.meter = [7, 8];
  p.patterns[0].bars = 2;
  const loop = Math.round(28 * (15 / 100) * SR);
  const two = await renderProject(p, scopeOf(p), { tail: 0, loops: 2 });
  expect(two.channels[0].length).toBe(2 * loop);
  // The second pass starts with the block's first note, 28 steps in.
  expect(onset(two.channels[0], loop / SR - 0.01)).toBeCloseTo(loop / SR, 2);
});

test('render progress advances during the render', async () => {
  const p = blips(100, 0);
  const seen: number[] = [];
  await renderProject(p, scopeOf(p), { tail: 0, loops: 2, onProgress: (f) => seen.push(f) });
  expect(seen.length).toBeGreaterThan(5);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(seen.at(-1)).toBe(1);
});

test('an empty scope renders nothing', async () => {
  const p = project([{ id: 'a', sound: sound('osc') }], {}, { song: [] });
  const pcm = await renderProject(p, { kind: 'song' }, { tail: 1 });
  expect(pcm.channels.map((c) => c.length)).toEqual([0, 0]);
});

test('mp3 output decodes back to the same duration and level', async () => {
  const pcm = await renderSound(sound('osc', { wave: 'sawtooth' }, { amp: adsr(0.01, 0.1, 1, 0.1), out: { level: -6 } }), {}, { note: 57, dur: 1.5 });
  const seen: number[] = [];
  const mp3 = await encodeMp3(pcm, 192, (f) => seen.push(f));
  expect(seen.length).toBeGreaterThan(3);
  expect(seen.at(-1)).toBe(1);
  const ctx = new OfflineAudioContext(2, 1, SR);
  const back = await ctx.decodeAudioData(mp3.slice().buffer);
  const seconds = pcm.channels[0].length / SR;
  expect(Math.abs(back.duration - seconds)).toBeLessThan(0.1);
  expect(Math.abs(db(rms(slice(back.getChannelData(0), 0.3, 1.3)) / rms(slice(pcm.channels[0], 0.3, 1.3))))).toBeLessThan(0.5);
});

test('decodeSample rejects bytes that are not audio', async () => {
  await expect(decodeSample('garbage', new Uint8Array(1000).fill(7))).rejects.toThrow();
});
