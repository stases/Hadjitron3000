// Automation rows and locks: the values of a row, the parameters they can name, the automator's points, the store's
// actions and the file format.

import { beforeEach, expect, test } from 'vitest';
import { Automator } from '../../src/audio/automator';
import {
  AUTO_GRID, MAX_SONG_TICKS, automatedRefs, automationGroups, cleanPoints, pointsValue, refKey, refLabel, refSpec,
  soundTargets, storedValue, validLocks,
} from '../../src/core/automation';
import { TICKS_PER_STEP, emptyProject, newChannel, newModule, newNote, newPattern, newSound } from '../../src/core/defaults';
import { parseBlock, parseProject, serializeBlock, serializeProject } from '../../src/core/fileformat';
import { extractBlock } from '../../src/core/block';
import { noteExtras } from '../../src/core/notes';
import { fromNorm, toNorm } from '../../src/core/params';
import { eventsBetween, tickTime } from '../../src/core/sequencer';
import type { AutoRow, Lock, Note, ParamRef, Project } from '../../src/core/types';
import * as app from '../../src/state/store';

const BAR = 16 * TICKS_PER_STEP;

/** Channel a (a pad with a delay) and channel b, one bar of channel a's notes placed for four bars, at 240 BPM. */
function base(notes: Note[] = []): Project {
  const p = emptyProject();
  const pad = newSound('osc', 'Warm Pad');
  pad.chain = [{ ...newModule('delay'), id: 'dl' }, { ...newModule('delay'), id: 'dl2' }];
  p.channels = [newChannel('a', pad, 0), newChannel('b', newSound('noise', 'Hiss'), 1)];
  p.bpm = 240;
  p.mixer.master.chain = [{ ...newModule('eq'), id: 'meq' }];
  p.patterns[0].notes = { a: notes };
  p.song = [{ id: 's', pattern: p.patterns[0].id, lane: 0, bar: 0, bars: 4 }];
  return p;
}

const cutoff: ParamRef = { owner: 'a', module: 'filter', param: 'cutoff' };
const level: ParamRef = { owner: 'a', module: 'out', param: 'level' };

test('a row holds its first value before it, goes in straight lines between points and holds its last after it', () => {
  const points: AutoRow['points'] = [[100, 0.2], [200, 0.6], [400, 0.4]];
  expect(pointsValue(points, 0)).toBe(0.2);
  expect(pointsValue(points, 100)).toBe(0.2);
  expect(pointsValue(points, 150)).toBeCloseTo(0.4, 12);
  expect(pointsValue(points, 300)).toBeCloseTo(0.5, 12);
  expect(pointsValue(points, 400)).toBe(0.4);
  expect(pointsValue(points, 9999)).toBe(0.4);
  expect(pointsValue([[50, 0.7]], 0)).toBe(0.7);
  expect(pointsValue([[50, 0.7]], 500)).toBe(0.7);
  // Two points on one tick make a jump there.
  expect(pointsValue([[0, 0], [100, 1], [100, 0.5], [200, 0.5]], 100)).toBe(0.5);
  expect(pointsValue([[0, 0], [100, 1], [100, 0.5], [200, 0.5]], 99)).toBeCloseTo(0.99, 12);
});

