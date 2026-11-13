// Space: an algorithmic reverb. Four all-pass diffusers on each side smear the input, which then circulates in a
// feedback delay network of eight lines mixed by a Hadamard matrix (Jot's design). On every pass each line is
// low-passed by Tone and turned down so that the tail falls 60 dB in Size seconds. Slow sines swing the line
// lengths a little, so long tails do not ring metallically. Freeze makes the loop lossless and shuts its input, so
// the tail holds while new notes play dry on top; Shimmer feeds the tail back into the loop an octave up. Dry is how
// much of the input passes as it is: all of it in a sound, 1 - Mix on a bus or the master.

import { Processor, at, clamp, clean, flush, params, readCubic, register, ringSize, type Params } from './processor';

const LINES = [31.3, 37.9, 41.9, 46.1, 53.3, 59.9, 67.7, 73.1]; // ms
const SWING_HZ = [0.13, 0.17, 0.21, 0.24, 0.29, 0.31, 0.37, 0.41];
const SWING_MS = 0.35;
const DIFFUSERS = [4.71, 3.63, 12.73, 9.31]; // ms on the left, RIGHT_STRETCH times as long on the right
const RIGHT_STRETCH = 1.071;
const DIFFUSION = 0.6;
// Signs with which the left input, the right input and the shimmer enter the lines, and with which the lines make
// the left and right outputs. Each pair is orthogonal, so the two sides of the tail are uncorrelated.
const IN_L = [1, -1, 1, 1, -1, 1, -1, -1];
const IN_R = [1, 1, -1, 1, -1, -1, 1, -1];
const IN_SHIMMER = [1, 1, 1, -1, 1, -1, -1, -1];
const OUT_L = [1, -1, 1, -1, 1, -1, 1, -1];
const OUT_R = [1, 1, -1, -1, 1, 1, -1, -1];
const IN_GAIN = 0.25;
// The octave-up shifter reads its input with two grains of this length, crossfaded.
const GRAIN = 0.06;
const SHIMMER_GAIN = 1;
// The shifter only hears the tail between these frequencies. Shifted up, the lowest would stay where they are and
// the highest would fold back down past Nyquist, and either could then build up round the loop for ever.
const SHIMMER_LOW = 120;
const SHIMMER_HIGH = 6000;
const N = LINES.length;

