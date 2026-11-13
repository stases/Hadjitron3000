// Seeded randomness, so that two renders of the same project are bit-identical.

/** Uniform numbers in [-1, 1) from a 32-bit seed (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
}

export type NoiseColor = 'white' | 'pink' | 'brown';

const NOISE_SECONDS = 4;
const NOISE_RMS = 0.2;
const LOOP_FADE = 0.05;
const noiseCache = new Map<string, AudioBuffer>();

function colored(color: NoiseColor, n: number): Float32Array {
  const next = rng(color === 'white' ? 1 : color === 'pink' ? 2 : 3);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let brown = 0;
  for (let i = 0; i < n; i++) {
    const w = next();
    if (color === 'white') out[i] = w;
    else if (color === 'brown') out[i] = brown = 0.998 * brown + 0.02 * w;
    else {
      // Paul Kellet's pink noise filter.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  }
  return out;
}

/** A looping buffer of noise at a fixed RMS level, the same for every colour. */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const key = `${color}@${ctx.sampleRate}`;
  const cached = noiseCache.get(key);
  if (cached) return cached;
  const n = Math.round(NOISE_SECONDS * ctx.sampleRate);
  const fade = Math.round(LOOP_FADE * ctx.sampleRate);
  const raw = colored(color, n + fade);
  // Crossfade the extra tail into the head so the loop point is seamless.
  for (let i = 0; i < fade; i++) raw[i] = raw[i] * (i / fade) + raw[n + i] * (1 - i / fade);
  const data = raw.subarray(0, n);
  let mean = 0;
  for (const v of data) mean += v;
  mean /= n;
  let power = 0;
  for (const v of data) power += (v - mean) ** 2;
  const scale = NOISE_RMS / Math.sqrt(power / n);
  const buf = new AudioBuffer({ length: n, sampleRate: ctx.sampleRate, numberOfChannels: 1 });
  buf.getChannelData(0).set(data.map((v) => (v - mean) * scale));
  noiseCache.set(key, buf);
  return buf;
}
