import { expect, test } from 'vitest';
import { emptyProject, newSound, TICKS_PER_STEP } from '../../src/core/defaults';
import { eventsBetween, heardAt, loopSteps, songBars, stepSeconds, tickTime } from '../../src/core/sequencer';
import type { Note, Project } from '../../src/core/types';
import { notesOf, stepNote } from '../support/steps';

const T = TICKS_PER_STEP;

function demo(): Project {
  const p = emptyProject();
  p.bpm = 120;
  p.channels.push({ id: 'k', sound: newSound(), color: 0, mute: false, solo: false });
  p.patterns[0].notes = { k: notesOf({ 0: { note: 60, vel: 0.8, len: 1 }, 3: { note: 67, vel: 0.5, len: 2 } }) };
  return p;
}

/** The time of a step as it was before notes had ticks: every second sixteenth late by swing * half a step. */
const oldStepTime = (step: number, bpm: number, swing: number) =>
  step * stepSeconds(bpm) + (step % 2 === 1 ? swing * stepSeconds(bpm) * 0.5 : 0);

test('a step is a sixteenth note', () => {
  expect(stepSeconds(120)).toBeCloseTo(0.125);
  expect(tickTime(4 * T, 120, 0)).toBeCloseTo(0.5);
  expect(tickTime(T / 2, 120, 0)).toBeCloseTo(0.0625);
});

test('swing delays every second step by up to half a step', () => {
  expect(tickTime(2 * T, 120, 1)).toBeCloseTo(0.25);
  expect(tickTime(3 * T, 120, 1)).toBeCloseTo(0.375 + 0.0625);
});

test('ticks on the grid land exactly where the steps did before, for any tempo and swing', () => {
  for (const bpm of [40, 99, 126, 137, 240]) {
    for (const swing of [0, 0.3, 0.6, 1]) {
      for (let step = 0; step < 600; step++) expect(tickTime(step * T, bpm, swing)).toBe(oldStepTime(step, bpm, swing));
    }
  }
});

test('the swing warp is continuous and rises with every tick', () => {
  for (const swing of [0, 0.25, 0.5, 1]) {
    let last = -Infinity;
    for (let tick = 0; tick <= 8 * T; tick++) {
      const t = tickTime(tick, 120, swing);
      expect(t).toBeGreaterThan(last);
      last = t;
    }
  }
});

test('ticks between grid lines keep their proportional place inside the swung step', () => {
  const swing = 0.5;
  for (const pair of [0, 2, 10]) {
    const [a, b, c] = [pair, pair + 1, pair + 2].map((step) => tickTime(step * T, 120, swing));
    for (const frac of [0.25, 0.5, 0.75]) {
      expect(tickTime((pair + frac) * T, 120, swing)).toBeCloseTo(a + frac * (b - a), 12);
      expect(tickTime((pair + 1 + frac) * T, 120, swing)).toBeCloseTo(b + frac * (c - b), 12);
    }
  }
  // The first step of a pair is stretched by the swing, the second squeezed by as much.
  expect(tickTime(T, 120, swing) - tickTime(0, 120, swing)).toBeCloseTo(0.125 * 1.25, 12);
  expect(tickTime(2 * T, 120, swing) - tickTime(T, 120, swing)).toBeCloseTo(0.125 * 0.75, 12);
});

test('a note ends where the swing puts its last tick', () => {
  const p = demo();
  p.swing = 0.5;
  const scope = { kind: 'pattern', patternId: p.patterns[0].id } as const;
  const [first, second] = eventsBetween(p, scope, 0, 16 * T);
  expect(first.dur).toBeCloseTo(tickTime(T, 120, 0.5), 12);
  expect(second.time + second.dur).toBeCloseTo(tickTime(5 * T, 120, 0.5), 12);
});

test('a pattern loops', () => {
  const p = demo();
  const scope = { kind: 'pattern', patternId: p.patterns[0].id } as const;
  expect(loopSteps(p, scope)).toBe(16);
  expect(heardAt(p, scope, 19 * T + 5)).toMatchObject([{ tick: 3 * T + 5, placement: null }]);
  const events = eventsBetween(p, scope, 0, 32 * T);
  expect(events.map((e) => e.time)).toEqual([0, 0.375, 2, 2.375]);
  expect(events[1]).toMatchObject({ channelId: 'k', note: 67, vel: 0.5, dur: 0.25 });
});

