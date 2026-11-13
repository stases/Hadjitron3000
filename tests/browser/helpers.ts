// Measurements on rendered audio, and small builders for test sounds and projects.

import { AMP, MODULES } from '../../src/core/modules';
import { defaultParams } from '../../src/core/params';
import { emptyProject, newSound } from '../../src/core/defaults';
import type { Channel, ModInst, ModTarget, ModuleInst, Params, Project, Sound } from '../../src/core/types';
import { rowsOf } from '../support/steps';
import type { StepSpec } from '../support/steps';

export const SR = 44100;

export const frame = (t: number, sr = SR) => Math.round(t * sr);

/** The part of a channel between two times in seconds. */
export function slice(d: Float32Array, t0: number, t1: number, sr = SR): Float32Array {
  return d.subarray(frame(t0, sr), frame(t1, sr));
}

export function peak(d: Float32Array): number {
  let p = 0;
  for (const v of d) p = Math.max(p, Math.abs(v));
  return p;
}

export function rms(d: Float32Array): number {
  let s = 0;
  for (const v of d) s += v * v;
  return Math.sqrt(s / Math.max(d.length, 1));
}

export const db = (x: number) => 20 * Math.log10(x);

/** Largest difference between neighbouring samples: a click shows up as a jump. */
export function maxJump(d: Float32Array): number {
  let m = 0;
  for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1]));
  return m;
}

/** Frequency from the spacing of rising zero crossings (interpolated between samples). */
export function freq(d: Float32Array, sr = SR): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 1; i < d.length; i++) {
    if (d[i - 1] < 0 && d[i] >= 0) {
      const t = i - 1 + -d[i - 1] / (d[i] - d[i - 1]);
      if (first < 0) first = t;
      last = t;
      count++;
    }
  }
  return count > 1 ? ((count - 1) * sr) / (last - first) : 0;
}

/** Amplitude of the component at `f` hertz (a single Hann-windowed DFT bin). */
export function amplitudeAt(d: Float32Array, f: number, sr = SR): number {
  let re = 0;
  let im = 0;
  let wsum = 0;
  const n = d.length;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const ph = (2 * Math.PI * f * i) / sr;
    re += w * d[i] * Math.cos(ph);
    im -= w * d[i] * Math.sin(ph);
    wsum += w;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}

/** First time (seconds) at or after `from` where the signal exceeds `threshold`, or -1. */
export function onset(d: Float32Array, from: number, threshold = 1e-4, sr = SR): number {
  for (let i = frame(from, sr); i < d.length; i++) if (Math.abs(d[i]) > threshold) return i / sr;
  return -1;
}

export function finite(d: Float32Array): boolean {
  return d.every(Number.isFinite);
}

/** A 16-bit mono PCM WAV file. */
export function wav(samples: Float32Array, sr = SR): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return bytes;
}

export function tone(seconds: number, f: number, amp: number, sr = SR): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
}

export function adsr(attack: number, decay: number, sustain: number, release: number): Params {
  return { attack, decay, sustain, release };
}

/** A sound with full output level and centred pan; `source` overrides source parameters. */
export function sound(type: string, source: Params = {}, extra: Partial<Sound> = {}): Sound {
  const s = newSound(type);
  return {
    ...s,
    source: { ...s.source, params: { ...s.source.params, ...source } },
    amp: { ...defaultParams(AMP), ...extra.amp },
    out: { level: 0, pan: 0, ...extra.out },
    chain: extra.chain ?? [],
    mods: extra.mods ?? [],
  };
}

let ids = 0;

export function effect(type: string, params: Params = {}, on = true): ModuleInst {
  return { id: `fx${ids++}`, type, params: { ...defaultParams(MODULES[type]), ...params }, on };
}

export function mod(type: string, target: ModTarget | null, amount: number, params: Params = {}, on = true): ModInst {
  return { id: `mod${ids++}`, type, params: { ...defaultParams(MODULES[type]), ...params }, on, target, amount };
}

/** A one-pattern project; `steps` maps channel ids to their steps, which become notes. */
export function project(
  channels: (Partial<Channel> & { id: string; sound: Sound })[],
  steps: Record<string, Record<number, StepSpec>> = {},
  extra: Partial<Project> = {},
): Project {
  const p = emptyProject();
  p.channels = channels.map((c) => ({ color: 0, mute: false, solo: false, ...c }));
  p.patterns[0].notes = rowsOf(steps);
  return { ...p, master: 0, ...extra };
}
