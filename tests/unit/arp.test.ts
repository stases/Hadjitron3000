import { expect, test } from 'vitest';
import { arpOf, arpOrder, arpeggiate } from '../../src/core/arp';
import type { ArpSettings, Held } from '../../src/core/arp';
import { TICKS_PER_STEP, emptyProject, newChannel, newSound } from '../../src/core/defaults';
import { MAX_NOTE } from '../../src/core/notes';
import { eventsBetween, plays, tickTime } from '../../src/core/sequencer';
import type { Note, Project } from '../../src/core/types';

const T = TICKS_PER_STEP;
const arp = (mode: string, octaves = 1, rate = T, gate = 0.5): ArpSettings => ({ mode, rate, octaves, gate });
const held = (pitch: number, start: number, end = Infinity): Held => ({ pitch, start, end, key: `${pitch}` });

test('the play settings give the arpeggiator its rate in ticks, or none when it is off', () => {
  expect(arpOf({ mode: 'poly', glide: 0, arp: 'off', rate: '1/16', octaves: 1, gate: 0.5 })).toBeNull();
  expect(arpOf({ mode: 'poly', glide: 0 })).toBeNull();
  const rates = ['1/4', '1/4t', '1/8', '1/8t', '1/16', '1/16t', '1/32'];
  expect(rates.map((rate) => arpOf({ arp: 'up', rate, octaves: 2, gate: 0.3 })!.rate))
    .toEqual([96, 64, 48, 32, 24, 16, 12]);
  expect(arpOf({ arp: 'down', rate: '1/8', octaves: 3, gate: 0.3 }))
    .toEqual({ mode: 'down', rate: 48, octaves: 3, gate: 0.3 });
});

test('each mode orders the held notes over one to four octaves', () => {
  // Played in the order E, G, C.
  const chord = [held(64, 0), held(67, 5), held(60, 10)];
  const order = (mode: string, octaves: number) => arpOrder(chord, arp(mode, octaves)).map((n) => n.note);
  const up = (octaves: number) => Array.from({ length: octaves }, (_, o) => [60, 64, 67].map((n) => n + 12 * o)).flat();
  for (const octaves of [1, 2, 3, 4]) {
    expect(order('up', octaves)).toEqual(up(octaves));
    expect(order('random', octaves)).toEqual(up(octaves));
    expect(order('down', octaves)).toEqual(up(octaves).reverse());
    expect(order('updown', octaves)).toEqual([...up(octaves), ...up(octaves).slice(1, -1).reverse()]);
    expect(order('played', octaves))
      .toEqual(Array.from({ length: octaves }, (_, o) => [64, 67, 60].map((n) => n + 12 * o)).flat());
  }
  expect(order('updown', 1)).toEqual([60, 64, 67, 64]);
  // One note up and down is that note; two go back and forth.
  expect(arpOrder([held(60, 0)], arp('updown')).map((n) => n.note)).toEqual([60]);
  expect(arpOrder([held(60, 0), held(62, 0)], arp('updown')).map((n) => n.note)).toEqual([60, 62]);
  // Octaves above the top of the range are left out.
  expect(arpOrder([held(MAX_NOTE - 5, 0)], arp('up', 3)).map((n) => n.note)).toEqual([MAX_NOTE - 5]);
});

test('notes come every rate from where the held set changes, the order starts again with every change', () => {
  // C and E from 0, G joins at 60, C lets go at 100, everything ends at 160.
  const set = [held(60, 0, 100), held(64, 0, 160), held(67, 60, 160)];
  const notes = arpeggiate(set, arp('up'), 0, 400);
  expect(notes.map((n) => [n.tick, n.note])).toEqual([
    [0, 60], [24, 64], [48, 60], // C E
    [60, 60], [84, 64], // C E G from G's start
    [100, 64], [124, 67], [148, 64], // E G from C's end
  ]);
  // Half the rate long, and never past the note it plays.
  expect(notes.map((n) => n.end - n.tick)).toEqual([12, 12, 12, 12, 12, 12, 12, 12]);
  expect(arpeggiate([held(60, 0, 30)], arp('up', 1, T, 1), 0, 96).map((n) => [n.tick, n.end]))
    .toEqual([[0, 24], [24, 30]]);
  // One held note repeats as long as it is held; the gate scales the length.
  expect(arpeggiate([held(72, 10, 100)], arp('up', 1, 32, 0.25), 0, 400).map((n) => [n.tick, n.end, n.note]))
    .toEqual([[10, 18, 72], [42, 50, 72], [74, 82, 72]]);
  // A key still down plays on to the end of the window.
  expect(arpeggiate([held(60, 0)], arp('up', 2), 0, 96).map((n) => n.note)).toEqual([60, 72, 60, 72]);
});

