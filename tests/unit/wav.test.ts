import { expect, test } from 'vitest';
import { encodeWav } from '../../src/core/wav';

test.each([1, 2])('writes the canonical PCM header for %i channels', (count) => {
  const bytes = encodeWav({ sampleRate: 48000, channels: Array.from({ length: count }, () => new Float32Array(3)) });
  const view = new DataView(bytes.buffer);
  const text = (offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
  expect(bytes.length).toBe(44 + 3 * count * 2);
  expect(text(0, 4)).toBe('RIFF');
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  expect(text(8, 4)).toBe('WAVE');
  expect(text(12, 4)).toBe('fmt ');
  expect(view.getUint32(16, true)).toBe(16);
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(count);
  expect(view.getUint32(24, true)).toBe(48000);
  expect(view.getUint32(28, true)).toBe(48000 * count * 2);
  expect(view.getUint16(32, true)).toBe(count * 2);
  expect(view.getUint16(34, true)).toBe(16);
  expect(text(36, 4)).toBe('data');
  expect(view.getUint32(40, true)).toBe(3 * count * 2);
});

test('interleaves frames, clips peaks and rounds both signs to nearest integers', () => {
  const left = new Float32Array([0, 1, -1, 2, -2, 0.5, -0.5, 0.1, -0.1]);
  const right = new Float32Array([0.25, -0.25, 0.75, -0.75, 0, 0, 0, 0, 0]);
  const bytes = encodeWav({ sampleRate: 44100, channels: [left, right] });
  const view = new DataView(bytes.buffer);
  expect(Array.from({ length: 18 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([
    0, 8192, 32767, -8192, -32768, 24575, 32767, -24576, -32768, 0,
    16384, 0, -16384, 0, 3277, 0, -3277, 0,
  ]);
  expect(Array.from(bytes.subarray(48, 52))).toEqual([255, 127, 0, 224]);
});

test('empty PCM has a complete header and no sample data', () => {
  const bytes = encodeWav({ sampleRate: 44100, channels: [new Float32Array(), new Float32Array()] });
  expect(bytes.length).toBe(44);
  expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(0);
});
