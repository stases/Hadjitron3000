// The factory sounds. They are ordinary .h3s files, bundled with the app.

import { parseSound } from '../core/fileformat';
import type { SampleData, Sound } from '../core/types';
import { factoryId, factorySample, type FactorySample } from './samples';

const files = import.meta.glob<string>('./sounds/*.h3s', { query: '?raw', import: 'default', eager: true });

/** Factory sound names, grouped and ordered the way the library lists them, each group from plain to special. */
export const PRESET_GROUPS: readonly { label: string; names: readonly string[] }[] = [
  {
    label: 'Drums',
    names: [
      'Kick', 'Punch Kick', 'Hard Kick', 'Rumble Kick', 'Crushed Kick', 'Snare', 'Crushed Snare', 'Clap', 'Room Clap',
      'Rim', 'Tom', 'Low Tom', 'Hat', 'Tight Hat', 'Open Hat', 'Long Hat', 'Ride', 'Chopped Break',
    ],
  },
  { label: 'Percussion', names: ['Tick', 'Shaker', 'Wood Block', 'Metal Hit', 'Glitch Hit', 'Comb Click', 'Zap'] },
  {
    label: 'Bass',
    names: [
      'Sub Bass', 'Warm Sub', 'Round Bass', 'Rolling Bass', 'Thump Bass', 'Sub 808', 'Sub Pulse', 'Acid Bass',
      'Acid Square', 'Acid Squelch', 'Reese Bass', 'Wobble Bass',
    ],
  },
  {
    label: 'Keys',
    names: [
      'Kalimba', 'Soft Kalimba', 'Soft Mallet', 'Bell', 'Ring Bell', 'Music Box', 'Soft Keys', 'Crushed Keys',
      'Old Tape Piano', 'Pluck', 'Harp', 'Plucked String', 'Trance Pluck', 'Arp Pluck', 'Dub Stab', 'Minor Stab',
      'Dub Chord', 'Glass Draw',
    ],
  },
  {
    label: 'Leads',
    names: ['Square Lead', 'PWM Lead', 'Drift Lead', 'Soft Acid Line', 'Supersaw', 'Hoover', 'Draw Buzz'],
  },
  {
    label: 'Pads',
    names: [
      'Warm Pad', 'Glass Pad', 'Breath Pad', 'Wide Strings', 'Lush Pad', 'Choir Pad', 'Phase Pad', 'Gated Pad',
      'Fog Pad', 'Slow Tide', 'Cloud Pad', 'Shimmer Pad', 'Frozen Hall',
    ],
  },
  { label: 'Textures', names: ['Dust', 'Wind', 'Deep Drone', 'Dark Drone', 'Still Air'] },
  { label: 'Risers', names: ['Noise Riser', 'Uplifter', 'Downlifter'] },
];

/** The factory sounds that play a factory sample, which their files leave out because it is made in code. */
const SAMPLED: Readonly<Record<string, FactorySample>> = { 'Cloud Pad': 'pad', 'Chopped Break': 'break' };

/** A fresh copy of a factory sound. */
export function preset(name: string): Sound {
  const text = files[`./sounds/${name}.h3s`];
  if (!text) throw new Error(`There is no factory sound called ${name}.`);
  const { sound } = parseSound(text);
  if (Object.hasOwn(SAMPLED, name)) sound.source.params.sample = factoryId(SAMPLED[name]);
  return sound;
}

/** The samples a factory sound plays, to go into the project with it. */
export function presetSamples(name: string): Record<string, SampleData> {
  if (!Object.hasOwn(SAMPLED, name)) return {};
  const { id, sample } = factorySample(SAMPLED[name]);
  return { [id]: sample };
}
