// The path inside every note: the filter, per-note modulators, play modes and glide, and the oscillator's second
// oscillator, sub and pulse width.

import { expect, test } from 'vitest';
import { Engine, renderSound } from '../../src/audio';
import { defaultParams } from '../../src/core/params';
import { FILTER } from '../../src/core/modules';
import { STOCK_SHAPES, encodeShape } from '../../src/core/shape';
import type { ModInst, Params, Sound } from '../../src/core/types';
import { preset } from '../../src/presets';
import {
  adsr, amplitudeAt, db, expectEnergy, freq, maxJump, mod, notes, onset, peak, project, rms, slice, sound, SR, tone,
  wav,
} from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);
const filter = (params: Params = {}): Params => ({ ...defaultParams(FILTER), on: true, reso: 0, ...params });
const play = (mode: string, glide = 0): Params => ({ mode, glide });
const perNote = (m: ModInst): ModInst => ({ ...m, per: 'note' });

/** Level of a sine through the voice filter, against the same sine unfiltered. */
async function through(params: Params, note: number, vel = 1): Promise<number> {
  const level = async (f: Params) => {
    const s = sound('osc', { wave: 'sine' }, { amp: flat, out: { level: -6 } });
    const pcm = await renderSound({ ...s, filter: f }, {}, { note, vel, dur: 0.4, tail: 0.1 });
    return rms(slice(pcm.channels[0], 0.15, 0.35));
  };
  return db((await level(filter(params))) / (await level(defaultParams(FILTER))));
}

test('an old sound renders exactly as before the voice path existed', async () => {
  // Length and energy of the left channel, measured on the commit before this one.
  const pinned = [['Pluck', 118885, 9.581717755], ['Square Lead', 91284, 200.876290481]] as const;
  for (const [name, length, energy] of pinned) {
    const left = (await renderSound(preset(name), {}, { note: 48, dur: 0.5 })).channels[0];
    expect(left.length, name).toBe(length);
    expectEnergy(left, energy, name);
  }
});

test('the filter is off by default and passes the sound unchanged', async () => {
  const s = sound('osc', {}, { amp: flat });
  const a = await renderSound(s, {}, { dur: 0.3 });
  const b = await renderSound({ ...s, filter: { ...s.filter, cutoff: 100 } }, {}, { dur: 0.3 });
  expect(b.channels[0]).toEqual(a.channels[0]);
});

test('the filter keeps the bass and 24 dB falls off twice as steeply as 12 dB', async () => {
  // Cutoff 440 Hz; note 81 is 880 Hz, one octave above, note 93 two octaves above.
  expect(await through({ cutoff: 440 }, 45)).toBeGreaterThan(-1);
  const twelve = [await through({ cutoff: 440 }, 81), await through({ cutoff: 440 }, 93)];
  const four = [await through({ cutoff: 440, slope: '24' }, 81), await through({ cutoff: 440, slope: '24' }, 93)];
  expect(twelve[1] - twelve[0]).toBeLessThan(-10);
  expect(twelve[1] - twelve[0]).toBeGreaterThan(-14);
  expect(four[1] - four[0]).toBeLessThan(-21);
  expect(four[1] - four[0]).toBeGreaterThan(-27);
  expect(await through({ cutoff: 440, mode: 'highpass', slope: '24' }, 33)).toBeLessThan(-60);
});

test('key tracking moves the cutoff with the note and velocity moves it down for soft notes', async () => {
  // Without tracking a note two octaves above the cutoff is cut; with full tracking the cutoff follows from C3.
  expect(await through({ cutoff: 262 }, 84)).toBeLessThan(-20);
  const tracked = [await through({ cutoff: 262, key: 1 }, 84), await through({ cutoff: 262, key: 1 }, 60)];
  expect(Math.abs(tracked[0] - tracked[1])).toBeLessThan(1);
  expect(await through({ cutoff: 880, vel: 1 }, 81, 1)).toBeGreaterThan(-4);
  expect(await through({ cutoff: 880, vel: 1 }, 81, 0.5)).toBeLessThan(-18);
  expect(await through({ cutoff: 880, vel: -1 }, 81, 0.5)).toBeGreaterThan(-1);
});

