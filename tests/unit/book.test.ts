import { beforeEach, describe, expect, test } from 'vitest';
import { MAKE_A_SONG, MAKE_A_SOUND } from '../../src/app/book/chapters/01-first-steps';
import { CHAPTERS, PAGES, findPage, pageKey } from '../../src/app/book/pages';
import type { Example, Piece, WorkedPiece } from '../../src/app/book/pages';
import { near } from '../../src/app/book/steps';
import { useDialogs } from '../../src/app/dialogStore';
import type { Look, TourStep } from '../../src/app/tour/tourStore';
import { PARAM_HINTS } from '../../src/ui/factory/hints';
import { extractBlock } from '../../src/core/block';
import { TICKS_PER_STEP, newNote, newSound } from '../../src/core/defaults';
import { parseProject, serializeProject } from '../../src/core/fileformat';
import { MODULES, paramSpec } from '../../src/core/modules';
import type { Project } from '../../src/core/types';
import { starterProject } from '../../src/presets/projects';
import * as app from '../../src/state/store';

const state = app.useApp.getState;
let start: Project;
const look = (): Look => ({ state: state(), start, dialog: useDialogs.getState().dialog });

const pieces = (kind: string): Piece[] =>
  CHAPTERS.flatMap((c) => c.pages.flatMap((p) => p.pieces.filter((piece) => typeof piece !== 'string' && piece.kind === kind)));
const worked = () => pieces('worked') as WorkedPiece[];
const examples = (): Example[] => CHAPTERS.flatMap((c) => c.pages.flatMap((p) => p.pieces.flatMap((piece) => {
  if (typeof piece === 'string') return [];
  if (piece.kind === 'example' || piece.kind === 'worked') return [piece.example];
  if (piece.kind === 'compare') return [piece.before, piece.after];
  return [];
})));

/** Whether a project reads back from its file with all its sounds, notes and song, and reads the same after that. */
function valid(project: Project): boolean {
  const read = parseProject(serializeProject(project));
  const text = serializeProject(read);
  const count = (p: Project) => p.patterns.map((b) => Object.values(b.notes).flat().length).join();
  return serializeProject(parseProject(text)) === text && count(read) === count(project)
    && read.channels.map((c) => c.sound.name).join() === project.channels.map((c) => c.sound.name).join()
    && read.song.length === project.song.length;
}

/** Put an example into the app the way Load does, on a new project for a sound or a block. */
function load(example: Example): void {
  const project = example.make();
  if (example.kind === 'project') return app.openProject(project, null);
  app.openProject(starterProject(), null);
  if (example.kind === 'sound') app.addChannel(project.channels[0].sound, project.samples);
  else app.insertBlock(extractBlock(project, project.patterns[0].id)!);
}

/** Each step that can tell is not done before its action and done after it; returns the finished project. */
function walk(piece: WorkedPiece, name: string): Project {
  load(piece.example);
  start = state().project;
  useDialogs.setState({ dialog: null });
  piece.steps.forEach((step: TourStep, i) => {
    const where = `${name}, step ${i + 1}: ${step.text.slice(0, 40)}`;
    if (typeof step.done !== 'function') {
      step.act?.(state());
      return;
    }
    expect(step.done(look()), `${where} before`).toBe(false);
    expect(step.act, where).toBeDefined();
    step.act!(state());
    expect(step.done(look()), `${where} after`).toBe(true);
  });
  return state().project;
}

beforeEach(() => {
  app.openProject(starterProject(), null);
  app.setPlaying(false);
  start = state().project;
  useDialogs.setState({ dialog: null });
});

