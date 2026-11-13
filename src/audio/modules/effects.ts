// Channel effects. Each is input -> ... -> output and follows parameter changes smoothly.

import { SYNC_BEATS } from '../../core/modules';
import type { Params } from '../../core/types';
import { glide } from '../automation';
import { mix } from '../mix';
import { rng } from '../random';

export interface Effect {
  input: AudioNode;
  output: AudioNode;
  /** Mod targets, by parameter id. */
  targets: Record<string, AudioParam[]>;
  update(p: Params, bpm: number): void;
  dispose(): void;
}

export type EffectBuilder = (ctx: BaseAudioContext, p: Params, bpm: number) => Effect;

const num = (p: Params, id: string) => p[id] as number;

// ---- filter

export const filterQ = (p: Params) => (p.mode === 'bandpass' ? 0.5 * 40 ** num(p, 'reso') : num(p, 'reso') * 24);

const filter: EffectBuilder = (ctx, p) => {
  const bq = new BiquadFilterNode(ctx, { type: p.mode as BiquadFilterType, frequency: num(p, 'cutoff'), Q: filterQ(p) });
  return {
    input: bq,
    output: bq,
    targets: { cutoff: [bq.detune] },
    update(p) {
      const t = ctx.currentTime;
      bq.type = p.mode as BiquadFilterType;
      glide(bq.frequency, num(p, 'cutoff'), t);
      glide(bq.Q, filterQ(p), t);
    },
    dispose() {},
  };
};

// ---- drive

// The shaper sees the driven signal divided by DRIVE_RANGE (a WaveShaper only reads inputs in -1..1),
// and its curve undoes that scaling, so the gain before it can change smoothly.
export const DRIVE_RANGE = 16;
const DRIVE_MAX_DB = 36;
const SHAPES: Record<string, (x: number) => number> = {
  soft: Math.tanh,
  hard: (x) => Math.max(-1, Math.min(1, x)),
  fold: (x) => (2 / Math.PI) * Math.asin(Math.sin((Math.PI / 2) * x)),
};
const curves = new Map<string, Float32Array<ArrayBuffer>>();

export function driveCurve(shape: string): Float32Array<ArrayBuffer> {
  let curve = curves.get(shape);
  if (!curve) {
    const n = 16385;
    curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = SHAPES[shape](DRIVE_RANGE * ((2 * i) / (n - 1) - 1));
    curves.set(shape, curve);
  }
  return curve;
}

// Chromium's 4x oversampling delays the shaped signal by 192 samples (measured at 44.1 and 48 kHz).
// The dry path is delayed to match, or mixing the two would comb-filter.
const SHAPER_LATENCY = 192;

export const preGain = (amount: number) => 10 ** ((amount * DRIVE_MAX_DB) / 20);

/** Gain after the shaper that keeps a -12 dBFS sine at its input level. */
export function makeup(shape: string, amount: number): number {
  const a = 0.25;
  const g = preGain(amount);
  const n = 256;
  let power = 0;
  for (let i = 0; i < n; i++) power += SHAPES[shape](g * a * Math.sin((2 * Math.PI * i) / n)) ** 2;
  return a / Math.SQRT2 / Math.sqrt(power / n);
}

const drive: EffectBuilder = (ctx, p) => {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx, { gain: 1 - num(p, 'mix') });
  const pre = new GainNode(ctx, { gain: preGain(num(p, 'amount')) / DRIVE_RANGE });
  const shaper = new WaveShaperNode(ctx, { curve: driveCurve(p.shape as string), oversample: '4x' });
  const post = new GainNode(ctx, { gain: makeup(p.shape as string, num(p, 'amount')) });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(p, 'tone'), Q: 0 });
  const wet = new GainNode(ctx, { gain: num(p, 'mix') });
  input.connect(new DelayNode(ctx, { delayTime: SHAPER_LATENCY / ctx.sampleRate })).connect(dry).connect(output);
  input.connect(pre).connect(shaper).connect(post).connect(tone).connect(wet).connect(output);
  let shape = p.shape as string;
  return {
    input,
    output,
    targets: {},
    update(p) {
      const t = ctx.currentTime;
      if (p.shape !== shape) shaper.curve = driveCurve((shape = p.shape as string));
      glide(pre.gain, preGain(num(p, 'amount')) / DRIVE_RANGE, t);
      glide(post.gain, makeup(shape, num(p, 'amount')), t);
      glide(tone.frequency, num(p, 'tone'), t);
      glide(dry.gain, 1 - num(p, 'mix'), t);
      glide(wet.gain, num(p, 'mix'), t);
    },
    dispose() {},
  };
};

// ---- delay

const MAX_DELAY = 4;
// Delay time changes glide with this time constant: a tape-like bend instead of clicks.
const DELAY_GLIDE = 0.05;

