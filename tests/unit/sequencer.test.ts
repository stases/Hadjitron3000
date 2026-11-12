import { expect, test } from 'vitest';
import { emptyProject, newSound, newStep } from '../../src/core/defaults';
import { eventsBetween, locate, loopSteps, stepSeconds, stepTime } from '../../src/core/sequencer';
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
  expect(locate(p, scope, 19)?.step).toBe(3);
  const events = eventsBetween(p, scope, 0, 32);
  expect(events.map((e) => e.time)).toEqual([0, 0.375, 2, 2.375]);
  expect(events[1]).toMatchObject({ channelId: 'k', note: 67, vel: 0.5, dur: 0.25 });
});

test('the song plays its patterns in order and an empty song plays nothing', () => {
  const p = demo();
  const a = p.patterns[0];
  const b = { id: 'b', name: 'B', bars: 2, cells: { k: { 31: newStep(72) } } };
  p.patterns.push(b);
  p.song = [a.id, 'b', a.id];
  const scope = { kind: 'song' } as const;
  expect(loopSteps(p, scope)).toBe(64);
  expect(locate(p, scope, 16)).toMatchObject({ index: 1, step: 0 });
  expect(locate(p, scope, 48)).toMatchObject({ index: 2, step: 0 });
  expect(eventsBetween(p, scope, 0, 64).map((e) => e.note)).toEqual([60, 67, 72, 60, 67]);
  p.song = [];
  expect(locate(p, scope, 0)).toBeNull();
  expect(eventsBetween(p, scope, 0, 16)).toEqual([]);
});
