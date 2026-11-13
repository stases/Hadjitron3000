import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { TICKS_PER_STEP } from '../../core/defaults';
import type { Bar } from '../../core/meter';
import type { Channel, Note, Pattern, Placement } from '../../core/types';
import { tokenColor } from '../kit';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';
import { barWidth } from './song';

const MINI_H = 36;
const ROW_PITCH = 4;

const NOTCH = {
  rows: ['kkkkk', '.kkk.', '..k..'],
  colors: { k: 'var(--ink)' },
};

/**
 * Left edge of tick `t` of the tile, in pixels from its inner edge: the steps of each bar are spread over all but
 * the last pixel of its cell, so every bar stays over its cell.
 */
function tickX(t: number, bar: Bar): number {
  const span = barWidth(bar) - 3;
  return Math.floor(t / bar.ticks) * barWidth(bar) + Math.floor(((t % bar.ticks) * span) / bar.ticks);
}

/**
 * One row per channel with notes, in channel order; each note a run of ink from its start to the start of its last
 * step, the block repeated over the tile, and a held note once to the end of the tile. Chords on a row fall on the
 * same pixels.
 */
function drawMiniature(canvas: HTMLCanvasElement, rows: Note[][], blockTicks: number, ticks: number, bar: Bar) {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = tokenColor('--ink');
  const pitch = Math.max(1, Math.min(ROW_PITCH, Math.floor((MINI_H + 1) / rows.length)));
  const height = pitch > 2 ? pitch - 1 : 1;
  const top = Math.max(0, Math.floor((MINI_H - rows.length * pitch + pitch - height) / 2));
  rows.forEach((notes, row) => {
    const y = top + row * pitch;
    if (y + height > MINI_H) return;
    for (const n of notes) {
      if (n.start >= blockTicks) continue;
      const len = n.hold ? ticks - n.start : Math.min(n.len, blockTicks - n.start);
      for (let start = n.start; start < ticks; start += n.hold ? ticks : blockTicks) {
        const x = tickX(start, bar);
        g.fillRect(x, y, Math.max(1, tickX(Math.min(start + len, ticks) - TICKS_PER_STEP, bar) + 1 - x), height);
      }
    }
  });
}

interface TileProps {
  placement: Placement;
  pattern: Pattern;
  channels: Channel[];
  bar: Bar;
  selected: boolean;
  current: boolean;
}

/** A placement on the timeline: a raised key in its block's colour with the name and a miniature of the notes. */
export const Tile = memo(function Tile({ placement, pattern, channels, bar, selected, current }: TileProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const w = barWidth(bar);
  const width = placement.bars * w - 2;
  const blockTicks = pattern.bars * bar.ticks;
  const ticks = placement.bars * bar.ticks;
  const rows = useMemo(
    () =>
      channels.flatMap((c) => {
        const notes = pattern.notes[c.id];
        return notes?.some((n) => n.start < blockTicks) ? [notes] : [];
      }),
    [channels, pattern.notes, blockTicks],
  );

  useLayoutEffect(() => drawMiniature(canvas.current!, rows, blockTicks, ticks, bar), [rows, blockTicks, ticks, bar]);

  const starts = Math.ceil(placement.bars / pattern.bars);
  const repeats = Array.from({ length: starts - 1 }, (_, i) => (i + 1) * pattern.bars);
  return (
    <div
      className={cx('h-song-tile', selected && 'is-selected', current && !selected && 'is-current')}
      data-id={placement.id}
      style={{ left: placement.bar * w, width, '--tile': `var(--c${pattern.color})` } as CSSProperties}
    >
      <span className="h-song-name">{pattern.name}</span>
      <canvas ref={canvas} className="h-song-mini" width={width - 2} height={MINI_H} />
      {repeats.map((at) => (
        <span key={at} className="h-song-notch" style={{ left: at * w - 3 }}>
          <SpriteImage sprite={NOTCH} />
        </span>
      ))}
      <i className="h-song-edge" />
    </div>
  );
});
