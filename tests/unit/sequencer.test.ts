import { expect, test } from 'vitest';
import { emptyProject, newSound, newStep } from '../../src/core/defaults';
import { eventsBetween, heardAt, loopSteps, songBars, stepSeconds, stepTime } from '../../src/core/sequencer';
import type { Project } from '../../src/core/types';

function demo(): Project {
  const p = emptyProject();
  p.bpm = 120;
  p.channels.push({ id: 'k', sound: newSound(), color: 0, mute: false, solo: false });
  p.patterns[0].cells = { k: { 0: newStep(60), 3: { note: 67, vel: 0.5, len: 2 } } };
  return p;
}

test('a step is a sixteenth note', () => {
  expect(stepSeconds(120)).toBeCloseTo(0.125);
  expect(stepTime(4, 120, 0)).toBeCloseTo(0.5);
});

test('swing delays every second step by up to half a step', () => {
  expect(stepTime(2, 120, 1)).toBeCloseTo(0.25);
  expect(stepTime(3, 120, 1)).toBeCloseTo(0.375 + 0.0625);
});

test('a pattern loops', () => {
  const p = demo();
  const scope = { kind: 'pattern', patternId: p.patterns[0].id } as const;
  expect(loopSteps(p, scope)).toBe(16);
  expect(heardAt(p, scope, 19)).toMatchObject([{ step: 3, placement: null }]);
  const events = eventsBetween(p, scope, 0, 32);
  expect(events.map((e) => e.time)).toEqual([0, 0.375, 2, 2.375]);
  expect(events[1]).toMatchObject({ channelId: 'k', note: 67, vel: 0.5, dur: 0.25 });
});

test('the song plays its placements, layered across lanes, and an empty song plays nothing', () => {
  const p = demo();
  const a = p.patterns[0];
  const b = { id: 'b', name: 'B', color: 1, bars: 2, cells: { k: { 31: newStep(72) } } };
  p.patterns.push(b);
  p.song = [
    { id: 's1', pattern: a.id, lane: 0, bar: 0, bars: 1 },
    { id: 's2', pattern: 'b', lane: 0, bar: 1, bars: 2 },
    { id: 's3', pattern: a.id, lane: 1, bar: 2, bars: 2 },
  ];
  const scope = { kind: 'song' } as const;
  expect(songBars(p)).toBe(4);
  expect(loopSteps(p, scope)).toBe(64);
  expect(heardAt(p, scope, 16)).toMatchObject([{ pattern: b, step: 0, placement: { id: 's2' } }]);
  expect(heardAt(p, scope, 40).map((h) => [h.pattern.id, h.step])).toEqual([['b', 24], [a.id, 8]]);
  expect(eventsBetween(p, scope, 0, 64).map((e) => e.note)).toEqual([60, 67, 60, 67, 72, 60, 67]);
  p.song = [];
  expect(heardAt(p, scope, 0)).toEqual([]);
  expect(eventsBetween(p, scope, 0, 16)).toEqual([]);
});

test('a placement repeats a shorter block, cuts off a longer one, and gaps are silent', () => {
  const p = demo();
  const a = p.patterns[0];
  p.song = [{ id: 's1', pattern: a.id, lane: 0, bar: 1, bars: 2 }];
  const scope = { kind: 'song' } as const;
  expect(loopSteps(p, scope)).toBe(48);
  expect(heardAt(p, scope, 3)).toEqual([]);
  expect(eventsBetween(p, scope, 0, 48).map((e) => e.time)).toEqual([2, 2.375, 4, 4.375]);
  a.bars = 4;
  a.cells.k[40] = newStep(72);
  expect(eventsBetween(p, scope, 0, 48).map((e) => e.note)).toEqual([60, 67]);
});
