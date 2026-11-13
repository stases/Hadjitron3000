import { expect, test } from 'vitest';
import { barOf } from '../../src/core/meter';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import type { Note } from '../../src/core/types';
import {
  ROW_H, dragNotes, drawnLength, endX, gapsBackground, makeClip, noteAt, noteY, notesIn, parsePosition, parseSteps,
  pitchAt, placeClip, positionText, sheetBackground, snapFloor, snapRound, stepsText, tickAt, tickX, velocityGroup,
} from '../../src/ui/track/roll';
import { CELL_W, cellX, columnAt, gapAfter, laneWidth, onBeat } from '../../src/ui/track/steps';

const T = 24;
const B = barOf([4, 4]);
const BAR_TICKS = B.ticks;
const note = (id: string, start: number, len: number, pitch = 60, vel = 0.8): Note =>
  ({ id, start, len, note: pitch, vel });

test('a tick is a pixel inside the grid cells, and the gaps between cells count as the next step line', () => {
  expect(CELL_W).toBe(T);
  for (let t = 0; t < 2 * BAR_TICKS; t++) expect(tickAt(tickX(t, B), 32, B)).toBe(t);
  expect(tickX(36, B)).toBe(cellX(1, B) + 12);
  expect(endX(24, B)).toBe(CELL_W);
  expect(endX(36, B)).toBe(cellX(1, B) + 12);
  expect(endX(BAR_TICKS, B)).toBe(cellX(15, B) + CELL_W);
  expect(tickAt(CELL_W + 1, 32, B)).toBe(T);
  expect(tickAt(cellX(15, B) + CELL_W + 5, 32, B)).toBe(BAR_TICKS);
  expect(tickAt(-10, 16, B)).toBe(0);
  expect(tickAt(99999, 16, B)).toBe(BAR_TICKS - 1);
  expect(pitchAt(noteY(60))).toBe(60);
  expect(pitchAt(noteY(60) + ROW_H - 1)).toBe(60);
  expect(pitchAt(-5)).toBe(MAX_NOTE);
  expect(pitchAt(99999)).toBe(MIN_NOTE);
});

test('snapping floors or rounds to the unit, triplets included', () => {
  expect(snapFloor(47, 24)).toBe(24);
  expect(snapRound(36, 24)).toBe(48);
  expect(snapRound(40, 32)).toBe(32);
  expect(snapFloor(47, 16)).toBe(32);
  expect(snapRound(47, 1)).toBe(47);
});

test('the note under the pointer is the latest-starting one of that pitch, with a few pixels of edge at each end', () => {
  const notes = [note('a', 0, 48), note('b', 24, 48), note('c', 0, 24, 62), note('out', 400, 24)];
  const y = noteY(60) + 5;
  expect(noteAt(notes, 10, y, BAR_TICKS, B)).toEqual({ note: notes[0], part: 'body' });
  expect(noteAt(notes, 1, y, BAR_TICKS, B)!.part).toBe('start');
  expect(noteAt(notes, cellX(1, B) + 10, y, BAR_TICKS, B)!.note.id).toBe('b');
  expect(noteAt(notes, cellX(2, B) + CELL_W - 1, y, BAR_TICKS, B)).toEqual({ note: notes[1], part: 'end' });
  expect(noteAt(notes, 10, noteY(62) + 1, BAR_TICKS, B)!.note.id).toBe('c');
  expect(noteAt(notes, 10, noteY(61), BAR_TICKS, B)).toBeNull();
  expect(noteAt(notes, cellX(3, B) + 2, y, BAR_TICKS, B)).toBeNull();
  expect(noteAt(notes, tickX(400, B) + 2, y, 384, B)).toBeNull();
  // A note of two pixels has no edges.
  expect(noteAt([note('t', 0, 2)], 1, y, BAR_TICKS, B)!.part).toBe('body');
});

test('a rubber band selects the notes it touches', () => {
  const notes = [note('a', 0, 24), note('b', 48, 24, 64), note('c', 96, 24, 50)];
  const band = { left: 10, top: noteY(64) + 11, right: tickX(48, B) + 1, bottom: noteY(60) };
  expect(notesIn(notes, band, BAR_TICKS, B)).toEqual(['b']);
  expect(notesIn(notes, { ...band, bottom: noteY(60) + 1 }, BAR_TICKS, B)).toEqual(['a', 'b']);
  expect(notesIn(notes, { left: 0, top: 0, right: 99999, bottom: 99999 }, 96, B)).toEqual(['a', 'b']);
});

