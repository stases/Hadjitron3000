import { expect, test } from 'vitest';
import { renderProject, renderSound } from '../../src/audio';
import { PRESET_GROUPS, preset } from '../../src/presets';
import { demoProject } from '../../src/presets/projects';
import { peak } from './helpers';

test('every factory sound makes a healthy note', async () => {
  for (const name of PRESET_GROUPS.flatMap((g) => g.names)) {
    const pcm = await renderSound(preset(name), {}, { dur: 0.5 });
    const p = Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));
    expect(p, name).toBeGreaterThan(0.005);
    expect(p, name).toBeLessThan(0.9);
  }
});

test('the demo song renders without hitting the clipper hard', async () => {
  const pcm = await renderProject(demoProject(), { kind: 'song' });
  const p = Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));
  expect(p).toBeGreaterThan(0.3);
  expect(p).toBeLessThan(0.8);
}, 30_000);
