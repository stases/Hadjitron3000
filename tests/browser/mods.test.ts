import { expect, test } from 'vitest';
import { renderSound } from '../../src/audio';
import { modSource } from '../../src/audio/modules/modulators';
import { MODULES } from '../../src/core/modules';
import { defaultParams } from '../../src/core/params';
import type { ModInst, ModuleInst, Params, Sound } from '../../src/core/types';
import { adsr, effect, freq, maxJump, mod, notes, peak, project, rms, slice, sound, SR } from './helpers';

const flat = adsr(0.002, 0.1, 1, 0.02);
const sine = (mods: ModInst[], chain: ModuleInst[] = [], wave = 'sine') =>
  sound('osc', { wave }, { amp: flat, mods, chain, out: { level: -6 } });

test('an envelope on the source pitch sweeps it by amount x 48 semitones', async () => {
  // Amount 0.25 is +12 semitones at the top of the envelope.
  const held = await renderSound(sine([mod('env', { module: 'source', param: 'pitch' }, 0.25, adsr(0, 0.1, 1, 0.1))]), {}, { note: 69, dur: 0.5 });
  expect(Math.abs(freq(slice(held.channels[0], 0.05, 0.45)) / 880 - 1)).toBeLessThan(0.01);

  const sweep = sine([mod('env', { module: 'source', param: 'pitch' }, 0.25, adsr(0, 0.2, 0, 0.1))]);
  const pcm = await renderSound(sweep, {}, { note: 69, dur: 1 });
  const d = pcm.channels[0];
  expect(freq(slice(d, 0.002, 0.012))).toBeGreaterThan(800);
  // Halfway down the exponential decay (time constant 50 ms): 440 * 2^exp(-1).
  expect(Math.abs(freq(slice(d, 0.045, 0.055)) / (440 * 2 ** Math.exp(-1)) - 1)).toBeLessThan(0.03);
  expect(Math.abs(freq(slice(d, 0.6, 0.9)) / 440 - 1)).toBeLessThan(0.01);
});

test('an fm envelope on the index brightens the attack', async () => {
  const s = sound('fm', { amount: 0, ratio: 1 }, { amp: flat, mods: [mod('env', { module: 'source', param: 'amount' }, 0.5, adsr(0, 0.3, 0, 0.1))] });
  const pcm = await renderSound(s, {}, { note: 57, dur: 1 });
  const bright = (d: Float32Array) => rms(d.map((v, i) => (i ? v - d[i - 1] : 0))) / rms(d);
  expect(bright(slice(pcm.channels[0], 0.01, 0.05))).toBeGreaterThan(2 * bright(slice(pcm.channels[0], 0.7, 0.9)));
});

test('an lfo on the output level makes a tremolo at its rate', async () => {
  const pcm = await renderSound(sine([mod('lfo', { module: 'out', param: 'level' }, 0.8, { rate: 8 })]), {}, { note: 81, dur: 1.2 });
  const d = slice(pcm.channels[0], 0.05, 1.05);
  const env = Float32Array.from({ length: 200 }, (_, k) => rms(d.subarray(k * 220, k * 220 + 220)));
  const mean = env.reduce((a, b) => a + b) / env.length;
  // Envelope sampled every 5 ms; its frequency is the tremolo rate.
  expect(Math.abs(freq(env.map((v) => v - mean), 200) / 8 - 1)).toBeLessThan(0.05);
  expect(Math.max(...env) / Math.min(...env)).toBeGreaterThan(5);
});

