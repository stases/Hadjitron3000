// Automation of the song and locks of notes in rendered audio: smooth sweeps, buses, sends, the master, locked notes,
// and the same points live as in an export.

import { afterEach, expect, test, vi } from 'vitest';
import { Engine, Transport, renderProject } from '../../src/audio';
import { pointsValue, refKey, refSpec } from '../../src/core/automation';
import { newBusModule, newModule } from '../../src/core/defaults';
import { fromNorm, toNorm } from '../../src/core/params';
import type { AutoRow, Lock, Note, ParamRef, PlayScope, Project, Sound } from '../../src/core/types';
import { adsr, amplitudeAt, db, freq, oldDemo, peak, project, rms, slice, sound } from './helpers';

const song = { kind: 'song' } as const;
const flat = adsr(0.005, 0.1, 1, 0.05);
const sine = (extra: Partial<Sound> = {}) => sound('osc', { wave: 'sine' }, { amp: flat, out: { level: -6 }, ...extra });
const saw = (extra: Partial<Sound> = {}) => sound('osc', { wave: 'sawtooth' }, { amp: flat, out: { level: -12 }, ...extra });
const level = (d: Float32Array, t: number) => rms(slice(d, t - 0.05, t + 0.05));

/** At 240 BPM a bar is a second and has 384 ticks. */
const BAR = 384;

/** Channel a plays `notes` in a one-bar block, placed for `bars` bars, at 240 BPM; empty buses. */
function songOf(s: Sound, notes: Note[], bars: number, extra: Partial<Project> = {}): Project {
  const p = project([{ id: 'a', sound: s }], {}, { bpm: 240, ...extra });
  p.mixer = { ...p.mixer, buses: [{ ...p.mixer.buses[0], chain: [] }, { ...p.mixer.buses[1], chain: [] }] };
  p.patterns[0].notes = { a: notes };
  p.song = [{ id: 's', pattern: p.patterns[0].id, lane: 0, bar: 0, bars }];
  return p;
}

const drone = (note = 57): Note => ({ id: 'n', start: 0, len: 24, note, vel: 1, hold: true });

/** A row from `from` to `to` (in the parameter's units) between two bars. */
function row(p: Project, target: ParamRef, [b0, from]: [number, number], [b1, to]: [number, number]): AutoRow {
  const spec = refSpec(p, target)!;
  return { id: `r${refKey(target)}`, target, points: [[b0 * BAR, toNorm(spec, from)], [b1 * BAR, toNorm(spec, to)]] };
}

const render = async (p: Project, scope: PlayScope = song) => (await renderProject(p, scope, { tail: 0 })).channels[0];

/** Largest second difference of the samples, a measure of edges: a smooth signal at f has about (2 pi f / sr)^2. */
function maxBend(d: Float32Array): number {
  let m = 0;
  for (let i = 2; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - 2 * d[i - 1] + d[i - 2]));
  return m;
}

test('a cutoff row sweeps the spectrum open from bar to bar, without zipper noise', async () => {
  const filter = (s: Sound) => ({ ...s, filter: { ...s.filter, on: true, mode: 'lowpass', cutoff: 2000, reso: 0 } });
  const target = { owner: 'a', module: 'filter', param: 'cutoff' };
  const sweep = (s: Sound) => {
    const p = songOf(filter(s), [drone(45)], 4);
    p.automation = [row(p, target, [0, 150], [4, 6000])];
    return p;
  };
  const bright = await render(sweep(saw()));
  // The tenth harmonic of 110 Hz grows every half second until the cutoff passes it, a little after two seconds.
  const harmonic = [0.5, 1, 1.5, 2, 3.5].map((t) => amplitudeAt(slice(bright, t - 0.2, t + 0.2), 1100));
  for (let i = 1; i < harmonic.length; i++) expect(harmonic[i]).toBeGreaterThan(harmonic[i - 1]);
  expect(db(harmonic[4] / harmonic[0])).toBeGreaterThan(20);
  // A sine of 110 Hz through the same sweep stays as smooth as a sine: no steps in its level or its phase.
  const smooth = await render(sweep(sine()));
  const body = slice(smooth, 0.1, 3.9);
  const w = (2 * Math.PI * 110) / 44100;
  expect(maxBend(body)).toBeLessThan(1.1 * w * w * peak(body));
});

test('the output level follows its row and holds the last value after it', async () => {
  const p = songOf(sine(), [drone()], 4);
  p.automation = [row(p, { owner: 'a', module: 'out', param: 'level' }, [1, -6], [3, -30])];
  const d = await render(p);
  const ref = level(d, 0.5);
  expect(db(level(d, 1.5) / ref)).toBeCloseTo(-6, 0);
  expect(db(level(d, 2) / ref)).toBeCloseTo(-12, 0);
  expect(db(level(d, 3.5) / ref)).toBeCloseTo(-24, 0);
  const w = (2 * Math.PI * 440) / 44100;
  const body = slice(d, 0.1, 3.9);
  expect(maxBend(body)).toBeLessThan(1.1 * w * w * peak(body));
});

