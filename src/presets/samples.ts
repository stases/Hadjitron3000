// The factory's own recordings, made in code the first time a sound asks for them: a one-bar drum break and a pad
// chord. Each is a WAV file kept like one the user loads, under a fixed id. The id is what the file hashed to
// (sampleId) when it was first made, on an x64 machine, but it is a name, never checked against the content: another
// processor may compute the last bits of the synthesis differently, and a project must find its factory sample by
// the same id on every machine.

import { rng } from '../audio/random';
import { encodeWav } from '../core/wav';
import type { SampleData } from '../core/types';

const BREAK_RATE = 44100;
const PAD_RATE = 22050;
/** The break is one bar of sixteenths at this tempo. */
export const BREAK_BPM = 120;

type Hit = 'kick' | 'snare' | 'hat';

/** The break on a grid of sixteenths: what plays on each step, and how hard. Every eighth starts with a hit. */
const PATTERN: [step: number, hit: Hit, vel: number][] = [
  [0, 'kick', 1], [0, 'hat', 0.6], [2, 'hat', 0.5], [4, 'snare', 1], [4, 'hat', 0.4], [6, 'hat', 0.6],
  [7, 'kick', 0.6], [8, 'kick', 0.9], [8, 'hat', 0.5], [10, 'kick', 0.8], [10, 'hat', 0.5], [11, 'snare', 0.3],
  [12, 'snare', 1], [12, 'hat', 0.4], [14, 'hat', 0.6], [15, 'snare', 0.4],
];

/** One drum hit at full velocity, `sr` samples a second. */
function drum(hit: Hit, sr: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.round((hit === 'kick' ? 0.45 : hit === 'snare' ? 0.3 : 0.12) * sr));
  let phase = 0;
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const n = noise();
    const bright = n - last;
    last = n;
    if (hit === 'kick') {
      // A sine falling from 160 Hz to 50 Hz, with a short click on top.
      phase += (2 * Math.PI * (50 + 110 * Math.exp(-t / 0.03))) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t / 0.18) + 0.3 * n * Math.exp(-t / 0.002);
    } else if (hit === 'snare') {
      out[i] = 0.5 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.06) + 0.45 * bright * Math.exp(-t / 0.11);
    } else {
      out[i] = 0.3 * bright * Math.exp(-t / 0.025);
    }
  }
  return finish(out, sr, 1);
}

/** Scale a recording to a peak of `top` and fade its last 20 ms out, so it does not end in a click. */
function finish(data: Float32Array, sr: number, top: number): Float32Array {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const fade = Math.round(0.02 * sr);
  return data.map((v, i) => (v * top) / peak * Math.min(1, (data.length - i) / fade));
}

/** One bar of a dry drum break at BREAK_BPM: kick, snare and hats, mono. */
function drumBreak(): Float32Array {
  const step = (60 / BREAK_BPM / 4) * BREAK_RATE;
  const out = new Float32Array(Math.round(16 * step));
  const noise = rng(17);
  for (const [at, hit, vel] of PATTERN) {
    const start = Math.round(at * step);
    drum(hit, BREAK_RATE, noise).forEach((v, i) => {
      if (start + i < out.length) out[start + i] += vel * v;
    });
  }
  return finish(out, BREAK_RATE, 0.9);
}

/**
 * Six seconds of a D minor ninth chord of detuned saws that opens up from dark to bright along its length and
 * breathes slowly, with a little air: material for grains, where Position chooses how bright.
 */
function padChord(): Float32Array {
  const sr = PAD_RATE;
  const n = 6 * sr;
  // One cycle of a saw with 24 harmonics, which keeps the highest note of the chord below Nyquist.
  const size = 2048;
  const saw = Float32Array.from({ length: size }, (_, i) => {
    let v = 0;
    for (let k = 1; k <= 24; k++) v += Math.sin((2 * Math.PI * k * i) / size) / k;
    return v;
  });
  const notes = [146.83, 174.61, 220, 261.63, 329.63];
  const out = new Float32Array(n);
  const noise = rng(23);
  notes.forEach((f, v) => {
    for (const cents of [-7, 6]) {
      const inc = (size * f * Math.exp((cents / 1200) * Math.LN2)) / sr;
      let phase = (v * 397 + (cents + 10) * 31) % size;
      for (let i = 0; i < n; i++) {
        const breathe = 0.75 + 0.25 * Math.sin((2 * Math.PI * (0.11 + 0.04 * v) * i) / sr + v);
        out[i] += saw[phase | 0] * breathe;
        phase = (phase + inc) % size;
      }
    }
  });
  // Two one-pole low passes whose corner rises from 300 Hz to 3 kHz along the chord; the air goes in after them.
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const corner = 300 * Math.exp((i / n) * Math.log(10));
    const k = 1 - Math.exp((-2 * Math.PI * corner) / sr);
    a += k * (out[i] - a);
    b += k * (a - b);
    out[i] = b + 0.02 * noise();
  }
  return finish(out, sr, 0.8);
}

/** The factory samples by name: how to make each, and its fixed id. */
const FACTORY = {
  break: { name: 'Factory Break.wav', id: 'scf66f83913356e01', make: () => ({ rate: BREAK_RATE, data: drumBreak() }) },
  pad: { name: 'Factory Pad.wav', id: 's41341d4887d7311d', make: () => ({ rate: PAD_RATE, data: padChord() }) },
} as const;

export type FactorySample = keyof typeof FACTORY;

const made = new Map<FactorySample, SampleData>();

/** The id of a factory sample, without making it. */
export const factoryId = (kind: FactorySample): string => FACTORY[kind].id;

/** A factory sample as a WAV file, made the first time it is asked for. */
export function factorySample(kind: FactorySample): { id: string; sample: SampleData } {
  let sample = made.get(kind);
  if (!sample) {
    const { rate, data } = FACTORY[kind].make();
    sample = { name: FACTORY[kind].name, bytes: encodeWav({ sampleRate: rate, channels: [data] }) };
    made.set(kind, sample);
  }
  return { id: FACTORY[kind].id, sample };
}