test('an lfo on the filter cutoff changes the brightness over time', async () => {
  const brightness = async (amount: number) => {
    const lfo = mod('lfo', { module: 'f', param: 'cutoff' }, amount, { rate: 4 });
    const filter = { ...effect('filter', { cutoff: 800, reso: 0 }), id: 'f' };
    const pcm = await renderSound(sine([lfo], [filter], 'sawtooth'), {}, { note: 45, dur: 1.1 });
    const d = slice(pcm.channels[0], 0.05, 1.05);
    // Windows of four periods of the 110 Hz saw, so a steady tone measures the same in each.
    const n = Math.round((4 * 44100) / 110);
    return Array.from({ length: Math.floor(d.length / n) }, (_, k) => {
      const w = d.subarray(k * n, k * n + n);
      return rms(w.map((v, i) => (i ? v - w[i - 1] : 0))) / rms(w);
    });
  };
  const still = await brightness(0);
  const moving = await brightness(0.5);
  expect(Math.max(...still) / Math.min(...still)).toBeLessThan(1.1);
  expect(Math.max(...moving) / Math.min(...moving)).toBeGreaterThan(3);
});

test('a bypassed modulator or one without a target does nothing', async () => {
  const dry = await renderSound(sine([]), {}, { dur: 0.3 });
  const off = await renderSound(sine([mod('lfo', { module: 'out', param: 'level' }, 1, {}, false)]), {}, { dur: 0.3 });
  const loose = await renderSound(sine([mod('env', null, 1)]), {}, { dur: 0.3 });
  expect(off.channels[0]).toEqual(dry.channels[0]);
  expect(loose.channels[0]).toEqual(dry.channels[0]);
});

/** Level of a signal in windows of 5 ms. */
function levels(d: Float32Array, sr = SR): Float32Array {
  const n = Math.round(0.005 * sr);
  return Float32Array.from({ length: Math.floor(d.length / n) }, (_, k) => rms(d.subarray(k * n, k * n + n)));
}

/** The rate of a tremolo, from the level in 5 ms windows crossing its mean. */
function tremolo(d: Float32Array): number {
  const env = levels(d);
  const mean = env.reduce((a, b) => a + b) / env.length;
  return freq(env.map((v) => v - mean), 200);
}

/** How far the level swings in a quarter second from `t`: loudest window over quietest. */
function swing(d: Float32Array, t: number): number {
  const env = levels(slice(d, t, t + 0.25));
  return Math.max(...env) / Math.min(...env);
}

const mono = (s: Sound): Sound => ({ ...s, play: { mode: 'mono', glide: 0 } });
const level = { module: 'out', param: 'level' };

test('a synced lfo runs at its note value at the tempo and follows a change of tempo', async () => {
  const s = sine([mod('lfo', level, 0.8, { rate: 7, sync: '1/8' })]);
  // An eighth note at 120 bpm is a quarter second, 4 Hz; at 90 bpm 3 Hz.
  for (const [bpm, rate] of [[120, 4], [90, 3]]) {
    const d = await notes(s, [[81, 0, 2]], 2, { bpm });
    expect(Math.abs(tremolo(slice(d, 0.05, 1.95)) / rate - 1), `${bpm} bpm`).toBeLessThan(0.03);
  }
  const at60 = project([{ id: 'a', sound: s }], {}, { bpm: 60 });
  const d = await notes(s, [[81, 0, 3]], 3, { live: [[1.5, (e) => e.setProject(at60)]] });
  expect(Math.abs(tremolo(slice(d, 0.05, 1.45)) / 4 - 1)).toBeLessThan(0.03);
  expect(Math.abs(tremolo(slice(d, 1.6, 2.95)) / 2 - 1)).toBeLessThan(0.03);
});

