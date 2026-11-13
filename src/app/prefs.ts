// Preferences of the person at this computer. They live in localStorage under one key, apart from the project and
// from undo, and storage that cannot be read or written leaves the defaults in place.

import { create } from 'zustand';

export interface Prefs {
  /** Beginner mode folds Shaping and Deep controls into sections and groups the add lists by level. */
  beginner: boolean;
}

const KEY = 'hadjitron-prefs';
const DEFAULTS: Prefs = { beginner: true };

/** The stored preferences; a missing value or one of the wrong type gets its default. */
function load(): Prefs {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const saved = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
    const prefs = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof Prefs)[]) {
      if (typeof saved[key] === typeof DEFAULTS[key]) prefs[key] = saved[key] as Prefs[typeof key];
    }
    return prefs;
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