test('a bus level row, a send row and the master level move what they should', async () => {
  const sent = (rowOf: (p: Project) => AutoRow, sends: [number, number]) => {
    const p = songOf(sine(), [drone()], 3);
    p.channels[0].sends = sends;
    p.automation = [rowOf(p)];
    return render(p);
  };
  // With an empty bus the sent sound adds to the dry one: twice as loud, +6 dB, at full send and level.
  const bus = await sent((p) => row(p, { owner: { rack: 0 }, module: 'out', param: 'level' }, [0, -48], [2, 0]), [1, 0]);
  expect(db(level(bus, 2.5) / level(bus, 0.1))).toBeCloseTo(6, 0);
  const send = await sent((p) => row(p, { owner: 'a', module: 'send', param: '1' }, [0, 0], [2, 1]), [0, 0]);
  expect(db(level(send, 2.5) / level(send, 0.1))).toBeCloseTo(6, 0);
  expect(level(send, 1) / level(send, 0.1)).toBeGreaterThan(1.3);
  const out: ParamRef = { owner: { rack: 'master' }, module: 'out', param: 'level' };
  const master = await sent((p) => row(p, out, [0, 0], [2, -12]), [0, 0]);
  // At 0.1 s the master is already 0.6 dB down.
  expect(db(level(master, 2.5) / level(master, 0.1))).toBeCloseTo(-11.4, 0);
});

test('an effect of a rack follows its row', async () => {
  const p = songOf(sine(), [drone()], 3);
  p.mixer.master.chain = [{ id: 'eq', type: 'eq', on: true, params: { low: 0, mid: 0, freq: 220, high: 0, lowcut: 20 } }];
  p.automation = [row(p, { owner: { rack: 'master' }, module: 'eq', param: 'mid' }, [0, 0], [2, -18])];
  const d = await render(p);
  // At 0.1 s the cut is already 0.9 dB deep.
  expect(db(level(d, 1) / level(d, 0.1))).toBeCloseTo(-8.1, 0);
  expect(db(level(d, 2.5) / level(d, 0.1))).toBeCloseTo(-17.1, 0);
});

test('a comb, made of a processor, follows its Freq row in straight lines, as smoothly as a sine', async () => {
  const comb = { ...newModule('comb'), id: 'cb', params: { ...newModule('comb').params, feedback: 0.5, damp: 0, mix: 1 } };
  const s = sine({ chain: [comb] });
  const target: ParamRef = { owner: 'a', module: 'cb', param: 'freq' };
  const p = songOf(s, [drone()], 3);
  p.automation = [row(p, target, [0, 300], [2, 3000])];
  const engine = new Engine(new OfflineAudioContext(2, 128, 44100));
  engine.setProject(p);
  expect(engine.ramps(target)).toBe(true);
  const moved = await render(p);
  // Each moment sounds like the comb held still at the value the row has then.
  const spec = refSpec(p, target)!;
  for (const t of [0.5, 1, 1.5]) {
    const freq = fromNorm(spec, pointsValue(p.automation[0].points, t * BAR));
    const held = songOf(sine({ chain: [{ ...comb, params: { ...comb.params, freq } }] }), [drone()], 3);
    expect(db(level(moved, t) / level(await render(held), t))).toBeCloseTo(0, 0);
  }
  expect(db(level(moved, 2.5) / level(moved, 0.75))).toBeGreaterThan(6);
  const w = (2 * Math.PI * 220) / 44100;
  const body = slice(moved, 0.1, 2.9);
  expect(maxBend(body)).toBeLessThan(1.5 * w * w * peak(body));
});

test('a crusher on a bus follows its Mix row', async () => {
  const p = songOf(sine(), [drone()], 3);
  p.channels[0].sends = [1, 0];
  p.mixer.buses[0].chain = [{ ...newBusModule('crusher', { bits: 3, mix: 0 }), id: 'cr' }];
  const target: ParamRef = { owner: { rack: 0 }, module: 'cr', param: 'mix' };
  p.automation = [row(p, target, [0, 0], [2, 1])];
  const engine = new Engine(new OfflineAudioContext(2, 128, 44100));
  engine.setProject(p);
  expect(engine.ramps(target)).toBe(true);
  const d = await render(p);
  // Three bits turn the bus's sine into steps whose odd harmonics grow with the mix, in straight lines.
  const third = (t: number) => amplitudeAt(slice(d, t - 0.2, t + 0.2), 3 * 220);
  expect(third(0.3)).toBeLessThan(third(1) / 2);
  expect(db(third(2.5) / third(1))).toBeCloseTo(6, 0);
});

