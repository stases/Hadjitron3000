// Channel effects. Each is input -> ... -> output and follows parameter changes smoothly.

import { SYNC_BEATS } from '../../core/modules';
import type { Params } from '../../core/types';
import { dbToGain, glide } from '../automation';
import { mix } from '../mix';
import { rng } from '../random';
import { lfoRate } from './modulators';

export interface Effect {
  input: AudioNode;
  output: AudioNode;
  /** Mod targets, by parameter id. */
  targets: Record<string, AudioParam[]>;
  update(p: Params, bpm: number): void;
  dispose(): void;
  /** How far a compressor turns the sound down right now, in dB (0 or below); absent for other effects. */
  reduction?(): number;
}

/**
 * `shared` is set for an effect on a bus or the master, where Mix has to reach the wet sound alone: the delay and the
 * reverb then crossfade from dry to wet like the other effects instead of adding the wet on top of the dry.
 */
export type EffectBuilder = (ctx: BaseAudioContext, p: Params, bpm: number, shared?: boolean) => Effect;

const num = (p: Params, id: string) => p[id] as number;

/**
 * A Mix knob: the dry input and the processed `wet` signal summed into one output, crossfaded so that 100 % is the
 * wet signal alone. The dry path waits `latency` samples, so that it stays in time with a wet path that is late by that
 * much. With `add` all of the dry passes, untouched, and Mix sets only the wet level on top of it, as the delay and the
 * reverb do inside a sound.
 */
function blend(ctx: BaseAudioContext, input: AudioNode, wet: AudioNode, amount: number, latency = 0, add = false) {
  const output = new GainNode(ctx);
  const dry = add ? null : new GainNode(ctx, { gain: 1 - amount });
  const wetGain = new GainNode(ctx, { gain: amount });
  const early = latency ? input.connect(new DelayNode(ctx, { delayTime: latency / ctx.sampleRate })) : input;
  if (dry) early.connect(dry).connect(output);
  else early.connect(output);
  wet.connect(wetGain).connect(output);
  return {
    output,
    wet: wetGain.gain,
    set(amount: number, t: number) {
      if (dry) glide(dry.gain, 1 - amount, t);
      glide(wetGain.gain, amount, t);
    },
  };
}

// The lowest setting of a low cut (`lowCut` in core/modules.ts), where it is off.
const LOW_CUT_OFF = 20;
// Q in dB of a second-order Butterworth high pass, flat up to its corner.
const BUTTERWORTH_Q = 20 * Math.log10(Math.SQRT1_2);

/**
 * A high pass that is out of the way at LOW_CUT_OFF: the signal goes round it through a gain of exactly 1, so it
 * passes bit for bit. Above that setting the two paths crossfade to the filter, which glides to its corner.
 */