describe('the chapters', () => {
  test('have ids of their own, titles and pages, in the order of their files', () => {
    expect(CHAPTERS.length).toBeGreaterThan(1);
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(CHAPTERS.length);
    expect(CHAPTERS[0].id).toBe('first-steps');
    for (const chapter of CHAPTERS) {
      expect(chapter.title, chapter.id).toBeTruthy();
      expect(chapter.pages.length, chapter.id).toBeGreaterThan(0);
      for (const page of chapter.pages) {
        expect(page.title, chapter.id).toBeTruthy();
        expect(page.pieces.length, page.title).toBeGreaterThan(0);
      }
    }
  });

  test('a page key finds its page, and anything else the first page', () => {
    expect(PAGES).toHaveLength(CHAPTERS.reduce((n, c) => n + c.pages.length, 0));
    const last = CHAPTERS.at(-1)!;
    expect(findPage(pageKey(last, last.pages.length - 1))).toEqual({ chapter: CHAPTERS.length - 1, page: last.pages.length - 1 });
    for (const key of ['', 'nowhere/0', `${CHAPTERS[0].id}/99`, `${CHAPTERS[0].id}/x`]) {
      expect(findPage(key)).toEqual({ chapter: 0, page: 0 });
    }
  });

  test('speak in plain sentences, without exclamation marks', () => {
    const texts = CHAPTERS.flatMap((c) => c.pages.flatMap((p) => [p.title, ...p.pieces.flatMap((piece) => {
      if (typeof piece === 'string') return [piece];
      if (piece.kind === 'worked') return [piece.result, ...piece.steps.flatMap((s) => [s.title ?? '', s.text])];
      if (piece.kind === 'knobs' || piece.kind === 'envelope') return [piece.kind === 'knobs' ? piece.when : piece.caption];
      if (piece.kind === 'terms') return piece.terms.flat();
      return [];
    })]));
    for (const text of texts) expect(text, text).not.toMatch(/!/);
  });

  test('name only units that exist, each with a hint for every knob it shows', () => {
    for (const piece of pieces('knobs')) {
      if (typeof piece === 'string' || piece.kind !== 'knobs') continue;
      const def = MODULES[piece.unit];
      expect(def, piece.unit).toBeDefined();
      for (const spec of def.params) {
        if (def.type === 'voicefilter' && spec.id === 'on') continue;
        expect(PARAM_HINTS[def.type][spec.id], `${def.type}.${spec.id}`).toBeTruthy();
      }
    }
  });

  test('make every example as a valid project that survives the file format', () => {
    const all = examples();
    expect(all.length).toBeGreaterThan(5);
    for (const example of all) {
      const project = example.make();
      expect(valid(project), example.title).toBe(true);
      if (example.kind !== 'project') {
        expect(Object.values(project.patterns[0].notes).flat().length, example.title).toBeGreaterThan(0);
      }
      if (example.kind === 'sound') expect(project.channels, example.title).toHaveLength(1);
      for (const row of project.patterns.flatMap((p) => Object.values(p.notes))) {
        expect(new Set(row.map((n) => n.id)).size, example.title).toBe(row.length);
      }
    }
  });

  test('point every step that waits for a press at a control, and give every step that can tell an action', () => {
    for (const piece of worked()) {
      for (const step of piece.steps) {
        if (step.done === 'press') expect(step.target, step.text).toBeTruthy();
        if (typeof step.done === 'function') expect(step.act, step.text).toBeDefined();
      }
      for (const checkpoint of piece.checkpoints ?? []) {
        expect(checkpoint.after).toBeGreaterThan(0);
        expect(checkpoint.after).toBeLessThan(piece.steps.length);
      }
    }
  });
});

test('every recipe goes from an empty project to a song in 15 to 30 steps, with its checkpoints in order', () => {
  const recipes = worked().filter((p) => p.checkpoints);
  expect(recipes).toHaveLength(6);
  for (const piece of recipes) {
    const what = piece.example.title;
    expect(piece.example.make().channels, what).toHaveLength(0);
    expect(piece.steps.length, what).toBeGreaterThanOrEqual(15);
    expect(piece.steps.length, what).toBeLessThanOrEqual(30);
    const after = piece.checkpoints!.map((c) => c.after);
    expect(after, what).toEqual([...after].sort((a, b) => a - b));
    expect(new Set(after).size, what).toBe(after.length);
  }
});

