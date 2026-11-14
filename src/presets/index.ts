// The factory sounds. They are ordinary .h3s files, bundled with the app.

import { parseSound } from '../core/fileformat';
import type { SampleData, Sound } from '../core/types';
import { factoryId, factorySample, type FactorySample } from './samples';

const files = import.meta.glob<string>('./sounds/*.h3s', { query: '?raw', import: 'default', eager: true });

/** Factory sound names, grouped and ordered the way the library lists them. */
export const PRESET_GROUPS: readonly { label: string; names: readonly string[] }[] = [
  { label: 'Drums', names: ['Kick', 'Punch Kick', 'Snare', 'Clap', 'Hat', 'Open Hat', 'Tick', 'Tom', 'Chopped Break'] },
  { label: 'Bass', names: ['Sub Bass', 'Round Bass', 'Acid Bass', 'Reese Bass', 'Wobble Bass', 'Sub 808'] },
  {
    label: 'Keys',
    names: [
      'Kalimba', 'Bell', 'Ring Bell', 'Soft Keys', 'Crushed Keys', 'Old Tape Piano', 'Pluck', 'Plucked String',
      'Trance Pluck', 'Dub Stab', 'Glass Draw', 'Square Lead', 'PWM Lead',
    ],
  },
  {
    label: 'Pads',
    names: [
      'Warm Pad', 'Glass Pad', 'Wide Strings', 'Phase Pad', 'Frozen Hall', 'Slow Tide', 'Deep Drone', 'Dust',
      'Cloud Pad',
    ],
  },
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