function lowCut(ctx: BaseAudioContext, input: AudioNode, freq: number) {
  const on = (f: number) => (f > LOW_CUT_OFF ? 1 : 0);
  const output = new GainNode(ctx);
  const around = new GainNode(ctx, { gain: 1 - on(freq) });
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: freq, Q: BUTTERWORTH_Q });
  const through = new GainNode(ctx, { gain: on(freq) });
  input.connect(around).connect(output);
  input.connect(hp).connect(through).connect(output);
  return {
    output,
    set(freq: number, t: number) {
      glide(hp.frequency, freq, t);
      glide(around.gain, 1 - on(freq), t);
      glide(through.gain, on(freq), t);
    },
  };
}

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
  const pre = new GainNode(ctx, { gain: preGain(num(p, 'amount')) / DRIVE_RANGE });
  const shaper = new WaveShaperNode(ctx, { curve: driveCurve(p.shape as string), oversample: '4x' });
  const post = new GainNode(ctx, { gain: makeup(p.shape as string, num(p, 'amount')) });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(p, 'tone'), Q: 0 });
  input.connect(pre).connect(shaper).connect(post).connect(tone);
  const out = blend(ctx, input, tone, num(p, 'mix'), SHAPER_LATENCY);
  let shape = p.shape as string;
  return {
    input,
    output: out.output,
    targets: {},
    update(p) {
      const t = ctx.currentTime;
      if (p.shape !== shape) shaper.curve = driveCurve((shape = p.shape as string));
      glide(pre.gain, preGain(num(p, 'amount')) / DRIVE_RANGE, t);
      glide(post.gain, makeup(shape, num(p, 'amount')), t);
      glide(tone.frequency, num(p, 'tone'), t);
      out.set(num(p, 'mix'), t);
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
 * The low cut sits in the feedback only, so the first repeat is whole and every later one thinner.
 */
const delay: EffectBuilder = (ctx, p, bpm, shared) => {
  const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  const time = delayTime(p, bpm);
  const lines = [0, 1].map(() => new DelayNode(ctx, { maxDelayTime: MAX_DELAY + 0.1, delayTime: time }));
  const tones = lines.map((line) => {
    const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(p, 'tone'), Q: 0 });
    line.connect(tone);
    return tone;
  });
  const cuts = tones.map((tone) => lowCut(ctx, tone, num(p, 'lowcut')));
  const gains = routing(p).map((gain) => new GainNode(ctx, { gain }));
  const [inL, inRL, inR, fbL, fbR, fbLR, fbRL] = gains;
  const out = blend(ctx, input, merge, num(p, 'mix'), 0, !shared);
  input.connect(split);
  split.connect(inL, 0);
  split.connect(inRL, 1);
  split.connect(inR, 1);
  cuts[0].output.connect(fbL);
  cuts[0].output.connect(fbLR);
  cuts[1].output.connect(fbR);
  cuts[1].output.connect(fbRL);
  mix(ctx, [inL, inRL, fbL, fbRL]).connect(lines[0]);
  mix(ctx, [inR, fbR, fbLR]).connect(lines[1]);
  tones[0].connect(merge, 0, 0);
  tones[1].connect(merge, 0, 1);
  return {
    input,
    output: out.output,
    targets: { time: lines.map((l) => l.delayTime), mix: [out.wet] },
    update(p, bpm) {
      const t = ctx.currentTime;
      for (const line of lines) glide(line.delayTime, delayTime(p, bpm), t, DELAY_GLIDE);
      for (const tone of tones) glide(tone.frequency, num(p, 'tone'), t);
      for (const cut of cuts) cut.set(num(p, 'lowcut'), t);
      out.set(num(p, 'mix'), t);
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

const reverb: EffectBuilder = (ctx, p, _bpm, shared) => {
  const input = new GainNode(ctx);
  // The convolvers' sum: one convolver, or two while a new impulse fades in.
  const wet = new GainNode(ctx);
  const out = blend(ctx, input, wet, num(p, 'mix'), 0, !shared);
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
    output: out.output,
    targets: { mix: [out.wet] },
    update(p) {
      out.set(num(p, 'mix'), ctx.currentTime);
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

// ---- eq

const LOW_SHELF = 200;
const HIGH_SHELF = 4000;
// About an octave and a half wide.
const MID_Q = 0.9;

const eq: EffectBuilder = (ctx, p) => {
  const input = new GainNode(ctx);
  const cut = lowCut(ctx, input, num(p, 'lowcut'));
  const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: LOW_SHELF, gain: num(p, 'low') });
  const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: num(p, 'freq'), Q: MID_Q, gain: num(p, 'mid') });
  const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: HIGH_SHELF, gain: num(p, 'high') });
  cut.output.connect(low).connect(mid).connect(high);
  return {
    input,
    output: high,
    targets: { freq: [mid.detune] },
    update(p) {
      const t = ctx.currentTime;
      cut.set(num(p, 'lowcut'), t);
      glide(low.gain, num(p, 'low'), t);
      glide(mid.gain, num(p, 'mid'), t);
      glide(mid.frequency, num(p, 'freq'), t);
      glide(high.gain, num(p, 'high'), t);
    },
    dispose() {},
  };
};

// ---- compressor

// Chromium's compressor looks ahead: its output is late by this many seconds of samples, rounded down.
const COMPRESSOR_LOOKAHEAD = 0.006;
const COMPRESSOR_KNEE = 6;

/**
 * How far the sound is raised into the compressor and lowered again after it. Chromium's compressor turns its
 * output up by itself, by an amount that depends on its threshold and ratio and jumps when they change. Its
 * threshold therefore stays at 0 dB, where it adds nothing, and the Threshold knob moves the sound instead, by
 * this gain, with the knee centred on the knob's value.
 */
const compressorDrive = (p: Params) => dbToGain(COMPRESSOR_KNEE / 2 - num(p, 'threshold'));