test('drive in the filter adds harmonics and keeps the attack whole', async () => {
  const s = (drive: number) => ({
    ...sound('osc', { wave: 'sine' }, { amp: adsr(0.001, 0.2, 1, 0.05) }), filter: filter({ cutoff: 20000, drive }),
  });
  const clean = (await renderSound(s(0), {}, { note: 57, vel: 1, dur: 0.4 })).channels[0];
  const driven = (await renderSound(s(0.8), {}, { note: 57, vel: 1, dur: 0.4 })).channels[0];
  const third = (d: Float32Array) => amplitudeAt(slice(d, 0.1, 0.3), 660) / amplitudeAt(slice(d, 0.1, 0.3), 220);
  expect(third(clean)).toBeLessThan(0.001);
  expect(third(driven)).toBeGreaterThan(0.05);
  expect(Math.abs(db(rms(slice(driven, 0.1, 0.3)) / rms(slice(clean, 0.1, 0.3))))).toBeLessThan(3);
  // The shaper delays the sound by 128 samples and the amp envelope waits for it, so the attack is not skipped.
  const start = onset(driven, 0, 1e-3);
  expect(start - onset(clean, 0, 1e-3)).toBeCloseTo(128 / SR, 3);
  expect(peak(slice(driven, start, start + 0.0004))).toBeLessThan(0.5 * peak(slice(driven, 0.1, 0.2)));
});

test('overlapping notes each sweep their own filter with a per-note envelope and share a per-sound one', async () => {
  // A at 110 Hz, then B at 622 Hz; A's 8th harmonic (880 Hz) shows how far A's filter is open.
  const sweep = (per: 'note' | 'sound'): Sound => ({
    ...sound('osc', { wave: 'sawtooth' }, {
      amp: flat,
      mods: [{ ...mod('env', { module: 'filter', param: 'cutoff' }, 0.8, adsr(0, 0.08, 0, 0.1)), per }],
    }),
    filter: filter({ cutoff: 150 }),
  });
  const brightA = async (per: 'note' | 'sound', withB: boolean) => {
    const b: [number, number, number][] = withB ? [[75, 0.5, 0.5]] : [];
    const d = await notes(sweep(per), [[45, 0, 1], ...b], 1.2);
    return amplitudeAt(slice(d, 0.505, 0.545), 880);
  };
  const alone = await brightA('note', false);
  expect(await brightA('note', true)).toBeLessThan(1.5 * alone);
  expect(await brightA('sound', true)).toBeGreaterThan(5 * alone);
});

test('a per-note modulator scales with velocity as far as Velocity says', async () => {
  // An envelope on the pitch, amount 0.25: +12 semitones at full velocity.
  const env = (share: number) =>
    perNote(mod('env', { module: 'source', param: 'pitch' }, 0.25, { ...adsr(0, 1, 1, 0.1), vel: share }));
  const s = (share: number) => sound('osc', { wave: 'sine' }, { amp: flat, mods: [env(share)] });
  const top = async (share: number, vel: number) =>
    freq(slice(await notes(s(share), [[57, 0, 0.5, vel]], 0.5), 0.1, 0.4));
  expect(await top(0, 0.5)).toBeCloseTo(440, -1);
  expect(await top(1, 1)).toBeCloseTo(440, -1);
  expect(await top(1, 0.5)).toBeCloseTo(220 * 2 ** 0.5, -1);
});

