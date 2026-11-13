import { afterEach, expect, test } from 'vitest';
import { Engine, Transport } from '../../src/audio';
import { stepSeconds } from '../../src/core/sequencer';
import type { PlayScope, Project } from '../../src/core/types';
import { adsr, peak, project, sound } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ctx: AudioContext;

afterEach(async () => {
  await ctx?.close();
});

async function setup(p: Project) {
  ctx = new AudioContext();
  await ctx.resume();
  const engine = new Engine(ctx);
  engine.setProject(p);
  const calls: number[] = [];
  const play = engine.play.bind(engine);
  engine.play = (channelId, note, vel, time, dur) => {
    calls.push(time);
    play(channelId, note, vel, time, dur);
  };
  const state: { project: Project; scope: PlayScope } = { project: p, scope: { kind: 'pattern', patternId: p.patterns[0].id } };
  return { engine, calls, state, transport: new Transport(engine, () => state) };
}

const everyStep = (bpm: number) =>
  project(
    [{ id: 'a', sound: sound('osc', { wave: 'sine' }, { amp: adsr(0.001, 0.02, 0.8, 0.02), out: { level: -6 } }) }],
    { a: Object.fromEntries(Array.from({ length: 16 }, (_, s) => [s, { note: 69, vel: 1, len: 0.5 }])) },
    { bpm },
  );

test('the transport schedules every step on time and reports the audible step', async () => {
  const { engine, calls, transport } = await setup(everyStep(240));
  const step = stepSeconds(240);
  expect(transport.position()).toBe(-1);
  transport.start();
  expect(transport.playing).toBe(true);
  await sleep(400);
  const t1 = ctx.currentTime;
  const p1 = transport.position();
  await sleep(400);
  const t2 = ctx.currentTime;
  const p2 = transport.position();
  // The position moves at the tempo: one step per 62.5 ms.
  expect(Math.abs(p2 - p1 - (t2 - t1) / step)).toBeLessThan(0.05);
  // Step 0 was scheduled at calls[0]; the audible step is the clock minus the output latency from there.
  expect(Math.abs(p2 - (t2 - (ctx.outputLatency || 0) - calls[0]) / step)).toBeLessThan(0.05);
  // Notes are scheduled up to 120 ms ahead of the clock, one per step, evenly spaced.
  expect(calls.length).toBeGreaterThan(p2);
  expect(calls.length).toBeLessThan(p2 + 0.12 / step + 2);
  for (let i = 1; i < calls.length; i++) expect(calls[i] - calls[i - 1]).toBeCloseTo(step, 9);
  // And they are heard.
  const [l, r] = engine.levels();
  expect(l).toBeGreaterThan(0.05);
  expect(r).toBeCloseTo(l, 2);
  const wave = new Float32Array(1024);
  engine.scope(wave);
  expect(peak(wave)).toBeGreaterThan(0.05);
  transport.stop();
  expect(transport.playing).toBe(false);
  expect(transport.position()).toBe(-1);
  const n = calls.length;
  await sleep(100);
  expect(calls.length).toBe(n);
});

test('a tempo change keeps the next step in place and continues at the new tempo', async () => {
  const { calls, state, transport } = await setup(everyStep(240));
  transport.start();
  await sleep(300);
  state.project = { ...state.project, bpm: 120 };
  const before = calls.length;
  await sleep(400);
  transport.stop();
  const gaps = calls.slice(1).map((t, i) => t - calls[i]);
  expect(gaps.slice(0, before - 1).every((g) => Math.abs(g - 0.0625) < 1e-9)).toBe(true);
  expect(gaps.slice(before).every((g) => Math.abs(g - 0.125) < 1e-9)).toBe(true);
  // The step after the change starts one old step after the last one: the beat does not jump.
  expect(gaps[before - 1]).toBeCloseTo(0.0625, 9);
});

test('with nothing to play the transport runs silently', async () => {
  const empty = project([{ id: 'a', sound: sound('osc') }], {}, { bpm: 120 });
  const { calls, state, transport } = await setup(empty);
  state.scope = { kind: 'song' };
  state.project = { ...empty, song: [] };
  transport.start();
  await sleep(300);
  expect(transport.position()).toBeGreaterThan(1);
  expect(calls).toEqual([]);
  transport.stop();
});

test('in 7/8 the block comes round every fourteen steps', async () => {
  const p = project([{ id: 'a', sound: sound('osc') }], { a: { 0: { note: 69, vel: 1, len: 0.5 } } }, { bpm: 240 });
  p.meter = [7, 8];
  const { calls, transport } = await setup(p);
  transport.start();
  await sleep(1100);
  transport.stop();
  expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(calls[1] - calls[0]).toBeCloseTo(14 * stepSeconds(240), 9);
});
