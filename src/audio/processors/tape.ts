// Tape: the sound is recorded through a gentle saturation, played back from a delay whose length wanders (wow, slow;
// flutter, fast) so the pitch moves, with hiss under it and the highs rolled off by age.

import { Processor, at, clamp, clean, flush, params, readCubic, register, ringSize, type Params } from './processor';

// The playback head runs this far behind the record head, enough for the deepest wow.
const BASE = 0.006;
// Each wander is two sines, [hertz, share of the depth, starting phase]. Depth is the largest change of pitch
// at full amount, as a ratio: wow about 21 cents, flutter about 5.
const WOW = { depth: 0.012, parts: [[0.6, 0.7, 0], [0.23, 0.3, 1.3]] };
const FLUTTER = { depth: 0.003, parts: [[7.3, 0.6, 0.4], [11.1, 0.4, 2.1]] };
// Wow and flutter follow their knobs this slowly, so turning them bends the pitch no more than the wander does.
const AMOUNT_TAU = 0.3;
// The hiss at full amount (RMS), and how it follows the sound: full while the sound is above GATE, gone a
// moment after it stops, so a tape effect on a silent sound is silent.
const HISS = 0.02;
const GATE = 1e-3;
const GATE_RELEASE = 0.15;
const SATURATION = 4;
// Age rolls off the highs with two one-pole low passes, from TOP when new down to BOTTOM when old.
const TOP = 20000;
const BOTTOM = 2500;

class Tape extends Processor {
  static parameterDescriptors = params('wow', 'flutter', 'hiss', 'saturation', 'age');
  private readonly lines: [Float32Array, Float32Array];
  private readonly mask: number;
  private readonly base: number;
  // Per part of the wander: angle per frame, depth in samples per unit of amount, phase.
  private readonly waves: { step: number; depth: number; phase: number; flutter: boolean }[];
  private w = 0;
  private frame = 0;
  private wow = -1;
  private flutter = 0;
  private gate = 0;
  private seed = 0x9e3779b9;
  private readonly lows = new Float64Array(4);
  private age = -1;
  private coef = 0;

  constructor() {
    super();
    const sr = this.sampleRate;
    this.base = Math.round(BASE * sr);
    const size = ringSize(this.base * 2 + 8);
    this.lines = [new Float32Array(size), new Float32Array(size)];
    this.mask = size - 1;
    // A delay of A sin(wt) changes the pitch by A w cos(wt), so a part with share s of depth D swings by s D / w.
    const parts = (spec: typeof WOW, flutter: boolean) => spec.parts.map(([hz, share, phase]) => {
      const omega = 2 * Math.PI * hz;
      return { step: omega / sr, depth: ((share * spec.depth) / omega) * sr, phase, flutter };
    });
    this.waves = [...parts(WOW, false), ...parts(FLUTTER, true)];
  }

  /** White noise of RMS 1 from a xorshift generator. */
  private noise(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return (this.seed / 2 ** 31 - 1) * Math.sqrt(3);
  }

  protected render(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, p: Params, n: number) {
    const sr = this.sampleRate;
    const [lineL, lineR] = this.lines;
    const { mask, lows } = this;
    const follow = 1 - Math.exp(-1 / (AMOUNT_TAU * sr));
    const release = Math.exp(-1 / (GATE_RELEASE * sr));
    if (this.wow < 0) {
      this.wow = clamp(at(p.wow, 0), 0, 1);
      this.flutter = clamp(at(p.flutter, 0), 0, 1);
    }
    let w = this.w;
    for (let i = 0; i < n; i++) {
      this.wow += (clamp(at(p.wow, i), 0, 1) - this.wow) * follow;
      this.flutter += (clamp(at(p.flutter, i), 0, 1) - this.flutter) * follow;
      let delay = this.base;
      for (let j = 0; j < this.waves.length; j++) {
        const wave = this.waves[j];
        delay += (wave.flutter ? this.flutter : this.wow) * wave.depth * Math.sin(wave.step * this.frame + wave.phase);
      }
      const k = SATURATION * clamp(at(p.saturation, i), 0, 1);
      const l = clean(inL[i]);
      const r = clean(inR[i]);
      lineL[w] = k > 1e-3 ? Math.tanh(k * l) / k : l;
      lineR[w] = k > 1e-3 ? Math.tanh(k * r) / k : r;
      const level = Math.max(Math.abs(l), Math.abs(r));
      this.gate = flush(level > this.gate ? level : this.gate * release);
      const hiss = HISS * clamp(at(p.hiss, i), 0, 1) ** 2 * Math.min(1, this.gate / GATE);
      let yl = readCubic(lineL, mask, w, delay);
      let yr = readCubic(lineR, mask, w, delay);
      if (hiss > 0) {
        yl += hiss * this.noise();
        yr += hiss * this.noise();
      }
      const age = clamp(at(p.age, i), 0, 1);
      if (age !== this.age) {
        this.age = age;
        this.coef = 1 - Math.exp((-2 * Math.PI * TOP * (BOTTOM / TOP) ** age) / sr);
      }
      const c = this.coef;
      lows[0] = flush(lows[0] + c * (yl - lows[0]));
      lows[1] = flush(lows[1] + c * (lows[0] - lows[1]));
      lows[2] = flush(lows[2] + c * (yr - lows[2]));
      lows[3] = flush(lows[3] + c * (lows[2] - lows[3]));
      outL[i] = lows[1];
      outR[i] = lows[3];
      w = (w + 1) & mask;
      this.frame++;
    }
    this.w = w;
  }
}

register('tape', Tape);