test('mono cuts the note before; legato glides into a held note without starting the envelopes again', async () => {
  // A slow attack shows a restart: the level falls back to the start of the attack.
  const s = (mode: string) => ({
    ...sound('osc', { wave: 'sine' }, { amp: adsr(0.3, 0.1, 1, 0.05) }), play: play(mode),
  });
  const run = (mode: string) => notes(s(mode), [[57, 0, 0.8], [64, 0.5, 0.5]], 1.2);
  const [poly, mono, legato] = [await run('poly'), await run('mono'), await run('legato')];
  // Poly: both notes sound; mono and legato: only the second one.
  expect(amplitudeAt(slice(poly, 0.6, 0.75), 220)).toBeGreaterThan(0.2);
  for (const d of [mono, legato]) expect(amplitudeAt(slice(d, 0.6, 0.75), 220)).toBeLessThan(0.005);
  expect(rms(slice(mono, 0.51, 0.53))).toBeLessThan(0.3 * rms(slice(mono, 0.4, 0.48)));
  expect(rms(slice(legato, 0.51, 0.53))).toBeGreaterThan(0.9 * rms(slice(legato, 0.4, 0.48)));
  expect(Math.abs(freq(slice(legato, 0.6, 0.9)) / 329.63 - 1)).toBeLessThan(0.01);
  // A legato note that does not overlap the one before starts again.
  const apart = await notes(s('legato'), [[57, 0, 0.4], [64, 0.5, 0.5]], 1.2);
  expect(rms(slice(apart, 0.51, 0.53))).toBeLessThan(0.3 * rms(slice(apart, 0.3, 0.38)));
  expect(maxJump(legato)).toBeLessThan(0.05);
  expect(maxJump(mono)).toBeLessThan(0.05);
});

test('live keys play last-note priority: letting go of the newer key goes back to the older one', async () => {
  for (const mode of ['mono', 'legato']) {
    const s = { ...sound('osc', { wave: 'sine' }, { amp: adsr(0.002, 0.1, 1, 0.05) }), play: play(mode) };
    const d = await notes(s, [], 1.6, { live: [
      [0, (e) => e.noteOn('a', 57, 1)],
      [0.3, (e) => e.noteOn('a', 64, 1)],
      [0.6, (e) => e.noteOff('a', 64)],
      [0.9, (e) => e.noteOn('a', 69, 1)],
      [1.0, (e) => e.noteOff('a', 57)],
      [1.2, (e) => e.noteOff('a', 69)],
    ] });
    expect(Math.abs(freq(slice(d, 0.1, 0.3)) / 220 - 1), mode).toBeLessThan(0.01);
    expect(Math.abs(freq(slice(d, 0.35, 0.6)) / 329.63 - 1), mode).toBeLessThan(0.01);
    expect(Math.abs(freq(slice(d, 0.65, 0.9)) / 220 - 1), mode).toBeLessThan(0.01);
    expect(Math.abs(freq(slice(d, 0.95, 1.2)) / 440 - 1), mode).toBeLessThan(0.01);
    expect(peak(slice(d, 1.3, 1.6)), mode).toBe(0);
  }
});

test('glide reaches the new pitch in the set time for the oscillator, the fm pair and the sampler', async () => {
  // 220 Hz to 440 Hz over 0.2 s, straight in cents: 311 Hz halfway.
  const samples = { s1: { name: 'a.wav', bytes: wav(tone(2, 220, 0.5)) } };
  // The sample plays 220 Hz at C3, the others at A2.
  const sources: [string, Params, number][] = [
    ['osc', { wave: 'sine' }, 57], ['fm', { amount: 0, ratio: 1 }, 57], ['sample', { sample: 's1', mode: 'gate' }, 60],
  ];
  for (const [type, params, low] of sources) {
    const s = { ...sound(type, params, { amp: flat }), play: play('poly', 0.2) };
    const d = await notes(s, [[low, 0, 0.4], [low + 12, 0.5, 0.6]], 1.2, { samples });
    expect(Math.abs(freq(slice(d, 0.501, 0.515)) / 222 - 1), type).toBeLessThan(0.04);
    expect(Math.abs(freq(slice(d, 0.595, 0.605)) / 311 - 1), type).toBeLessThan(0.03);
    expect(Math.abs(freq(slice(d, 0.71, 1)) / 440 - 1), type).toBeLessThan(0.005);
  }
});

