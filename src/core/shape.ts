// A drawn wave: one cycle as SHAPE_POINTS values in -1..1, kept in a sound as a short string of two base-64 digits
// per point. Between its points the cycle runs in straight lines, which is how it is drawn and how it sounds.

export const SHAPE_POINTS = 64;

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// An even number of steps, so that 0 is stored exactly.
const STEPS = 4094;

const clamp = (v: number) => Math.min(1, Math.max(-1, v));

export function encodeShape(points: readonly number[]): string {
  return points
    .map((v) => {
      const q = Math.round(((clamp(v) + 1) / 2) * STEPS);
      return DIGITS[q >> 6] + DIGITS[q & 63];
    })
    .join('');
}

/** The points of a stored shape, or null when the text is not one. */
export function decodeShape(text: string): number[] | null {
  if (text.length !== 2 * SHAPE_POINTS) return null;
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 2) {
    const hi = DIGITS.indexOf(text[i]);
    const lo = DIGITS.indexOf(text[i + 1]);
    const q = hi * 64 + lo;
    if (hi < 0 || lo < 0 || q > STEPS) return null;
    out.push((2 * q) / STEPS - 1);
  }
  return out;
}

const cycle = (f: (u: number) => number) => Array.from({ length: SHAPE_POINTS }, (_, n) => f(n / SHAPE_POINTS));

/** The four stock waves as drawings, in the phase the oscillator plays them. */
export const STOCK_SHAPES = {
  sine: cycle((u) => Math.sin(2 * Math.PI * u)),
  triangle: cycle((u) => (u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4)),
  sawtooth: cycle((u) => (u < 0.5 ? 2 * u : 2 * u - 2)),
  square: cycle((u) => (u < 0.5 ? 1 : -1)),
} as const;

export const DEFAULT_SHAPE = encodeShape(STOCK_SHAPES.sine);

/** Each point averaged with its neighbours (1, 2, 1), round the cycle. */
export function smoothShape(points: readonly number[]): number[] {
  const n = points.length;
  return points.map((v, i) => (points[(i + n - 1) % n] + 2 * v + points[(i + 1) % n]) / 4);
}

/** Set the points from `i0` to `i1` on the straight line between the two values. */
export function strokeShape(points: number[], i0: number, v0: number, i1: number, v1: number): void {
  if (i0 === i1) {
    points[i1] = clamp(v1);
    return;
  }
  const dir = i1 > i0 ? 1 : -1;
  for (let i = i0; i !== i1 + dir; i += dir) points[i] = clamp(v0 + ((v1 - v0) * (i - i0)) / (i1 - i0));
}

/**
 * The cosine (`real`) and sine (`imag`) amplitudes of harmonics 0..count of the cycle drawn in straight lines, as a
 * PeriodicWave takes them; the constant is left out. Joining the points with lines multiplies the points' own
 * spectrum, repeated every SHAPE_POINTS harmonics, by sinc² of the harmonic over SHAPE_POINTS.
 */
export function shapeHarmonics(points: readonly number[], count: number): { real: Float32Array; imag: Float32Array } {
  const n = points.length;
  const dft = Array.from({ length: n }, (_, k) => {
    let re = 0;
    let im = 0;
    points.forEach((v, j) => {
      const a = (2 * Math.PI * k * j) / n;
      re += v * Math.cos(a);
      im -= v * Math.sin(a);
    });
    return [re / n, im / n];
  });
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  for (let k = 1; k <= count; k++) {
    const x = (Math.PI * k) / n;
    const sinc2 = (Math.sin(x) / x) ** 2;
    const [re, im] = dft[k % n];
    real[k] = 2 * re * sinc2;
    imag[k] = -2 * im * sinc2;
  }
  return { real, imag };
}