/** Make-up is the gain after compressing, Mix blends the compressed sound with the dry one in time. */
const compressor: EffectBuilder = (ctx, p) => {
  const input = new GainNode(ctx);
  const pre = new GainNode(ctx, { gain: compressorDrive(p) });
  const comp = new DynamicsCompressorNode(ctx, {
    threshold: 0, knee: COMPRESSOR_KNEE, ratio: num(p, 'ratio'), attack: num(p, 'attack'), release: num(p, 'release'),
  });
  const post = new GainNode(ctx, { gain: dbToGain(num(p, 'makeup')) / compressorDrive(p) });
  input.connect(pre).connect(comp).connect(post);
  const out = blend(ctx, input, post, num(p, 'mix'), Math.floor(COMPRESSOR_LOOKAHEAD * ctx.sampleRate));
  return {
    input,
    output: out.output,
    targets: {},
    update(p) {
      const t = ctx.currentTime;
      glide(pre.gain, compressorDrive(p), t);
      glide(post.gain, dbToGain(num(p, 'makeup')) / compressorDrive(p), t);
      for (const id of ['ratio', 'attack', 'release'] as const) glide(comp[id], num(p, id), t);
      out.set(num(p, 'mix'), t);
    },
    dispose() {},
    reduction: () => comp.reduction,
  };
};

// An effect's own oscillators stop this long after its channel goes, once the channel has faded out.
const STOP_AFTER = 0.2;

// ---- ring modulator

/** The sound multiplied by a sine: sum and difference tones, or at a few hertz a throbbing tremolo. */
const ring: EffectBuilder = (ctx, p) => {
  const input = new GainNode(ctx);
  const ringed = new GainNode(ctx, { gain: 0 });
  const carrier = new OscillatorNode(ctx, { frequency: num(p, 'freq') });
  carrier.connect(ringed.gain);
  carrier.start();
  input.connect(ringed);
  const out = blend(ctx, input, ringed, num(p, 'mix'));
  return {
    input,
    output: out.output,
    targets: { freq: [carrier.detune] },
    update(p) {
      const t = ctx.currentTime;
      glide(carrier.frequency, num(p, 'freq'), t);
      out.set(num(p, 'mix'), t);
    },
    dispose() {
      carrier.stop(ctx.currentTime + STOP_AFTER);
    },
  };
};

// ---- chorus

// The delay lines swing around CHORUS_DELAY by up to CHORUS_SWING at full depth.
const CHORUS_DELAY = 0.012;
const CHORUS_SWING = 0.003;

/** A chorus line's gain on its own side and on the other. */
const spreadGain = (p: Params, own: boolean) => (own ? 1 + num(p, 'spread') : 1 - num(p, 'spread')) / 2;

/**
 * Two delay lines fed with the mono sum, swung in opposite directions by one LFO. Spread pans them apart: at 0
 * both sit in the middle, at 100 % one is left and the other right.
 */
