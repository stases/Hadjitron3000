// Grains: a cloud of short overlapping pieces of a sample. Every grain reads a stretch from around Position through a
// raised-cosine window, at the note's pitch with a random detune of its own, panned at random, sometimes backwards.
// New grains start at a steady pace while the gate is open; the gate closing ends the processor.

import { Processor, at, clamp, clean, params, register, type Params } from './processor';

interface Sample {
  channels: Float32Array[];
  rate: number;
}

/** What the page hands every grains processor. */
export interface GrainOptions {
  /** The sample's id; its channels come with the first processor of the context that plays it. */
  sample: string;
  channels?: Float32Array[];
  /** The sample's own sample rate. */
  rate: number;
  /** How much faster than recorded the note plays the sample. */
  ratio: number;
  seed: number;
}

/** The samples of this audio context, by id: one copy each, shared by every processor that plays it. */
const samples = new Map<string, Sample>();

const MAX_GRAINS = 64;
// A raised cosine in steps fine enough to read without interpolating: no step is more than -68 dB of the grain.
const TABLE = 8192;
const WINDOW = Float32Array.from({ length: TABLE }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / TABLE));
const MIN_SIZE = 0.005;
const MAX_SIZE = 2;
const MIN_DENSITY = 0.05;
const MAX_DENSITY = 64;
// Grains read different parts of the sample, so their levels add as powers; a raised cosine's mean power is 3/8.
// Below two at once the gaps between grains are left as they are.
const level = (density: number) => 1 / Math.sqrt(0.375 * Math.max(density, 2));

/** Uniform numbers in [-1, 1) from a 32-bit seed (mulberry32, as the page's random.ts). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
}

/** Sample `j` of a channel, or silence outside it. */
const tap = (d: Float32Array, j: number) => (j >= 0 && j < d.length ? d[j] : 0);

/** The channel at `pos` near or past either end, silent past them. */
function edge(d: Float32Array, pos: number): number {
  const j = Math.floor(pos);
  return tap(d, j) + (tap(d, j + 1) - tap(d, j)) * (pos - j);
}

/**
 * Add frames `a` to `stop` of a grain to `outL` and `outR`, with their gains: the left channel (and the right one,
 * or the left again for a mono sample) read from `pos` on at `mul` times the speed, through the window from `phase`
 * on in steps of `inc`. The speed is `speed` throughout, or each frame's in `steps` while a glide or a pitch
 * modulator moves it. Samples are read between their neighbours in straight lines, as AudioBufferSourceNode does;
 * the cubic read of processor.ts cost half as much again, and a dense cloud is the price of that. Returns where the
 * reading ends.
 */
function grain(
  dl: Float32Array, dr: Float32Array | null, outL: Float32Array, outR: Float32Array, gl: number, gr: number,
  a: number, stop: number, pos: number, mul: number, speed: number, steps: Float64Array | null, phase: number,
  inc: number,
): number {
  const last = dl.length - 1;
  const step = mul * speed;
  for (let i = a; i < stop; i++) {
    const w = WINDOW[phase | 0];
    const j = pos | 0;
    const f = pos - j;
    const inside = j >= 1 && j < last;
    const l = (inside ? dl[j] + (dl[j + 1] - dl[j]) * f : edge(dl, pos)) * w;
    const r = dr ? (inside ? dr[j] + (dr[j + 1] - dr[j]) * f : edge(dr, pos)) * w : l;
    outL[i] += l * gl;
    outR[i] += r * gr;
    pos += steps ? mul * steps[i] : step;
    phase += inc;
  }
  return pos;
}

class Grains extends Processor {
  static parameterDescriptors = params(
    'gate', 'position', 'spray', 'size', 'density', 'detune', 'pspray', 'octaves', 'width', 'reverse',
  );
  private readonly sample: Sample | undefined;
  /** Source samples read per output frame at the note's own pitch. */
  private readonly ratio: number;
  private readonly random: () => number;
  // The sounding grains, packed at the front: where each reads, how fast (negative backwards), where its window is
  // and how fast that moves, the frames it has left, the frame of this block it starts on, and its two gains.
  private readonly pos = new Float64Array(MAX_GRAINS);
  private readonly mul = new Float64Array(MAX_GRAINS);
  private readonly phase = new Float64Array(MAX_GRAINS);
  private readonly inc = new Float64Array(MAX_GRAINS);
  private readonly left = new Int32Array(MAX_GRAINS);
  private readonly from = new Int32Array(MAX_GRAINS);
  private readonly gainL = new Float64Array(MAX_GRAINS);
  private readonly gainR = new Float64Array(MAX_GRAINS);
  private readonly fields = [this.pos, this.mul, this.phase, this.inc, this.left, this.from, this.gainL, this.gainR];
  private count = 0;
  /** The reading speed at each frame of the block, which a glide or a pitch modulator moves. */
  private steps = new Float64Array(128);
  private cents = NaN;
  private speed = 0;
  private open = false;
  /** Frames until the next grain starts. */
  private next = 0;