test('every worked example can be done step by step from its start, and ends in a valid project', () => {
  for (const piece of worked()) {
    expect(valid(walk(piece, piece.example.title)), piece.example.title).toBe(true);
  }
});

test('a control turned by hand to about the right place counts, one turned elsewhere does not', () => {
  const cutoff = MODULES.voicefilter;
  expect(near(cutoff, 'cutoff', 330, 300)).toBe(true);
  expect(near(cutoff, 'cutoff', 500, 300)).toBe(false);
  expect(near(MODULES.amp, 'decay', 0.22, 0.2)).toBe(true);
  expect(near(MODULES.amp, 'decay', 0.6, 0.2)).toBe(false);
  expect(near(MODULES.amp, 'sustain', 0.62, 0.6)).toBe(true);
  expect(near(MODULES.amp, 'sustain', 0.7, 0.6)).toBe(false);
  expect(near(MODULES.osc, 'wave', 'square', 'square')).toBe(true);
  expect(near(MODULES.osc, 'wave', 'sawtooth', 'square')).toBe(false);
  expect(paramSpec(cutoff, 'cutoff')?.kind).toBe('float');
});

describe('the lessons of the first chapter', () => {
  const done = (piece: WorkedPiece, index: number) => (piece.steps[index].done as (look: Look) => boolean)(look());
  const channel = () => state().channelId!;
  const row = (name: string) => state().project.channels.find((c) => c.sound.name === name)!.id;
  const block = () => state().patternId;
  const put = (pattern: string, name: string, step: number, note = 60) =>
    app.addNote(pattern, row(name), newNote(step * TICKS_PER_STEP, note));

  test('Make a Sound looks at the selected sound only', () => {
    app.addChannel(newSound('osc', 'Oscillator'));
    app.addEffect(channel(), 'delay');
    expect(done(MAKE_A_SOUND, 9)).toBe(true);
    app.selectChannel(start.channels[0].id);
    expect(done(MAKE_A_SOUND, 1)).toBe(false);
    expect(done(MAKE_A_SOUND, 9)).toBe(false);
  });

  test('a copied block is no variation until it differs from every other block', () => {
    expect(done(MAKE_A_SONG, 6)).toBe(false);
    const a = block();
    const kick = put(a, 'Kick', 0)!;
    const b = app.duplicatePattern(a)!;
    expect(done(MAKE_A_SONG, 6)).toBe(false);
    app.setNotesVelocity(b, row('Kick'), [kick], 0.5);
    expect(done(MAKE_A_SONG, 6)).toBe(true);
    app.selectPattern(a);
    expect(done(MAKE_A_SONG, 6)).toBe(true);
  });

  test('blocks layer only when they overlap in time in different lanes', () => {
    const a = block();
    app.addPlacement(a, 0, 0);
    app.addPlacement(a, 1, 1);
    expect(done(MAKE_A_SONG, 10)).toBe(false);
    app.addPlacement(a, 2, 0);
    expect(done(MAKE_A_SONG, 10)).toBe(true);
  });

  test('the cutoff step waits for the filter to be on, and a whole-sound filter does not count', () => {
    app.addChannel(newSound('osc', 'Oscillator'));
    app.setParam(channel(), 'filter', 'cutoff', 300);
    expect(done(MAKE_A_SOUND, 6)).toBe(false);
    app.setParam(channel(), 'filter', 'on', true);
    expect(done(MAKE_A_SOUND, 6)).toBe(true);
    const env = app.addMod(channel(), 'env')!;
    const whole = app.addEffect(channel(), 'filter')!;
    app.setModTarget(channel(), env, { module: whole, param: 'cutoff' });
    expect(done(MAKE_A_SOUND, 8)).toBe(false);
  });

  test('keep to ten to fourteen steps each', () => {
    for (const { steps } of [MAKE_A_SOUND, MAKE_A_SONG]) {
      expect(steps.length).toBeGreaterThanOrEqual(10);
      expect(steps.length).toBeLessThanOrEqual(14);
    }
  });
});
