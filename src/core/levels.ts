// Levels of complexity. Every module and every parameter has one; beginner mode shows Basics at once and keeps
// Shaping and Deep a step away, pro mode ignores them.

export type Level = 1 | 2 | 3;

export const LEVELS: readonly Level[] = [1, 2, 3];
export const LEVEL_NAMES: Readonly<Record<Level, string>> = { 1: 'Basics', 2: 'Shaping', 3: 'Deep' };

/** Anything with a level; Basics when the field is absent. */
export interface Levelled {
  level?: Level;
}

export const levelOf = (item: Levelled): Level => item.level ?? 1;

/** The items of each level, in their original order. */
export function byLevel<T extends Levelled>(items: readonly T[]): Record<Level, T[]> {
  const out: Record<Level, T[]> = { 1: [], 2: [], 3: [] };
  for (const item of items) out[levelOf(item)].push(item);
  return out;
}
