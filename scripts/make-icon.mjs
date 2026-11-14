// Make build/icon.ico, the Windows icon of the application, its installer and its files, from build/icon.png.
// Each size is the PNG averaged down over the area each new pixel covers. Sizes below 256 are stored as
// uncompressed bitmaps, which every part of Windows reads; 256 is stored as a PNG, as Windows expects.
// Run it with `npm run icon` after changing build/icon.png, and commit both files.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

export const SIZES = [16, 24, 32, 48, 64, 128, 256];

function predict(filter, left, up, corner) {
  switch (filter) {
    case 0: return 0;
    case 1: return left;
    case 2: return up;
    case 3: return (left + up) >> 1;
    default: {
      const p = left + up - corner;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - corner);
      return pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
    }
  }
}

/** The pixels of an 8-bit RGBA PNG without interlacing, as build/icon.png is. */
export function decodePng(bytes) {
  const data = Buffer.from(bytes);
  let width = 0;
  let height = 0;
  const idat = [];
  for (let at = 8; at < data.length;) {
    const length = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error('Expected an 8-bit RGBA PNG without interlacing');
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      pixels[y * stride + x] = (line[x] + predict(filter, left, up, corner)) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** How much of each source pixel falls into each of `size` new pixels along one side of length `length`. */
function weights(length, size) {
  const scale = length / size;
  return Array.from({ length: size }, (_, i) => {
    const from = i * scale;
    const to = from + scale;
    const taps = [];
    for (let s = Math.floor(from); s < Math.min(length, Math.ceil(to)); s++) {
      taps.push([s, (Math.min(to, s + 1) - Math.max(from, s)) / scale]);
    }
    return taps;
  });
}

/** The image averaged down to size × size, with the colours weighted by their opacity. */
export function resize({ width, height, pixels }, size) {
  const xs = weights(width, size);
  const ys = weights(height, size);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const [sy, wy] of ys[y]) {
        for (const [sx, wx] of xs[x]) {
          const at = (sy * width + sx) * 4;
          const w = wx * wy * pixels[at + 3];
          r += pixels[at] * w;
          g += pixels[at + 1] * w;
          b += pixels[at + 2] * w;
          a += w;
        }
      }
      const at = (y * size + x) * 4;
      if (a > 0) [out[at], out[at + 1], out[at + 2]] = [r / a, g / a, b / a].map(Math.round);
      out[at + 3] = Math.round(a);
    }
  }
  return out;
}

/** An icon image as a 32-bit bitmap: the header, the rows bottom up in BGRA, then the transparency mask. */
function bitmap(rgba, size) {
  const maskStride = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20);
  const colours = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = (row * size + x) * 4;
      [colours[to], colours[to + 1], colours[to + 2], colours[to + 3]] =
        [rgba[from + 2], rgba[from + 1], rgba[from], rgba[from + 3]];
      if (rgba[from + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, colours, mask]);
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

function encodePng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The .ico file for a PNG: a directory of the sizes, then each image. */
export function icoFrom(png) {
  const image = decodePng(png);
  const images = SIZES.map((size) => {
    const rgba = resize(image, size);
    return size === 256 ? encodePng(rgba, size) : bitmap(rgba, size);
  });
  const directory = Buffer.alloc(6 + 16 * SIZES.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(SIZES.length, 4);
  let offset = directory.length;
  SIZES.forEach((size, i) => {
    const entry = 6 + 16 * i;
    directory[entry] = size % 256;
    directory[entry + 1] = size % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[i].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([directory, ...images]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const png = new URL('../build/icon.png', import.meta.url);
  const ico = new URL('../build/icon.ico', import.meta.url);
  writeFileSync(ico, icoFrom(readFileSync(png)));
  console.log(`Wrote ${fileURLToPath(ico)} with ${SIZES.join(', ')} pixel images.`);
}
