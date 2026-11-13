import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { fadeGain } from '../../core/arrangement';
import { TICKS_PER_STEP } from '../../core/defaults';
import type { Bar } from '../../core/meter';
import type { Channel, Note, Pattern, Placement } from '../../core/types';
import { tokenColor } from '../kit';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';
import { TILE_H, barWidth } from './song';

const MINI_H = 36;
const ROW_PITCH = 4;
const HANDLE = 5;

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

/** A row of the miniature: one sound's notes, and whether the placement silences that sound. */
interface Row {
  notes: Note[];
  muted: boolean;
}

/** Every other pixel of a rectangle, in a checker that lines up across the canvas. */
function dither(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) if ((i + j) % 2 === 0) g.fillRect(i, j, 1, 1);
}

/**
 * One row per channel with notes, in channel order; each note a run of ink from its start to the start of its last
 * step, the block repeated over the tile, and a held note once to the end of the tile. Chords on a row fall on the
 * same pixels. The row of a sound the placement mutes is drawn in every other pixel.
 */
function drawMiniature(canvas: HTMLCanvasElement, rows: Row[], blockTicks: number, ticks: number, bar: Bar) {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = tokenColor('--ink');
  const pitch = Math.max(1, Math.min(ROW_PITCH, Math.floor((MINI_H + 1) / rows.length)));
  const height = pitch > 2 ? pitch - 1 : 1;
  const top = Math.max(0, Math.floor((MINI_H - rows.length * pitch + pitch - height) / 2));
  rows.forEach(({ notes, muted }, row) => {
    const y = top + row * pitch;
    if (y + height > MINI_H) return;
    for (const n of notes) {
      if (n.start >= blockTicks) continue;
      const len = n.hold ? ticks - n.start : Math.min(n.len, blockTicks - n.start);
      for (let start = n.start; start < ticks; start += n.hold ? ticks : blockTicks) {
        const x = tickX(start, bar);
        const w = Math.max(1, tickX(Math.min(start + len, ticks) - TICKS_PER_STEP, bar) + 1 - x);
        if (!muted) g.fillRect(x, y, w, height);
        else dither(g, x, y, w, height);
      }
    }
  });
}

/**
 * The fades as ramps over the block colour, inside the tile's edge: above the equal-power curve the tile is
 * dithered with ink, and the curve itself is a line of ink, `fadeIn` pixels from the left and `fadeOut` from the right.
 */
function drawFades(canvas: HTMLCanvasElement, fadeIn: number, fadeOut: number) {
  const g = canvas.getContext('2d')!;
  const { width, height } = canvas;
  g.clearRect(0, 0, width, height);
  g.fillStyle = tokenColor('--ink');
  const ramp = (length: number, column: (i: number) => number) => {
    let last = height;
    for (let i = 0; i < length; i++) {
      const y = Math.round((1 - fadeGain(i + 0.5, length, length, 0)) * (height - 1));
      const x = column(i);
      dither(g, x, 0, 1, y);
      g.fillRect(x, y, 1, Math.max(1, last - y));
      last = y;
    }
  };
  ramp(fadeIn, (i) => i);
  ramp(fadeOut, (i) => width - 1 - i);
}

interface TileProps {
  placement: Placement;
  pattern: Pattern;
  channels: Channel[];
  bar: Bar;
  selected: boolean;
  current: boolean;
  handles: boolean;
}

/**
 * A placement on the timeline: a raised key in its block's colour with the name, a miniature of the notes and the
 * fades as ramps. With `handles` the top corners carry small handles that drag the fades.
 */
export const Tile = memo(function Tile({ placement, pattern, channels, bar, selected, current, handles }: TileProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fades = useRef<HTMLCanvasElement>(null);
  const w = barWidth(bar);
  const width = placement.bars * w - 2;
  const blockTicks = pattern.bars * bar.ticks;
  const ticks = placement.bars * bar.ticks;
  const { mutes } = placement;
  const rows = useMemo(
    () =>
      channels.flatMap((c) => {
        const notes = pattern.notes[c.id];
        return notes?.some((n) => n.start < blockTicks) ? [{ notes, muted: !!mutes?.includes(c.id) }] : [];
      }),
    [channels, pattern.notes, blockTicks, mutes],
  );
  // A fade of n bars covers their cells and the n - 1 bar lines between them.
  const fadeIn = placement.fadeIn ? placement.fadeIn * w - 2 : 0;
  const fadeOut = placement.fadeOut ? placement.fadeOut * w - 2 : 0;

  useLayoutEffect(() => drawMiniature(canvas.current!, rows, blockTicks, ticks, bar), [rows, blockTicks, ticks, bar]);
  // The ramps start inside the tile's one-pixel edge.
  useLayoutEffect(() => drawFades(fades.current!, fadeIn - 1, fadeOut - 1), [fadeIn, fadeOut, width]);

  const starts = Math.ceil(placement.bars / pattern.bars);
  const repeats = Array.from({ length: starts - 1 }, (_, i) => (i + 1) * pattern.bars);
  const handleAt = (fade: number) => Math.min(width - HANDLE, Math.max(0, fade - Math.ceil(HANDLE / 2)));
  return (
    <div
      className={cx('h-song-tile', selected && 'is-selected', current && !selected && 'is-current')}
      data-id={placement.id}
      style={{ left: placement.bar * w, width, '--tile': `var(--c${pattern.color})` } as CSSProperties}
    >
      <canvas ref={fades} className="h-song-fades" width={width - 2} height={TILE_H - 2} />
      <span className="h-song-name">{pattern.name}</span>
      <canvas ref={canvas} className="h-song-mini" width={width - 2} height={MINI_H} />
      {repeats.map((at) => (
        <span key={at} className="h-song-notch" style={{ left: at * w - 3 }}>
          <SpriteImage sprite={NOTCH} />
        </span>
      ))}
      <i className="h-song-edge" />
      {handles && <i className="h-song-fade is-in" style={{ left: handleAt(fadeIn) }} />}
      {handles && <i className="h-song-fade is-out" style={{ right: handleAt(fadeOut) }} />}
    </div>
  );
});
