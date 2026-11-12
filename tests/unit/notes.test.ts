import { expect, test } from 'vitest';
import { isBlackKey, MAX_NOTE, MIN_NOTE, noteFreq, noteName, ROOT_NOTE } from '../../src/core/notes';

test('uses C3 as the root note and names octave boundaries', () => {
  expect(ROOT_NOTE).toBe(60);
  expect(noteName(60)).toBe('C3');
  expect(noteName(61)).toBe('C#3');
  expect(noteName(59)).toBe('B2');
  expect(noteName(MIN_NOTE)).toBe('C-1');
  expect(noteName(MAX_NOTE)).toBe('C7');
  expect(noteName(-1)).toBe('B-3');
});

test('equal temperament is anchored to A440', () => {
  expect(noteFreq(69)).toBe(440);
  expect(noteFreq(81)).toBe(880);
  expect(noteFreq(57)).toBe(220);
  expect(noteFreq(70) / noteFreq(69)).toBeCloseTo(2 ** (1 / 12), 12);
});

test('identifies the five black keys in every octave', () => {
  const expected = [false, true, false, true, false, false, true, false, true, false, true, false];
  for (const base of [-12, 0, 60, 96]) {
    expect(Array.from({ length: 12 }, (_, i) => isBlackKey(base + i))).toEqual(expected);
  }
});
