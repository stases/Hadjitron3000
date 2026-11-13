import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  SHAPE_POINTS, STOCK_SHAPES, decodeShape, encodeShape, smoothShape, strokeShape,
} from '../../core/shape';
import { beginGesture, commitGesture, setParam } from '../../state/store';
import type { Owner } from '../../state/store';
import { Button, Display, tokenColor, useHint } from '../kit';
import { PARAM_HINTS } from './hints';

const WIDTH = 180;
const HEIGHT = 60;
const MID = (HEIGHT - 1) / 2;
const HALF = MID - 2;
// While a stroke goes on, the sound follows the drawing this often.
const FOLLOW_MS = 100;

const STOCK = [
  ['sine', 'Sine'],
  ['sawtooth', 'Saw'],
  ['square', 'Square'],
  ['triangle', 'Triangle'],
] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const yOf = (v: number) => Math.round(MID - v * HALF);

/** The drawn line at `x`, from the points joined by straight lines round the cycle. */
function valueAt(points: readonly number[], x: number): number {
  const u = (x / WIDTH) * SHAPE_POINTS;
  const i = Math.floor(u);
  return points[i % SHAPE_POINTS] + (points[(i + 1) % SHAPE_POINTS] - points[i % SHAPE_POINTS]) * (u - i);
}

interface Stroke {
  points: number[];
  /** The points before the stroke, which a straight line starts again from. */
  before: number[];
  anchor: [number, number];
  last: [number, number];
  timer?: number;
}

/**
 * One cycle of a drawn wave, drawn with the mouse: dragging sets the height under the pointer and joins up fast
 * moves, Shift draws a straight line from where the stroke began. Buttons start it again from a stock wave or soften
 * it.
 */
export function ShapeEditor({ owner, id, value }: { owner: Owner; id: string; value: string }) {
  const [draft, setDraft] = useState<number[] | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const points = draft ?? decodeShape(value)!;
  const hover = useHint(PARAM_HINTS.osc[id]);
  const store = (p: readonly number[]) => setParam(owner, 'source', id, encodeShape(p));

  const at = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.querySelector('canvas')!.getBoundingClientRect();
    const i = clamp(Math.round(((e.clientX - r.left) / WIDTH) * SHAPE_POINTS), 0, SHAPE_POINTS - 1);
    return [i, clamp((MID - (e.clientY - r.top)) / HALF, -1, 1)];
  };
  const follow = () => {
    const s = stroke.current!;
    s.timer = undefined;
    store(s.points);
  };
  const drawn = (s: Stroke) => {
    setDraft([...s.points]);
    s.timer ??= window.setTimeout(follow, FOLLOW_MS);
  };
  const end = () => {
    const s = stroke.current;
    if (!s) return;
    clearTimeout(s.timer);
    store(s.points);
    commitGesture();
    stroke.current = null;
    setDraft(null);
  };

  return (
    <div className="h-factory-cell is-display h-factory-shape">
      <div
        className="h-factory-shape-draw"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          beginGesture();
          const p = at(e);
          const s: Stroke = { points: [...points], before: [...points], anchor: p, last: p };
          strokeShape(s.points, ...p, ...p);
          stroke.current = s;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawn(s);
        }}
        onPointerMove={(e) => {
          const s = stroke.current;
          if (!s) return;
          const p = at(e);
          if (e.shiftKey) {
            s.points = [...s.before];
            strokeShape(s.points, ...s.anchor, ...p);
          } else {
            strokeShape(s.points, ...s.last, ...p);
          }
          s.last = p;
          drawn(s);
        }}
        onPointerUp={end}
        onLostPointerCapture={end}
        {...hover.props}
      >
        <Display
          width={WIDTH}
          height={HEIGHT}
          deps={[points]}
          draw={(g, w, h) => {
            g.fillStyle = tokenColor('--amber-dim');
            for (let x = 0; x < w; x += 2) g.fillRect(x, yOf(0), 1, 1);
            for (const k of [1, 2, 3]) for (let y = 0; y < h; y += 4) g.fillRect(Math.round((k * w) / 4), y, 1, 1);
            g.fillStyle = tokenColor('--amber');
            let prev = yOf(valueAt(points, 0));
            for (let x = 0; x < w; x++) {
              const next = yOf(valueAt(points, x + 1));
              const top = Math.min(prev, next);
              g.fillRect(x, top, 1, Math.max(prev, next) - top + 1);
              prev = next;
            }
          }}
        />
      </div>
      <div className="h-factory-shape-tools">
        {STOCK.map(([wave, label]) => (
          <Button
            key={wave}
            small
            onClick={() => store(STOCK_SHAPES[wave])}
            hint={`Starts the drawing again from a ${label.toLowerCase()} wave.`}
          >
            {label}
          </Button>
        ))}
        <Button
          small
          onClick={() => store(smoothShape(points))}
          hint="Softens the drawing a little; press again for more."
        >
          Smooth
        </Button>
      </div>
    </div>
  );
}
