import { expect, test } from 'vitest';
import { fadeGain } from '../../src/core/arrangement';
import { emptyProject, newChannel, newSound, TICKS_PER_STEP } from '../../src/core/defaults';
import { eventsBetween, heardAt, loopSteps, plays, songBars, stepSeconds, tickTime } from '../../src/core/sequencer';
import type { Note, Placement, Project } from '../../src/core/types';
import { notesOf, stepNote } from '../support/steps';

const T = TICKS_PER_STEP;

function demo(): Project {
  const p = emptyProject();
  p.bpm = 120;
  p.channels.push(newChannel('k', newSound(), 0));
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
  p.channels.push(newChannel('pad', newSound(), 1));
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

/** A project with one row of these notes in a one-bar block A, at 120 BPM. */
function oneRow(notes: Note[], meter: Project['meter'] = [4, 4]): Project {
  const p = emptyProject();
  p.meter = meter;
  p.channels.push(newChannel('k', newSound(), 0));
  p.patterns[0].notes = { k: notes };
  return p;
}

const blockScope = (p: Project) => ({ kind: 'pattern', patternId: p.patterns[0].id } as const);

test('a note with a chance plays on the same passes every time, and on about that share of them', () => {
  const note: Note = { id: 'n', start: 0, len: T, note: 60, vel: 1, chance: 30 };
  const passes = Array.from({ length: 10000 }, (_, i) => plays(note, 'p', i));
  expect(Array.from({ length: 10000 }, (_, i) => plays(note, 'p', i))).toEqual(passes);
  expect(passes.filter(Boolean).length / passes.length).toBeCloseTo(0.3, 1.5);
  for (const chance of [1, 50, 99]) {
    const share = Array.from({ length: 20000 }, (_, i) => plays({ ...note, chance }, 'q', i)).filter(Boolean).length;
    expect(Math.abs(share / 20000 - chance / 100)).toBeLessThan(0.015);
  }
  // Another note or another block makes other choices.
  expect(Array.from({ length: 64 }, (_, i) => plays({ ...note, id: 'm' }, 'p', i))).not.toEqual(passes.slice(0, 64));
  expect(Array.from({ length: 64 }, (_, i) => plays(note, 'r', i))).not.toEqual(passes.slice(0, 64));
  expect(plays({ ...note, chance: undefined }, 'p', 0)).toBe(true);
});

test('in the block on repeat a chance is decided per pass, the same on every play', () => {
  const p = oneRow([{ id: 'n', start: 0, len: T, note: 60, vel: 1, chance: 50 }]);
  const scope = blockScope(p);
  const heard = (from: number) => eventsBetween(p, scope, from, 64 * 16 * T).map((e) => Math.round(e.time / 2));
  const passes = heard(0);
  expect(passes.length).toBeGreaterThan(16);
  expect(passes.length).toBeLessThan(48);
  expect(heard(0)).toEqual(passes);
  const [note] = p.patterns[0].notes.k;
  expect(passes).toEqual(Array.from({ length: 64 }, (_, i) => i).filter((i) => plays(note, p.patterns[0].id, i)));
});

test('in the song a chance is decided by the bar where the repeat of the placement starts', () => {
  const p = oneRow([{ id: 'n', start: 0, len: T, note: 60, vel: 1, chance: 50 }]);
  const a = p.patterns[0];
  p.song = [
    { id: 's1', pattern: a.id, lane: 0, bar: 0, bars: 40 }, { id: 's2', pattern: a.id, lane: 1, bar: 3, bars: 2 },
  ];
  const bars = eventsBetween(p, { kind: 'song' }, 0, 40 * 16 * T).map((e) => e.time / 2);
  const lane1 = Array.from({ length: 40 }, (_, i) => i).filter((i) => plays(a.notes.k[0], a.id, i));
  const lane2 = [3, 4].filter((i) => plays(a.notes.k[0], a.id, i));
  expect(bars).toEqual([...lane1, ...lane2].sort((x, y) => x - y));
  // The second time round the song sounds the same.
  const again = eventsBetween(p, { kind: 'song' }, 40 * 16 * T, 80 * 16 * T).map((e) => e.time / 2 - 40);
  expect(again).toEqual(bars);
});

test('a ratchet plays the note that many times inside its length, each that long, swung like the steps', () => {
  for (const swing of [0, 0.5]) {
    const p = oneRow([{ id: 'r', start: 2 * T, len: 2 * T, note: 60, vel: 0.5, ratchet: 4, slide: true }]);
    p.swing = swing;
    const events = eventsBetween(p, blockScope(p), 0, 16 * T);
    const ticks = [48, 60, 72, 84];
    expect(events.map((e) => e.time)).toEqual(ticks.map((t) => tickTime(t, 120, swing)));
    expect(events.map((e) => e.dur)).toEqual(ticks.map((t) => tickTime(t + 12, 120, swing) - tickTime(t, 120, swing)));
    expect(events.map((e) => [e.note, e.vel])).toEqual(ticks.map(() => [60, 0.5]));
    // Only the first repeat glides in.
    expect(events.map((e) => e.slide ?? false)).toEqual([true, false, false, false]);
  }
  for (const ratchet of [2, 3, 6, 8]) {
    const p = oneRow([{ id: 'r', start: 0, len: T, note: 60, vel: 1, ratchet }]);
    const events = eventsBetween(p, blockScope(p), 0, 16 * T);
    expect(events).toHaveLength(ratchet);
    events.forEach((e, i) => expect(e.time).toBeCloseTo(tickTime((i * T) / ratchet, 120, 0), 12));
    events.forEach((e) => expect(e.dur).toBeCloseTo(stepSeconds(120) / ratchet, 12));
  }
});

test('repeats of a ratchet past the end of the block are left out, and windows find each repeat once', () => {
  const p = oneRow([
    { ...stepNote(3), ratchet: 3 }, { id: 'r', start: 15 * T, len: 2 * T, note: 60, vel: 1, ratchet: 4 },
  ]);
  p.swing = 0.3;
  const scope = blockScope(p);
  expect(eventsBetween(p, scope, 0, 16 * T)).toHaveLength(2 + 3);
  const end = 3 * 16 * T;
  const whole = windowed(p, scope, end, end);
  for (const size of [1, 5, 7, T]) expect(windowed(p, scope, size, end)).toEqual(whole);
});

test('a ratchet plays whole or not at all when it has a chance', () => {
  const p = oneRow([{ id: 'r', start: 0, len: 4 * T, note: 60, vel: 1, ratchet: 8, chance: 50 }]);
  const scope = blockScope(p);
  const counts = Array.from({ length: 40 }, (_, pass) =>
    eventsBetween(p, scope, pass * 16 * T, (pass + 1) * 16 * T).length);
  expect(new Set(counts)).toEqual(new Set([0, 8]));
});

test('a held note in the song sounds once from its start to the end of its placement', () => {
  const held: Note = { id: 'h', start: 4 * T, len: T, note: 48, vel: 0.6, hold: true };
  const p = oneRow([held, stepNote(0, 72)]);
  const a = p.patterns[0];
  p.song = [
    { id: 's1', pattern: a.id, lane: 0, bar: 2, bars: 3 }, { id: 's2', pattern: a.id, lane: 0, bar: 6, bars: 1 },
  ];
  for (const bpm of [60, 133]) {
    p.bpm = bpm;
    const time = (tick: number) => tickTime(tick, bpm, 0);
    const events = eventsBetween(p, { kind: 'song' }, 0, 7 * 16 * T).filter((e) => e.note === 48);
    // Not started again when the block repeats inside the placement, cut where the placement ends.
    expect(events).toHaveLength(2);
    expect(events[0].time).toBe(time(36 * T));
    expect(events[0].time + events[0].dur).toBeCloseTo(time(5 * 16 * T), 12);
    expect(events[1].time + events[1].dur).toBeCloseTo(time(7 * 16 * T), 12);
    expect(events[0].dur / stepSeconds(bpm)).toBeCloseTo(44, 9);
  }
  // A placement that ends before the note starts does not play it.
  p.song = [{ id: 's1', pattern: a.id, lane: 0, bar: 0, bars: 1 }];
  a.bars = 2;
  held.start = 20 * T;
  expect(eventsBetween(p, { kind: 'song' }, 0, 16 * T).map((e) => e.note)).toEqual([72]);
});

test('a held note in the block on repeat lasts to the end of the block and starts again with each pass', () => {
  const p = oneRow([{ id: 'h', start: 4 * T, len: T, note: 48, vel: 0.6, hold: true, ratchet: 2 }]);
  const events = eventsBetween(p, blockScope(p), 0, 32 * T);
  // With a ratchet the last repeat is the one held.
  const at = (tick: number) => tickTime(tick, 120, 0);
  expect(events.map((e) => [e.time, e.dur])).toEqual([
    [at(96), stepSeconds(120) / 2], [at(108), at(384) - at(108)],
    [at(480), stepSeconds(120) / 2], [at(492), at(768) - at(492)],
  ]);
});

test('a slide is carried to the event and nothing else is', () => {
  const p = oneRow([{ ...stepNote(0), slide: true }, stepNote(1)]);
  const [first, second] = eventsBetween(p, blockScope(p), 0, 16 * T);
  expect(first.slide).toBe(true);
  expect(second).toEqual({ channelId: 'k', time: 0.125, dur: 0.125, note: 60, vel: 0.8 });
});

test('a 7/8 bar is fourteen steps, in blocks and the song, and windows schedule each event once', () => {
  const notes = [
    stepNote(0), { ...stepNote(6, 67), ratchet: 3 }, { ...stepNote(10, 50), hold: true }, stepNote(13, 64),
  ];
  const p = oneRow(notes, [7, 8]);
  p.swing = 0.25;
  const a = p.patterns[0];
  a.bars = 2;
  p.song = [{ id: 's1', pattern: a.id, lane: 0, bar: 1, bars: 3 }];
  expect(loopSteps(p, blockScope(p))).toBe(28);
  expect(loopSteps(p, { kind: 'song' })).toBe(56);
  expect(heardAt(p, { kind: 'song' }, 14 * T + 5)).toMatchObject([{ tick: 5 }]);
  expect(eventsBetween(p, blockScope(p), 0, 28 * T).map((e) => e.time / stepSeconds(120)))
    .toEqual([0, 6, 6 + 1 / 3, 6 + 2 / 3, 10, 13].map((step) => tickTime(step * T, 120, 0.25) / stepSeconds(120)));
  for (const scope of [blockScope(p), { kind: 'song' } as const]) {
    const end = 3 * loopSteps(p, scope) * T;
    const whole = windowed(p, scope, end, end);
    expect(whole.length).toBeGreaterThan(0);
    for (const size of [1, 7, T, 5 * T, 14 * T]) expect(windowed(p, scope, size, end)).toEqual(whole);
  }
});

/** A bar of 4/4, two seconds at 120 BPM. */
const B = 16 * T;

/** An eight-bar block with these notes on row k, placed once over eight bars of lane 1 with these extras. */
function placed(notes: Note[], extra: Partial<Placement> = {}): Project {
  const p = oneRow(notes);
  p.patterns[0].bars = 8;
  p.song = [{ id: 's', pattern: p.patterns[0].id, lane: 0, bar: 0, bars: 8, ...extra }];
  return p;
}

test('notes of a faded placement carry the fades as a gain curve, before, in and across the fades', () => {
  const p = placed([
    { id: 'a', start: 0, len: T, note: 60, vel: 1 },
    { id: 'b', start: 4 * B, len: T, note: 62, vel: 1 },
    { id: 'c', start: 5 * B + 8 * T, len: B, note: 64, vel: 1 },
    { id: 'd', start: 0, len: T, note: 48, vel: 1, hold: true },
    { id: 'e', start: 2 * B + 8 * T, len: 2 * T, note: 66, vel: 1 },
  ], { fadeIn: 2, fadeOut: 2 });
  const events = eventsBetween(p, { kind: 'song' }, 0, 8 * B);
  const event = (note: number) => events.find((e) => e.note === note)!;
  // Sixteen seconds of song with a fade of four seconds at each end, no swing: the curve in seconds.
  const expectOnFade = (note: number) => {
    const { time, gain } = event(note);
    for (const [at, value] of gain!) expect(value, `${note} at ${at}`).toBeCloseTo(fadeGain(time + at, 16, 4, 4), 12);
    return gain!;
  };

  // In the fade-in: from silence, on to the end of the fade so the release keeps rising.
  const a = expectOnFade(60);
  expect(a).toHaveLength(17);
  expect(a[0]).toEqual([0, 0]);
  expect(a.at(-1)).toEqual([4, 1]);
  expect(a.every(([, g], i) => i === 0 || g > a[i - 1][1])).toBe(true);
  // Between the fades, and just after the fade-in: a single point at full gain.
  expect(event(62).gain).toEqual([[0, 1]]);
  expect(event(66).gain).toEqual([[0, 1]]);
  // Across into the fade-out: full gain to the boundary, then falling to silence at the end of the placement.
  const c = expectOnFade(64);
  expect(c[0]).toEqual([0, 1]);
  expect(c[1][0]).toBeCloseTo(1, 12);
  expect(c[1][1]).toBe(1);
  expect(c.at(-1)).toEqual([5, 0]);
  expect(c).toHaveLength(18);
  // A drone over the whole placement swells over the fade-in, holds, and dies away over the fade-out.
  const d = expectOnFade(48);
  expect(event(48).dur).toBe(16);
  expect(d).toHaveLength(34);
  expect(d[0]).toEqual([0, 0]);
  expect(d[16]).toEqual([4, 1]);
  expect(d[17]).toEqual([12, 1]);
  expect(d.at(-1)).toEqual([16, 0]);
});

test('a note that sounds past the end of a placement with a fade-out is silent at the end', () => {
  const p = placed([{ id: 'a', start: 7 * B + 8 * T, len: 2 * B, note: 60, vel: 1 }], { fadeOut: 1 });
  const [event] = eventsBetween(p, { kind: 'song' }, 0, 8 * B);
  expect(event.dur).toBe(4);
  expect(event.gain![0][1]).toBeCloseTo(Math.SQRT1_2, 12);
  expect(event.gain!.at(-1)).toEqual([4, 0]);
  expect(event.gain!.find(([at]) => at === 1)![1]).toBe(0);
});

test('without fades in a lane at 0 dB notes carry no curve; the block on repeat ignores lanes, fades, mutes', () => {
  const p = placed([stepNote(0), { ...stepNote(4), hold: true }]);
  const song = eventsBetween(p, { kind: 'song' }, 0, 8 * B);
  expect(song).toHaveLength(2);
  expect(song.every((e) => !('gain' in e))).toBe(true);
  p.song[0] = { ...p.song[0], fadeIn: 4, mutes: ['k'] };
  p.lanes[0] = { level: -12, mute: true };
  const block = eventsBetween(p, blockScope(p), 0, 8 * B);
  expect(block).toHaveLength(2);
  expect(block.every((e) => !('gain' in e))).toBe(true);
});

test('a lane plays at its level, multiplies the fades, and a muted lane or one at the bottom plays nothing', () => {
  const p = placed([stepNote(0), { ...stepNote(4 * 16), hold: true }]);
  p.channels.push(newChannel('h', newSound(), 1));
  p.patterns.push({ id: 'b', name: 'B', color: 1, bars: 1, notes: { h: [stepNote(0, 72)] } });
  p.song.push({ id: 't', pattern: 'b', lane: 1, bar: 0, bars: 1 });
  const lane = 10 ** (-12 / 20);
  p.lanes[0].level = -12;
  const events = eventsBetween(p, { kind: 'song' }, 0, 8 * B);
  expect(events.filter((e) => e.channelId === 'k').map((e) => e.gain)).toEqual([[[0, lane]], [[0, lane]]]);
  expect(events.find((e) => e.channelId === 'h')!.gain).toBeUndefined();

  p.song[0].fadeOut = 2;
  const held = eventsBetween(p, { kind: 'song' }, 0, 8 * B).find((e) => e.note === 60 && e.time === 8)!;
  expect(held.gain![0]).toEqual([0, lane]);
  expect(held.gain!.at(-1)).toEqual([8, 0]);
  expect(Math.max(...held.gain!.map(([, g]) => g))).toBe(lane);

  for (const muted of [{ level: 0, mute: true }, { level: -48, mute: false }]) {
    p.lanes[0] = muted;
    expect(eventsBetween(p, { kind: 'song' }, 0, 8 * B).map((e) => e.channelId)).toEqual(['h']);
  }
});

test('a placement silences exactly the sounds it mutes; the same block elsewhere plays them', () => {
  const p = oneRow([stepNote(0), stepNote(8)]);
  p.channels.push(newChannel('h', newSound(), 1));
  p.channels.push(newChannel('s', newSound(), 2));
  const a = p.patterns[0];
  a.notes.h = [stepNote(2, 72), stepNote(6, 72)];
  a.notes.s = [stepNote(4, 50)];
  p.song = [
    { id: 's1', pattern: a.id, lane: 0, bar: 0, bars: 1 },
    { id: 's2', pattern: a.id, lane: 0, bar: 1, bars: 1, mutes: ['h'] },
    { id: 's3', pattern: a.id, lane: 1, bar: 2, bars: 1, mutes: ['h', 's'] },
  ];
  const heard = eventsBetween(p, { kind: 'song' }, 0, 3 * B).map((e) => `${Math.floor(e.time / 2)}:${e.channelId}`);
  expect(heard).toEqual(['0:k', '0:h', '0:s', '0:h', '0:k', '1:k', '1:s', '1:k', '2:k', '2:k']);
  expect(eventsBetween(p, { kind: 'song' }, 0, 3 * B).every((e) => !('gain' in e))).toBe(true);
});

/** A one-bar block of 4/4 with a five-step hat against a sixteen-step kick, the hat's last note past its loop. */
function polymeter(): Project {
  const p = oneRow([stepNote(0, 36, 'k0'), stepNote(4, 36, 'k4'), stepNote(8, 36, 'k8'), stepNote(12, 36, 'k12')]);
  p.channels.push(newChannel('h', newSound(), 1));
  p.patterns[0].notes.h = [stepNote(0, 72, 'h0'), stepNote(3, 70, 'h3'), stepNote(6, 74, 'h6')];
  p.patterns[0].loops = { h: 5 };
  return p;
}

test('a row with a loop of its own repeats it end to end through the block, and starts again with the block', () => {
  const p = polymeter();
  const scope = blockScope(p);
  const steps = (events: ReturnType<typeof eventsBetween>, id: string) =>
    events.filter((e) => e.channelId === id).map((e) => [Math.round(e.time / stepSeconds(120)), e.note]);
  const two = eventsBetween(p, scope, 0, 32 * T);
  // The note on step 6 is past the loop of five steps and silent; the copies at 0, 5, 10 and 15 play steps 0 and 3,
  // the last copy only its first step, and the second pass starts the loop again with the block.
  const pass = [[0, 72], [3, 70], [5, 72], [8, 70], [10, 72], [13, 70], [15, 72]];
  expect(steps(two, 'h')).toEqual([...pass, ...pass.map(([s, n]) => [s + 16, n])]);
  expect(steps(two, 'k')).toEqual([[0, 36], [4, 36], [8, 36], [12, 36], [16, 36], [20, 36], [24, 36], [28, 36]]);
  // Lengthened again past step 6, that note plays.
  p.patterns[0].loops = { h: 7 };
  expect(steps(eventsBetween(p, scope, 0, 16 * T), 'h').map(([s]) => s)).toEqual([0, 3, 6, 7, 10, 13, 14]);
  // A loop as long as the block or longer is no loop.
  p.patterns[0].loops = { h: 40 };
  expect(steps(eventsBetween(p, scope, 0, 16 * T), 'h').map(([s]) => s)).toEqual([0, 3, 6]);
});

test('swing in a looped row counts from the bar, so a copy on an odd step is swung there', () => {
  const p = polymeter();
  p.swing = 0.6;
  const hat = eventsBetween(p, blockScope(p), 0, 16 * T).filter((e) => e.channelId === 'h');
  expect(hat.map((e) => e.time)).toEqual([0, 3, 5, 8, 10, 13, 15].map((s) => tickTime(s * T, 120, 0.6)));
});

test('in the song a looped row starts again with every repeat of its block, and windows find each note once', () => {
  const p = polymeter();
  p.swing = 0.3;
  p.patterns[0].notes.h[1] = { ...p.patterns[0].notes.h[1], ratchet: 3, chance: 50 };
  p.song = [{ id: 's', pattern: p.patterns[0].id, lane: 0, bar: 1, bars: 3 }];
  for (const scope of [blockScope(p), { kind: 'song' } as const]) {
    const end = 2 * loopSteps(p, scope) * T;
    const whole = windowed(p, scope, end, end);
    for (const size of [1, 5, T, 7 * T, 100]) expect(windowed(p, scope, size, end)).toEqual(whole);
  }
  // A chance in a copy of the loop is decided anew, from the pass and the copy.
  p.swing = 0;
  const h3 = p.patterns[0].notes.h[1];
  const copies = (bar: number) => [0, 1, 2].map((k) => plays(h3, p.patterns[0].id, k === 0 ? bar : `${bar}:${k}`));
  const heard = eventsBetween(p, { kind: 'song' }, 0, 4 * 16 * T).filter((e) => e.note === 70);
  const expected = [1, 2, 3].flatMap((bar) => copies(bar).flatMap((on, k) => (on ? [bar * 16 + 3 + 5 * k] : [])));
  expect([...new Set(heard.map((e) => Math.floor(e.time / stepSeconds(120) + 1e-9)))]).toEqual(expected);
});

test('an arpeggiated looped row: arpeggiator and loops together schedule each note exactly once across windows', () => {
  const p = polymeter();
  p.swing = 0.45;
  p.channels[1].sound.play = { ...p.channels[1].sound.play, arp: 'updown', rate: '1/16t', octaves: 2, gate: 0.8 };
  const a = p.patterns[0];
  a.bars = 2;
  a.notes.h = [
    { id: 'c', start: 0, len: 4 * T, note: 60, vel: 0.8 }, { id: 'e', start: 2 * T, len: 9 * T, note: 64, vel: 0.8 },
    { id: 'g', start: 3 * T, len: T, note: 67, vel: 0.8, chance: 60 },
    { id: 'd', start: 9 * T, len: 2 * T, note: 50, vel: 0.8, hold: true },
  ];
  a.loops = { h: 13 };
  p.song = [{ id: 's', pattern: a.id, lane: 0, bar: 0, bars: 5 }];
  for (const scope of [blockScope(p), { kind: 'song' } as const]) {
    const end = 2 * loopSteps(p, scope) * T;
    const whole = windowed(p, scope, end, end);
    expect(whole.length).toBeGreaterThan(40);
    for (const size of [1, 7, T, 5 * T, 333]) expect(windowed(p, scope, size, end)).toEqual(whole);
  }
});
