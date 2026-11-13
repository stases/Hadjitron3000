// The geometry of the song timeline and small questions about placements. Sizes must match song.css.

import { MAX_SONG_BARS } from '../../core/defaults';
import type { Bar } from '../../core/meter';
import type { Placement } from '../../core/types';
import { selectPattern, setView } from '../../state/store';

/** Width of one bar on the timeline: a cell of seven pixels to four steps (28 in 4/4) and a 2px bar line. */
export const barWidth = (bar: Bar) => Math.round((bar.steps * 7) / 4) + 2;
/** Height of a tile, the inside of a lane. */
export const TILE_H = 56;

/** How many bars the placement may grow to before it runs into the next one in its lane or the end of the song. */
export function room(song: Placement[], placement: Placement): number {
  let end = MAX_SONG_BARS;
  for (const other of song) {
    if (other.lane === placement.lane && other.bar > placement.bar) end = Math.min(end, other.bar);
  }
  return end - placement.bar;
}

/** "Beat · bars 5 to 8", or "Beat · bar 5" for a one-bar placement. */
export function placementText(name: string, placement: Placement): string {
  const first = placement.bar + 1;
  return placement.bars === 1 ? `${name} · bar ${first}` : `${name} · bars ${first} to ${first + placement.bars - 1}`;
}

export function openInTrack(patternId: string): void {
  selectPattern(patternId);
  setView('track');
}
