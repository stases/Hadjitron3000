// What every processor shares: the audio thread's globals, a stereo frame around `render`, and small sample helpers.
// Processors run in the AudioWorkletGlobalScope, so nothing here may import from the rest of the app.

interface WorkletScope {
  sampleRate: number;
  AudioWorkletProcessor: new () => { readonly port: MessagePort };
  registerProcessor(name: string, processor: unknown): void;
}

const scope = globalThis as unknown as WorkletScope;

export type Params = Record<string, Float32Array>;

/**
 * Parameters that take their whole value from what is connected to them: the page drives each with a
 * ConstantSourceNode, which knobs glide and modulators add to.
 */
export const params = (...names: string[]) => names.map((name) => ({ name, defaultValue: 0 }));

/** A parameter at frame `i`: one value per frame, or a single value for the whole block when it is constant. */
export const at = (p: Float32Array, i: number) => (p.length > 1 ? p[i] : p[0]);

/** The sample, or 0 when it is NaN or infinite. */
export const clean = (x: number) => (x - x === 0 ? x : 0);

/** Values this small are set to 0 in feedback, where they would otherwise decay into slow denormal numbers. */
export const flush = (x: number) => (x > 1e-20 || x < -1e-20 ? x : 0);

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** A power of two of at least `n`, for ring buffers indexed with a mask. */
export const ringSize = (n: number) => 2 ** Math.ceil(Math.log2(n));

/**
 * The value `delay` samples (more than 2) before position `w` of a ring buffer whose length is `mask + 1`, by cubic
 * Hermite interpolation. Its gain is at most 1 at every frequency and fraction, so it is safe inside feedback.
 */
export function readCubic(buf: Float32Array, mask: number, w: number, delay: number): number {
  const pos = w - delay;
  const i = Math.floor(pos);
  const f = pos - i;
  const xm = buf[(i - 1) & mask];
  const x0 = buf[i & mask];
  const x1 = buf[(i + 1) & mask];
  const x2 = buf[(i + 2) & mask];
  const c1 = 0.5 * (x1 - xm);
  const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/**
 * A stereo processor. `render` gets both input channels (silence when nothing is connected) and fills both
 * outputs. It runs until the page sends any message, which the effect does once its channel has gone.
 */
export abstract class Processor extends scope.AudioWorkletProcessor {
  protected readonly sampleRate = scope.sampleRate;
  private running = true;
  private silence = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = () => {
      this.running = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Params): boolean {
    const [left, right] = outputs[0];
    const n = left.length;
    if (this.silence.length < n) this.silence = new Float32Array(n);
    const input = inputs[0];
    const inL = input[0] ?? this.silence;
    this.render(inL, input[1] ?? inL, left, right ?? left, parameters, n);
    return this.running;
  }

  protected abstract render(
    inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, p: Params, n: number,
  ): void;
}

export function register(name: string, processor: typeof Processor): void {
  scope.registerProcessor(name, processor);
}
