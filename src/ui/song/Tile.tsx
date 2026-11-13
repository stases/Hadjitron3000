import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { STEPS_PER_BAR } from '../../core/defaults';
import type { Channel, Pattern, Placement, Step } from '../../core/types';
import { tokenColor } from '../kit';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';
import { BAR_W } from './song';

const MINI_H = 36;
const ROW_PITCH = 4;
/** The steps of one bar are spread over this many pixels of its 28px cell. */
const BAR_SPAN = 27;

const NOTCH = {
  rows: ['kkkkk', '.kkk.', '..k..'],
  colors: { k: 'var(--ink)' },
};

/** Left edge of absolute step `t` of the tile, in pixels from its inner edge; every bar stays over its cell. */
function stepX(t: number): number {
  return Math.floor(t / STEPS_PER_BAR) * BAR_W + Math.floor(((t % STEPS_PER_BAR) * BAR_SPAN) / STEPS_PER_BAR);
}

/** One row per channel with steps, in channel order; each step a run of ink, the block repeated over the tile. */
function drawMiniature(canvas: HTMLCanvasElement, rows: Record<number, Step>[], blockSteps: number, steps: number) {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = tokenColor('--ink');
  const pitch = Math.max(1, Math.min(ROW_PITCH, Math.floor((MINI_H + 1) / rows.length)));
  const height = pitch > 2 ? pitch - 1 : 1;
  const top = Math.max(0, Math.floor((MINI_H - rows.length * pitch + pitch - height) / 2));
  rows.forEach((cells, row) => {
    const y = top + row * pitch;
    if (y + height > MINI_H) return;
    for (const key in cells) {
      const s = Number(key);
      if (s >= blockSteps) continue;
      const len = Math.min(cells[s].len, blockSteps - s);
      for (let start = s; start < steps; start += blockSteps) {
        const x = stepX(start);
        g.fillRect(x, y, stepX(Math.min(start + len, steps) - 1) + 1 - x, height);
      }
    }
  });
}

interface TileProps {
  placement: Placement;
  pattern: Pattern;
  channels: Channel[];
  selected: boolean;
  current: boolean;
}

/** A placement on the timeline: a raised key in its block's colour with the name and a miniature of the steps. */
export const Tile = memo(function Tile({ placement, pattern, channels, selected, current }: TileProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = placement.bars * BAR_W - 2;
  const blockSteps = pattern.bars * STEPS_PER_BAR;
  const steps = placement.bars * STEPS_PER_BAR;
  const rows = useMemo(
    () =>
      channels.flatMap((c) => {
        const cells = pattern.cells[c.id];
        return cells && Object.keys(cells).some((key) => Number(key) < blockSteps) ? [cells] : [];
      }),
    [channels, pattern.cells, blockSteps],
  );

  useLayoutEffect(() => drawMiniature(canvas.current!, rows, blockSteps, steps), [rows, blockSteps, steps]);

  const starts = Math.ceil(placement.bars / pattern.bars);
  const repeats = Array.from({ length: starts - 1 }, (_, i) => (i + 1) * pattern.bars);
  return (
    <div
      className={cx('h-song-tile', selected && 'is-selected', current && !selected && 'is-current')}
      data-id={placement.id}
      style={{ left: placement.bar * BAR_W, width, '--tile': `var(--c${pattern.color})` } as CSSProperties}
    >
      <span className="h-song-name">{pattern.name}</span>
      <canvas ref={canvas} className="h-song-mini" width={width - 2} height={MINI_H} />
      {repeats.map((bar) => (
        <span key={bar} className="h-song-notch" style={{ left: bar * BAR_W - 3 }}>
          <SpriteImage sprite={NOTCH} />
        </span>
      ))}
      <i className="h-song-edge" />
    </div>
  );
});
