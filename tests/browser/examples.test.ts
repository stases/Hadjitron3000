// The example songs of File > Open Example, rendered: clear of the clipper, loud enough, the same every time.

import { expect, test } from 'vitest';
import { renderProject } from '../../src/audio';
import { fitFades } from '../../src/core/arrangement';
import type { Project } from '../../src/core/types';
import { EXAMPLES } from '../../src/presets/examples';
import { db, peak, rms } from './helpers';

/** The first `bars` bars of the song, the placements cut there with their fades fitted. */
function excerpt(project: Project, bars: number): Project {
  return {
    ...project,
    song: project.song.filter((s) => s.bar < bars).map((s) => {
      const length = Math.min(s.bars, bars - s.bar);
      const { fadeIn, fadeOut, ...rest } = s;
      return { ...rest, bars: length, ...fitFades(length, fadeIn ?? 0, fadeOut ?? 0) };
    }),
  };
}

/** FNV-1a over the bits of every sample. */
function digest(channels: Float32Array[]): number {
  let h = 0x811c9dc5;
  for (const d of channels) {
    for (const v of new Uint32Array(d.buffer, d.byteOffset, d.length)) h = Math.imul(h ^ v, 0x01000193);
  }
  return h >>> 0;
}

test('every example renders clear of the clipper and as loud as the demo, within a few decibels', async () => {
  // All six at once, at 16 kHz and without the tail, which keeps this quick; the tail only falls away.
  const levels = await Promise.all(EXAMPLES.map(async ({ project }) => {
    const [l, r] = (await renderProject(project(), { kind: 'song' }, { sampleRate: 16000, tail: 0 })).channels;
    return { peak: Math.max(peak(l), peak(r)), loudness: db(Math.hypot(rms(l), rms(r)) / Math.SQRT2) };
  }));
  for (const [i, { name }] of EXAMPLES.entries()) {
    expect(levels[i].peak, name).toBeGreaterThan(0.3);
    expect(levels[i].peak, name).toBeLessThan(0.8);
    expect(levels[i].loudness, name).toBeGreaterThan(-25);
    expect(levels[i].loudness, name).toBeLessThan(-16);
  }
}, 120_000);

test('every block of every example makes itself heard on its own', async () => {
  await Promise.all(EXAMPLES.map(async ({ name, project }) => {
    const p = project();
    for (const pattern of p.patterns) {
      const pcm = await renderProject(p, { kind: 'pattern', patternId: pattern.id }, { sampleRate: 8000, tail: 0 });
      expect(rms(pcm.channels[0]), `${name}: ${pattern.name}`).toBeGreaterThan(1e-3);
    }
  }));
}, 60_000);

test('every example renders the same twice: chances, drifts, noise and held notes included', async () => {
  const render = (p: Project) => renderProject(excerpt(p, 8), { kind: 'song' }, { sampleRate: 8000, tail: 0 });
  await Promise.all(EXAMPLES.map(async ({ name, project }) => {
    const p = project();
    const [a, b] = [await render(p), await render(p)];
    expect(rms(a.channels[0]), name).toBeGreaterThan(1e-3);
    expect(digest(a.channels), name).toBe(digest(b.channels));
  }));
}, 60_000);
