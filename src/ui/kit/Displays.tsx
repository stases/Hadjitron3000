import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DependencyList, ReactNode } from 'react';
import { DIVISIONS } from '../../core/scope';
import type { Sweep } from '../../core/scope';
import { cx } from './cx';
import { useHint } from './hint';
import { tokenColor } from './pixels';

export function Lcd({ big, children }: { big?: boolean; children: ReactNode }) {
  return <div className={cx('h-lcd', big && 'is-big')}>{children}</div>;
}

type LedColor = number | 'red' | 'green' | 'amber';

interface LedProps {
  on: boolean;
  color?: LedColor;
  onClick?: () => void;
  hint?: string;
}

export function Led({ on, color = 'red', onClick, hint }: LedProps) {
  const hover = useHint(hint);
  const lamp = typeof color === 'number' ? `c${color}` : color;
  const className = cx('h-led', `is-${lamp}`, on && 'is-on');
  if (!onClick) return <i className={className} {...hover.props} />;
  return (
    <button type="button" className={className} aria-pressed={on} onClick={onClick} {...hover.props} />
  );
}

interface DisplayProps {
  width: number;
  height: number;
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
  deps?: DependencyList;
  live?: boolean;
}

/** An amber display: a canvas at exactly width x height CSS pixels, cleared to --crt before every draw. */
export function Display({ width, height, draw, deps = [], live }: DisplayProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useLayoutEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    const paint = () => {
      g.fillStyle = tokenColor('--crt');
      g.fillRect(0, 0, width, height);
      drawRef.current(g, width, height);
    };
    paint();
    // Frames come from the window the display is in, which may be another one than the app's, such as the Guide
    // Book's own window: a window in the background slows its frames down.
    const view = g.canvas.ownerDocument.defaultView;
    if (!live || !view) return;
    let frame = view.requestAnimationFrame(function loop() {
      paint();
      frame = view.requestAnimationFrame(loop);
    });
    return () => view.cancelAnimationFrame(frame);
  }, [width, height, live, ...deps]);

  return (
    <div className="h-display">
      <canvas ref={canvas} width={width} height={height} style={{ width, height }} />
    </div>
  );
}

const SCOPE_SAMPLES = 1024;
const GRID_ROWS = 8;
/** Full-scale levels a bench scope steps through, as a real one steps its volts per division. */
const RANGES = [0.05, 0.1, 0.2, 0.5, 1, 2, 5];
const SILENCE = 0.003;
/** A bench trace holds when its level falls below this share of the loudest sweep since it started running... */
const HOLD_BELOW = 1 / 4;
/** ...and runs again when the level rises to this many times the quietest since. */
const RUN_ABOVE = 2;
/** The held trace dims in hard steps, by milliseconds since it was held, and then clears. */
const AFTERGLOW: [number, string][] = [
  [1500, '--amber-mid'],
  [3000, '--amber-dim'],
];

/** Dotted division lines, the centre lines dotted twice as densely. */
function drawGraticule(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = tokenColor('--amber-dim');
  for (let k = 0; k <= DIVISIONS; k++) {
    const x = Math.round((k * (w - 1)) / DIVISIONS);
    for (let y = 0; y < h; y += 2 * k === DIVISIONS ? 2 : 4) g.fillRect(x, y, 1, 1);
  }
  for (let k = 0; k <= GRID_ROWS; k++) {
    const y = Math.round((k * (h - 1)) / GRID_ROWS);
    for (let x = 0; x < w; x += 2 * k === GRID_ROWS ? 2 : 4) g.fillRect(x, y, 1, 1);
  }
}

/**
 * For each column, the top and bottom rows of the trace between the column's edges, with the samples in between
 * interpolated, so that neighbouring columns join up. `range` is the level at the top edge. Returns the peak level.
 */
function traceColumns(s: Float32Array, { start, length }: Sweep, range: number, h: number, cols: Int16Array): number {
  const mid = Math.floor(h / 2);
  const y = (v: number) => Math.min(h - 1, Math.max(0, Math.round(mid - (v / range) * (mid - 1))));
  const at = (p: number) => {
    const i = Math.floor(p);
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (p - i) : s[s.length - 1];
  };
  const w = cols.length / 2;
  let peak = 0;
  let prev = at(start);
  for (let x = 0; x < w; x++) {
    const p1 = start + ((x + 1) * length) / w;
    const next = at(p1);
    let lo = Math.min(prev, next);
    let hi = Math.max(prev, next);
    for (let i = Math.ceil(start + (x * length) / w); i < p1; i++) {
      lo = Math.min(lo, s[i]);
      hi = Math.max(hi, s[i]);
    }
    cols[2 * x] = y(hi);
    cols[2 * x + 1] = y(lo);
    peak = Math.max(peak, hi, -lo);
    prev = next;
  }
  return peak;
}

function drawTrace(g: CanvasRenderingContext2D, cols: Int16Array, color: string) {
  g.fillStyle = tokenColor(color);
  for (let x = 0; 2 * x < cols.length; x++) g.fillRect(x, cols[2 * x], 1, cols[2 * x + 1] - cols[2 * x] + 1);
}

interface Trace {
  cols: Int16Array;
  held: Int16Array;
  range: number;
  /** The loudest level since the trace started running, and the quietest since it was held. */
  peak: number;
  floor: number;
  /** When the trace was held, or null while it runs. */
  heldAt: number | null;
}

