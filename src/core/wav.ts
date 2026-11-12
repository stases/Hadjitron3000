import type { Pcm } from './types';

/** A 16-bit PCM WAV file. */
export function encodeWav(pcm: Pcm): Uint8Array {
  const channels = pcm.channels.length;
  const frames = pcm.channels[0]?.length ?? 0;
  const blockAlign = channels * 2;
  const dataSize = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  }
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of pcm.channels) {
      const sample = Math.min(1, Math.max(-1, channel[frame]));
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return bytes;
}
