import { expect, test } from 'vitest';
import { renderProject, renderSound } from '../../src/audio';
import { PRESET_GROUPS, preset } from '../../src/presets';
import { demoProject } from '../../src/presets/projects';
import { db, peak, rms, slice } from './helpers';

test('every factory sound makes a healthy note', async () => {
  for (const name of PRESET_GROUPS.flatMap((g) => g.names)) {
    const pcm = await renderSound(preset(name), {}, { dur: 0.5 });
    const p = Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));
    expect(p, name).toBeGreaterThan(0.005);
    expect(p, name).toBeLessThan(0.9);
  }
});

test('the basses and leads made with the voice path are as loud as their neighbours in the library', async () => {
  const level = async (name: string) => {
    const [l, r] = (await renderSound(preset(name), {}, { dur: 0.5 })).channels;
    return db(Math.hypot(rms(slice(l, 0, 0.5)), rms(slice(r, 0, 0.5))) / Math.SQRT2);
  };
  const pairs = [
    ['Acid Bass', 'Round Bass'], ['Reese Bass', 'Round Bass'], ['Sub 808', 'Sub Bass'], ['Trance Pluck', 'Pluck'],
    ['PWM Lead', 'Square Lead'],
  ];
  for (const [name, peer] of pairs) expect(Math.abs((await level(name)) - (await level(peer))), name).toBeLessThan(2.5);
});

test('the demo song renders without hitting the clipper hard', async () => {
  const pcm = await renderProject(demoProject(), { kind: 'song' });
  const p = Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));
  expect(p).toBeGreaterThan(0.3);
  expect(p).toBeLessThan(0.8);
}, 30_000);
