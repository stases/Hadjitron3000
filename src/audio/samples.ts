// Decoded sample audio, shared by every engine (live and offline).

import { detectOnsets, sliceBounds, type Onset } from '../core/slices';
import type { Params } from '../core/types';

const decoded = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();
const reversed = new WeakMap<AudioBuffer, AudioBuffer>();
const onsets = new WeakMap<AudioBuffer, Onset[]>();
const looped = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
// The last few seamless loops of each buffer are kept.
const LOOP_CACHE = 4;
let decoder: OfflineAudioContext | undefined;

export function decodeSample(id: string, bytes: Uint8Array): Promise<AudioBuffer> {
  const done = decoded.get(id);
  if (done) return Promise.resolve(done);
  let p = pending.get(id);
  if (!p) {
    decoder ??= new OfflineAudioContext(1, 1, 44100);
    // decodeAudioData detaches the buffer it is given, so hand it a copy.
    p = decoder.decodeAudioData(bytes.slice().buffer).then(
      (buf) => {
        decoded.set(id, buf);
        pending.delete(id);
        return buf;
      },
      (err: unknown) => {
        pending.delete(id);
        throw err;
      },
    );
    pending.set(id, p);
  }
  return p;
}

export function sampleBuffer(id: string): AudioBuffer | undefined {
  return decoded.get(id);
}

export function reversedBuffer(buf: AudioBuffer): AudioBuffer {
  let rev = reversed.get(buf);
  if (!rev) {
    rev = new AudioBuffer({ length: buf.length, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels });
    for (let c = 0; c < buf.numberOfChannels; c++) rev.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
    reversed.set(buf, rev);
  }
  return rev;
}

/**
 * Where a sampler cuts its region into slices, in seconds of the buffer: the start, every cut and the end; null
 * when Slices is off. The hits of a buffer are found once and kept.
 */
export function sliceTimes(buf: AudioBuffer, p: Params): number[] | null {
  const slices = (p.slices ?? 'off') as string;
  let found = slices === 'hits' ? onsets.get(buf) : [];
  if (!found) {
    found = detectOnsets(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate);
    onsets.set(buf, found);
  }
  const [start, end] = [p.start as number, p.end as number].map((share) => share * buf.duration);
  return sliceBounds(start, end, slices, found, p.sens as number);
}

/**
 * The loop from `start` to `end` seconds of a buffer, made seamless: its last `share` is blended into its
 * beginning with an equal-power crossfade and cut off, so the loop, played round, runs from its shortened end
 * straight into a beginning that starts with the material that followed there. Kept per buffer, region and share.
 */
export function seamlessLoop(buf: AudioBuffer, start: number, end: number, share: number): AudioBuffer | null {
  const a = Math.round(start * buf.sampleRate);
  const b = Math.round(end * buf.sampleRate);
  const fade = Math.round(share * (b - a));
  if (b - a - fade < 1) return null;
  const key = `${a}:${b}:${fade}`;
  let cache = looped.get(buf);
  if (!cache) looped.set(buf, (cache = new Map()));
  let loop = cache.get(key);
  if (!loop) {
    loop = new AudioBuffer({ length: b - a - fade, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels });
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const from = buf.getChannelData(c);
      const to = loop.getChannelData(c);
      to.set(from.subarray(a, b - fade));
      for (let i = 0; i < fade; i++) {
        const x = (Math.PI / 2) * (i / fade);
        to[i] = from[a + i] * Math.sin(x) + from[b - fade + i] * Math.cos(x);
      }
    }
    if (cache.size >= LOOP_CACHE) cache.delete(cache.keys().next().value!);
  }
  cache.delete(key);
  cache.set(key, loop);
  return loop;
}
