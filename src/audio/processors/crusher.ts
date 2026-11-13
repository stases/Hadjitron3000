// Crusher: fewer bits and a lower sample rate. The rate holds each sample until the next one is due, so high notes
// fold back down as aliases; the bits round every sample to a coarser step. 16 bits at the full rate is the input.

import { Processor, at, clamp, clean, params, register, type Params } from './processor';

class Crusher extends Processor {
  static parameterDescriptors = params('bits', 'rate', 'detune', 'mix');
  // Where the next sample is taken: one whole is one sample at the reduced rate.
  private phase = 1;
  private heldL = 0;
  private heldR = 0;

  protected render(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, p: Params, n: number) {
    const { bits, rate, detune, mix } = p;
    const steady = rate.length === 1 && detune.length === 1;
    let step = steady ? (rate[0] * 2 ** (detune[0] / 1200)) / this.sampleRate : 0;
    for (let i = 0; i < n; i++) {
      const l = clean(inL[i]);
      const r = clean(inR[i]);
      if (!steady) step = (at(rate, i) * 2 ** (at(detune, i) / 1200)) / this.sampleRate;
      this.phase += step > 0 ? step : 0;
      if (this.phase >= 1) {
        this.phase -= Math.floor(this.phase);
        this.heldL = l;
        this.heldR = r;
      }
      const b = at(bits, i);
      // 2^(bits - 1) steps on each side of zero; at 16 bits nothing is rounded.
      const k = b < 16 ? 2 ** (clamp(b, 1, 16) - 1) : 0;
      const m = clamp(at(mix, i), 0, 1);
      outL[i] = l * (1 - m) + (k ? Math.round(this.heldL * k) / k : this.heldL) * m;
      outR[i] = r * (1 - m) + (k ? Math.round(this.heldR * k) / k : this.heldR) * m;
    }
  }
}

register('crusher', Crusher);