test('mono glides from the note it cuts, and the pulse width follows the glide', async () => {
  const s = { ...sound('osc', { wave: 'square', pw: 0.25 }, { amp: flat }), play: play('mono', 0.1) };
  const d = await notes(s, [[45, 0, 0.5], [57, 0.3, 0.5]], 1);
  expect(Math.abs(freq(slice(d, 0.3, 0.32)) / 110 - 1)).toBeLessThan(0.1);
  expect(Math.abs(freq(slice(d, 0.5, 0.8)) / 220 - 1)).toBeLessThan(0.01);
  // A quarter-width pulse keeps its missing fourth harmonic after the glide.
  const after = slice(d, 0.5, 0.8);
  expect(amplitudeAt(after, 880) / amplitudeAt(after, 220)).toBeLessThan(0.03);
  expect(amplitudeAt(after, 440) / amplitudeAt(after, 220)).toBeCloseTo(0.707, 1);
});

test('a forced slide ties a note into the one before without starting again, in any mode', async () => {
  const s = { ...sound('osc', { wave: 'sine' }, { amp: adsr(0.3, 0.1, 1, 0.05) }), play: play('poly') };
  const run = async (slide: boolean) => {
    const ctx = new OfflineAudioContext(2, Math.round(1.2 * SR), SR);
    const engine = new Engine(ctx);
    engine.setProject(project([{ id: 'a', sound: s }]));
    engine.play('a', 57, 1, 0, 0.5);
    engine.play('a', 69, 1, 0.5, 0.5, slide);
    return (await ctx.startRendering()).getChannelData(0);
  };
  const tied = await run(true);
  const fresh = await run(false);
  // Gliding over 60 ms: the 220 Hz note has gone to 440 Hz and kept its level.
  expect(Math.abs(freq(slice(tied, 0.58, 0.95)) / 440 - 1)).toBeLessThan(0.01);
  expect(amplitudeAt(slice(tied, 0.58, 0.95), 220)).toBeLessThan(0.005);
  expect(rms(slice(tied, 0.51, 0.53))).toBeGreaterThan(0.9 * rms(slice(tied, 0.4, 0.48)));
  expect(freq(slice(tied, 0.52, 0.54))).toBeLessThan(400);
  expect(rms(slice(fresh, 0.56, 0.58))).toBeLessThan(0.5 * rms(slice(fresh, 0.4, 0.48)));
});

test('the sub and the second oscillator sound at their pitches', async () => {
  const at = async (params: Params, f: number) => {
    const s = sound('osc', { wave: 'sine', ...params }, { amp: flat, out: { level: -12 } });
    const pcm = await renderSound(s, {}, { note: 69, vel: 1, dur: 0.5 });
    const d = slice(pcm.channels[0], 0.1, 0.45);
    return amplitudeAt(d, f) / amplitudeAt(d, 440);
  };
  expect(await at({ sub: 0.5 }, 220)).toBeCloseTo(0.5, 1);
  expect(await at({ sub: 1, subOct: -2 }, 110)).toBeCloseTo(1, 1);
  expect(await at({ sub: 1, subOct: -2 }, 220)).toBeLessThan(0.01);
  // Osc 2 a fifth up at half the mix: two equal sines.
  expect(await at({ mix2: 0.5, wave2: 'sine', pitch2: 7 }, 440 * 2 ** (7 / 12))).toBeCloseTo(1, 1);
  expect(await at({ mix2: 0.25, wave2: 'sine', pitch2: -12 }, 220)).toBeCloseTo(1 / 3, 1);
  // Unison applies to both oscillators.
  const unison = sound('osc', { wave: 'sine', voices: 3, spread: 30, width: 1, mix2: 1, wave2: 'sine' }, { amp: flat });
  const wide = await renderSound(unison, {}, { dur: 0.4 });
  expect(rms(slice(wide.channels[0], 0.1, 0.35).map((v, i) => v - wide.channels[1][i + 4410]))).toBeGreaterThan(0.05);
});