test('a note locked to a low cutoff is dark while the note sounding with it is not', async () => {
  const s: Sound = { ...saw(), filter: { ...saw().filter, on: true, mode: 'lowpass', cutoff: 8000, reso: 0 } };
  const spec = refSpec(songOf(s, [], 1), { owner: 'a', module: 'filter', param: 'cutoff' })!;
  const lock: Lock = { target: { module: 'filter', param: 'cutoff' }, value: toNorm(spec, 200) };
  const chord = (locks?: Lock[]): Note[] => [
    { id: 'low', start: 0, len: 192, note: 43, vel: 1, ...(locks && { locks }) },
    { id: 'high', start: 0, len: 192, note: 50, vel: 1 },
  ];
  const locked = slice(await render(songOf(s, chord([lock]), 1)), 0.1, 0.45);
  const open = slice(await render(songOf(s, chord(), 1)), 0.1, 0.45);
  // The 20th harmonic of the low note, 1960 Hz, is gone; the 13th of the other, 1909 Hz, is untouched.
  expect(db(amplitudeAt(locked, 1960) / amplitudeAt(open, 1960))).toBeLessThan(-30);
  expect(db(amplitudeAt(locked, 1908.8) / amplitudeAt(open, 1908.8))).toBeCloseTo(0, 0);
});

test('a lock of the output level holds for its note and lets go at its end', async () => {
  const p = songOf(sine(), [], 1);
  const spec = refSpec(p, { owner: 'a', module: 'out', param: 'level' })!;
  const lock: Lock = { target: { module: 'out', param: 'level' }, value: toNorm(spec, -30) };
  const two = (locks?: Lock[]): Note[] => [
    { id: 'one', start: 0, len: 192, note: 69, vel: 1, ...(locks && { locks }) },
    { id: 'two', start: 192, len: 192, note: 69, vel: 1 },
  ];
  p.patterns[0].notes = { a: two([lock]) };
  const locked = await render(p);
  p.patterns[0].notes = { a: two() };
  const plain = await render(p);
  expect(db(level(locked, 0.25) / level(plain, 0.25))).toBeCloseTo(-24, 0);
  expect(db(level(locked, 0.75) / level(plain, 0.75))).toBeCloseTo(0, 1);
});

test('a row of a parameter that notes read when they start reaches each new note at its start', async () => {
  const p = songOf(sine(), [{ id: 'n', start: 0, len: 192, note: 57, vel: 1 }], 3);
  p.automation = [row(p, { owner: 'a', module: 'source', param: 'pitch' }, [0, 0], [2, 12])];
  const d = await render(p);
  expect(freq(slice(d, 0.1, 0.4))).toBeCloseTo(220, 0);
  expect(freq(slice(d, 1.1, 1.4))).toBeCloseTo(220 * 2 ** (6 / 12), 0);
  expect(freq(slice(d, 2.1, 2.4))).toBeCloseTo(440, 0);
});

test('a block on repeat plays without the automation', async () => {
  const p = songOf(sine(), [drone()], 1);
  const pattern = { kind: 'pattern', patternId: p.patterns[0].id } as const;
  const plain = await render(p, pattern);
  p.automation = [row(p, { owner: 'a', module: 'out', param: 'level' }, [0, -40], [1, -40])];
  expect(await render(p, pattern)).toEqual(plain);
  expect(db(level(await render(p), 0.5) / level(plain, 0.5))).toBeCloseTo(-34, 0);
});

test('a project without automation or locks renders as before, as does one with an empty row', { timeout: 60000 }, async () => {
  const p = oldDemo();
  const before = await renderProject(p, song, { tail: 0 });
  const target: ParamRef = { owner: { rack: 'master' }, module: 'out', param: 'level' };
  const empty = await renderProject({ ...p, automation: [{ id: 'r', target, points: [] }] }, song, { tail: 0 });
  expect(empty.channels[0]).toEqual(before.channels[0]);
  expect(empty.channels[1]).toEqual(before.channels[1]);
});

let live: AudioContext | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await live?.close();
  live = undefined;
});

test('live playback hands the engine the same automation points as an export', async () => {
  const locks = [{ target: { module: 'out', param: 'pan' }, value: 0 }];
  const p = songOf(sine(), [drone(), { id: 'x', start: 96, len: 96, note: 64, vel: 1, locks }], 4);
  p.automation = [row(p, { owner: 'a', module: 'out', param: 'level' }, [0, -6], [4, -30])];
  const calls: [string, number, number][] = [];
  vi.spyOn(Engine.prototype, 'automate').mockImplementation((ref, value, time) => {
    calls.push([refKey(ref), value, time]);
  });
  await render(p);
  const exported = calls.splice(0);
  live = new AudioContext();
  await live.resume();
  const engine = new Engine(live);
  engine.setProject(p);
  const transport = new Transport(engine, () => ({ project: p, scope: song }));
  transport.start();
  await new Promise((r) => setTimeout(r, 700));
  transport.stop();
  const origin = calls[0][2];
  expect(calls.length).toBeGreaterThan(40);
  expect(calls.map(([key, value, time]) => [key, value, time - origin]))
    .toEqual(exported.slice(0, calls.length).map(([key, value, time]) => [key, value, expect.closeTo(time, 9)]));
});
