import { beforeEach, expect, test } from 'vitest';
import { LESSONS } from '../../src/app/tour/lessons';
import type { LessonId, Look } from '../../src/app/tour/lessons';
import type { DialogKind } from '../../src/app/dialogStore';
import { newNote, newSound, TICKS_PER_STEP } from '../../src/core/defaults';
import type { Project } from '../../src/core/types';
import { starterProject } from '../../src/presets/projects';
import * as app from '../../src/state/store';

const state = app.useApp.getState;
let start: Project;
let dialog: DialogKind | null;
const look = (): Look => ({ state: state(), start, dialog });
const channel = () => state().channelId!;
const row = (name: string) => state().project.channels.find((c) => c.sound.name === name)!.id;
const block = () => state().patternId;
/** Put a one-step note on a step of the row of the sound with this name. */
const put = (pattern: string, name: string, step: number, note = 60) =>
  app.addNote(pattern, row(name), newNote(step * TICKS_PER_STEP, note));
/** Whether a step that can tell is done now. */
const done = (lesson: LessonId, index: number) => (LESSONS[lesson].steps[index].done as (look: Look) => boolean)(look());

beforeEach(() => {
  app.openProject(starterProject(), null);
  app.setPlaying(false);
  start = state().project;
  dialog = null;
});

/** Each step that can tell is not done before its action and done after it. */
function walk(lesson: LessonId, actions: (() => void)[]): void {
  const { steps } = LESSONS[lesson];
  expect(actions).toHaveLength(steps.length);
  steps.forEach((step, i) => {
    if (typeof step.done !== 'function') {
      actions[i]();
      return;
    }
    expect(step.done(look()), `${step.title} before`).toBe(false);
    actions[i]();
    expect(step.done(look()), `${step.title} after`).toBe(true);
  });
}

const nothing = () => {};

test('the steps of Make a Sound are done by building a plucky bass', () => {
  let env = '';
  walk('sound', [
    nothing,
    () => app.addChannel(newSound('osc', 'Oscillator')),
    nothing,
    () => app.setParam(channel(), 'source', 'wave', 'square'),
    () => app.setParam(channel(), 'amp', 'sustain', 0),
    () => app.setParam(channel(), 'filter', 'on', true),
    () => app.setParam(channel(), 'filter', 'cutoff', 300),
    () => (env = app.addMod(channel(), 'env')!),
    () => app.setModTarget(channel(), env, { module: 'filter', param: 'cutoff' }),
    () => app.addEffect(channel(), 'reverb'),
    () => app.renameSound(channel(), 'Pluck Bass'),
    nothing,
    nothing,
  ]);
});

test('Make a Sound looks at the selected sound only', () => {
  app.addChannel(newSound('osc', 'Oscillator'));
  app.addEffect(channel(), 'delay');
  expect(done('sound', 9)).toBe(true);
  app.selectChannel(start.channels[0].id);
  expect(done('sound', 1)).toBe(false);
  expect(done('sound', 9)).toBe(false);
});

test('the steps of Make a Song are done by writing and arranging two blocks', () => {
  let a = '';
  let b = '';
  let bass = '';
  walk('song', [
    nothing,
    () => [0, 4, 8, 12].forEach((i) => put(block(), 'Kick', i)),
    () => {
      put(block(), 'Snare', 4);
      put(block(), 'Hat', 2);
    },
    () => (bass = put(block(), 'Sub Bass', 0, 63)!),
    () => app.resizeNotes(block(), row('Sub Bass'), [bass], 2 * TICKS_PER_STEP),
    () => {
      a = block();
      b = app.duplicatePattern(a)!;
    },
    () => put(b, 'Hat', 10),
    () => app.setView('song'),
    () => {
      app.addPlacement(a, 0, 0);
      app.addPlacement(b, 0, 1);
    },
    () => app.resizePlacement(state().placementId!, 3),
    () => app.addPlacement(a, 1, 2),
    () => app.setPlaying(true),
    () => (dialog = { kind: 'export' }),
    nothing,
  ]);
});

test('a copied block is no variation until it differs from every other block', () => {
  expect(done('song', 6)).toBe(false);
  const a = block();
  const kick = put(a, 'Kick', 0)!;
  const b = app.duplicatePattern(a)!;
  expect(done('song', 6)).toBe(false);
  app.setNotesVelocity(b, row('Kick'), [kick], 0.5);
  expect(done('song', 6)).toBe(true);
  app.selectPattern(a);
  expect(done('song', 6)).toBe(true);
});

test('blocks layer only when they overlap in time in different lanes', () => {
  const a = block();
  app.addPlacement(a, 0, 0);
  app.addPlacement(a, 1, 1);
  expect(done('song', 10)).toBe(false);
  app.addPlacement(a, 2, 0);
  expect(done('song', 10)).toBe(true);
});

test('every step that points at a control names it, and the lessons keep to ten to fourteen steps', () => {
  for (const { steps } of Object.values(LESSONS)) {
    expect(steps.length).toBeGreaterThanOrEqual(10);
    expect(steps.length).toBeLessThanOrEqual(14);
    for (const step of steps) {
      if (step.done === 'press') expect(step.target).toBeTruthy();
      expect(step.text).not.toMatch(/!/);
    }
  }
});

test('the cutoff step waits for the filter to be on, and a whole-sound filter does not count', () => {
  app.addChannel(newSound('osc', 'Oscillator'));
  app.setParam(channel(), 'filter', 'cutoff', 300);
  expect(done('sound', 6)).toBe(false);
  app.setParam(channel(), 'filter', 'on', true);
  expect(done('sound', 6)).toBe(true);
  const env = app.addMod(channel(), 'env')!;
  const whole = app.addEffect(channel(), 'filter')!;
  app.setModTarget(channel(), env, { module: whole, param: 'cutoff' });
  expect(done('sound', 8)).toBe(false);
});