  constructor(options: { processorOptions: GrainOptions }) {
    super();
    const o = options.processorOptions;
    if (o.channels) samples.set(o.sample, { channels: o.channels, rate: o.rate });
    this.sample = samples.get(o.sample);
    this.ratio = (o.ratio * o.rate) / this.sampleRate;
    this.random = rng(o.seed);
  }

  protected render(_inL: Float32Array, _inR: Float32Array, outL: Float32Array, outR: Float32Array, p: Params, n: number) {
    outL.fill(0);
    outR.fill(0);
    let end = n;
    for (let i = 0; i < n; i++) {
      const gate = at(p.gate, i);
      if (!this.open) {
        if (gate < 0.5) continue;
        this.open = true;
        // The cloud sounds in full from the start, as if its grains had been starting all along.
        const hop = this.hop(p, i);
        for (let age = hop; age < this.frames(p, i); age += hop) this.spawn(p, i, Math.round(age));
        this.next = 0;
      } else if (gate < 0.5) {
        end = i;
        this.running = false;
        break;
      }
      if (this.next <= 0) {
        this.spawn(p, i, 0);
        this.next += this.hop(p, i);
      }
      this.next--;
    }
    if (!this.sample) return;
    // The speed of the block, or of each frame when it moves within it.
    if (this.steps.length < n) this.steps = new Float64Array(n);
    const steps = this.steps;
    let moving = false;
    for (let i = 0; i < end; i++) {
      const c = at(p.detune, i);
      if (c !== this.cents) {
        moving = i > 0;
        this.cents = c;
        this.speed = this.ratio * 2 ** (clamp(clean(c), -9600, 9600) / 1200);
      }
      steps[i] = this.speed;
    }
    const speed = steps[0];
    const dl = this.sample.channels[0];
    const dr = this.sample.channels[1] ?? null;
    for (let g = 0; g < this.count;) {
      const a = this.from[g];
      const stop = Math.min(end, a + this.left[g]);
      const pos = grain(
        dl, dr, outL, outR, this.gainL[g], this.gainR[g], a, stop, this.pos[g], this.mul[g], speed,
        moving ? steps : null, this.phase[g], this.inc[g],
      );
      this.left[g] -= stop - a;
      if (this.left[g] <= 0) {
        this.remove(g);
        continue;
      }
      this.pos[g] = pos;
      this.phase[g] += this.inc[g] * (stop - a);
      this.from[g] = 0;
      g++;
    }
  }

  private frames(p: Params, i: number): number {
    return Math.max(2, Math.round(clamp(clean(at(p.size, i)), MIN_SIZE, MAX_SIZE) * this.sampleRate));
  }

  private hop(p: Params, i: number): number {
    return Math.max(1, this.frames(p, i) / clamp(clean(at(p.density, i)), MIN_DENSITY, MAX_DENSITY));
  }

  /**
   * Start a grain at frame `i` of the block, `age` frames into its life. It reads a stretch centred on Position,
   * moved by up to half of Spray either way and kept inside the sample.
   */
  private spawn(p: Params, i: number, age: number): void {
    const data = this.sample;
    const frames = this.frames(p, i);
    if (!data || this.count >= MAX_GRAINS || age >= frames) return;
    const r = this.random;
    let cents = clamp(clean(at(p.pspray, i)), 0, 4800) * r();
    if (at(p.octaves, i) >= 0.5) cents = 1200 * Math.round(cents / 1200);
    const back = (r() + 1) / 2 < clamp(clean(at(p.reverse, i)), 0, 1);
    const mul = 2 ** (cents / 1200) * (back ? -1 : 1);
    const speed = this.ratio * 2 ** (clamp(clean(at(p.detune, i)), -9600, 9600) / 1200);
    const length = data.channels[0].length;
    const span = frames * speed * Math.abs(mul);
    const centre = clamp(clean(at(p.position, i)) + (clamp(clean(at(p.spray, i)), 0, 1) * r()) / 2, 0, 1);
    const start = Math.max(1, Math.min(centre * length - span / 2, length - 3 - span));
    const pan = clamp(clean(at(p.width, i)), 0, 1) * r();
    const angle = ((pan + 1) * Math.PI) / 4;
    // A stereo sample keeps its sides at the centre; a mono one is shared between them at equal power.
    const gain = (data.channels.length > 1 ? Math.SQRT2 : 1)
      * level(clamp(clean(at(p.density, i)), MIN_DENSITY, MAX_DENSITY));
    const g = this.count++;
    this.pos[g] = (back ? start + span : start) + mul * speed * age;
    this.mul[g] = mul;
    this.inc[g] = TABLE / frames;
    this.phase[g] = age * this.inc[g];
    this.left[g] = frames - age;
    this.from[g] = i;
    this.gainL[g] = Math.cos(angle) * gain;
    this.gainR[g] = Math.sin(angle) * gain;
  }

  /** Take a grain out by moving the last one into its place. */
  private remove(g: number): void {
    const last = --this.count;
    for (const field of this.fields) field[g] = field[last];
  }
}

register('grains', Grains);
