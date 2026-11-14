// The song's mix in rendered audio: fades of placements, levels and mutes of lanes, sounds muted in a placement.

import { expect, test } from 'vitest';
import { renderProject } from '../../src/audio';
import type { Placement, Project } from '../../src/core/types';
import { adsr, amplitudeAt, db, expectEnergy, oldDemo, peak, project, rms, slice, sound } from './helpers';

const song = { kind: 'song' } as const;
const sine = () => sound('osc', { wave: 'sine' }, { amp: adsr(0.002, 0.1, 1, 0.05), out: { level: -6 } });

/** A one-bar block of a held A4 on channel a, at 240 BPM (a bar is a second), placed with these placements. */
function drone(placements: Partial<Placement>[]): Project {
  const p = project([{ id: 'a', sound: sine() }], {}, { bpm: 240 });
  p.patterns[0].notes = { a: [{ id: 'n', start: 0, len: 24, note: 69, vel: 1, hold: true }] };
  p.song = placements.map((s, i) => ({ id: `s${i}`, pattern: p.patterns[0].id, lane: 0, bar: 0, bars: 1, ...s }));
  return p;
}

const level = (d: Float32Array, t: number) => rms(slice(d, t - 0.02, t + 0.02));

test('a drone with a four-bar fade-in and fade-out swells, holds and dies away along the fade', async () => {
  const p = drone([{ bars: 12, fadeIn: 4, fadeOut: 4 }]);
  const left = (await renderProject(p, song, { tail: 1 })).channels[0];
  const full = level(left, 6);
  expect(full).toBeGreaterThan(0.1);
  const at = (t: number) => level(left, t) / full;
  for (const [t, gain] of [[1, Math.sin(Math.PI / 8)], [2, Math.SQRT1_2], [3, Math.cos(Math.PI / 8)]]) {
    expect(at(t), `fade-in at ${t} s`).toBeCloseTo(gain, 2);
    expect(at(12 - t), `fade-out at ${12 - t} s`).toBeCloseTo(gain, 2);
  }
  expect(at(5)).toBeCloseTo(1, 3);
  expect(at(7)).toBeCloseTo(1, 3);
  expect(rms(slice(left, 0, 0.05)) / full).toBeLessThan(0.02);
  expect(rms(slice(left, 11.99, 12))).toBeLessThan(0.005 * full);
  expect(peak(slice(left, 12.02, 12.5))).toBeLessThan(1e-3);
});

test('a note that slides on from a faded note follows its own gain, not the fade it ties into', async () => {
  const p = project([{ id: 'a', sound: sine() }], {}, { bpm: 240 });
  const x = p.patterns[0];
  x.bars = 2;
  x.notes = { a: [{ id: 'n', start: 0, len: 768, note: 69, vel: 1 }] };
  const slide = { id: 'n', start: 0, len: 768, note: 69, vel: 1, slide: true };
  p.patterns.push({ id: 'y', name: 'Y', color: 1, bars: 2, notes: { a: [slide] } });
  p.song = [
    { id: 's1', pattern: x.id, lane: 0, bar: 0, bars: 2, fadeOut: 1 },
    { id: 's2', pattern: 'y', lane: 0, bar: 2, bars: 2 },
  ];
  const left = (await renderProject(p, song, { tail: 0 })).channels[0];
  const full = level(left, 0.5);
  expect(level(left, 1.5) / full).toBeCloseTo(Math.SQRT1_2, 2);
  expect(level(left, 2.5) / full).toBeCloseTo(1, 2);
  expect(level(left, 3.5) / full).toBeCloseTo(1, 2);
});

test('a lane at -12 dB is 12 dB lower, and a muted lane is silent', async () => {
  const p = drone([{ bars: 2 }]);
  const render = async (lanes: Project['lanes']) =>
    (await renderProject({ ...p, lanes }, song, { tail: 0 })).channels[0];
  const open = await render(p.lanes);
  const lower = await render([{ level: -12, mute: false }, ...p.lanes.slice(1)]);
  expect(db(rms(slice(lower, 0.5, 1.5)) / rms(slice(open, 0.5, 1.5)))).toBeCloseTo(-12, 2);
  const muted = await render([{ level: 0, mute: true }, ...p.lanes.slice(1)]);
  expect(muted.length).toBe(open.length);
  expect(peak(muted)).toBe(0);
  // Another lane is not touched by it.
  expect(peak(await render([p.lanes[0], { level: -48, mute: true }, ...p.lanes.slice(2)]))).toBe(peak(open));
});

test('a sound muted in one placement plays in the other', async () => {
  const p = project([{ id: 'a', sound: sine() }, { id: 'b', sound: sine() }], {}, { bpm: 240 });
  p.patterns[0].notes = {
    a: [{ id: 'n', start: 0, len: 384, note: 69, vel: 1 }],
    b: [{ id: 'n', start: 0, len: 384, note: 76, vel: 1 }],
  };
  p.song = [
    { id: 's1', pattern: p.patterns[0].id, lane: 0, bar: 0, bars: 1 },
    { id: 's2', pattern: p.patterns[0].id, lane: 0, bar: 1, bars: 1, mutes: ['b'] },
  ];
  const left = (await renderProject(p, song, { tail: 0 })).channels[0];
  const first = slice(left, 0.3, 0.7);
  const second = slice(left, 1.3, 1.7);
  expect(amplitudeAt(first, 440)).toBeGreaterThan(0.1);
  expect(amplitudeAt(first, 659.26)).toBeGreaterThan(0.1);
  expect(amplitudeAt(second, 440)).toBeCloseTo(amplitudeAt(first, 440), 3);
  expect(amplitudeAt(second, 659.26)).toBeLessThan(1e-3);
});

test('an existing project without lanes, fades or mutes renders exactly as before them', async () => {
  // Length and energy of both channels of the demo song, measured on the commit before this one; the mixer has since
  // moved some of the demo's reverb to a bus, so this is the demo as it was then.
  const pcm = await renderProject(oldDemo(), song, { tail: 2 });
  expect(pcm.channels[0].length).toBe(1432200);
  expectEnergy(pcm.channels[0], 16811.317117581, 'left');
  expectEnergy(pcm.channels[1], 17061.309470188, 'right');
}, 60_000);
