// A hash of a text to 32 bits, for decisions that must come out the same on every play and in every export.

/** FNV-1a over the characters, then mixed, as an unsigned 32-bit integer. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A number in [0, 1) from a text. */
export const hashUnit = (text: string) => hash(text) / 2 ** 32;
