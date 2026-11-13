// Per-voice sources. Each builder creates and starts the nodes of one note.

import { noteFreq } from '../../core/notes';
import { decodeShape, shapeHarmonics } from '../../core/shape';
import type { Params } from '../../core/types';
import { mix } from '../mix';
import { noiseBuffer, type NoiseColor } from '../random';
import { reversedBuffer, sampleBuffer } from '../samples';

/**
 * A parameter that moves with the voice's pitch when it glides: by `k` cents per cent (a detune), or, as a period,
 * by the factor 2^(-cents / 1200).
 */
export type Follower = { param: AudioParam; base: number } & ({ k: number } | { period: true });

export interface SourceVoice {
  output: AudioNode;
  /** Every scheduled node of the voice; they are stopped together when the voice ends. */
  nodes: AudioScheduledSourceNode[];
  /** Mod targets of the source, by parameter id. */
  targets: Record<string, AudioParam[]>;
  /** What changes when the pitch of the voice glides. */
  followers: Follower[];
  /** A one-shot sample plays for this long whatever the note length. */
  length?: number;
  /** Follow a new drawing of a drawn wave while the note sounds. */
  redraw?(p: Params, t: number): void;
}

export interface VoiceStart {
  note: number;
  t0: number;
  /** Counts voices, so that successive noise voices start at different points of the loop. */
  serial: number;
  /** Source parameters that a modulator moves. */
  modulated: ReadonlySet<string>;
}

export type SourceBuilder = (ctx: BaseAudioContext, p: Params, v: VoiceStart) => SourceVoice | null;

// A non-looping sample region ends with this fade, so cutting it mid-wave does not click.
const REGION_FADE = 0.004;
// The longest pulse period, in seconds (a note of 4 Hz).
const MAX_PERIOD = 0.25;
// A drawn wave has this many harmonics, enough for the lowest notes; the oscillator drops those above Nyquist.
const DRAWN_HARMONICS = 512;
// The last few drawn waves of each context are kept, so that notes of the same drawing share one.
const DRAWN_CACHE = 8;
// A new drawing crossfades into a held note with this time constant.
const REDRAW_TAU = 0.005;
const drawnWaves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

/** The band-limited wave of a drawing, at the level it was drawn. */
function drawnWave(ctx: BaseAudioContext, shape: string): PeriodicWave {
  let cache = drawnWaves.get(ctx);
  if (!cache) drawnWaves.set(ctx, (cache = new Map()));
  let wave = cache.get(shape);
  if (!wave) {
    const { real, imag } = shapeHarmonics(decodeShape(shape)!, DRAWN_HARMONICS);
    wave = new PeriodicWave(ctx, { real, imag, disableNormalization: true });
    if (cache.size >= DRAWN_CACHE) cache.delete(cache.keys().next().value!);
  }
  cache.delete(shape);
  cache.set(shape, wave);
  return wave;
}

const cents = (p: Params) => (p.pitch as number) * 100 + (p.fine as number);
const follow = (param: AudioParam): Follower => ({ param, base: param.value, k: 1 });

function noise(ctx: BaseAudioContext, color: NoiseColor, t0: number, serial: number): AudioBufferSourceNode {
  const buffer = noiseBuffer(ctx, color);
  const src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
  src.start(t0, ((serial * 0.6180339887) % 1) * buffer.duration);
  return src;
}

/**
 * A pulse wave made of a sawtooth minus the same sawtooth delayed by a share of its period: the share is the pulse
 * width. Both parts are band-limited, so the pulse does not alias, and moving the delay moves the width smoothly.
 * At 50 % it is the square wave, harmonic for harmonic. The delay is a period at the note's own pitch, so the width
 * follows a glide but not other pitch modulation.
 */
function pulse(
  ctx: BaseAudioContext, saw: AudioNode, width: number, freq: number, t0: number, out: SourceVoice,
): AudioNode {
  const share = new ConstantSourceNode(ctx, { offset: width });
  share.start(t0);
  const period = new GainNode(ctx, { gain: 1 / freq });
  const delay = new DelayNode(ctx, { maxDelayTime: MAX_PERIOD, delayTime: 0 });
  share.connect(period).connect(delay.delayTime);
  saw.connect(delay);
  out.nodes.push(share);
  (out.targets.pw ??= []).push(share.offset);
  out.followers.push({ param: period.gain, base: 1 / freq, period: true });
  return mix(ctx, [saw, delay.connect(new GainNode(ctx, { gain: -1 }))]);
}

