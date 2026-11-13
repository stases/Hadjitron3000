import type { ReactNode } from 'react';
import { create } from 'zustand';
import { usePrefs } from '../../app/prefs';
import { LEVEL_NAMES, byLevel, levelOf } from '../../core/levels';
import type { Level } from '../../core/levels';
import { MODULES, paramSpec } from '../../core/modules';
import type { ModuleDef } from '../../core/modules';
import { defaultParams } from '../../core/params';
import type { Params } from '../../core/types';
import type { MenuItem, RackFold, SelectItem } from '../kit';

/** Which sections are open, by unit type and level ("filter/2"); kept while the app runs. */
export const useFolds = create<Record<string, boolean>>(() => ({}));

const FOLD_HINTS: Readonly<Record<2 | 3, string>> = {
  2: 'Shows the Shaping controls, which change the character of the sound; the lamp lights when one is changed.',
  3: 'Shows the Deep controls, the ones that take some explaining; the lamp lights when one is changed.',
};

/** Tells whether controls of a level are on screen in units of a type: always in pro mode and at Basics. */
export function useShown(): (type: string, level: Level) => boolean {
  const beginner = usePrefs((p) => p.beginner);
  const open = useFolds();
  return (type, level) => !beginner || level === 1 || !!open[`${type}/${level}`];
}

/** One cell of a unit and the parameters it shows; it belongs to the level of the first one. */
export interface Cell {
  ids: string[];
  node: ReactNode;
}

/**
 * Lays out the cells of a unit. In pro mode every cell is in the row, in table order. In beginner mode the row holds
 * the Basics cells and each higher level that has cells gets a fold.
 */
export function useLevels(type: string, params: Params, cells: Cell[]): { row: ReactNode[]; folds: RackFold[] } {
  const beginner = usePrefs((p) => p.beginner);
  const shown = useShown();
  if (!beginner) return { row: cells.map((c) => c.node), folds: [] };
  const def = MODULES[type];
  const defaults = defaultParams(def);
  const groups = byLevel(cells.map((c) => ({ ...c, level: levelOf(paramSpec(def, c.ids[0])!) })));
  const folds = ([2, 3] as const)
    .filter((level) => groups[level].length > 0)
    .map((level) => ({
      label: LEVEL_NAMES[level],
      open: shown(type, level),
      lit: groups[level].some((c) => c.ids.some((id) => params[id] !== defaults[id])),
      hint: FOLD_HINTS[level],
      onToggle: () => useFolds.setState((s) => ({ [`${type}/${level}`]: !s[`${type}/${level}`] })),
      children: <div className="h-factory-row">{groups[level].map((c) => c.node)}</div>,
    }));
  return { row: groups[1].map((c) => c.node), folds };
}

/** The heading of a level and an item for each of its modules, or nothing when it has none. */
function headed<T>(defs: ModuleDef[], level: Level, item: (def: ModuleDef) => T): (T | { heading: string })[] {
  return defs.length ? [{ heading: LEVEL_NAMES[level] }, ...defs.map(item)] : [];
}

/**
 * An add list as a menu: flat in pro mode; in beginner mode Basics and Shaping under their headings and the Deep
 * modules one step away in a submenu.
 */
export function addMenu(beginner: boolean, defs: readonly ModuleDef[], add: (type: string) => void): MenuItem[] {
  const item = (d: ModuleDef): MenuItem => ({ label: d.label, onSelect: () => add(d.type) });
  if (!beginner) return defs.map(item);
  const groups = byLevel(defs);
  const items = [...headed(groups[1], 1, item), ...headed(groups[2], 2, item)];
  return groups[3].length ? [...items, 'separator', { label: LEVEL_NAMES[3], items: groups[3].map(item) }] : items;
}

/** The source selector's items, grouped like an add list; in beginner mode the Deep sources wait behind More…. */
export function sourceItems(
  beginner: boolean,
  defs: readonly ModuleDef[],
): { options: SelectItem[]; more: SelectItem[] } {
  const option = (d: ModuleDef): SelectItem => ({ value: d.type, label: d.label });
  if (!beginner) return { options: defs.map(option), more: [] };
  const groups = byLevel(defs);
  return {
    options: [...headed(groups[1], 1, option), ...headed(groups[2], 2, option)],
    more: headed(groups[3], 3, option),
  };
}