test('values go through the taper of their parameter, so a cutoff row moves evenly in octaves', () => {
  const p = base();
  const spec = refSpec(p, cutoff)!;
  expect(fromNorm(spec, 0)).toBe(20);
  expect(fromNorm(spec, 1)).toBe(20000);
  expect(fromNorm(spec, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 0);
  expect(fromNorm(spec, 1 / 3)).toBeCloseTo(200, 0);
  const send = refSpec(p, { owner: 'a', module: 'send', param: '0' })!;
  expect([send.min, send.max, send.label]).toEqual([0, 1, 'Room']);
  expect(refSpec(p, { owner: { rack: 1 }, module: 'out', param: 'level' })).toMatchObject({ min: -48, max: 6 });
});

test('a reference names a float of a sound, a send, a bus or the master, and nothing else', () => {
  const p = base();
  for (const ref of [
    cutoff, level, { owner: 'a', module: 'dl', param: 'mix' }, { owner: 'a', module: 'amp', param: 'attack' },
    { owner: 'a', module: 'play', param: 'glide' }, { owner: 'a', module: 'send', param: '1' },
    { owner: { rack: 0 }, module: 'out', param: 'level' }, { owner: { rack: 'master' }, module: 'meq', param: 'low' },
    { owner: { rack: 0 }, module: p.mixer.buses[0].chain[0].id, param: 'mix' },
  ] as ParamRef[]) {
    expect(refSpec(p, ref), JSON.stringify(ref)).toBeDefined();
  }
  for (const ref of [
    { owner: 'x', module: 'filter', param: 'cutoff' }, { owner: 'a', module: 'filter', param: 'mode' },
    { owner: 'a', module: 'filter', param: 'on' }, { owner: 'a', module: 'send', param: '2' },
    { owner: 'a', module: 'gone', param: 'mix' }, { owner: { rack: 'master' }, module: 'out', param: 'pan' },
    // A reverb's size and tone rebuild it when they change, so they cannot move while it plays.
    { owner: { rack: 0 }, module: p.mixer.buses[0].chain[0].id, param: 'size' },
    { owner: { rack: 0 }, module: p.mixer.buses[0].chain[0].id, param: 'tone' },
  ] as ParamRef[]) {
    expect(refSpec(p, ref), JSON.stringify(ref)).toBeUndefined();
  }
  expect(storedValue(p, cutoff)).toBe(2000);
  expect(storedValue(p, { owner: { rack: 'master' }, module: 'out', param: 'level' })).toBe(0);
});

test('targets are listed by sound, bus and master, named like the modulator targets', () => {
  const p = base();
  const groups = automationGroups(p);
  expect(groups.map((g) => g.name)).toEqual(['Warm Pad', 'Hiss', 'Room', 'Echo', 'Master']);
  const labels = groups[0].targets.map((t) => t.label);
  expect(labels.slice(0, 2)).toEqual(['Source · Pitch', 'Source · Fine']);
  expect(labels).toContain('Filter · Cutoff');
  expect(labels).toContain('Delay 2 · Mix');
  expect(labels.slice(-4)).toEqual(['Output · Level', 'Output · Pan', 'Send · Room', 'Send · Echo']);
  expect(groups[4].targets.map((t) => t.label))
    .toEqual(['Level', 'EQ · Low', 'EQ · Mid', 'EQ · Mid Freq', 'EQ · High', 'EQ · Low Cut']);
  expect(groups[2].targets.map((t) => t.label)).toEqual(['Level', 'Reverb · Mix']);
  expect(refLabel(p, cutoff)).toBe('Warm Pad · Filter · Cutoff');
  expect(refLabel(p, { owner: { rack: 'master' }, module: 'out', param: 'level' })).toBe('Master · Level');
  expect(refLabel(p, { owner: 'a', module: 'gone', param: 'mix' })).toBeNull();
  // Every listed target is one refSpec knows.
  for (const g of groups) for (const t of g.targets) expect(refSpec(p, t.target)).toBeDefined();
  expect(soundTargets(p.channels[1].sound).map((t) => t.label)).not.toContain('Source · Color');
});

test('points are kept whole, in range and in order', () => {
  expect(cleanPoints([[300.4, 2], [-5, 0.5], [100, -1], [NaN, 0.5], [MAX_SONG_TICKS + 99, 0.3]]))
    .toEqual([[0, 0.5], [100, 0], [300, 1], [MAX_SONG_TICKS, 0.3]]);
});

test('notes keep at most two valid locks, one per parameter, and only those their sound has', () => {
  const lock = (module: string, param: string, value: unknown) => ({ target: { module, param }, value });
  const many = [lock('filter', 'cutoff', 2), lock('filter', 'cutoff', 0.1), lock('out', 'pan', 0.3), lock('amp', 'attack', 0.5)];
  expect(noteExtras({ locks: many })).toEqual({ locks: [lock('filter', 'cutoff', 1), lock('out', 'pan', 0.3)] });
  expect(noteExtras({ locks: [{ target: 'x', value: 1 }, lock('a', 'b', 'c')] })).toEqual({});
  expect(noteExtras({ locks: [] })).toEqual({});
  const p = base();
  expect(validLocks(p.channels[0].sound, [lock('dl', 'mix', 0.5), lock('gone', 'mix', 0.5), lock('filter', 'mode', 0)] as Lock[]))
    .toEqual([lock('dl', 'mix', 0.5)]);
});

test('the sequencer passes a note\'s locks on with each of its events', () => {
  const locks: Lock[] = [{ target: { module: 'filter', param: 'cutoff' }, value: 0.2 }];
  const p = base([{ id: 'n', start: 0, len: 48, note: 60, vel: 1, ratchet: 2, locks }, { id: 'm', start: 96, len: 24, note: 60, vel: 1 }]);
  const events = eventsBetween(p, { kind: 'song' }, 0, BAR);
  expect(events.map((e) => e.locks)).toEqual([locks, locks, undefined]);
});

test('the notes an arpeggiator makes from a locked note, and the copies of a looped row, keep its locks', () => {
  const locks: Lock[] = [{ target: { module: 'filter', param: 'cutoff' }, value: 0.2 }];
  // A row of its own four steps long plays its one locked note four times in the bar.
  const looped = base([{ id: 'n', start: 0, len: 24, note: 60, vel: 1, locks }]);
  looped.patterns[0].loops = { a: 4 };
  const copies = eventsBetween(looped, { kind: 'song' }, 0, BAR);
  expect(copies.map((e) => [e.time, e.locks])).toEqual([0, 0.25, 0.5, 0.75].map((t) => [t, locks]));
  // An arpeggio of a chord held for a beat: the locked note's steps carry its locks, the other's none.
  const arp = base([
    { id: 'n', start: 0, len: 96, note: 60, vel: 1, locks },
    { id: 'm', start: 0, len: 96, note: 64, vel: 1 },
  ]);
  arp.channels[0].sound.play = { ...arp.channels[0].sound.play, arp: 'up', rate: '1/16' };
  const steps = eventsBetween(arp, { kind: 'song' }, 0, 96);
  expect(steps.map((e) => [e.note, e.locks])).toEqual([[60, locks], [64, undefined], [60, locks], [64, undefined]]);
});

test('the arpeggiator\'s octaves and gate are neither rows nor locks, since the sequencer reads them', () => {
  const p = base();
  const play = soundTargets(p.channels[0].sound).filter((t) => t.target.module === 'play').map((t) => t.label);
  expect(play).toEqual(['Play · Glide']);
  expect(refSpec(p, { owner: 'a', module: 'play', param: 'gate' })).toBeUndefined();
});

test('the parameters moved while the song plays are those of rows with points and the shared ones notes lock', () => {
  const p = base([{ id: 'n', start: 0, len: 24, note: 60, vel: 1, locks: [
    { target: { module: 'dl', param: 'mix' }, value: 0.2 }, { target: { module: 'filter', param: 'cutoff' }, value: 0.2 },
  ] }]);
  p.automation = [{ id: 'r', target: level, points: [[0, 0.5]] }, { id: 'e', target: cutoff, points: [] }];
  expect(automatedRefs(p)).toEqual([level, { owner: 'a', module: 'dl', param: 'mix' }]);
});

/** Runs an automator over the song in windows of `size` ticks and returns what it handed on. */
function points(p: Project, size: number, until = 4 * BAR, from = 0) {
  const calls: [string, number, number][] = [];
  const automator = new Automator({ automate: (ref, value, time) => calls.push([refKey(ref), value, time]), endAutomation() {} });
  const at = (tick: number) => tickTime(tick, p.bpm, p.swing);
  automator.start(p, from, at(from));
  for (let t = from; t < until; t += size) {
    const events = eventsBetween(p, { kind: 'song' }, t, t + size);
    for (const e of events) automator.hold(p, e, e.time);
    automator.advance(p, t, Math.min(t + size, until), at);
  }
  return calls;
}

test('the automator starts every row at its value there and hands on points only where the value moves', () => {
  const p = base();
  const spec = refSpec(p, level)!;
  // Flat for a bar, down over a bar, flat after.
  p.automation = [{ id: 'r', target: level, points: [[0, toNorm(spec, 0)], [BAR, toNorm(spec, 0)], [2 * BAR, toNorm(spec, -24)]] }];
  const calls = points(p, TICKS_PER_STEP);
  expect(calls[0]).toEqual([refKey(level), 0, 0]);
  // Then the sample before the change, and every grid sample of the ramp, and nothing after it.
  const ramp = calls.slice(1);
  expect(ramp[0][2]).toBeCloseTo(tickTime(BAR, 240, 0), 12);
  expect(ramp.length).toBe(BAR / AUTO_GRID + 1);
  expect(ramp.at(-1)).toEqual([refKey(level), -24, tickTime(2 * BAR, 240, 0)]);
  // Starting in the middle of the ramp starts at the value there.
  const middle = points(p, TICKS_PER_STEP, 4 * BAR, 1.5 * BAR)[0];
  expect(middle[1]).toBeCloseTo(-12, 1);
});

test('the points are the same whatever windows the automator is driven in, as live and in an export', () => {
  const locks: Lock[] = [{ target: { module: 'dl', param: 'mix' }, value: 0.9 }];
  const p = base([{ id: 'n', start: 100, len: 50, note: 60, vel: 1, locks }, { id: 'm', start: 0, len: 24, note: 60, vel: 1 }]);
  p.swing = 0.4;
  p.automation = [
    { id: 'r', target: cutoff, points: [[10, 0.1], [700, 0.9], [900, 0.3]] },
    { id: 'm', target: { owner: { rack: 'master' }, module: 'out', param: 'level' }, points: [[0, 1], [1536, 0]] },
  ];
  // Points of different parameters may come in another order; each parameter's own come the same.
  const byParameter = (calls: [string, number, number][]) => calls.toSorted((a, b) => a[0].localeCompare(b[0]));
  const steps = byParameter(points(p, TICKS_PER_STEP));
  expect(byParameter(points(p, 7))).toEqual(steps);
  expect(byParameter(points(p, 4 * BAR))).toEqual(steps);
});

test('a lock of a shared parameter holds its value through its note and lets go at its end; the song loops', () => {
  const locks: Lock[] = [{ target: { module: 'dl', param: 'mix' }, value: 1 }];
  const p = base([{ id: 'n', start: 96, len: 96, note: 60, vel: 1, locks }]);
  p.song[0].bars = 1;
  const ref = refKey({ owner: 'a', module: 'dl', param: 'mix' });
  const mix = points(p, TICKS_PER_STEP, 2 * BAR).filter(([key]) => key === ref);
  const at = (tick: number) => tickTime(tick, 240, 0);
  const stored = p.channels[0].sound.chain[0].params.mix;
  // Each pass: held at the stored mix until a grid step before the note, up to the lock at its start, and back.
  expect(mix.slice(0, 4)).toEqual([
    [ref, stored, at(96 - AUTO_GRID)], [ref, 1, at(96)], [ref, 1, at(192 - AUTO_GRID)], [ref, stored, at(192)],
  ]);
  expect(mix.slice(4).map(([, v, t]) => [v, t]))
    .toEqual([[stored, at(BAR + 93)], [1, at(BAR + 96)], [1, at(BAR + 189)], [stored, at(BAR + 192)]]);
  // A note's lock of a parameter inside the voice is the voice's own: the automator leaves it alone.
  const own = [{ target: { module: 'filter', param: 'cutoff' }, value: 1 }];
  const voice = base([{ id: 'n', start: 96, len: 96, note: 60, vel: 1, locks: own }]);
  expect(points(voice, TICKS_PER_STEP)).toEqual([]);
});

test('a row loops with the song, and a project without rows or locks gets no points at all', () => {
  const p = base();
  p.song[0].bars = 1;
  p.automation = [{ id: 'r', target: cutoff, points: [[0, 0], [BAR, 1]] }];
  const calls = points(p, TICKS_PER_STEP, 2 * BAR);
  const second = calls.findIndex(([, , t]) => t >= tickTime(BAR, 240, 0));
  expect(calls[second][1]).toBe(20);
  expect(calls[second - 1][1]).toBeCloseTo(fromNorm(refSpec(p, cutoff)!, 1 - AUTO_GRID / BAR), 6);
  expect(points(base(), TICKS_PER_STEP)).toEqual([]);
});

const write = (p: Project) => JSON.parse(serializeProject(p)).project;

test('a project always writes its automation, and notes write locks only when they have them', () => {
  const locks: Lock[] = [{ target: { module: 'filter', param: 'cutoff' }, value: 0.25 }];
  const p = base([{ id: 'n', start: 0, len: 24, note: 60, vel: 1, locks }, { id: 'm', start: 24, len: 24, note: 60, vel: 1 }]);
  expect(write(p).automation).toEqual([]);
  p.automation = [
    { id: 'r1', target: cutoff, points: [[0, 0.1], [384, 0.9]] },
    { id: 'r2', target: { owner: { rack: 'master' }, module: 'out', param: 'level' }, points: [] },
  ];
  const raw = write(p);
  expect(raw.automation).toEqual(p.automation);
  expect(raw.patterns[0].notes.a[1]).not.toHaveProperty('locks');
  const back = parseProject(serializeProject(p));
  expect(back.automation).toEqual(p.automation);
  expect(back.patterns[0].notes.a).toEqual(p.patterns[0].notes.a);
  // A block carries its notes' locks along.
  const block = parseBlock(serializeBlock(extractBlock(p, p.patterns[0].id)!));
  expect(block.tracks[0].notes[0].locks).toEqual(locks);
});

test('old files read without automation and locks, and rows the project cannot play are dropped', () => {
  const p = base([{ id: 'n', start: 0, len: 24, note: 60, vel: 1 }]);
  const old = write(p);
  delete old.automation;
  const file = (project: unknown) => JSON.stringify({ format: 'hadjitron3000/project', version: 3, project, samples: {} });
  expect(parseProject(file(old)).automation).toEqual([]);
  old.automation = [
    { id: 'a', target: cutoff, points: [[384, 0.5], [0, 2], 'x', [5]] },
    { id: 'a', target: { owner: { rack: 0 }, module: 'out', param: 'level' }, points: [] },
    { id: 'c', target: cutoff, points: [[0, 0]] },
    { id: 'd', target: { owner: 'nobody', module: 'filter', param: 'cutoff' }, points: [] },
    { id: 'e', target: { owner: { rack: 2 }, module: 'out', param: 'level' }, points: [] },
    { id: 'f', target: { owner: 'a', module: 'filter', param: 'mode' }, points: [] },
  ];
  old.patterns[0].notes.a[0].locks = [
    { target: { module: 'gone', param: 'mix' }, value: 0.5 }, { target: { module: 'dl', param: 'mix' }, value: 0.5 },
  ];
  const read = parseProject(file(old));
  expect(read.automation.map((r) => [r.target, r.points])).toEqual([
    [cutoff, [[0, 1], [384, 0.5]]], [{ owner: { rack: 0 }, module: 'out', param: 'level' }, []],
  ]);
  expect(read.automation[1].id).not.toBe('a');
  expect(read.patterns[0].notes.a[0].locks).toEqual([{ target: { module: 'dl', param: 'mix' }, value: 0.5 }]);
});

const state = app.useApp.getState;

beforeEach(() => app.openProject(base([{ id: 'n', start: 0, len: 24, note: 60, vel: 1 }]), null));

test('the store adds a row once per parameter, sets its points and removes it, each one undo step', () => {
  expect(app.addAutomation({ owner: 'a', module: 'filter', param: 'mode' })).toBeNull();
  const id = app.addAutomation(cutoff)!;
  expect(app.addAutomation({ ...cutoff })).toBe(id);
  expect(state().project.automation).toEqual([{ id, target: cutoff, points: [] }]);
  app.beginGesture();
  app.setAutomationPoints(id, [[384, 0.5]]);
  app.setAutomationPoints(id, [[400.2, 0.7], [0, 1.5]]);
  app.commitGesture();
  expect(state().project.automation[0].points).toEqual([[0, 1], [400, 0.7]]);
  app.undo();
  expect(state().project.automation[0].points).toEqual([]);
  app.removeAutomation(id);
  expect(state().project.automation).toEqual([]);
  app.undo();
  expect(state().project.automation).toHaveLength(1);
});

test('rows go with the parameter they move: a removed effect, a removed sound, another source', () => {
  const add = (ref: ParamRef) => app.addAutomation(ref);
  add({ owner: 'a', module: 'dl', param: 'mix' });
  add({ owner: 'a', module: 'source', param: 'pw' });
  add({ owner: 'b', module: 'out', param: 'pan' });
  add({ owner: { rack: 'master' }, module: 'meq', param: 'low' });
  const targets = () => state().project.automation.map((r) => r.target);
  app.removeModule('a', 'dl');
  expect(targets()).toHaveLength(3);
  app.setSourceType('a', 'fm');
  expect(targets()).toHaveLength(2);
  app.removeModule({ rack: 'master' }, 'meq');
  app.removeChannel('b');
  expect(targets()).toEqual([]);
  // The sound still plays its stored values, which automation never changes.
  expect(state().project.channels[0].sound.out.pan).toBe(0);
});

test('locks are set per slot on the selected notes and dropped with an edit once their effect is gone', () => {
  const patternId = state().project.patterns[0].id;
  const second = app.addNote(patternId, 'a', newNote(48))!;
  const lock = (module: string, param: string, value: number): Lock => ({ target: { module, param }, value });
  app.setNotesLock(patternId, 'a', ['n', second], 0, lock('filter', 'cutoff', 0.3));
  app.setNotesLock(patternId, 'a', ['n'], 1, lock('dl', 'mix', 0.8));
  app.setNotesLock(patternId, 'a', ['n'], 0, lock('filter', 'cutoff', 0.4));
  const notes = () => state().project.patterns[0].notes.a;
  expect(notes()[0].locks).toEqual([lock('filter', 'cutoff', 0.4), lock('dl', 'mix', 0.8)]);
  expect(notes()[1].locks).toEqual([lock('filter', 'cutoff', 0.3)]);
  // Setting the second slot to the parameter of the first moves it there.
  app.setNotesLock(patternId, 'a', [second], 1, lock('filter', 'cutoff', 0.6));
  expect(notes()[1].locks).toEqual([lock('filter', 'cutoff', 0.6)]);
  app.setNotesLock(patternId, 'a', ['n'], 0, null);
  expect(notes()[0].locks).toEqual([lock('dl', 'mix', 0.8)]);
  app.setNotesLock(patternId, 'a', [second], 0, lock('filter', 'mode', 0.4));
  expect(notes()[1]).not.toHaveProperty('locks');
  app.removeModule('a', 'dl');
  expect(notes()[0].locks).toEqual([lock('dl', 'mix', 0.8)]);
  app.setNotesVelocity(patternId, 'a', ['n'], 0.5);
  expect(notes()[0]).not.toHaveProperty('locks');
  // Copies of a block keep their notes' locks.
  app.setNotesLock(patternId, 'a', [second], 0, lock('out', 'pan', 0.1));
  const copy = app.duplicatePattern(patternId)!;
  expect(state().project.patterns.find((p) => p.id === copy)!.notes.a[1].locks).toEqual([lock('out', 'pan', 0.1)]);
  expect(newPattern('Z').notes).toEqual({});
});