test('dragging the body moves notes by whole snap units, keeping off-grid places, inside the block and range', () => {
  const notes = [note('a', 30, 24, 60), note('b', 48, 24, 64)];
  const drag = (ticks: number, semis: number, unit = T) =>
    dragNotes(notes, notes[0], 'body', ticks, semis, unit, 2 * BAR_TICKS);
  expect(drag(13, 2).map((n) => [n.start, n.note])).toEqual([[54, 62], [72, 66]]);
  expect(drag(11, 0).map((n) => n.start)).toEqual([30, 48]);
  expect(drag(13, 0, 1).map((n) => n.start)).toEqual([43, 61]);
  expect(drag(-100, -100).map((n) => [n.start, n.note])).toEqual([[0, MIN_NOTE], [18, MIN_NOTE + 4]]);
  expect(drag(9999, 100).map((n) => [n.start + n.len, n.note])).toEqual([[2 * BAR_TICKS - 18, MAX_NOTE - 4],
    [2 * BAR_TICKS, MAX_NOTE]]);
  // A note already reaching past the end of the block can still move earlier but not later.
  const long = [note('l', 24, 2 * BAR_TICKS)];
  expect(dragNotes(long, long[0], 'body', 48, 0, T, 2 * BAR_TICKS)[0].start).toBe(24);
  expect(dragNotes(long, long[0], 'body', -48, 0, T, 2 * BAR_TICKS)[0].start).toBe(0);
});

test('dragging an edge puts it on the grid, moves the others alike, and keeps every note a tick long', () => {
  const notes = [note('a', 30, 30), note('b', 48, 12, 64)];
  const end = (ticks: number, unit = T) => dragNotes(notes, notes[0], 'end', ticks, 5, unit, BAR_TICKS);
  expect(end(10).map((n) => [n.start, n.len, n.note])).toEqual([[30, 42, 60], [48, 24, 64]]);
  expect(end(-29).map((n) => n.len)).toEqual([19, 1]);
  expect(end(-29, 1).map((n) => n.len)).toEqual([19, 1]);
  expect(end(9999).map((n) => n.start + n.len)).toEqual([BAR_TICKS, BAR_TICKS]);
  const start = (ticks: number, unit = T) => dragNotes(notes, notes[0], 'start', ticks, 5, unit, BAR_TICKS);
  expect(start(-10).map((n) => [n.start, n.len, n.note])).toEqual([[24, 36, 60], [42, 18, 64]]);
  expect(start(-100).map((n) => n.start)).toEqual([0, 18]);
  expect(start(100).map((n) => [n.start + n.len, n.len])).toEqual([[60, 19], [60, 1]]);
  expect(start(3, 1).map((n) => n.start)).toEqual([33, 51]);
  expect(start(-5, 16).map((n) => n.start)).toEqual([32, 50]);
});

test('a drawn note reaches the grid line after the pointer, at least one unit, and stops at the block end', () => {
  expect(drawnLength(48, 50, T, BAR_TICKS)).toBe(24);
  expect(drawnLength(48, 100, T, BAR_TICKS)).toBe(72);
  expect(drawnLength(48, 10, T, BAR_TICKS)).toBe(24);
  expect(drawnLength(48, 100, 1, BAR_TICKS)).toBe(53);
  expect(drawnLength(48, 100, 32, BAR_TICKS)).toBe(80);
  expect(drawnLength(360, 9999, T, BAR_TICKS)).toBe(24);
});

test('copied notes keep their places from the grid line before them and are cut to the block where they land', () => {
  const notes = [note('a', 30, 24, 60, 0.5), note('b', 30, 12, 64), note('c', 100, 10)];
  const { clip, origin } = makeClip(notes, T);
  expect(origin).toBe(24);
  expect(clip.span).toBe(96);
  expect(clip.notes).toEqual([
    { start: 6, len: 24, note: 60, vel: 0.5 }, { start: 6, len: 12, note: 64, vel: 0.8 },
    { start: 76, len: 10, note: 60, vel: 0.8 },
  ]);
  expect(placeClip(clip, 120, BAR_TICKS).map((n) => n.start)).toEqual([126, 126, 196]);
  expect(placeClip(clip, 300, BAR_TICKS).map((n) => [n.start, n.len])).toEqual([[306, 24], [306, 12], [376, 8]]);
  expect(placeClip(clip, 380, BAR_TICKS)).toEqual([]);
  expect(makeClip(notes, 1)).toMatchObject({ origin: 30, clip: { span: 80 } });
  expect(makeClip(notes, 32)).toMatchObject({ origin: 0, clip: { span: 128 } });
});

