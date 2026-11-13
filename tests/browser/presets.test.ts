import { expect, test } from 'vitest';
import { renderProject, renderSound } from '../../src/audio';
import { PRESET_GROUPS, preset } from '../../src/presets';
import { demoProject } from '../../src/presets/projects';
import { db, peak, rms, slice } from './helpers';

test('every factory sound makes a healthy note', async () => {
  for (const name of PRESET_GROUPS.flatMap((g) => g.names)) {
    // The first second is enough to judge; the tails of the drones and pads take far longer.
    const pcm = await renderSound(preset(name), {}, { dur: 0.5, tail: 0.5 });
    const p = Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));
    expect(p, name).toBeGreaterThan(0.005);
    expect(p, name).toBeLessThan(0.9);
  }
});

test('the basses, leads and effect showcases are as loud as their neighbours in the library', async () => {
  const level = async (name: string) => {
    const [l, r] = (await renderSound(preset(name), {}, { dur: 0.5 })).channels;
    return db(Math.hypot(rms(slice(l, 0, 0.5)), rms(slice(r, 0, 0.5))) / Math.SQRT2);
  };
  const pairs = [
    ['Acid Bass', 'Round Bass'], ['Reese Bass', 'Round Bass'], ['Sub 808', 'Sub Bass'], ['Trance Pluck', 'Pluck'],
    ['PWM Lead', 'Square Lead'], ['Wobble Bass', 'Round Bass'], ['Glass Draw', 'Kalimba'],
    ['Punch Kick', 'Kick'], ['Dub Stab', 'Pluck'], ['Ring Bell', 'Bell'],
    ['Crushed Keys', 'Soft Keys'], ['Old Tape Piano', 'Soft Keys'], ['Plucked String', 'Pluck'],
  ];
  for (const [name, peer] of pairs) expect(Math.abs((await level(name)) - (await level(peer))), name).toBeLessThan(2.5);
});

test('the slow pads and drones are as loud as the other pads once they have swelled', async () => {
  // At 8 kHz, which keeps their long swells quick to render and loses little of a pad.
  const level = async (name: string) => {
    const sr = 8000;
    const [l, r] = (await renderSound(preset(name), {}, { dur: 16, tail: 0, sampleRate: sr })).channels;
    return db(Math.hypot(rms(slice(l, 13, 16, sr)), rms(slice(r, 13, 16, sr))) / Math.SQRT2);
  };
  const warm = await level('Warm Pad');
  for (const name of ['Slow Tide', 'Deep Drone', 'Wide Strings', 'Phase Pad', 'Frozen Hall']) {
    expect(Math.abs((await level(name)) - warm), name).toBeLessThan(3);
  }
});

test('the demo song renders without hitting the clipper hard', async () => {
  const pcm = await renderProject(demoProject(), { kind: 'song' });
  const p = Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));
  expect(p).toBeGreaterThan(0.3);
  expect(p).toBeLessThan(0.8);
}, 60_000);
