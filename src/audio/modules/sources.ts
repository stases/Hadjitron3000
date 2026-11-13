// Per-voice sources. Each builder creates and starts the nodes of one note.

import { noteFreq } from '../../core/notes';
import type { Params } from '../../core/types';
import { mix } from '../mix';
import { noiseBuffer, type NoiseColor } from '../random';
import { reversedBuffer, sampleBuffer } from '../samples';

export interface SourceVoice {
  output: AudioNode;
  /** Every scheduled node of the voice; they are stopped together when the voice ends. */
  nodes: AudioScheduledSourceNode[];
  /** Mod targets of the source, by parameter id. */
  targets: Record<string, AudioParam[]>;
  /** A one-shot sample plays for this long whatever the note length. */
  length?: number;
}

/** `serial` counts voices, so that successive noise voices start at different points of the loop. */
export type SourceBuilder = (ctx: BaseAudioContext, p: Params, note: number, t0: number, serial: number) => SourceVoice | null;

// A non-looping sample region ends with this fade, so cutting it mid-wave does not click.
const REGION_FADE = 0.004;

const cents = (p: Params) => (p.pitch as number) * 100 + (p.fine as number);

function noise(ctx: BaseAudioContext, color: NoiseColor, t0: number, serial: number): AudioBufferSourceNode {
  const buffer = noiseBuffer(ctx, color);
  const src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
  src.start(t0, ((serial * 0.6180339887) % 1) * buffer.duration);
  return src;
}

const osc: SourceBuilder = (ctx, p, note, t0, serial) => {
  const n = Math.round(p.voices as number);
  const spread = p.spread as number;
  const width = p.width as number;
  const amount = p.noise as number;
  const out = new GainNode(ctx);
  const tone = new GainNode(ctx, { gain: (1 - amount) / Math.sqrt(n) });
  tone.connect(out);
  const oscs: OscillatorNode[] = [];
  const panned: AudioNode[] = [];
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? (2 * i) / (n - 1) - 1 : 0;
    const o = new OscillatorNode(ctx, {
      type: p.wave as OscillatorType,
      frequency: noteFreq(note),
      detune: cents(p) + x * spread,
    });
    o.start(t0);
    oscs.push(o);
    panned.push(n > 1 ? o.connect(new StereoPannerNode(ctx, { pan: x * width })) : o);
  }
  mix(ctx, panned).connect(tone);
  const nodes: AudioScheduledSourceNode[] = [...oscs];
  if (amount > 0) {
    const nz = noise(ctx, 'white', t0, serial);
    nz.connect(new GainNode(ctx, { gain: amount })).connect(out);
    nodes.push(nz);
  }
  return { output: out, nodes, targets: { pitch: oscs.map((o) => o.detune) } };
};

const fm: SourceBuilder = (ctx, p, note, t0) => {
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
  };
};

const noiseSource: SourceBuilder = (ctx, p, _note, t0, serial) => {
  const src = noise(ctx, p.color as NoiseColor, t0, serial);
  return { output: src, nodes: [src], targets: {} };
};

const sample: SourceBuilder = (ctx, p, note, t0) => {
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
  const voice: SourceVoice = { output: src, nodes: [src], targets: { pitch: [src.detune] } };
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
