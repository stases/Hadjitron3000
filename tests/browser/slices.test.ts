// Slices to Track: a sampler's slices laid out as notes of its row, in one undo step.

import { beforeEach, expect, test } from 'vitest';
import { slicesToTrack } from '../../src/app/commands';
import { useDialogs } from '../../src/app/dialogStore';
import { decodeSample } from '../../src/audio';
import { TICKS_PER_STEP, emptyProject } from '../../src/core/defaults';
import { preset, presetSamples } from '../../src/presets';
import { addChannel, openProject, setBpm, undo, useApp } from '../../src/state/store';

const T = TICKS_PER_STEP;
const state = useApp.getState;
const block = () => state().project.patterns[0];
let id: string;

beforeEach(async () => {
  openProject(emptyProject(), null);
  const samples = presetSamples('Chopped Break');
  const [[sampleId, data]] = Object.entries(samples);
  await decodeSample(sampleId, data.bytes);
  id = addChannel(preset('Chopped Break'), samples);
});

/** Run Slices to Track, answering its question with `answer` if it asks one. */
async function toTrack(answer?: string): Promise<boolean> {
  const done = slicesToTrack(id);
  let asked = false;
  if (answer) {
    await expect.poll(() => useDialogs.getState().messages.length).toBe(1);
    asked = true;
    useDialogs.getState().messages[0].resolve(answer);
  }
  await done;
  return asked;
}

test('the eight slices of the factory break fill a bar at its own tempo, one step apart, in one undo step', async () => {
  setBpm(120);
  const before = state().project;
  expect(await toTrack()).toBe(false);
  expect(block().bars).toBe(1);
  expect(block().notes[id].map((n) => [n.start, n.len, n.note])).toEqual(
    Array.from({ length: 8 }, (_, k) => [k * 2 * T, 2 * T, 60 + k]),
  );
  undo();
  expect(state().project).toBe(before);
});

test('when the slices need more bars, the block grows if the user agrees, and keeps what fits if not', async () => {
  // At 240 BPM the two seconds of the break take two bars.
  setBpm(240);
  expect(await toTrack('longer')).toBe(true);
  expect(block().bars).toBe(2);
  expect(block().notes[id]).toHaveLength(8);
  expect(block().notes[id].at(-1)!.start).toBe(28 * T);
  undo();
  await toTrack('keep');
  expect(block().bars).toBe(1);
  expect(block().notes[id].map((n) => n.note)).toEqual([60, 61, 62, 63]);
  const kept = state().project;
  await toTrack('cancel');
  expect(state().project).toBe(kept);
});