/**
 * One frame of a bench scope. The range only grows while a sound plays, so its envelope shows, and starts small
 * again once the held trace has cleared to the resting line.
 */
function drawBench(g: CanvasRenderingContext2D, h: number, s: Float32Array, at: Sweep, t: Trace) {
  let level = traceColumns(s, at, t.range, h, t.cols);
  if (level > t.range) {
    t.range = RANGES.find((r) => r >= level) ?? RANGES[RANGES.length - 1];
    level = traceColumns(s, at, t.range, h, t.cols);
  }
  const running = t.heldAt === null;
  if (level >= SILENCE && (running ? level >= t.peak * HOLD_BELOW : level >= t.floor * RUN_ABOVE)) {
    t.peak = running ? Math.max(t.peak, level) : level;
    t.heldAt = null;
    t.held.set(t.cols);
  } else if (running) {
    t.heldAt = performance.now();
    t.floor = level;
  } else {
    t.floor = Math.min(t.floor, level);
  }
  const heldFor = performance.now() - (t.heldAt ?? Infinity);
  const color = t.heldAt === null ? '--amber' : AFTERGLOW.find(([ms]) => heldFor < ms)?.[1];
  if (color) {
    drawTrace(g, t.held, color);
  } else {
    t.range = RANGES[0];
    g.fillStyle = tokenColor('--amber-mid');
    g.fillRect(0, Math.floor(h / 2), t.cols.length / 2, 1);
  }
}

interface ScopeProps {
  read: (buf: Float32Array) => void;
  width: number;
  height: number;
  samples?: number;
  /**
   * Makes it a bench scope: a graticule, a sweep that starts where this says (see core/scope), and a trace that
   * holds and dims when the sound falls quiet. Without it the whole buffer runs past freely at full scale.
   */
  sweep?: (buf: Float32Array) => Sweep;
}

/** A live scope: each column shows the range of the samples that fall into it, joined to its neighbour. */
export function Scope({ read, width, height, samples = SCOPE_SAMPLES, sweep }: ScopeProps) {
  const buf = useMemo(() => new Float32Array(samples), [samples]);
  const trace = useMemo<Trace>(
    () => ({
      cols: new Int16Array(2 * width),
      held: new Int16Array(2 * width),
      range: RANGES[0],
      peak: 0,
      floor: 0,
      heldAt: -Infinity, // held long ago, so it starts on the resting line
    }),
    [width],
  );
  return (
    <Display
      width={width}
      height={height}
      live
      draw={(g, w, h) => {
        read(buf);
        if (sweep) {
          drawGraticule(g, w, h);
          drawBench(g, h, buf, sweep(buf), trace);
          return;
        }
        g.fillStyle = tokenColor('--amber-dim');
        for (let x = 0; x < w; x += 2) g.fillRect(x, Math.floor(h / 2), 1, 1);
        traceColumns(buf, { start: 0, length: buf.length - 1 }, 1, h, trace.cols);
        drawTrace(g, trace.cols, '--amber');
      }}
    />
  );
}

/** Thresholds in dB of the twelve meter segments; the top two are over full scale. */
const SEGMENTS_DB = [-48, -39, -32, -26, -21, -16, -12, -9, -6, -3, 0, 3];
const RED_FROM = 10;
const PEAK_HOLD_MS = 900;
const PEAK_FALL_MS = 90;

interface MeterProps {
  read: () => [number, number];
  width?: number;
  height?: number;
  /** Segments stacked from the bottom up, left and right side by side, for a mixer strip. */
  vertical?: boolean;
}

export function Meter({ read, width = 74, height = 30, vertical }: MeterProps) {
  const peaks = useRef([
    { seg: -1, at: 0 },
    { seg: -1, at: 0 },
  ]);
  return (
    <Display
      width={width}
      height={height}
      live
      draw={(g, w, h) => {
        const now = performance.now();
        const levels = read();
        const n = SEGMENTS_DB.length;
        const [along, across] = vertical ? [h, w] : [w, h];
        const pitch = Math.floor((along - 2) / n);
        const start = Math.floor((along - pitch * n + 2) / 2);
        const thick = Math.floor((across - 10) / 2);
        const side = Math.floor((across - thick * 2 - 4) / 2);
        levels.forEach((level, ch) => {
          const db = 20 * Math.log10(Math.max(level, 1e-6));
          const count = SEGMENTS_DB.filter((t) => db >= t).length;
          const peak = peaks.current[ch];
          if (count - 1 >= peak.seg) {
            peak.seg = count - 1;
            peak.at = now;
          } else if (now - peak.at > PEAK_HOLD_MS) {
            peak.seg -= 1;
            peak.at = now - PEAK_HOLD_MS + PEAK_FALL_MS;
          }
          SEGMENTS_DB.forEach((_, i) => {
            const red = i >= RED_FROM;
            const lit = i < count || i === peak.seg;
            g.fillStyle = tokenColor(red ? (lit ? '--red' : '--red-off') : lit ? '--amber' : '--amber-dim');
            const a = start + (vertical ? n - 1 - i : i) * pitch;
            const b = side + ch * (thick + 4);
            if (vertical) g.fillRect(b, a, thick, pitch - 2);
            else g.fillRect(a, b, pitch - 2, thick);
          });
        });
      }}
    />
  );
}