const chorus: EffectBuilder = (ctx, p) => {
  const input = new GainNode(ctx);
  const mono = new GainNode(ctx, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const lfo = new OscillatorNode(ctx, { frequency: num(p, 'rate') });
  const swing = new GainNode(ctx, { gain: num(p, 'depth') * CHORUS_SWING });
  const against = new GainNode(ctx, { gain: -1 });
  lfo.connect(swing).connect(against);
  lfo.start();
  const lines = [swing, against].map((mod) => {
    const line = new DelayNode(ctx, { delayTime: CHORUS_DELAY });
    mod.connect(line.delayTime);
    mono.connect(line);
    return line;
  });
  input.connect(mono);
  const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  // The gains of both lines into the left side, then into the right.
  const sides = [0, 1].map((side) =>
    lines.map((line, i) => line.connect(new GainNode(ctx, { gain: spreadGain(p, i === side) })) as GainNode),
  );
  sides.forEach((gains, side) => mix(ctx, gains).connect(merge, 0, side));
  const out = blend(ctx, input, merge, num(p, 'mix'));
  return {
    input,
    output: out.output,
    targets: {},
    update(p) {
      const t = ctx.currentTime;
      glide(lfo.frequency, num(p, 'rate'), t);
      glide(swing.gain, num(p, 'depth') * CHORUS_SWING, t);
      sides.forEach((gains, side) => gains.forEach((g, i) => glide(g.gain, spreadGain(p, i === side), t)));
      out.set(num(p, 'mix'), t);
    },
    dispose() {
      lfo.stop(ctx.currentTime + STOP_AFTER);
    },
  };
};

// ---- phaser

// The notches sweep up and down from PHASER_CENTRE by PHASER_SWEEP cents at full depth, about 105 Hz to 3.4 kHz.
const PHASER_CENTRE = 600;
const PHASER_SWEEP = 3000;
// A unit is two all-pass biquads with Q 0.5, which equal four first-order all-pass stages.
const PHASER_UNITS = 8;
const PHASER_TERMS = 4;

/**
 * The gain of each unit's output in the wet sum. Feedback around a chain of all-passes A gives A / (1 - fb A); a
 * loop in Web Audio has to go through a delay of at least 128 samples, which would comb the sound, so the wet sum
 * is the first PHASER_TERMS terms of that series instead, A + fb A^2 + fb^2 A^3 + ..., taken from a cascade of
 * units. Four stages are one unit to a term and eight stages two.
 */
function phaserTaps(p: Params): number[] {
  const per = p.stages === '8' ? 2 : 1;
  const fb = num(p, 'feedback');
  return Array.from({ length: PHASER_UNITS }, (_, i) => {
    const term = (i + 1) / per - 1;
    return Number.isInteger(term) && term < PHASER_TERMS ? fb ** term : 0;
  });
}

const phaser: EffectBuilder = (ctx, p, bpm) => {
  const input = new GainNode(ctx);
  const lfo = new OscillatorNode(ctx, { frequency: lfoRate(p, bpm) });
  const sweep = new GainNode(ctx, { gain: num(p, 'depth') * PHASER_SWEEP });
  lfo.connect(sweep);
  lfo.start();
  let last: AudioNode = input;
  const units = Array.from({ length: PHASER_UNITS }, () => {
    for (let i = 0; i < 2; i++) {
      const ap = new BiquadFilterNode(ctx, { type: 'allpass', frequency: PHASER_CENTRE, Q: 0.5 });
      // The sweep sets the corners once per 128 samples: at a quarter of the cost of every sample, and smooth
      // enough for its slow rates.
      ap.detune.automationRate = 'k-rate';
      sweep.connect(ap.detune);
      last = last.connect(ap);
    }
    return last;
  });
  const taps = phaserTaps(p).map((gain, i) => units[i].connect(new GainNode(ctx, { gain })) as GainNode);
  const out = blend(ctx, input, mix(ctx, taps), num(p, 'mix'));
  return {
    input,
    output: out.output,
    targets: {},
    update(p, bpm) {
      const t = ctx.currentTime;
      glide(lfo.frequency, lfoRate(p, bpm), t);
      glide(sweep.gain, num(p, 'depth') * PHASER_SWEEP, t);
      phaserTaps(p).forEach((gain, i) => glide(taps[i].gain, gain, t));
      out.set(num(p, 'mix'), t);
    },
    dispose() {
      lfo.stop(ctx.currentTime + STOP_AFTER);
    },
  };
};

// ---- width

/**
 * Mid and side: the side signal is scaled by Width, so 0 % is mono, 100 % unchanged and 200 % twice as wide.
 * Bass Mono takes the side away below its frequency, which keeps the bass in the middle.
 */
const width: EffectBuilder = (ctx, p) => {
  const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  input.connect(split);
  const half = (channel: number, gain: number) => {
    const g = new GainNode(ctx, { gain });
    split.connect(g, channel);
    return g;
  };
  const mid = mix(ctx, [half(0, 0.5), half(1, 0.5)]);
  const bass = lowCut(ctx, mix(ctx, [half(0, 0.5), half(1, -0.5)]), num(p, 'bass'));
  const side = new GainNode(ctx, { gain: num(p, 'width') });
  const negative = new GainNode(ctx, { gain: -1 });
  bass.output.connect(side).connect(negative);
  mix(ctx, [mid, side]).connect(merge, 0, 0);
  mix(ctx, [mid, negative]).connect(merge, 0, 1);
  return {
    input,
    output: merge,
    targets: {},
    update(p) {
      const t = ctx.currentTime;
      glide(side.gain, num(p, 'width'), t);
      bass.set(num(p, 'bass'), t);
    },
    dispose() {},
  };
};

/**
 * How long effects without feedback go on after their input stops, at most: the chorus by its longest delay, the
 * compressor by its look-ahead, and the phaser's all-passes, whose slowest corner is near 100 Hz, until they are
 * 80 dB down. The EQ, ring modulator and width stop at once.
 */
export const SHORT_TAILS: Readonly<Record<string, number>> = {
  chorus: CHORUS_DELAY + CHORUS_SWING,
  compressor: COMPRESSOR_LOOKAHEAD,
  phaser: 0.25,
};

export const EFFECT_BUILDERS: Readonly<Record<string, EffectBuilder>> = {
  filter, eq, compressor, drive, ring, chorus, phaser, width, delay, reverb,
};
