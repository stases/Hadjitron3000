// Comb: a tuned delay that feeds back into itself through a low pass, so the sound rings at the delay's pitch and its
// harmonics; with negative feedback only the odd harmonics of half the pitch ring, an octave lower and hollow.

import { Processor, at, clamp, clean, flush, params, readCubic, register, ringSize, type Params } from './processor';

// The lowest pitch the delay holds, below the knob's range so that a modulator can take it lower.
const LOWEST = 20;
const MAX_FEEDBACK = 0.98;
// The loop's low pass at full damping: a one-pole whose corner is near 350 Hz at 44.1 kHz.
const MAX_DAMP = 0.95;

class Comb extends Processor {
  static parameterDescriptors = params('freq', 'detune', 'feedback', 'damp', 'mix');
  private readonly lines: [Float32Array, Float32Array];
  private readonly mask: number;
  private w = 0;
  private lowL = 0;
  private lowR = 0;
  // The loop delay for the last pitch and damping, which take turns to change only while a knob moves.
  private freq = 0;
  private pole = -1;
  private delay = 0;

  constructor() {
    super();
    const size = ringSize(this.sampleRate / LOWEST + 8);
    this.lines = [new Float32Array(size), new Float32Array(size)];
    this.mask = size - 1;
  }

  protected render(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, p: Params, n: number) {
    const sr = this.sampleRate;
    const [lineL, lineR] = this.lines;
    const mask = this.mask;
    let w = this.w;
    for (let i = 0; i < n; i++) {
      const freq = clamp(at(p.freq, i) * 2 ** (at(p.detune, i) / 1200), LOWEST, sr / 4);
      const a = MAX_DAMP * clamp(at(p.damp, i), 0, 1);
      if (freq !== this.freq || a !== this.pole) {
        this.freq = freq;
        this.pole = a;
        // The low pass delays the fundamental a little too; the line is shortened by as much, so it stays in tune.
        const omega = (2 * Math.PI * freq) / sr;
        this.delay = Math.max(3, sr / freq - Math.atan2(a * Math.sin(omega), 1 - a * Math.cos(omega)) / omega);
      }
      const g = clamp(at(p.feedback, i), -MAX_FEEDBACK, MAX_FEEDBACK);
      // Keeps the loudness of a broad sound the same whatever the feedback.
      const wet = Math.sqrt(1 - g * g) * clamp(at(p.mix, i), 0, 1);
      const dry = 1 - clamp(at(p.mix, i), 0, 1);
      const l = clean(inL[i]);
      const r = clean(inR[i]);
      this.lowL = flush((1 - a) * readCubic(lineL, mask, w, this.delay) + a * this.lowL);
      this.lowR = flush((1 - a) * readCubic(lineR, mask, w, this.delay) + a * this.lowR);
      const yl = l + g * this.lowL;
      const yr = r + g * this.lowR;
      lineL[w] = yl;
      lineR[w] = yr;
      outL[i] = l * dry + yl * wet;
      outR[i] = r * dry + yr * wet;
      w = (w + 1) & mask;
    }
    this.w = w;
  }
}

register('comb', Comb);