test('an lfo fades in after the latest note of the whole sound, or from the start of each note', async () => {
  const whole = mono(sine([mod('lfo', level, 0.5, { rate: 8, fade: 1 })]));
  const d = await notes(whole, [[81, 0, 1.5], [81, 1.5, 1.5]], 3);
  expect(swing(d, 0.02)).toBeLessThan(1.3);
  expect(swing(d, 1.1)).toBeGreaterThan(2.5);
  expect(swing(d, 1.52)).toBeLessThan(1.3);
  expect(swing(d, 2.6)).toBeGreaterThan(2.5);

  // In each note: the pitch wobbles by up to a semitone, 11 % up and down, once the fade is through.
  const pitch = { module: 'source', param: 'pitch' };
  const vibrato = { ...mod('lfo', pitch, 0.02, { rate: 6, fade: 1 }), per: 'note' as const };
  const p = await notes(mono(sine([vibrato])), [[69, 0, 1.5], [69, 1.5, 1.5]], 3);
  const wobble = (t: number) => {
    const f = Array.from({ length: 10 }, (_, k) => freq(slice(p, t + k * 0.025, t + (k + 1) * 0.025)));
    return Math.max(...f) / Math.min(...f);
  };
  expect(wobble(0.02)).toBeLessThan(1.03);
  expect(wobble(1.1)).toBeGreaterThan(1.08);
  expect(wobble(1.52)).toBeLessThan(1.03);
});

test('retrigger starts an lfo of the whole sound again with every note; off, it runs on', async () => {
  // A 2 Hz square: high for the first quarter second of its cycle, low for the second.
  const s = (retrigger: boolean) => mono(sine([mod('lfo', level, 0.8, { wave: 'square', rate: 2, retrigger })]));
  const after = async (retrigger: boolean) =>
    rms(slice(await notes(s(retrigger), [[81, 0, 0.35], [81, 0.35, 0.65]], 1), 0.38, 0.45));
  expect((await after(true)) / (await after(false))).toBeGreaterThan(5);
});

test('a very slow lfo takes minutes for a cycle', async () => {
  const sr = 3000;
  const mods = [mod('lfo', level, 1, { rate: 0.002 })];
  const s = sound('osc', { wave: 'sine' }, { amp: flat, mods, out: { level: -12 } });
  const d = await notes(s, [[57, 0, 126]], 126, { sampleRate: sr });
  const at = (t: number) => rms(slice(d, t, t + 0.5, sr));
  // A quarter of the 500 s cycle is 125 s: the level doubles, and halfway there it is up by sin(pi / 4).
  expect(at(62.5) / at(0.1)).toBeCloseTo(1 + Math.SQRT1_2, 1);
  expect(at(124.5) / at(0.1)).toBeCloseTo(2, 1);
});

/** Drift on its own, sampled at 3 kHz. */
async function drift(params: Params, seconds: number): Promise<Float32Array> {
  const sr = 3000;
  const ctx = new OfflineAudioContext(1, seconds * sr, sr);
  const p = { ...defaultParams(MODULES.drift), ...params };
  modSource(ctx, 'drift', p, 120, { t0: 0, perNote: true, seed: () => 0 }).output.connect(ctx.destination);
  return (await ctx.startRendering()).getChannelData(0);
}

test('drift wanders within -1..1 without coming back to itself in two minutes', async () => {
  const d = await drift({ rate: 1 }, 120);
  expect(peak(d)).toBeLessThanOrEqual(1);
  expect(rms(d)).toBeGreaterThan(0.3);
  // Averages over a tenth of a second, then how alike they are to themselves 2 to 40 s later.
  const avg = Float32Array.from({ length: 1200 }, (_, k) => d.subarray(k * 300, (k + 1) * 300).reduce((a, b) => a + b));
  const corr = (lag: number) => {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i + lag < avg.length; i++) {
      ab += avg[i] * avg[i + lag];
      aa += avg[i] ** 2;
      bb += avg[i + lag] ** 2;
    }
    return ab / Math.sqrt(aa * bb);
  };
  expect(corr(3)).toBeGreaterThan(0.5);
  for (let lag = 20; lag <= 400; lag += 5) expect(Math.abs(corr(lag)), `${lag / 10} s`).toBeLessThan(0.5);
});