test('the song plays its placements, layered across lanes, and an empty song plays nothing', () => {
  const p = demo();
  const a = p.patterns[0];
  const b = { id: 'b', name: 'B', color: 1, bars: 2, notes: { k: [stepNote(31, 72)] } };
  p.patterns.push(b);
  p.song = [
    { id: 's1', pattern: a.id, lane: 0, bar: 0, bars: 1 },
    { id: 's2', pattern: 'b', lane: 0, bar: 1, bars: 2 },
    { id: 's3', pattern: a.id, lane: 1, bar: 2, bars: 2 },
  ];
  const scope = { kind: 'song' } as const;
  expect(songBars(p)).toBe(4);
  expect(loopSteps(p, scope)).toBe(64);
  expect(heardAt(p, scope, 16 * T)).toMatchObject([{ pattern: b, tick: 0, placement: { id: 's2' } }]);
  expect(heardAt(p, scope, 40 * T).map((h) => [h.pattern.id, h.tick])).toEqual([['b', 24 * T], [a.id, 8 * T]]);
  expect(eventsBetween(p, scope, 0, 64 * T).map((e) => e.note)).toEqual([60, 67, 60, 67, 72, 60, 67]);
  p.song = [];
  expect(heardAt(p, scope, 0)).toEqual([]);
  expect(eventsBetween(p, scope, 0, 16 * T)).toEqual([]);
});

test('a placement repeats a shorter block, cuts off a longer one, and gaps are silent', () => {
  const p = demo();
  const a = p.patterns[0];
  p.song = [{ id: 's1', pattern: a.id, lane: 0, bar: 1, bars: 2 }];
  const scope = { kind: 'song' } as const;
  expect(loopSteps(p, scope)).toBe(48);
  expect(heardAt(p, scope, 3 * T)).toEqual([]);
  expect(eventsBetween(p, scope, 0, 48 * T).map((e) => e.time)).toEqual([2, 2.375, 4, 4.375]);
  a.bars = 4;
  a.notes.k.push(stepNote(40, 72));
  expect(eventsBetween(p, scope, 0, 48 * T).map((e) => e.note)).toEqual([60, 67]);
});

/** Every note of every window, as "time:channel:note", for windows of `size` ticks from 0 to `end`. */
function windowed(p: Project, scope: Parameters<typeof eventsBetween>[1], size: number, end: number): string[] {
  const out: string[] = [];
  for (let from = 0; from < end; from += size) {
    const events = eventsBetween(p, scope, from, Math.min(end, from + size));
    out.push(...events.map((e) => `${e.time}:${e.channelId}:${e.note}`));
  }
  return out;
}

test('tick windows schedule every note once, across window edges and the loop wrap, with chords and overlaps', () => {
  const p = demo();
  p.swing = 0.4;
  p.channels.push({ id: 'pad', sound: newSound(), color: 1, mute: false, solo: false });
  const pad: Note[] = [
    { id: 'c1', start: 0, len: 96, note: 48, vel: 0.7 },
    { id: 'c2', start: 0, len: 96, note: 55, vel: 0.7 },
    { id: 'c3', start: 0, len: 48, note: 63, vel: 0.7 },
    { id: 'o1', start: 23, len: 200, note: 60, vel: 0.5 },
    { id: 'o2', start: 24, len: 5, note: 60, vel: 0.5 },
    { id: 'e1', start: 16 * T - 1, len: 30, note: 67, vel: 0.5 },
  ];
  p.patterns[0].notes.pad = pad;
  const a = p.patterns[0];
  p.patterns.push({ ...a, id: 'b', bars: 3 });
  p.song = [
    { id: 's1', pattern: a.id, lane: 0, bar: 0, bars: 3 },
    { id: 's2', pattern: 'b', lane: 1, bar: 1, bars: 2 },
  ];
  // Three passes: the block alone has 8 notes; the song plays it three times in lane 1 and once more in lane 2.
  const scopes = [[{ kind: 'pattern', patternId: a.id } as const, 3 * 8], [{ kind: 'song' } as const, 3 * 32]] as const;
  for (const [scope, count] of scopes) {
    const end = 3 * loopSteps(p, scope) * T;
    const whole = windowed(p, scope, end, end);
    expect(whole).toHaveLength(count);
    for (const size of [1, 5, T, 7 * T, 100]) expect(windowed(p, scope, size, end)).toEqual(whole);
  }
  // Three passes of the block: eight notes each, the chord's three on the same time.
  const block = windowed(p, { kind: 'pattern', patternId: a.id }, T, 3 * 16 * T);
  expect(block).toHaveLength(24);
  expect(block.slice(0, 4).map((e) => e.split(':').slice(1).join(':'))).toEqual(['k:60', 'pad:48', 'pad:55', 'pad:63']);
});
