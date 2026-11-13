import { useLayoutEffect, useRef } from 'react';
import type { DependencyList, ReactNode } from 'react';
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
    if (!live) return;
    let frame = requestAnimationFrame(function loop() {
      paint();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [width, height, live, ...deps]);

  return (
    <div className="h-display">
      <canvas ref={canvas} width={width} height={height} style={{ width, height }} />
    </div>
  );
}

const SCOPE_SAMPLES = 1024;

/** A live scope: each column shows the range of the samples that fall into it, joined to its neighbour. */
export function Scope({ read, width, height }: { read: (buf: Float32Array) => void; width: number; height: number }) {
  const buf = useRef(new Float32Array(SCOPE_SAMPLES));
  return (
    <Display
      width={width}
      height={height}
      live
      draw={(g, w, h) => {
        const mid = Math.floor(h / 2);
        g.fillStyle = tokenColor('--amber-dim');
        for (let x = 0; x < w; x += 2) g.fillRect(x, mid, 1, 1);
        read(buf.current);
        const s = buf.current;
        const y = (v: number) => Math.min(h - 1, Math.max(0, Math.round(mid - v * (mid - 1))));
        g.fillStyle = tokenColor('--amber');
        let prev = y(s[0]);
        for (let x = 0; x < w; x++) {
          const i0 = Math.floor((x * s.length) / w);
          const i1 = Math.max(i0 + 1, Math.floor(((x + 1) * s.length) / w));
          let top = prev;
          let bottom = prev;
          for (let i = i0; i < i1; i++) {
            const v = y(s[i]);
            top = Math.min(top, v);
            bottom = Math.max(bottom, v);
          }
          g.fillRect(x, top, 1, bottom - top + 1);
          prev = y(s[i1 - 1]);
        }
      }}
    />
  );
}

/** Thresholds in dB of the twelve meter segments; the top two are over full scale. */
const SEGMENTS_DB = [-48, -39, -32, -26, -21, -16, -12, -9, -6, -3, 0, 3];
const RED_FROM = 10;
const PEAK_HOLD_MS = 900;
const PEAK_FALL_MS = 90;

export function Meter({ read, width = 74, height = 30 }: { read: () => [number, number]; width?: number; height?: number }) {
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
        const pitch = Math.floor((w - 2) / SEGMENTS_DB.length);
        const left = Math.floor((w - pitch * SEGMENTS_DB.length + 2) / 2);
        const rowH = Math.floor((h - 10) / 2);
        const top = Math.floor((h - rowH * 2 - 4) / 2);
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
            g.fillRect(left + i * pitch, top + ch * (rowH + 4), pitch - 2, rowH);
          });
        });
      }}
    />
  );
}