test('pulse width changes the harmonics, 50 % is the square, and moving it does not click', async () => {
  const spectrum = async (params: Params, mods: ModInst[] = []) => {
    const s = sound('osc', { wave: 'square', ...params }, { amp: flat, mods });
    const pcm = await renderSound(s, {}, { note: 45, vel: 1, dur: 0.5 });
    const d = slice(pcm.channels[0], 0.1, 0.45);
    return [1, 2, 3, 4, 5, 7, 9].map((k) => amplitudeAt(d, 110 * k));
  };
  // An LFO at amount 0 on the width builds the pulse at 50 % without moving it.
  const still = mod('lfo', { module: 'source', param: 'pw' }, 0, { rate: 3 });
  const square = await spectrum({});
  const pulse50 = await spectrum({}, [still]);
  [0, 2, 4, 5, 6].forEach((k) => expect(Math.abs(db(pulse50[k] / square[k])), `harmonic ${k}`).toBeLessThan(0.3));
  expect(pulse50[1] / pulse50[0]).toBeLessThan(0.01);
  const quarter = await spectrum({ pw: 0.25 });
  expect(quarter[1] / quarter[0]).toBeCloseTo(0.707, 1);
  expect(quarter[3] / quarter[0]).toBeLessThan(0.02);
  const thin = await spectrum({ pw: 0.1 });
  expect(thin[1] / thin[0]).toBeGreaterThan(0.8);

  // A slow sweep of the width: the fizz of every cycle stays even, with no spike in any of them.
  const sweep = mod('lfo', { module: 'source', param: 'pw' }, 0.8, { rate: 1 });
  const swept = sound('osc', { wave: 'square' }, { amp: flat, mods: [sweep] });
  const pcm = await renderSound(swept, {}, { note: 45, vel: 1, dur: 1 });
  const d = slice(pcm.channels[0], 0.05, 0.95);
  const n = Math.round(SR / 110);
  const fizz = Array.from({ length: Math.floor(d.length / n) - 1 }, (_, k) => {
    const w = d.subarray(k * n, k * n + n);
    return rms(w.map((v, i) => (i ? v - w[i - 1] : 0)));
  });
  const sorted = [...fizz].sort((a, b) => a - b);
  expect(sorted.at(-1)! / sorted[Math.floor(sorted.length / 2)]).toBeLessThan(1.3);
  // The width really moves: the second harmonic is there at 90 % and gone at 50 %.
  const second = [0.21, 0.46].map((t) => amplitudeAt(slice(pcm.channels[0], t, t + 0.08), 220));
  expect(Math.max(...second) / Math.min(...second)).toBeGreaterThan(3);
});

test('24 voices with every part of the voice switched on render well faster than real time', async () => {
  const heavy: Sound = {
    ...sound('osc', { wave: 'square', mix2: 0.5, wave2: 'sawtooth', fine2: 9, sub: 0.5, pw: 0.3 }, {
      amp: adsr(0.01, 0.3, 0.7, 0.3),
      mods: [
        perNote(mod('env', { module: 'filter', param: 'cutoff' }, 0.4, adsr(0, 0.4, 0.2, 0.3))),
        perNote(mod('lfo', { module: 'source', param: 'pw' }, 0.3, { rate: 3 })),
      ],
      out: { level: -24 },
    }),
    filter: filter({ cutoff: 600, reso: 0.4, slope: '24', drive: 0.4, key: 0.5 }),
  };
  const seconds = 6;
  const p = project([{ id: 'a', sound: heavy }]);
  const ctx = new OfflineAudioContext(2, seconds * SR, SR);
  const engine = new Engine(ctx);
  engine.setProject(p);
  for (let i = 0; i < 24; i++) engine.play('a', 36 + i * 2, 0.8, i * 0.01, seconds - 1);
  const t0 = performance.now();
  const d = (await ctx.startRendering()).getChannelData(0);
  const ratio = (performance.now() - t0) / 1000 / seconds;
  expect(rms(slice(d, 1, 4))).toBeGreaterThan(0.01);
  // The test node is shared with other jobs, so the bound leaves room for a busy machine.
  expect(ratio).toBeLessThan(0.75);
});

