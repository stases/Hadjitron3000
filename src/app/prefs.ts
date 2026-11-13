// Preferences of the person at this computer. They live in localStorage under one key, apart from the project and
// from undo, and storage that cannot be read or written leaves the defaults in place.

import { create } from 'zustand';

export interface Prefs {
  /** Beginner mode folds Shaping and Deep controls into sections and groups the add lists by level. */
  beginner: boolean;
  /** The metronome clicks on every beat while playing. */
  metronome: boolean;
  /** The grid notes played in are recorded on, in ticks (0 is Off). */
  quantize: number;
}

const KEY = 'hadjitron-prefs';
const DEFAULTS: Prefs = { beginner: true, metronome: false, quantize: 24 };

/** The stored preferences; a missing value or one of the wrong type gets its default. */
function load(): Prefs {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const saved = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) =>
      [key, typeof saved[key] === typeof value ? saved[key] : value])) as Prefs;
  } catch {
    return { ...DEFAULTS };
  }
}

export const usePrefs = create<Prefs>(load);

export function setPrefs(change: Partial<Prefs>): void {
  usePrefs.setState(change);
  try {
    localStorage.setItem(KEY, JSON.stringify(usePrefs.getState()));
  } catch {
    // Not remembered beyond this run; the app works the same.
  }
}

export function toggleMetronome(): void {
  setPrefs({ metronome: !usePrefs.getState().metronome });
}
