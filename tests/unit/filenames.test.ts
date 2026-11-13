import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

// macOS disks ignore case, and imports leave the extension out: `Dialogs.tsx` next to `dialogs.ts` breaks there.
const modulePaths = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modulePaths(path);
    return /\.(ts|tsx|cjs|mjs)$/.test(entry.name) ? [path.replace(/\.[^.]+$/, '').toLowerCase()] : [];
  });

test('no two modules differ only by case', () => {
  const paths = ['src', 'electron', 'scripts', 'tests'].flatMap(modulePaths);
  expect(paths.filter((p, i) => paths.indexOf(p) !== i)).toEqual([]);
});
