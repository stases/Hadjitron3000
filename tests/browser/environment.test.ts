import { expect, test } from 'vitest';
import { createMp3Encoder } from 'wasm-media-encoders';

test('offline render of a sine is not silent', async () => {
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  const osc = new OscillatorNode(ctx, { frequency: 220 });
  osc.connect(ctx.destination);
  osc.start(0);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  expect(peak).toBeGreaterThan(0.9);
});

test('realtime context advances without a sound card', async () => {
  const ctx = new AudioContext();
  await ctx.resume();
  const t0 = ctx.currentTime;
  await new Promise((r) => setTimeout(r, 300));
  expect(ctx.state).toBe('running');
  expect(ctx.currentTime).toBeGreaterThan(t0 + 0.1);
  await ctx.close();
});

test('mp3 encoder produces frames that decode back', async () => {
  const sr = 44100;
  const n = sr;
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
  const enc = await createMp3Encoder();
  enc.configure({ sampleRate: sr, channels: 2, bitrate: 192 });
  const parts: Uint8Array[] = [];
  parts.push(enc.encode([l, l]).slice());
  parts.push(enc.finalize().slice());
  const bytes = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  expect(bytes.length).toBeGreaterThan(10000);
  const ctx = new OfflineAudioContext(2, 1, sr);
  const decoded = await ctx.decodeAudioData(bytes.buffer);
  expect(decoded.duration).toBeGreaterThan(0.95);
  expect(decoded.duration).toBeLessThan(1.15);
});
