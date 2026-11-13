import { afterEach, expect, test } from 'vitest';
import { Metronome, renderProject } from '../../src/audio';
import { clock, initAudio } from '../../src/app/audio';
import { setPrefs } from '../../src/app/prefs';
import { barOf } from '../../src/core/meter';
import type { Meter } from '../../src/core/types';
import { demoProject } from '../../src/presets/projects';
import { openProject, setPlaying } from '../../src/state/store';
import { SR, amplitudeAt, peak } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Render the clicks a metronome schedules for `seconds`, with tick 0 at `origin`, at 120 BPM. */
async function clicks(meter: Meter, origin: number, on: boolean, seconds = 3) {
  const ctx = new OfflineAudioContext(1, seconds * SR, SR);
  const metronome = new Metronome(ctx, () => ({ clock: { origin, bpm: 120, swing: 0.4 }, bar: barOf(meter), on }));
  metronome.scheduleUntil(seconds);
  // Asking again schedules nothing twice.
  metronome.scheduleUntil(seconds);
  const out = (await ctx.startRendering()).getChannelData(0);
  const found: { time: number; level: number; high: boolean }[] = [];
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i]) < 0.01) continue;
    const click = out.subarray(i, i + Math.round(0.02 * SR));
    found.push({
      time: i / SR,
      level: peak(click),
      high: amplitudeAt(click, 1760) > amplitudeAt(click, 1320),
    });
    i += Math.round(0.1 * SR);
  }
  return found;
}

afterEach(() => {
  setPlaying(false);
  setPrefs({ metronome: false });
});

test('the metronome clicks on every beat of the meter, higher and louder on the first of the bar', async () => {
  // 3/4 at 120 BPM: a beat every half second; the beat before tick 0 is the last of the bar before it.
  const found = await clicks([3, 4], 0.5, true);
  expect(found.map((c) => c.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5].map((t) => expect.closeTo(t, 3)));
  expect(found.map((c) => c.high)).toEqual([false, true, false, false, true, false]);
  expect(found[1].level).toBeGreaterThan(found[2].level * 1.4);
  // 6/8 has two beats of a dotted quarter (0.75 s) to the bar; swing never moves a beat.
  const six = await clicks([6, 8], 0, true);
  expect(six.map((c) => [c.time, c.high])).toEqual([
    [0, true], [0.75, false], [1.5, true], [2.25, false],
  ].map(([t, high]) => [expect.closeTo(t as number, 3), high]));
  // 7/8 counts four, four and six steps.
  const seven = await clicks([7, 8], 0, true);
  expect(seven.map((c) => c.time)).toEqual([0, 0.5, 1, 1.75, 2.25, 2.75].map((t) => expect.closeTo(t, 3)));
});

test('switched off, the metronome clicks only the count-in before tick 0', async () => {
  const found = await clicks([4, 4], 2, false);
  expect(found.map((c) => c.time)).toEqual([0, 0.5, 1, 1.5].map((t) => expect.closeTo(t, 3)));
  expect(found.map((c) => c.high)).toEqual([true, false, false, false]);
});

test('the clicks of the live metronome are never part of a render', async () => {
  const project = demoProject();
  const scope = { kind: 'pattern' as const, patternId: project.patterns[0].id };
  const quiet = await renderProject(project, scope, { tail: 0 });
  openProject(project, null);
  initAudio();
  setPrefs({ metronome: true });
  setPlaying(true);
  await sleep(200);
  expect(clock()).not.toBeNull();
  const clicking = await renderProject(project, scope, { tail: 0 });
  expect(clicking.channels[0].length).toBe(quiet.channels[0].length);
  expect(clicking.channels.every((d, i) => d.every((v, j) => v === quiet.channels[i][j]))).toBe(true);
});
