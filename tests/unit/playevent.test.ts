import { expect, test, vi } from 'vitest';
import type { Engine } from '../../src/audio/engine';
import { playEvent } from '../../src/audio/transport';

test('a sequenced note reaches the engine with its slide flag and its gain curve', () => {
  const play = vi.fn();
  const engine = { play } as unknown as Engine;
  const gain: [number, number][] = [[0, 0.5], [1, 1]];
  playEvent(engine, { channelId: 'c', time: 0, dur: 0.5, note: 60, vel: 0.8, slide: true }, 2);
  playEvent(engine, { channelId: 'c', time: 0, dur: 0.5, note: 62, vel: 0.8, gain }, 3);
  expect(play.mock.calls).toEqual([
    ['c', 60, 0.8, 2, 0.5, true, undefined], ['c', 62, 0.8, 3, 0.5, undefined, gain],
  ]);
});
