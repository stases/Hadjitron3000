// An effect that cannot ramp its parameters is stepped through its update at a fine, fixed rate instead, live and in
// an export. The EQ stands in for such an effect here, with its ramp taken away.

import { expect, test, vi } from 'vitest';
import { Engine, renderProject } from '../../src/audio';
import { refSpec } from '../../src/core/automation';
import { toNorm } from '../../src/core/params';
import type { ParamRef } from '../../src/core/types';
import { adsr, db, project, rms, slice, sound } from './helpers';

vi.mock('../../src/audio/modules/effects', async (original) => {
  const effects = await original<typeof import('../../src/audio/modules/effects')>();
  return {
    ...effects,
    EFFECT_BUILDERS: {
      ...effects.EFFECT_BUILDERS,
      eq: (...args: Parameters<typeof effects.EFFECT_BUILDERS.eq>) => ({ ...effects.EFFECT_BUILDERS.eq(...args), ramp: undefined }),
    },
  };
});

test('an automated effect without ramp is stepped through its update, smoothly enough to follow the row', async () => {
  const eq = { id: 'eq', type: 'eq', on: true, params: { low: 0, mid: 0, freq: 440, high: 0, lowcut: 20 } };
  const s = sound('osc', { wave: 'sine' }, { amp: adsr(0.005, 0.1, 1, 0.05), out: { level: -6 }, chain: [eq] });
  const p = project([{ id: 'a', sound: s }], {}, { bpm: 240 });
  p.patterns[0].notes = { a: [{ id: 'n', start: 0, len: 24, note: 69, vel: 1, hold: true }] };
  p.song = [{ id: 's', pattern: p.patterns[0].id, lane: 0, bar: 0, bars: 3 }];
  const target: ParamRef = { owner: 'a', module: 'eq', param: 'mid' };
  const spec = refSpec(p, target)!;
  p.automation = [{ id: 'r', target, points: [[0, toNorm(spec, 0)], [768, toNorm(spec, -18)]] }];

  const engine = new Engine(new OfflineAudioContext(2, 128, 44100));
  engine.setProject(p);
  expect(engine.ramps(target)).toBe(false);
  expect(engine.ramps({ owner: 'a', module: 'out', param: 'level' })).toBe(true);

  const d = (await renderProject(p, { kind: 'song' }, { tail: 0 })).channels[0];
  const at = (t: number) => db(rms(slice(d, t - 0.02, t + 0.02)) / rms(slice(d, 0.03, 0.07)));
  // The cut deepens step by step along the row, 9 dB half way and 18 dB at its end.
  expect(at(0.5)).toBeCloseTo(-4.5, 0);
  expect(at(1)).toBeCloseTo(-9, 0);
  expect(at(1.5)).toBeCloseTo(-13.5, 0);
  expect(at(2.5)).toBeCloseTo(-18, 0);
});
