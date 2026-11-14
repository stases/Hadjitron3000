import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, test } from 'vitest';

interface Image {
  width: number;
  height: number;
  pixels: Buffer;
}

// The script is plain JavaScript without types; the specifier is cast so TypeScript does not look for them.
const { SIZES, decodePng, icoFrom, resize } = await import('../../scripts/make-icon.mjs' as string) as {
  SIZES: number[];
  decodePng(bytes: Buffer): Image;
  icoFrom(png: Buffer): Buffer;
  resize(image: Image, size: number): Buffer;
};

const png = readFileSync(new URL('../../build/icon.png', import.meta.url));
const ico = readFileSync(new URL('../../build/icon.ico', import.meta.url));

function entries(file: Buffer) {
  expect(file.readUInt16LE(0)).toBe(0);
  expect(file.readUInt16LE(2)).toBe(1);
  return Array.from({ length: file.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const size = file[at] || 256;
    expect(file[at + 1] || 256).toBe(size);
    expect(file.readUInt16LE(at + 6)).toBe(32);
    const data = file.subarray(file.readUInt32LE(at + 12), file.readUInt32LE(at + 12) + file.readUInt32LE(at + 8));
    return { size, data };
  });
}

test('the committed icon.ico holds every size Windows asks for, as bitmaps and one PNG', () => {
  const images = entries(ico);
  expect(images.map((image) => image.size)).toEqual(SIZES);
  for (const { size, data } of images) {
    if (size === 256) {
      expect(data.subarray(1, 4).toString('latin1')).toBe('PNG');
    } else {
      expect(data.readUInt32LE(0)).toBe(40);
      expect([data.readInt32LE(4), data.readInt32LE(8)]).toEqual([size, size * 2]);
      expect(data.length).toBe(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
    }
  }
});

test('icon.ico is made from the current icon.png (run npm run icon after changing it)', () => {
  const fresh = entries(icoFrom(png));
  const committed = entries(ico);
  const image = decodePng(png);
  for (const [i, { size, data }] of committed.entries()) {
    if (size === 256) {
      // The PNG is compared by its pixels, since another zlib may pack the same pixels differently.
      const idat = data.indexOf('IDAT');
      const rows = inflateSync(data.subarray(idat + 4, idat + 4 + data.readUInt32BE(idat - 4)));
      const pixels = resize(image, 256);
      for (let y = 0; y < 256; y++) {
        expect(rows.subarray(y * 1025 + 1, (y + 1) * 1025).equals(pixels.subarray(y * 1024, (y + 1) * 1024))).toBe(true);
      }
    } else {
      expect(data.equals(fresh[i].data)).toBe(true);
    }
  }
});

test('a transparent corner stays transparent and the middle stays opaque at every size', () => {
  const image = decodePng(png);
  expect([image.width, image.height]).toEqual([1024, 1024]);
  for (const size of SIZES) {
    const rgba = resize(image, size);
    expect(rgba[3]).toBe(0);
    expect(rgba[((size >> 1) * size + (size >> 1)) * 4 + 3]).toBe(255);
  }
});
