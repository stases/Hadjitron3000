// The marks that show a note's extras without selecting it, the same on a step of the grid and a note of the roll:
// a dither over a key that plays only sometimes, ticks along the bottom for a ratchet, a slanted line at the left
// for a slide, an arrow at the right for a hold, whose sound the views draw on as a line to the end of the block, and
// a small padlock at the top right for a note that locks a control.

import type { Note } from '../../core/types';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';

const SLIDE = { rows: ['...#', '..#.', '.#..', '#...'], colors: { '#': 'currentColor' } };
const HOLD = { rows: ['#..', '##.', '###', '##.', '#..'], colors: { '#': 'currentColor' } };
const LOCK = { rows: ['.#.', '#.#', '###', '###'], colors: { '#': 'currentColor' } };

/** The classes of a key that plays these notes. */
export function markClass(notes: readonly Note[]): string {
  return cx(
    notes.some((n) => n.chance !== undefined) && 'is-maybe', notes.some((n) => n.slide) && 'has-slide',
    notes.some((n) => n.hold) && 'has-hold',
  );
}

/** The marks inside a key `width` pixels wide that plays these notes. */
export function Marks({ notes, width }: { notes: readonly Note[]; width: number }) {
  const ratchet = Math.max(...notes.map((n) => n.ratchet ?? 1));
  return (
    <>
      {Array.from({ length: ratchet - 1 }, (_, i) => (
        <i key={i} className="h-mark-ratchet" style={{ left: Math.round(((i + 1) * width) / ratchet) }} />
      ))}
      {notes.some((n) => n.slide) && (
        <span className="h-mark-slide">
          <SpriteImage sprite={SLIDE} />
        </span>
      )}
      {notes.some((n) => n.hold) && (
        <span className="h-mark-hold">
          <SpriteImage sprite={HOLD} />
        </span>
      )}
      {notes.some((n) => n.locks) && (
        <span className="h-mark-lock">
          <SpriteImage sprite={LOCK} />
        </span>
      )}
    </>
  );
}