test('positions read as bar.beat.sixteenth with ticks after a plus, and lengths as steps', () => {
  expect(positionText(0, B)).toBe('1.1.1');
  expect(positionText(BAR_TICKS + 96 + 48 + 8, B)).toBe('2.2.3+8');
  for (const t of [0, 13, 96, 383, 384, 5000]) expect(parsePosition(positionText(t, B), B)).toBe(t);
  expect(parsePosition('3', B)).toBe(2 * BAR_TICKS);
  expect(parsePosition('1.2', B)).toBe(96);
  expect(parsePosition(' 1.1.2 + 4 ', B)).toBe(28);
  for (const bad of ['', 'x', '0.1.1', '1.0', '1..2']) expect(parsePosition(bad, B)).toBeNaN();
  expect([24, 36, 16, 1, 96].map(stepsText)).toEqual(['1', '1.5', '0.67', '0.04', '4']);
  expect(parseSteps('1.5')).toBe(36);
  expect(parseSteps('0,5')).toBe(12);
  expect(parseSteps('x')).toBeNaN();
});

test('a velocity bar stands for the notes that start there, or the selected ones among them', () => {
  const notes = [note('a', 0, 24), note('b', 0, 24, 64), note('c', 4, 24), note('d', 48, 24)];
  expect(velocityGroup(notes, [], 1, B).map((n) => n.id)).toEqual(['a', 'b']);
  expect(velocityGroup(notes, ['b', 'd'], 1, B).map((n) => n.id)).toEqual(['b']);
  expect(velocityGroup(notes, [], 5, B).map((n) => n.id)).toEqual(['c']);
  expect(velocityGroup(notes, [], tickX(48, B) - 2, B).map((n) => n.id)).toEqual(['d']);
  expect(velocityGroup(notes, [], 30, B)).toEqual([]);
});

test('the sheet draws snap lines inside the cells only for snaps off the step grid', () => {
  const lines = (unit: number) => (sheetBackground(unit, B).backgroundImage.match(/var\(--face-hi\)/g) ?? []).length;
  expect(lines(24)).toBe(0);
  expect(lines(1)).toBe(0);
  expect(lines(12)).toBe(16);
  expect(lines(16)).toBe(16);
  expect(lines(32)).toBe(8);
});

test('the grid and the roll put beat and bar gaps where the meter groups its steps', () => {
  const gaps = (bar: typeof B, columns: number) => Array.from({ length: columns }, (_, i) => gapAfter(i, bar));
  expect(gaps(B, 16)).toEqual([2, 2, 2, 6, 2, 2, 2, 6, 2, 2, 2, 6, 2, 2, 2, 12]);
  const seven = barOf([7, 8]);
  expect(gaps(seven, 14)).toEqual([2, 2, 2, 6, 2, 2, 2, 6, 2, 2, 2, 2, 2, 12]);
  const six = barOf([6, 8]);
  expect(gaps(six, 12)).toEqual([2, 2, 2, 2, 2, 6, 2, 2, 2, 2, 2, 12]);
  expect(Array.from({ length: 14 }, (_, i) => onBeat(i, seven))).toEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => [0, 4, 8].includes(i)));
  // The second bar starts where the first one's width says.
  expect(cellX(14, seven)).toBe(laneWidth(14, seven) + 12);
  for (const bar of [B, seven, six, barOf([5, 8]), barOf([3, 4])]) {
    for (let i = 0; i < 3 * bar.steps; i++) {
      expect(columnAt(cellX(i, bar), 3 * bar.steps, bar)).toBe(i);
      expect(tickAt(tickX(i * T + 7, bar), 3 * bar.steps, bar)).toBe(i * T + 7);
    }
  }
});

test('positions count beats by the groups of the meter', () => {
  const seven = barOf([7, 8]);
  expect(positionText(8 * T, seven)).toBe('1.3.1');
  expect(positionText(13 * T + 2, seven)).toBe('1.3.6+2');
  expect(positionText(14 * T, seven)).toBe('2.1.1');
  const six = barOf([6, 8]);
  expect(positionText(11 * T, six)).toBe('1.2.6');
  for (const bar of [seven, six, barOf([5, 4])]) {
    for (const t of [0, 13, 96, 200, 337, 5000]) expect(parsePosition(positionText(t, bar), bar)).toBe(t);
  }
  expect(parsePosition('1.4', seven)).toBeNaN();
  expect(parsePosition('2.3', six)).toBeNaN();
});

test('the backgrounds repeat every bar of the meter', () => {
  const seven = barOf([7, 8]);
  expect(sheetBackground(12, seven).backgroundSize.split(', ')[0]).toBe(`${cellX(14, seven)}px 100%`);
  expect(gapsBackground(seven).backgroundSize).toBe(`${cellX(14, seven)}px 100%`);
});
