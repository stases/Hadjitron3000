// What a modulator plays before its depth: an envelope's level, an LFO's wave or Drift's wandering value.

import { SYNC_BEATS } from '../../core/modules';
import type { Params } from '../../core/types';
import { cut, glide, schedule, type Plan } from '../automation';
import { rng } from '../random';

export interface ModSource {
  output: AudioNode;
  /** An envelope's level, which the channel writes its segments into; absent for the others. */
  level?: AudioParam;
  /** Follow new parameters and a new tempo. */
  update(p: Params, bpm: number): void;
  /** A new note at `t` of a modulator of the whole sound: the fade-in starts again and a retriggered LFO restarts. */
  noteOn(t: number): void;
  stop(t: number): void;
}

/** Where a modulator starts: `t0`, in every note or once for the whole sound, and a counter for random offsets. */
export interface ModStart {
  t0: number;
  perNote: boolean;
  seed: () => number;
}

// A whole-sound fade that starts again dips to nothing in this time first.
const FADE_DIP = 0.005;

/** An LFO's rate in hertz: its own, or one cycle per note value at the tempo. */
export const lfoRate = (p: Params, bpm: number) =>
  p.sync === 'free' ? (p.rate as number) : bpm / 60 / SYNC_BEATS[p.sync as string];

function envelope(ctx: BaseAudioContext, { t0 }: ModStart): ModSource {
  const node = new ConstantSourceNode(ctx, { offset: 0 });
  node.start(t0);
  return { output: node, level: node.offset, update() {}, noteOn() {}, stop: (t) => node.stop(t) };
}

/** An oscillator after a gain that fades the depth in; a retriggered one is replaced by a new one at every note. */
function lfo(ctx: BaseAudioContext, p: Params, bpm: number, { t0, perNote }: ModStart): ModSource {
  const fade = new GainNode(ctx);
  let params = p;
  let rate = lfoRate(p, bpm);
  let stopAt = Infinity;
  let plan: Plan | null = null;
  const make = (t: number) => {
    const o = new OscillatorNode(ctx, { type: params.wave as OscillatorType, frequency: rate });
    o.connect(fade);
    o.start(t);
    if (stopAt < Infinity) o.stop(stopAt);
    return o;
  };
  let osc = make(t0);
  const fadeIn = (t: number) => {
    const time = params.fade as number;
    if (time <= 0) return;
    const level = plan ? cut(fade.gain, plan, t) : perNote ? 0 : 1;
    if (!plan) fade.gain.cancelScheduledValues(t);
    const rise = { end: time, from: 0, to: 1, tau: 0 };
    plan = {
      t0: t,
      scale: 1,
      segs: level > 0
        ? [{ start: 0, end: FADE_DIP, from: level, to: 0, tau: 0 }, { ...rise, start: FADE_DIP, end: FADE_DIP + time }]
        : [{ ...rise, start: 0 }],
    };
    schedule(fade.gain, plan);
  };
  if (perNote) fadeIn(t0);
  return {
    output: fade,
    update(p, bpm) {
      const t = ctx.currentTime;
      params = p;
      rate = lfoRate(p, bpm);
      osc.type = p.wave as OscillatorType;
      glide(osc.frequency, rate, t);
      if ((p.fade as number) > 0 || !plan) return;
      plan = null;
      fade.gain.cancelScheduledValues(t);
      glide(fade.gain, 1, t);
    },
    noteOn(t) {
      fadeIn(t);
      if (!params.retrigger) return;
      osc.stop(t);
      osc = make(t);
    },
    stop(t) {
      stopAt = t;
      osc.stop(t);
    },
  };
}

// Drift reads a looping buffer of random values, CELL samples to a value, at DRIFT_RATE samples a second at speed 1.
const DRIFT_CELLS = 4096;
const CELL = 64;
const DRIFT_RATE = 3000;
// Moving the Smooth knob crossfades to the buffer of the new setting at the same place in this time.
const DRIFT_SWAP = 0.03;
const driftBuffers = new Map<number, AudioBuffer>();

/**
 * The same random values for every setting of Smooth: each one holds for the first (1 - smooth) of its cell and
 * glides along half a cosine to the next one in the rest. The last glides into the first, so the loop is seamless.
 */
function driftBuffer(smooth: number): AudioBuffer {
  let buffer = driftBuffers.get(smooth);
  if (buffer) return buffer;
  const next = rng(31);
  const values = Array.from({ length: DRIFT_CELLS }, next);
  buffer = new AudioBuffer({ length: DRIFT_CELLS * CELL, sampleRate: DRIFT_RATE, numberOfChannels: 1 });
  const data = buffer.getChannelData(0);
  for (let c = 0; c < DRIFT_CELLS; c++) {
    const a = values[c];
    const b = values[(c + 1) % DRIFT_CELLS];
    for (let j = 0; j < CELL; j++) {
      const w = smooth > 0 ? Math.max(0, (j / CELL - (1 - smooth)) / smooth) : 0;
      data[c * CELL + j] = a + ((b - a) * (1 - Math.cos(Math.PI * w))) / 2;
    }
  }
  driftBuffers.set(smooth, buffer);
  return buffer;
}

/** Playback speed of the drift buffer for a rate of new values per second. */
const driftSpeed = (p: Params) => ((p.rate as number) * CELL) / DRIFT_RATE;

/** Drift starts at a different place of its long loop every time, so no two notes wander alike. */
function drift(ctx: BaseAudioContext, p: Params, { t0, seed }: ModStart): ModSource {
  const output = new GainNode(ctx);
  const length = (DRIFT_CELLS * CELL) / DRIFT_RATE;
  let speed = driftSpeed(p);
  let smooth = p.smooth as number;
  let stopAt = Infinity;
  // Where in the buffer (in its seconds) the reading is at time `t`.
  let mark = { t: t0, at: ((seed() * 0.6180339887) % 1) * length };
  const at = (t: number) => (((mark.at + (t - mark.t) * speed) % length) + length) % length;
  const play = (t: number, gain: number) => {
    const src = new AudioBufferSourceNode(ctx, { buffer: driftBuffer(smooth), loop: true, playbackRate: speed });
    const level = new GainNode(ctx, { gain });
    src.connect(level).connect(output);
    src.start(t, at(t));
    if (stopAt < Infinity) src.stop(stopAt);
    return { src, level };
  };
  let current = play(t0, 1);
  return {
    output,
    update(p) {
      const t = Math.max(ctx.currentTime, mark.t);
      if (driftSpeed(p) !== speed) {
        mark = { t, at: at(t) };
        speed = driftSpeed(p);
        current.src.playbackRate.setValueAtTime(speed, t);
      }
      if (p.smooth === smooth) return;
      smooth = p.smooth as number;
      const old = current;
      current = play(t, 0);
      current.level.gain.setValueAtTime(0, t);
      current.level.gain.linearRampToValueAtTime(1, t + DRIFT_SWAP);
      old.level.gain.setValueAtTime(1, t);
      old.level.gain.linearRampToValueAtTime(0, t + DRIFT_SWAP);
      old.src.stop(Math.min(stopAt, t + DRIFT_SWAP));
    },
    noteOn() {},
    stop(t) {
      stopAt = t;
      current.src.stop(t);
    },
  };
}

export function modSource(ctx: BaseAudioContext, type: string, p: Params, bpm: number, start: ModStart): ModSource {
  if (type === 'lfo') return lfo(ctx, p, bpm, start);
  if (type === 'drift') return drift(ctx, p, start);
  return envelope(ctx, start);
}