test('a drawn sine plays like the sine oscillator', async () => {
  const play = async (params: Params) => {
    const s = sound('osc', params, { amp: flat, out: { level: -6 } });
    return (await renderSound(s, {}, { note: 69, dur: 0.3 })).channels[0];
  };
  const sine = await play({ wave: 'sine' });
  const drawn = await play({ wave: 'draw', shape: encodeShape(STOCK_SHAPES.sine) });
  expect(peak(sine.map((v, i) => v - drawn[i]))).toBeLessThan(0.002 * peak(sine));
});

test('a drawn saw has the harmonics of a saw and nothing folds back from above Nyquist', async () => {
  const shape = encodeShape(STOCK_SHAPES.sawtooth);
  const saw = sound('osc', { wave: 'draw', shape }, { amp: flat, out: { level: -6 } });
  const low = slice((await renderSound(saw, {}, { note: 45, dur: 0.5 })).channels[0], 0.1, 0.45);
  for (let k = 2; k <= 12; k++) {
    expect(Math.abs(db((k * amplitudeAt(low, 110 * k)) / amplitudeAt(low, 110))), `harmonic ${k}`).toBeLessThan(1);
  }
  // At 4186 Hz only five harmonics fit below Nyquist, which the drawn saw keeps as the stock one does; the next five
  // would fold back to the frequencies below.
  const high = async (s: Sound) => slice((await renderSound(s, {}, { note: 108, dur: 0.5 })).channels[0], 0.1, 0.45);
  const drawn = await high(saw);
  const stock = await high(sound('osc', { wave: 'sawtooth' }, { amp: flat, out: { level: -6 } }));
  const f = 4186.01;
  const rel = (d: Float32Array, k: number) => db(amplitudeAt(d, k * f) / amplitudeAt(d, f));
  for (let k = 2; k <= 4; k++) expect(Math.abs(rel(drawn, k) - rel(stock, k)), `harmonic ${k}`).toBeLessThan(1);
  for (let k = 6; k <= 10; k++) {
    expect(amplitudeAt(drawn, SR - k * f) / amplitudeAt(drawn, f), `harmonic ${k}`).toBeLessThan(1e-3);
  }
});

test('drawing again while a note is held changes it without a click', async () => {
  const s = (shape: number[]) =>
    sound('osc', { wave: 'draw', shape: encodeShape(shape) }, { amp: flat, out: { level: -6 } });
  const redrawn = project([{ id: 'a', sound: s(STOCK_SHAPES.triangle) }]);
  const d = await notes(s(STOCK_SHAPES.sine), [[57, 0, 1]], 1, { live: [[0.5, (e) => e.setProject(redrawn)]] });
  const third = (t: number) => amplitudeAt(slice(d, t, t + 0.3), 660) / amplitudeAt(slice(d, t, t + 0.3), 220);
  expect(third(0.1)).toBeLessThan(0.01);
  // A triangle's third harmonic is a ninth of its first.
  expect(third(0.6)).toBeCloseTo(1 / 9, 1);
  expect(maxJump(slice(d, 0.45, 0.6))).toBeLessThan(1.2 * maxJump(slice(d, 0.1, 0.4)));
});