test('stepped drift holds and jumps, smooth drift glides', async () => {
  const stepped = await drift({ rate: 1, smooth: 0 }, 20);
  const smooth = await drift({ rate: 1, smooth: 1 }, 20);
  const still = (d: Float32Array) => d.filter((v, i) => i > 0 && Math.abs(v - d[i - 1]) < 1e-6).length / d.length;
  expect(still(stepped)).toBeGreaterThan(0.9);
  expect(maxJump(stepped)).toBeGreaterThan(0.01);
  // Half a cosine between two values at most 2 apart over a second: never faster than pi / 3000 per sample.
  expect(maxJump(smooth)).toBeLessThan(0.0011);
  expect(still(smooth)).toBeLessThan(0.1);
});

test('drift in each note wanders its own way', async () => {
  const wander = { ...mod('drift', { module: 'source', param: 'pitch' }, 0.05, { rate: 2 }), per: 'note' as const };
  const d = await notes(sine([wander]), [[69, 0, 0.5], [69, 1, 0.5]], 1.6);
  const pitches = (t: number) => [0, 0.1, 0.2, 0.3].map((k) => freq(slice(d, t + k, t + k + 0.05)));
  const a = pitches(0.05);
  const b = pitches(1.05);
  expect(Math.max(...a.map((f, i) => Math.abs(f / b[i] - 1)))).toBeGreaterThan(0.01);
});

/** A saw through the voice filter, its cutoff moved by `mods`; the filter follows the key, so its detune is not 0. */
const filtered = (mods: ModInst[], filter: Params = {}): Sound => {
  const s = sound('osc', { wave: 'sawtooth' }, { amp: adsr(0.002, 0.1, 0.5, 0.02), mods, out: { level: -6 } });
  return { ...s, filter: { ...s.filter, on: true, cutoff: 600, key: 0.5, ...filter } };
};
const cutoff = { module: 'filter', param: 'cutoff' };

test('a render does not depend on when the page hears that a note has ended', async () => {
  // The browser tells the page that a source has ended a while after it has, sooner or later with the load of the
  // machine. Here the page hears it at once or a second later, and an lfo of the whole sound in the voices, which a
  // resonant filter goes on pulling after its note, must not notice when the next note comes.
  const s = filtered([mod('lfo', cutoff, 0.5, { rate: 3 })], { cutoff: 200, reso: 0.8 });
  const proto = AudioScheduledSourceNode.prototype;
  const real = Object.getOwnPropertyDescriptor(proto, 'onended')!;
  const render = async (heardAt: number) => {
    const heard: (() => void)[] = [];
    Object.defineProperty(proto, 'onended', {
      configurable: true,
      get: () => null,
      set(this: AudioScheduledSourceNode, handler: (e: Event) => void) {
        heard.push(() => handler.call(this, new Event('ended')));
      },
    });
    try {
      return await notes(s, [[45, 0, 0.1]], 2, {
        live: [[heardAt, () => heard.forEach((f) => f())], [1.2, (e) => e.play('a', 45, 1, 1.5, 0.3)]],
      });
    } finally {
      Object.defineProperty(proto, 'onended', real);
    }
  };
  const soon = await render(0.13);
  const late = await render(1.13);
  expect(peak(slice(soon, 1.5, 2)), 'the second note plays').toBeGreaterThan(0.05);
  expect(peak(soon.map((v, i) => v - late[i]))).toBe(0);
});

test('modulators of the whole sound and of the note on one parameter render the same every time', async () => {
  // The filter's detune is its own value plus each connection, added in an order that changes from run to run.
  const env = { ...mod('env', cutoff, 0.4, adsr(0, 0.15, 0, 0.1)), per: 'note' as const };
  const s = filtered([mod('lfo', cutoff, 0.3, { rate: 2 }), env]);
  const chord: [number, number, number][] = [[57, 0, 0.3], [60, 0, 0.3], [64, 0, 0.3], [55, 0.5, 0.3], [62, 0.5, 0.3]];
  const [first, ...more] = await Promise.all([0, 1, 2, 3].map(() => notes(s, chord, 1, { sampleRate: 22050 })));
  for (const d of more) expect(peak(d.map((v, i) => v - first[i]))).toBe(0);
});
