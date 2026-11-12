// Notes are MIDI numbers; 60 is C3 and plays a sound at its own pitch.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const ROOT_NOTE = 60;
export const MIN_NOTE = 12; // C-1
export const MAX_NOTE = 108; // C7

export function noteName(note: number): string {
  return NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 2);
}

export function noteFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function isBlackKey(note: number): boolean {
  return NAMES[((note % 12) + 12) % 12].length === 2;
}

/** Computer keyboard as a piano: key -> semitones above the C of the current octave. */
export const KEY_SEMITONES: Readonly<Record<string, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};