const osc: SourceBuilder = (ctx, p, { note, t0, serial, modulated }) => {
  const n = Math.round(p.voices as number);
  const spread = p.spread as number;
  const width = p.width as number;
  const amount = p.noise as number;
  const mix2 = p.mix2 as number;
  const sub = p.sub as number;
  const pw = p.pw as number;
  const out = new GainNode(ctx);
  const voice: SourceVoice = { output: out, nodes: [], targets: { pitch: [] }, followers: [] };
  const redraws: ((p: Params, t: number) => void)[] = [];
  const started = (o: OscillatorNode) => {
    o.start(t0);
    voice.nodes.push(o);
    voice.targets.pitch.push(o.detune);
    voice.followers.push(follow(o.detune));
    return o;
  };
  /**
   * A drawn wave plays on two oscillators started together, one of them silent. A new drawing goes into the silent
   * one, which then crossfades in; started at the same moment and moved alike, the two never drift apart in phase.
   */
  const drawn = (key: string, detune: number): AudioNode => {
    let shape = p[key] as string;
    const pair = [0, 1].map(() =>
      started(new OscillatorNode(ctx, { frequency: noteFreq(note), detune, periodicWave: drawnWave(ctx, shape) })),
    );
    const gains = pair.map((o, i) => {
      const gain = new GainNode(ctx, { gain: 1 - i });
      o.connect(gain);
      return gain;
    });
    let live = 0;
    redraws.push((p, t) => {
      if (p[key] === shape) return;
      shape = p[key] as string;
      live = 1 - live;
      pair[live].setPeriodicWave(drawnWave(ctx, shape));
      gains[live].gain.setTargetAtTime(1, t, REDRAW_TAU);
      gains[1 - live].gain.setTargetAtTime(0, t, REDRAW_TAU);
    });
    return mix(ctx, gains);
  };
  const oscillator = (wave: string, shape: string, detune: number, pan: number) => {
    const o = wave === 'draw'
      ? drawn(shape, detune)
      : started(new OscillatorNode(ctx, { type: wave as OscillatorType, frequency: noteFreq(note), detune }));
    return n > 1 ? o.connect(new StereoPannerNode(ctx, { pan })) : o;
  };
  /**
   * One oscillator with its unison voices; a square becomes a pulse when its width is not 50 % or is moved. `shape`
   * is the parameter that holds its drawing.
   */
  const stack = (wave: string, shape: string, at: number): AudioNode => {
    const square = wave === 'square' && (pw !== 0.5 || modulated.has('pw'));
    const type = square ? 'sawtooth' : wave;
    const panned = Array.from({ length: n }, (_, i) => {
      const x = n > 1 ? (2 * i) / (n - 1) - 1 : 0;
      return oscillator(type, shape, at + x * spread, x * width);
    });
    const sum = mix(ctx, panned);
    return square ? pulse(ctx, sum, pw, noteFreq(note + at / 100), t0, voice) : sum;
  };
  // Each part and its gain; the tone stage divides by the square root of the unison count.
  const parts: [AudioNode, number][] = [];
  if (mix2 < 1) parts.push([stack(p.wave as string, 'shape', cents(p)), 1 - mix2]);
  const cents2 = cents(p) + (p.pitch2 as number) * 100 + (p.fine2 as number);
  if (mix2 > 0) parts.push([stack(p.wave2 as string, 'shape2', cents2), mix2]);
  if (sub > 0) parts.push([oscillator('sine', '', cents(p) + 1200 * (p.subOct as number), 0), sub * Math.sqrt(n)]);
  const tone = new GainNode(ctx, { gain: (1 - amount) / Math.sqrt(n) });
  tone.connect(out);
  if (parts.length === 1 && parts[0][1] === 1) parts[0][0].connect(tone);
  else mix(ctx, parts.map(([node, gain]) => node.connect(new GainNode(ctx, { gain })))).connect(tone);
  if (amount > 0) {
    const nz = noise(ctx, 'white', t0, serial);
    nz.connect(new GainNode(ctx, { gain: amount })).connect(out);
    voice.nodes.push(nz);
  }
  if (redraws.length) voice.redraw = (p, t) => redraws.forEach((redraw) => redraw(p, t));
  return voice;
};

const fm: SourceBuilder = (ctx, p, { note, t0 }) => {
  const f = noteFreq(note);
  const ratio = p.ratio as number;
  const carrier = new OscillatorNode(ctx, { frequency: f, detune: cents(p) });
  const mod = new OscillatorNode(ctx, { frequency: f * ratio, detune: cents(p) });
  const index = new GainNode(ctx, { gain: p.amount as number });
  // Detune scales the carrier's whole frequency input, deviation included, so the index stays exact.
  mod.connect(index).connect(new GainNode(ctx, { gain: f * ratio })).connect(carrier.frequency);
  carrier.start(t0);
  mod.start(t0);
  return {
    output: carrier,
    nodes: [carrier, mod],
    targets: { pitch: [carrier.detune, mod.detune], amount: [index.gain] },
    followers: [follow(carrier.detune), follow(mod.detune)],
  };
};

const noiseSource: SourceBuilder = (ctx, p, { t0, serial }) => {
  const src = noise(ctx, p.color as NoiseColor, t0, serial);
  return { output: src, nodes: [src], targets: {}, followers: [] };
};

const sample: SourceBuilder = (ctx, p, { note, t0 }) => {
  const original = sampleBuffer(p.sample as string);
  if (!original) return null;
  const len = original.duration;
  let a = (p.start as number) * len;
  let b = (p.end as number) * len;
  if (b <= a) return null;
  const buffer = p.reverse ? reversedBuffer(original) : original;
  if (p.reverse) [a, b] = [len - b, len - a];
  const rate = 2 ** ((note - 60) / 12);
  const loop = p.loop as boolean;
  const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate, detune: cents(p), loop, loopStart: a, loopEnd: b });
  const voice: SourceVoice = {
    output: src, nodes: [src], targets: { pitch: [src.detune] }, followers: [follow(src.detune)],
  };
  if (loop) {
    src.start(t0, a);
    return voice;
  }
  src.start(t0, a, b - a);
  const playTime = (b - a) / (rate * 2 ** (cents(p) / 1200));
  const fade = new GainNode(ctx);
  fade.gain.setValueAtTime(1, t0 + Math.max(playTime - REGION_FADE, 0));
  fade.gain.linearRampToValueAtTime(0, t0 + playTime);
  voice.output = src.connect(fade);
  if (p.mode === 'oneshot') voice.length = playTime;
  return voice;
};

export const SOURCE_BUILDERS: Readonly<Record<string, SourceBuilder>> = { osc, fm, noise: noiseSource, sample };