/** A biquad's coefficients b0, b1, b2, a1, a2 (Robert Bristow-Johnson's cookbook). */
function biquad(lowpass: boolean, f: number, q: number, sr: number): number[] {
  const w = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const b0 = (lowpass ? 1 - cos : 1 + cos) / 2;
  const a0 = 1 + alpha;
  return [b0 / a0, (lowpass ? 2 * b0 : -2 * b0) / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

class Space extends Processor {
  static parameterDescriptors = params('size', 'tone', 'mix', 'dry', 'freeze', 'shimmer');
  private readonly lines: Float32Array[];
  private readonly lengths: Float64Array;
  private readonly mask: number;
  private readonly diffusers: { buf: Float32Array; length: number }[][];
  private readonly diffuseMask: number;
  private readonly lows = new Float64Array(N);
  private readonly mixed = new Float64Array(N);
  private readonly gains = new Float64Array(N);
  private readonly norms = new Float64Array(N);
  // Each swing is a sine and cosine pair turned by a fixed angle every frame.
  private readonly swingSin = new Float64Array(N);
  private readonly swingCos = new Float64Array(N);
  private readonly turnSin = new Float64Array(N);
  private readonly turnCos = new Float64Array(N);
  private readonly swingDepth: number;
  private readonly shift: Float32Array;
  private readonly shiftMask: number;
  private readonly window: Float64Array;
  // A high pass and a fourth-order low pass in front of the shifter, as three biquads and their states.
  private readonly band: Float64Array;
  private readonly bandState = new Float64Array(6);
  private grain = 0;
  private w = 0;
  private size = -1;
  private tone = -1;
  private pole = 0;
  private lastL = 0;
  private lastR = 0;

  constructor() {
    super();
    const sr = this.sampleRate;
    this.swingDepth = (SWING_MS / 1000) * sr;
    this.lengths = Float64Array.from(LINES, (ms) => Math.round((ms / 1000) * sr));
    const size = ringSize(this.lengths[N - 1] + this.swingDepth + 8);
    this.lines = LINES.map(() => new Float32Array(size));
    this.mask = size - 1;
    const longest = Math.round((DIFFUSERS[2] / 1000) * RIGHT_STRETCH * sr);
    const diffuseSize = ringSize(longest + 2);
    this.diffuseMask = diffuseSize - 1;
    this.diffusers = [1, RIGHT_STRETCH].map((stretch) =>
      DIFFUSERS.map((ms) => ({ buf: new Float32Array(diffuseSize), length: Math.round((ms / 1000) * stretch * sr) })),
    );
    for (let i = 0; i < N; i++) {
      const angle = (2 * Math.PI * SWING_HZ[i]) / sr;
      this.turnSin[i] = Math.sin(angle);
      this.turnCos[i] = Math.cos(angle);
      this.swingSin[i] = Math.sin(i * 0.9);
      this.swingCos[i] = Math.cos(i * 0.9);
    }
    const grain = 2 * Math.round((GRAIN * sr) / 2);
    this.window = Float64Array.from({ length: grain }, (_, j) => Math.sin((Math.PI * j) / grain) ** 2);
    this.shift = new Float32Array(ringSize(grain + 2));
    this.shiftMask = this.shift.length - 1;
    const high = Math.min(SHIMMER_HIGH, 0.2 * sr);
    this.band = Float64Array.from([
      ...biquad(false, SHIMMER_LOW, Math.SQRT1_2, sr), ...biquad(true, high, 0.5412, sr), ...biquad(true, high, 1.3066, sr),
    ]);
  }

  /** One side through its all-pass diffusers. */
  private diffuse(x: number, side: number): number {
    const chain = this.diffusers[side];
    for (let k = 0; k < chain.length; k++) {
      const { buf, length } = chain[k];
      const z = buf[(this.w - length) & this.diffuseMask];
      const v = flush(x - DIFFUSION * z);
      buf[this.w & this.diffuseMask] = v;
      x = z + DIFFUSION * v;
    }
    return x;
  }

  /** The tail an octave up: two grains read twice as fast as they are written, each faded in and out. */
  private shimmer(x: number): number {
    const { shift, shiftMask, window, band, bandState } = this;
    for (let k = 0; k < 3; k++) {
      const c = 5 * k;
      const z = 2 * k;
      const y = band[c] * x + bandState[z];
      bandState[z] = flush(band[c + 1] * x - band[c + 3] * y + bandState[z + 1]);
      bandState[z + 1] = flush(band[c + 2] * x - band[c + 4] * y);
      x = y;
    }
    const grain = window.length;
    shift[this.w & shiftMask] = x;
    const j = this.grain;
    const k = (j + grain / 2) % grain;
    const y = shift[(this.w - j - 1) & shiftMask] * window[j] + shift[(this.w - k - 1) & shiftMask] * window[k];
    this.grain = j > 0 ? j - 1 : grain - 1;
    return y;
  }

  protected render(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, p: Params, n: number) {
    const sr = this.sampleRate;
    const { lines, lengths, mask, lows, mixed, gains, norms, swingSin, swingCos, turnSin, turnCos } = this;
    for (let i = 0; i < n; i++) {
      const size = clamp(at(p.size, i), 0.05, 1000);
      if (size !== this.size) {
        this.size = size;
        for (let k = 0; k < N; k++) {
          gains[k] = 10 ** ((-3 * lengths[k]) / (size * sr));
          norms[k] = Math.sqrt(1 - gains[k] * gains[k]);
        }
      }
      const tone = clamp(at(p.tone, i), 20, sr / 2);
      if (tone !== this.tone) {
        this.tone = tone;
        this.pole = Math.exp((-2 * Math.PI * tone) / sr);
      }
      const frozen = clamp(at(p.freeze, i), 0, 1);
      const open = 1 - frozen;
      const pole = this.pole * open;
      const l = this.diffuse(clean(inL[i]), 0);
      const r = this.diffuse(clean(inR[i]), 1);
      const lifted = Math.tanh(SHIMMER_GAIN * clamp(at(p.shimmer, i), 0, 1) * this.shimmer(0.5 * (this.lastL + this.lastR)));
      let wetL = 0;
      let wetR = 0;
      for (let k = 0; k < N; k++) {
        const s = swingSin[k];
        const c = swingCos[k];
        swingSin[k] = s * turnCos[k] + c * turnSin[k];
        swingCos[k] = c * turnCos[k] - s * turnSin[k];
        const read = readCubic(lines[k], mask, this.w, lengths[k] + this.swingDepth * s);
        wetL += OUT_L[k] * read;
        wetR += OUT_R[k] * read;
        lows[k] = flush(read + pole * (lows[k] - read));
        mixed[k] = lows[k] * (gains[k] + (1 - gains[k]) * frozen);
      }
      // The Hadamard matrix, as a fast transform, scaled to keep the energy.
      for (let h = 1; h < N; h *= 2) {
        for (let a = 0; a < N; a += 2 * h) {
          for (let b = a; b < a + h; b++) {
            const x = mixed[b];
            const y = mixed[b + h];
            mixed[b] = x + y;
            mixed[b + h] = x - y;
          }
        }
      }
      const w = this.w & mask;
      for (let k = 0; k < N; k++) {
        const input = IN_GAIN * (IN_L[k] * l + IN_R[k] * r + IN_SHIMMER[k] * lifted);
        lines[k][w] = flush(mixed[k] * Math.SQRT1_2 * 0.5 + norms[k] * open * input);
      }
      this.lastL = wetL;
      this.lastR = wetR;
      const m = clamp(at(p.mix, i), 0, 1);
      const dry = clamp(at(p.dry, i), 0, 1);
      outL[i] = clean(inL[i]) * dry + m * this.lastL;
      outR[i] = clean(inR[i]) * dry + m * this.lastR;
      this.w = (this.w + 1) | 0;
    }
    // Keep the swings on the unit circle against rounding.
    for (let k = 0; k < N; k++) {
      const scale = 1 / Math.hypot(swingSin[k], swingCos[k]);
      swingSin[k] *= scale;
      swingCos[k] *= scale;
    }
  }
}

register('space', Space);
