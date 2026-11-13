import { expect, test } from 'vitest';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import { SCALES, inScale, nearestInScale, readScale, scaleNotes, scaleText } from '../../src/core/scale';

const pcs = (type: string, root = 0) =>
  Array.from({ length: 12 }, (_, i) => i).filter((pc) => inScale(60 + pc, { root, type }));

test('every scale has its own pitch classes from the root', () => {
  expect(Object.fromEntries(SCALES.map((s) => [s.type, pcs(s.type)]))).toEqual({
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
    majpent: [0, 2, 4, 7, 9],
    minpent: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    whole: [0, 2, 4, 6, 8, 10],
  });
  // D minor is C major's notes with B flat for B; the root moves every scale with it, in every octave.
  expect(pcs('minor', 2)).toEqual([0, 2, 4, 5, 7, 9, 10]);
  for (const s of SCALES) {
    for (const root of [0, 5, 11]) {
      for (const note of [MIN_NOTE, 40, 61, 97]) {
        expect(inScale(note, { root, type: s.type })).toBe(inScale(note + 12, { root, type: s.type }));
      }
    }
  }
  expect(Array.from({ length: 12 }, (_, i) => inScale(i + 60, undefined)).every(Boolean)).toBe(true);
});

test('the nearest scale note is the note itself when it is in the scale, else the closest, the lower of two', () => {
  for (const s of SCALES) {
    for (const root of [0, 3, 7]) {
      const scale = { root, type: s.type };
      for (let note = MIN_NOTE; note <= MAX_NOTE; note++) {
        const near = nearestInScale(note, scale);
        expect(inScale(near, scale), `${s.type} ${root} ${note}`).toBe(true);
        const d = Math.abs(near - note);
        for (let other = note - d; other <= note + d; other++) {
          if (other < near && other >= MIN_NOTE && Math.abs(other - note) === d) {
            expect(inScale(other, scale)).toBe(false);
          }
          if (Math.abs(other - note) < d && other >= MIN_NOTE && other <= MAX_NOTE) {
            expect(inScale(other, scale)).toBe(false);
          }
        }
      }
    }
  }
  const major = { root: 0, type: 'major' };
  expect(nearestInScale(61, major)).toBe(60);
  expect(nearestInScale(66, major)).toBe(65);
  expect(nearestInScale(61, undefined)).toBe(61);
  // At the top of the range the note does not leave it.
  expect(nearestInScale(MAX_NOTE, { root: 2, type: 'major' })).toBe(MAX_NOTE - 1);
});

test('the notes of a scale in a range, its name, and what a file may name', () => {
  expect(scaleNotes({ root: 9, type: 'minpent' }, 57, 69)).toEqual([57, 60, 62, 64, 67, 69]);
  expect(scaleNotes(undefined, 60, 63)).toEqual([60, 61, 62, 63]);
  expect(scaleText({ root: 2, type: 'harmonic' })).toBe('D Harmonic minor');
  expect(readScale({ root: 4, type: 'dorian' })).toEqual({ root: 4, type: 'dorian' });
  const bads = [null, 'major', { root: 12, type: 'major' }, { root: 1.5, type: 'minor' }, { root: 0, type: 'x' }];
  for (const bad of bads) {
    expect(readScale(bad)).toBeNull();
  }
});
