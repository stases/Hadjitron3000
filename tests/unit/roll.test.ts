import { expect, test } from 'vitest';
import { MAX_NOTE, MIN_NOTE } from '../../src/core/notes';
import type { Note } from '../../src/core/types';
import {
  BAR_TICKS, ROW_H, dragNotes, drawnLength, endX, makeClip, noteAt, noteY, notesIn, parsePosition, parseSteps,
  pitchAt, placeClip, positionText, sheetBackground, snapFloor, snapRound, stepsText, tickAt, tickX, velocityGroup,
} from '../../src/ui/track/roll';
import { CELL_W, cellX } from '../../src/ui/track/steps';

const T = 24;
const note = (id: string, start: number, len: number, pitch = 60, vel = 0.8): Note =>
  ({ id, start, len, note: pitch, vel });

test('a tick is a pixel inside the grid cells, and the gaps between cells count as the next step line', () => {
  expect(CELL_W).toBe(T);
  for (let t = 0; t < 2 * BAR_TICKS; t++) expect(tickAt(tickX(t), 32)).toBe(t);
  expect(tickX(36)).toBe(cellX(1) + 12);
  expect(endX(24)).toBe(CELL_W);
  expect(endX(36)).toBe(cellX(1) + 12);
  expect(endX(BAR_TICKS)).toBe(cellX(15) + CELL_W);
  expect(tickAt(CELL_W + 1, 32)).toBe(T);
  expect(tickAt(cellX(15) + CELL_W + 5, 32)).toBe(BAR_TICKS);
  expect(tickAt(-10, 16)).toBe(0);
  expect(tickAt(99999, 16)).toBe(BAR_TICKS - 1);
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
  expect(noteAt(notes, 10, y, BAR_TICKS)).toEqual({ note: notes[0], part: 'body' });
  expect(noteAt(notes, 1, y, BAR_TICKS)!.part).toBe('start');
  expect(noteAt(notes, cellX(1) + 10, y, BAR_TICKS)!.note.id).toBe('b');
  expect(noteAt(notes, cellX(2) + CELL_W - 1, y, BAR_TICKS)).toEqual({ note: notes[1], part: 'end' });
  expect(noteAt(notes, 10, noteY(62) + 1, BAR_TICKS)!.note.id).toBe('c');
  expect(noteAt(notes, 10, noteY(61), BAR_TICKS)).toBeNull();
  expect(noteAt(notes, cellX(3) + 2, y, BAR_TICKS)).toBeNull();
  expect(noteAt(notes, tickX(400) + 2, y, 384)).toBeNull();
  // A note of two pixels has no edges.
  expect(noteAt([note('t', 0, 2)], 1, y, BAR_TICKS)!.part).toBe('body');
});

test('a rubber band selects the notes it touches', () => {
  const notes = [note('a', 0, 24), note('b', 48, 24, 64), note('c', 96, 24, 50)];
  const band = { left: 10, top: noteY(64) + 11, right: tickX(48) + 1, bottom: noteY(60) };
  expect(notesIn(notes, band, BAR_TICKS)).toEqual(['b']);
  expect(notesIn(notes, { ...band, bottom: noteY(60) + 1 }, BAR_TICKS)).toEqual(['a', 'b']);
  expect(notesIn(notes, { left: 0, top: 0, right: 99999, bottom: 99999 }, 96)).toEqual(['a', 'b']);
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
  expect(positionText(0)).toBe('1.1.1');
  expect(positionText(BAR_TICKS + 96 + 48 + 8)).toBe('2.2.3+8');
  for (const t of [0, 13, 96, 383, 384, 5000]) expect(parsePosition(positionText(t))).toBe(t);
  expect(parsePosition('3')).toBe(2 * BAR_TICKS);
  expect(parsePosition('1.2')).toBe(96);
  expect(parsePosition(' 1.1.2 + 4 ')).toBe(28);
  for (const bad of ['', 'x', '0.1.1', '1.0', '1..2']) expect(parsePosition(bad)).toBeNaN();
  expect([24, 36, 16, 1, 96].map(stepsText)).toEqual(['1', '1.5', '0.67', '0.04', '4']);
  expect(parseSteps('1.5')).toBe(36);
  expect(parseSteps('0,5')).toBe(12);
  expect(parseSteps('x')).toBeNaN();
});

test('a velocity bar stands for the notes that start there, or the selected ones among them', () => {
  const notes = [note('a', 0, 24), note('b', 0, 24, 64), note('c', 4, 24), note('d', 48, 24)];
  expect(velocityGroup(notes, [], 1).map((n) => n.id)).toEqual(['a', 'b']);
  expect(velocityGroup(notes, ['b', 'd'], 1).map((n) => n.id)).toEqual(['b']);
  expect(velocityGroup(notes, [], 5).map((n) => n.id)).toEqual(['c']);
  expect(velocityGroup(notes, [], tickX(48) - 2).map((n) => n.id)).toEqual(['d']);
  expect(velocityGroup(notes, [], 30)).toEqual([]);
});

test('the sheet draws snap lines inside the cells only for snaps off the step grid', () => {
  const lines = (unit: number) => (sheetBackground(unit).backgroundImage.match(/var\(--face-hi\)/g) ?? []).length;
  expect(lines(24)).toBe(0);
  expect(lines(1)).toBe(0);
  expect(lines(12)).toBe(16);
  expect(lines(16)).toBe(16);
  expect(lines(32)).toBe(8);
});
