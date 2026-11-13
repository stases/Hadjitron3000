// The factory sounds. They are ordinary .h3s files, bundled with the app.

import { parseSound } from '../core/fileformat';
import type { Sound } from '../core/types';

const files = import.meta.glob<string>('./sounds/*.h3s', { query: '?raw', import: 'default', eager: true });

/** Factory sound names, grouped and ordered the way the library lists them. */
export const PRESET_GROUPS: readonly { label: string; names: readonly string[] }[] = [
  { label: 'Drums', names: ['Kick', 'Punch Kick', 'Snare', 'Clap', 'Hat', 'Open Hat', 'Tick', 'Tom'] },
  { label: 'Bass', names: ['Sub Bass', 'Round Bass', 'Acid Bass', 'Reese Bass', 'Wobble Bass', 'Sub 808'] },
  {
    label: 'Keys',
    names: [
      'Kalimba', 'Bell', 'Ring Bell', 'Soft Keys', 'Pluck', 'Trance Pluck', 'Dub Stab', 'Glass Draw', 'Square Lead',
      'PWM Lead',
    ],
  },
  { label: 'Pads', names: ['Warm Pad', 'Glass Pad', 'Wide Strings', 'Phase Pad', 'Slow Tide', 'Deep Drone', 'Dust'] },
];

/** A fresh copy of a factory sound. */
export function preset(name: string): Sound {
  const text = files[`./sounds/${name}.h3s`];
  if (!text) throw new Error(`There is no factory sound called ${name}.`);
  return parseSound(text).sound;
}
