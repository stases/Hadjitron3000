import { expect, test } from 'vitest';
import { renderProject, renderSound } from '../../src/audio';
import { PRESET_GROUPS, preset, presetSamples } from '../../src/presets';
import { demoProject } from '../../src/presets/projects';
import { centroid, db, peak, rms, slice } from './helpers';

/** Where the energy of a sound lies, by its spectral centroid in hertz over its first second. */
const BANDS = {
  sub: [0, 120], // sine subs
  low: [0, 400], // kicks, toms and bass lines
  mid: [150, 3000], // snares, claps, keys, leads, pads
  click: [800, 6000], // short wooden and metallic hits
  high: [3000, 22050], // hats, shakers, rides
  noise: [1000, 22050], // filtered noise beds
  riser: [0, 22050], // checked by how their brightness moves instead
} as const;

/**
 * Every factory sound: its kind, and the sound it is as loud as over its first half second (a sound that names
 * itself is a reference). Pads, drones and risers are balanced against Warm Pad after they have swelled, below.
 */
const SOUNDS: Record<string, [keyof typeof BANDS, string?]> = {
  Kick: ['low', 'Kick'], 'Punch Kick': ['low', 'Kick'], 'Hard Kick': ['low', 'Kick'], 'Rumble Kick': ['low', 'Kick'],
  'Crushed Kick': ['low', 'Kick'], Snare: ['mid', 'Snare'], 'Crushed Snare': ['mid', 'Snare'], Clap: ['mid', 'Clap'],
  'Room Clap': ['mid', 'Clap'], Rim: ['click', 'Tick'], Tom: ['low', 'Tom'], 'Low Tom': ['low', 'Tom'],
  Hat: ['high', 'Hat'], 'Tight Hat': ['high', 'Hat'], 'Open Hat': ['high', 'Open Hat'],
  'Long Hat': ['high', 'Open Hat'], Ride: ['high', 'Open Hat'], 'Chopped Break': ['low', 'Chopped Break'],

  Tick: ['click', 'Tick'], Shaker: ['high', 'Hat'], 'Wood Block': ['click', 'Tick'], 'Metal Hit': ['click', 'Tick'],
  'Glitch Hit': ['click', 'Tick'], 'Comb Click': ['click', 'Tick'], Zap: ['click', 'Tick'],

  'Sub Bass': ['sub', 'Sub Bass'], 'Warm Sub': ['sub', 'Sub Bass'], 'Round Bass': ['low', 'Round Bass'],
  'Rolling Bass': ['low', 'Round Bass'], 'Thump Bass': ['sub', 'Round Bass'], 'Sub 808': ['sub', 'Sub Bass'],
  'Sub Pulse': ['sub', 'Sub 808'], 'Acid Bass': ['low', 'Round Bass'], 'Acid Square': ['low', 'Acid Bass'],
  'Acid Squelch': ['low', 'Acid Bass'], 'Reese Bass': ['low', 'Round Bass'], 'Wobble Bass': ['low', 'Round Bass'],

  Kalimba: ['mid', 'Kalimba'], 'Soft Kalimba': ['mid', 'Kalimba'], 'Soft Mallet': ['mid', 'Kalimba'],
  Bell: ['mid', 'Bell'], 'Ring Bell': ['mid', 'Bell'], 'Music Box': ['mid', 'Kalimba'],
  'Soft Keys': ['mid', 'Soft Keys'], 'Crushed Keys': ['mid', 'Soft Keys'], 'Old Tape Piano': ['mid', 'Soft Keys'],
  Pluck: ['mid', 'Pluck'], Harp: ['mid', 'Kalimba'], 'Plucked String': ['mid', 'Pluck'],
  'Trance Pluck': ['mid', 'Pluck'], 'Arp Pluck': ['mid', 'Trance Pluck'], 'Dub Stab': ['mid', 'Pluck'],
  'Minor Stab': ['mid', 'Dub Stab'], 'Dub Chord': ['mid', 'Dub Stab'], 'Glass Draw': ['mid', 'Kalimba'],

  'Square Lead': ['mid', 'Square Lead'], 'PWM Lead': ['mid', 'Square Lead'], 'Drift Lead': ['mid', 'Square Lead'],
  'Soft Acid Line': ['mid', 'Square Lead'], Supersaw: ['mid', 'Square Lead'], Hoover: ['mid', 'Square Lead'],
  'Draw Buzz': ['mid', 'Square Lead'],

  'Warm Pad': ['mid'], 'Glass Pad': ['mid', 'Glass Pad'], 'Breath Pad': ['mid'], 'Wide Strings': ['mid'],
  'Lush Pad': ['mid'], 'Choir Pad': ['mid'], 'Phase Pad': ['mid'], 'Gated Pad': ['mid'], 'Fog Pad': ['mid'],
  'Cloud Pad': ['mid'],
  'Slow Tide': ['mid'], 'Shimmer Pad': ['mid'], 'Frozen Hall': ['mid'],

  Dust: ['noise', 'Dust'], Wind: ['mid'], 'Deep Drone': ['low'], 'Dark Drone': ['low'], 'Still Air': ['mid'],

  'Noise Riser': ['riser'], Uplifter: ['riser'], Downlifter: ['riser'],
};
const SWELLS = [
  'Slow Tide', 'Deep Drone', 'Wide Strings', 'Phase Pad', 'Frozen Hall', 'Breath Pad', 'Lush Pad', 'Choir Pad',
  'Gated Pad', 'Fog Pad', 'Cloud Pad', 'Shimmer Pad', 'Wind', 'Dark Drone', 'Still Air',
];
const RISERS = { 'Noise Riser': 'up', Uplifter: 'up', Downlifter: 'down' } as const;

