import type { ReactNode } from 'react';
import { create } from 'zustand';
import { usePrefs } from '../../app/prefs';
import { LEVEL_NAMES, byLevel } from '../../core/levels';
import type { Level } from '../../core/levels';
import type { ModuleDef } from '../../core/modules';
import type { MenuItem, RackFold, SelectItem } from '../kit';

/** Which sections are open, by unit type and level ("filter/2"); kept while the app runs. */
export const useFolds = create<Record<string, boolean>>(() => ({}));

const FOLD_HINTS: Readonly<Record<2 | 3, string>> = {
  2: 'Shows the Shaping controls, which change the character of the sound; the lamp lights when one is changed.',
  3: 'Shows the Deep controls, the ones that take some explaining; the lamp lights when one is changed.',
};

/** Open or close the section of a level in units of a type. */
export function toggleFold(type: string, level: Level): void {
  useFolds.setState((s) => ({ [`${type}/${level}`]: !s[`${type}/${level}`] }));
}

/** Tells whether controls of a level are on screen in units of a type: always in pro mode and at Basics. */
export function useShown(): (type: string, level: Level) => boolean {
  const beginner = usePrefs((p) => p.beginner);
  const open = useFolds();
  return (type, level) => !beginner || level === 1 || !!open[`${type}/${level}`];
}

/** One cell of a unit: its control, its level, and whether that control differs from its default. */
export interface Cell {
  node: ReactNode;
  level: Level;
  changed: boolean;
  /** A caption shared with the neighbouring cells of the same group, such as "Osc 2". */
  group?: string;
}

/** The nodes of a row, with neighbouring cells of one group gathered under its caption. */
function arrange(cells: Cell[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < cells.length; ) {
    const { group } = cells[i];
    if (!group) {
      out.push(cells[i++].node);
      continue;
    }
    const members: ReactNode[] = [];
    while (i < cells.length && cells[i].group === group) members.push(cells[i++].node);
    out.push(
      <div key={`group:${group}`} className="h-factory-group" role="group" aria-label={group}>
        <span className="h-factory-group-label">{group}</span>
        <div className="h-factory-row">{members}</div>
      </div>,
    );
  }
  return out;
}

/**
 * Lays out the cells of a unit. In pro mode every cell is in the row, in table order. In beginner mode the row holds
 * the Basics cells and each higher level that has cells gets a fold. Sections are kept open by unit type.
 */
export function useLevels(type: string, cells: Cell[]): { row: ReactNode[]; folds: RackFold[] } {
  const beginner = usePrefs((p) => p.beginner);
  const shown = useShown();
  if (!beginner) return { row: arrange(cells), folds: [] };
  const groups = byLevel(cells);
  const folds = ([2, 3] as const)
    .filter((level) => groups[level].length > 0)
    .map((level) => ({
      label: LEVEL_NAMES[level],
      open: shown(type, level),
      lit: groups[level].some((c) => c.changed),
      hint: FOLD_HINTS[level],
      onToggle: () => toggleFold(type, level),
      children: <div className="h-factory-row">{arrange(groups[level])}</div>,
    }));
  return { row: arrange(groups[1]), folds };
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
