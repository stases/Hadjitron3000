import { beforeEach, expect, test } from 'vitest';
import { LESSONS } from '../../src/app/tour/lessons';
import type { LessonId, Look } from '../../src/app/tour/lessons';
import type { DialogKind } from '../../src/app/dialogStore';
import { newSound } from '../../src/core/defaults';
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
const hit = { note: 60, vel: 0.8, len: 1 };
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
  let filter = '';
  let env = '';
  walk('sound', [
    nothing,
    () => app.addChannel(newSound('osc', 'Oscillator')),
    nothing,
    () => app.setParam(channel(), 'source', 'wave', 'square'),
    () => app.setParam(channel(), 'amp', 'sustain', 0),
    () => (filter = app.addEffect(channel(), 'filter')!),
    () => app.setParam(channel(), filter, 'cutoff', 300),
    () => (env = app.addMod(channel(), 'env')!),
    () => app.setModTarget(channel(), env, { module: filter, param: 'cutoff' }),
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
  walk('song', [
    nothing,
    () => [0, 4, 8, 12].forEach((i) => app.setStep(block(), row('Kick'), i, hit)),
    () => {
      app.setStep(block(), row('Snare'), 4, hit);
      app.setStep(block(), row('Hat'), 2, hit);
    },
    () => app.setStep(block(), row('Sub Bass'), 0, { ...hit, note: 63 }),
    () => app.patchStep(block(), row('Sub Bass'), 0, { len: 3 }),
    () => {
      a = block();
      b = app.duplicatePattern(a)!;
    },
    () => app.setStep(b, row('Hat'), 10, hit),
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
  app.setStep(a, row('Kick'), 0, hit);
  const b = app.duplicatePattern(a)!;
  expect(done('song', 6)).toBe(false);
  app.setStep(b, row('Kick'), 0, { ...hit, vel: 0.5 });
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