test('Random picks from the held notes by their keys, the same every time, and windows give each note once', () => {
  const set = Array.from({ length: 5 }, (_, i) => held(60 + 2 * i, 0, 2000));
  const notes = arpeggiate(set, arp('random', 2, 16), 0, 2000);
  expect(arpeggiate(set, arp('random', 2, 16), 0, 2000)).toEqual(notes);
  expect(new Set(notes.map((n) => n.note)).size).toBeGreaterThan(6);
  const renamed = set.map((h) => ({ ...h, key: `x${h.key}` }));
  expect(arpeggiate(renamed, arp('random', 2, 16), 0, 2000).map((n) => n.note)).not.toEqual(notes.map((n) => n.note));
  const pieces = [0, 7, 100, 333, 999, 1500, 2000];
  const windowed = pieces.slice(1).flatMap((to, i) => arpeggiate(set, arp('random', 2, 16), pieces[i], to));
  expect(windowed).toEqual(notes);
});

/** A one-bar block at 120 BPM with one row of these notes, played by a sound with these play settings. */
function arpProject(notes: Note[], play: Record<string, string | number> = {}): Project {
  const p = emptyProject();
  const sound = newSound();
  sound.play = { ...sound.play, arp: 'up', rate: '1/16', octaves: 1, gate: 0.5, ...play };
  p.channels.push(newChannel('k', sound, 0));
  p.patterns[0].notes = { k: notes };
  return p;
}

const scopeOf = (p: Project) => ({ kind: 'pattern', patternId: p.patterns[0].id } as const);
const note = (id: string, start: number, len: number, pitch: number, extra: Partial<Note> = {}): Note =>
  ({ id, start, len, note: pitch, vel: 0.7, ...extra });

test('a sequenced chord is played one note after another, swung like the steps, gated, every pass alike', () => {
  for (const swing of [0, 0.5]) {
    const p = arpProject([note('c', 0, 4 * T, 60), note('e', 0, 4 * T, 64), note('g', 0, 4 * T, 67)]);
    p.swing = swing;
    const events = eventsBetween(p, scopeOf(p), 0, 32 * T);
    const ticks = [0, 24, 48, 72];
    expect(events.map((e) => e.note)).toEqual([60, 64, 67, 60, 60, 64, 67, 60]);
    expect(events.slice(0, 4).map((e) => e.time)).toEqual(ticks.map((t) => tickTime(t, 120, swing)));
    expect(events.slice(0, 4).map((e) => e.dur))
      .toEqual(ticks.map((t) => tickTime(t + 12, 120, swing) - tickTime(t, 120, swing)));
    expect(events.every((e) => e.vel === 0.7)).toBe(true);
  }
  // Off, the same notes play as a chord.
  const plain = arpProject([note('c', 0, 4 * T, 60), note('e', 0, 4 * T, 64)], { arp: 'off' });
  expect(eventsBetween(plain, scopeOf(plain), 0, 16 * T).map((e) => e.time)).toEqual([0, 0]);
});

test('chance and slide carry to every arpeggiated note, a ratchet is ignored, a hold is arpeggiated to the end', () => {
  const p = arpProject([note('c', 0, 16 * T, 60, { chance: 50, slide: true, ratchet: 4 })]);
  const scope = scopeOf(p);
  const passes = Array.from({ length: 8 }, (_, pass) => eventsBetween(p, scope, pass * 16 * T, (pass + 1) * 16 * T));
  const [c] = p.patterns[0].notes.k;
  passes.forEach((events, pass) => {
    // Each of the sixteen notes asks its own chance, from the note, the pass and where it falls.
    const expected = Array.from({ length: 16 }, (_, k) => k)
      .filter((k) => plays(c, p.patterns[0].id, `${pass}@${k * T}`));
    expect(events.map((e) => Math.round(e.time / 0.125) % 16)).toEqual(expected);
    expect(events.every((e) => e.slide === true)).toBe(true);
  });
  const counts = passes.map((e) => e.length);
  expect(Math.min(...counts)).toBeLessThan(16);
  expect(Math.max(...counts)).toBeGreaterThan(0);
  // The same passes come out the same on another play.
  expect(eventsBetween(p, scope, 0, 16 * T)).toEqual(passes[0]);

  const held = arpProject([note('h', 4 * T, T, 48, { hold: true }), note('x', 8 * T, 3 * T, 55)], { rate: '1/8' });
  held.patterns[0].bars = 2;
  const events = eventsBetween(held, scopeOf(held), 0, 32 * T);
  // From step 4 the drone repeats every eighth; G joins at step 8 for three steps, and when it lets go the drone
  // starts again from there and goes on to the end of the block.
  const after = Array.from({ length: 11 }, (_, i) => [11 + 2 * i, 48]);
  expect(events.map((e) => [Math.round(e.time / 0.125), e.note]))
    .toEqual([[4, 48], [6, 48], [8, 48], [10, 55], ...after]);
});
