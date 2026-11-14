// What every recipe shares: it starts from an empty project with one empty block, and its page says what the style
// is, why its sounds are made so, the steps from nothing to a finished piece, and what to try next.

import type { Example, Page, Piece } from '../../pages';
import { projectExample } from '../../build';
import type { TourStep } from '../../../tour/tourStore';

/** An empty project at 120 BPM with an empty one-bar block called Beat and no sounds. */
export const emptyStart = (name: string): Example => projectExample(`An empty project, to become ${name}`, () => ({
  name, sounds: [], blocks: [{ name: 'Beat', bars: 1, rows: {} }],
}));

interface Recipe {
  title: string;
  name: string;
  /** What the style is: its tempo, key and scale. */
  about: readonly string[];
  /** Why its sounds are made the way they are. */
  sounds: readonly string[];
  result: string;
  steps: readonly TourStep[];
  /** Where the piece can be loaded part way: a name, such as After the drums, and the steps done by then. */
  checkpoints: readonly (readonly [label: string, after: number])[];
  /** What to change to make it one's own. */
  change: readonly string[];
}

/** A recipe page: from an empty project to an arranged, mixed piece, loadable at its checkpoints. */
export function recipe(r: Recipe): Page {
  const pieces: Piece[] = [
    ...r.about,
    ...r.sounds,
    {
      kind: 'worked',
      example: emptyStart(r.name),
      result: r.result,
      steps: r.steps,
      checkpoints: r.checkpoints.map(([label, after]) => ({ label, after })),
    },
    ...r.change,
  ];
  return { title: r.title, pieces };
}