/** Gains of the left input, right-into-left input, right input, the straight feedbacks and the crossed ones. */
function routing(p: Params): number[] {
  const pp = p.pingpong ? 1 : 0;
  const fb = num(p, 'feedback');
  return [1 - pp / 2, pp / 2, 1 - pp, fb * (1 - pp), fb * (1 - pp), fb * pp, fb * pp];
}

export const delayTime = (p: Params, bpm: number) =>
  Math.min(p.sync === 'free' ? num(p, 'time') : (SYNC_BEATS[p.sync as string] * 60) / bpm, MAX_DELAY);

/**
 * Two delay lines. Straight: left feeds back into left and right into right. Ping pong: the
 * mono sum enters the left line and each line feeds the other, so the repeats alternate.
 */
const delay: EffectBuilder = (ctx, p, bpm) => {
  const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const output = new GainNode(ctx);
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  const wet = new GainNode(ctx, { gain: num(p, 'mix') });
  const time = delayTime(p, bpm);
  const lines = [0, 1].map(() => new DelayNode(ctx, { maxDelayTime: MAX_DELAY + 0.1, delayTime: time }));
  const tones = lines.map((line) => {
    const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(p, 'tone'), Q: 0 });
    line.connect(tone);
    return tone;
  });
  const gains = routing(p).map((gain) => new GainNode(ctx, { gain }));
  const [inL, inRL, inR, fbL, fbR, fbLR, fbRL] = gains;
  input.connect(output);
  input.connect(split);
  split.connect(inL, 0);
  split.connect(inRL, 1);
  split.connect(inR, 1);
  tones[0].connect(fbL);
  tones[0].connect(fbLR);
  tones[1].connect(fbR);
  tones[1].connect(fbRL);
  mix(ctx, [inL, inRL, fbL, fbRL]).connect(lines[0]);
  mix(ctx, [inR, fbR, fbLR]).connect(lines[1]);
  tones[0].connect(merge, 0, 0);
  tones[1].connect(merge, 0, 1);
  merge.connect(wet).connect(output);
  return {
    input,
    output,
    targets: { time: lines.map((l) => l.delayTime), mix: [wet.gain] },
    update(p, bpm) {
      const t = ctx.currentTime;
      for (const line of lines) glide(line.delayTime, delayTime(p, bpm), t, DELAY_GLIDE);
      for (const tone of tones) glide(tone.frequency, num(p, 'tone'), t);
      glide(wet.gain, num(p, 'mix'), t);
      routing(p).forEach((v, i) => glide(gains[i].gain, v, t));
    },
    dispose() {},
  };
};

// ---- reverb

const REVERB_DEBOUNCE = 100;
const REVERB_FADE = 0.05;

/** Exponentially decaying noise, 60 dB down after `size` seconds, low-passed at `tone`, unit energy per side. */
function impulse(ctx: BaseAudioContext, size: number, tone: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(1, Math.round(size * sr));
  const buf = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 2 });
  const k = Math.exp(-2 * Math.PI * (tone / sr));
  for (let c = 0; c < 2; c++) {
    const next = rng(101 + c);
    const d = buf.getChannelData(c);
    let y = 0;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      y = (1 - k) * next() + k * y;
      d[i] = y * Math.exp((-Math.log(1000) * i) / n);
      energy += d[i] * d[i];
    }
    const scale = 1 / Math.sqrt(energy);
    for (let i = 0; i < n; i++) d[i] *= scale;
  }
  return buf;
}

const reverb: EffectBuilder = (ctx, p) => {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const wet = new GainNode(ctx, { gain: num(p, 'mix') });
  input.connect(output);
  wet.connect(output);
  let size = num(p, 'size');
  let tone = num(p, 'tone');
  const convolver = (gain: number) => {
    const conv = new ConvolverNode(ctx, { disableNormalization: true, buffer: impulse(ctx, size, tone) });
    const out = new GainNode(ctx, { gain });
    input.connect(conv).connect(out).connect(wet);
    return out;
  };
  let current = convolver(1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The new impulse goes into a second convolver that fades in while the old one fades out.
  const swap = () => {
    timer = undefined;
    const old = current;
    current = convolver(0);
    const t = ctx.currentTime;
    current.gain.setValueAtTime(0, t);
    current.gain.linearRampToValueAtTime(1, t + REVERB_FADE);
    old.gain.setValueAtTime(old.gain.value, t);
    old.gain.linearRampToValueAtTime(0, t + REVERB_FADE);
    setTimeout(() => old.disconnect(), REVERB_FADE * 1000 + 100);
  };
  return {
    input,
    output,
    targets: { mix: [wet.gain] },
    update(p) {
      glide(wet.gain, num(p, 'mix'), ctx.currentTime);
      if (num(p, 'size') === size && num(p, 'tone') === tone) return;
      size = num(p, 'size');
      tone = num(p, 'tone');
      clearTimeout(timer);
      timer = setTimeout(swap, REVERB_DEBOUNCE);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
};

export const EFFECT_BUILDERS: Readonly<Record<string, EffectBuilder>> = { filter, drive, delay, reverb };