const loudness = (l: Float32Array, r: Float32Array) => db(Math.hypot(rms(l), rms(r)) / Math.SQRT2);

test('every factory sound is healthy, as loud as its neighbours and with its energy where it belongs', async () => {
  const names = PRESET_GROUPS.flatMap((g) => g.names);
  expect(Object.keys(SOUNDS).sort()).toEqual([...names].sort());
  const level: Record<string, number> = {};
  for (const name of names) {
    // The first second is enough to judge; the tails of the drones and pads take far longer.
    const t0 = performance.now();
    const [l, r] = (await renderSound(preset(name), presetSamples(name), { dur: 0.5, tail: 0.5 })).channels;
    expect(performance.now() - t0, `${name} renders quickly`).toBeLessThan(3000);
    const p = Math.max(peak(l), peak(r));
    // A riser is still nearly silent here; it is heard by the next test.
    expect(p, name).toBeGreaterThan(SOUNDS[name][0] === 'riser' ? 0 : 0.005);
    expect(p, name).toBeLessThan(0.9);
    level[name] = loudness(slice(l, 0, 0.5), slice(r, 0, 0.5));
    const [lo, hi] = BANDS[SOUNDS[name][0]];
    const c = centroid(Float32Array.from(l, (v, i) => v + r[i]));
    expect(c, `${name}: centroid`).toBeGreaterThan(lo);
    expect(c, `${name}: centroid`).toBeLessThan(hi);
  }
  for (const [name, [, peer]] of Object.entries(SOUNDS)) {
    if (peer) expect(Math.abs(level[name] - level[peer]), `${name} against ${peer}`).toBeLessThan(2.5);
  }
}, 60_000);

test('pads and drones are as loud as Warm Pad once they have swelled, and risers at their loudest', async () => {
  // At 8 kHz, which keeps their long swells quick to render and loses little of a pad.
  const sr = 8000;
  const render = async (name: string, dur: number) =>
    (await renderSound(preset(name), presetSamples(name), { dur, tail: 0, sampleRate: sr })).channels;
  const swelled = async (name: string) => {
    const [l, r] = await render(name, 16);
    return loudness(slice(l, 13, 16, sr), slice(r, 13, 16, sr));
  };
  const warm = await swelled('Warm Pad');
  for (const name of SWELLS) expect(Math.abs((await swelled(name)) - warm), name).toBeLessThan(3);
  for (const [name, way] of Object.entries(RISERS)) {
    const [l, r] = await render(name, 8);
    const loudest = Math.max(...Array.from({ length: 15 }, (_, i) => loudness(
      slice(l, i / 2, i / 2 + 0.5, sr), slice(r, i / 2, i / 2 + 0.5, sr))));
    expect(Math.abs(loudest - warm), name).toBeLessThan(3);
    const [early, late] = [slice(l, 0, 1, sr), slice(l, 3, 4, sr)].map((d) => centroid(d, sr));
    expect(way === 'up' ? late / early : early / late, `${name} sweeps ${way}`).toBeGreaterThan(1.5);
  }
}, 60_000);

test('the demo song renders without hitting the clipper hard', async () => {
  const pcm = await renderProject(demoProject(), { kind: 'song' });
  const p = Math.max(peak(pcm.channels[0]), peak(pcm.channels[1]));
  expect(p).toBeGreaterThan(0.3);
  expect(p).toBeLessThan(0.8);
}, 60_000);
