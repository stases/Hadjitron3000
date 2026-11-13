import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { cx } from './cx';
import { setHint, useHint } from './hint';
import { tokenColor } from './pixels';

interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  defaultValue?: number;
  label: string;
  display: string;
  hint?: string;
  small?: boolean;
  /** Caption and value to the right of the knob instead of under it, for toolbars. */
  side?: boolean;
  steps?: number;
  disabled?: boolean;
  /** The ring lights from the centre outwards, for values whose middle is zero. */
  bipolar?: boolean;
  /** Something else moves the value (automation in the Song): the ring glows like a display. */
  automated?: boolean;
}

const DRAG_RANGE = 150;
const WHEEL_STEP = 0.02;
const KEY_STEP = 0.02;
const FINE = 0.1;
const WHEEL_END_MS = 300;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function Knob(props: KnobProps) {
  const { value, label, display, hint, small, side, steps, disabled, bipolar, automated } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const drag = useRef<{ y: number; raw: number; start: number; last: number } | null>(null);
  const hover = useHint(hint);
  const [dragging, setDragging] = useState(false);
  const size = small ? 28 : 36;

  useLayoutEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (g) drawKnob(g, size, value, !!disabled, !!bipolar, !!automated);
  }, [size, value, disabled, bipolar, automated]);

  useEffect(() => {
    if (dragging) setHint(`${label}: ${display}`);
  }, [dragging, label, display]);

  const quantize = (v: number) => {
    const n = latest.current.steps;
    return n && n > 1 ? Math.round(clamp01(v) * (n - 1)) / (n - 1) : clamp01(v);
  };
  const set = (v: number) => {
    const q = quantize(v);
    if (q !== latest.current.value) latest.current.onChange(q);
    return q;
  };
  const end = (v: number) => latest.current.onChangeEnd?.(v);

  useEffect(() => {
    const el = root.current;
    if (!el || disabled) return;
    let raw: number | null = null;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = Math.sign(e.deltaY || e.deltaX) * -1;
      if (!dir) return;
      const n = latest.current.steps;
      raw ??= latest.current.value;
      raw = clamp01(raw + dir * (n && n > 1 ? 1 / (n - 1) : e.shiftKey ? WHEEL_STEP * FINE : WHEEL_STEP));
      const v = set(raw);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        raw = null;
        end(v);
      }, WHEEL_END_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, [disabled]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, raw: value, start: value, last: value };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.raw = clamp01(d.raw + ((d.y - e.clientY) / DRAG_RANGE) * (e.shiftKey ? FINE : 1));
    d.y = e.clientY;
    d.last = set(d.raw);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    setHint(hover.over.current ? (hint ?? null) : null);
    if (d.last !== d.start) end(d.last);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const n = steps && steps > 1 ? 1 / (steps - 1) : e.shiftKey ? KEY_STEP * FINE : KEY_STEP;
    const next: Record<string, number> = {
      ArrowUp: value + n,
      ArrowRight: value + n,
      ArrowDown: value - n,
      ArrowLeft: value - n,
      PageUp: value + 0.1,
      PageDown: value - 0.1,
      Home: 0,
      End: 1,
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    end(set(next[e.key]));
  };

  return (
    <div
      ref={root}
      className={cx(
        'h-knob', small && 'is-small', side && 'is-side', disabled && 'is-disabled', automated && 'is-automated',
      )}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value}
      aria-valuetext={display}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onLostPointerCapture={onPointerUp}
      {...hover.props}
      onDoubleClick={() => {
        const d = latest.current.defaultValue;
        if (d !== undefined && !disabled) end(set(d));
      }}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvas} width={size} height={size} />
      <span className={cx('h-knob-label', disabled && 'h-engraved')}>{label}</span>
      <span className={cx('h-knob-value', disabled && 'h-engraved')}>{display}</span>
    </div>
  );
}

/**
 * The knob at CSS-pixel resolution: dot ring, putty cap with light upper-left edge, ink pointer. An automated knob's
 * ring is lit in full amber over dim amber dots.
 */
function drawKnob(
  g: CanvasRenderingContext2D, size: number, value: number, disabled: boolean, bipolar: boolean, automated: boolean,
) {
  const ink = tokenColor('--ink');
  const hi = tokenColor('--hi');
  const lo = tokenColor('--lo');
  const face = tokenColor('--face');
  const faceHi = tokenColor('--face-hi');
  const faceLo = tokenColor('--face-lo');
  const c = size / 2;
  const r = size === 36 ? 12 : 9;
  const ring = size === 36 ? 16 : 12.5;
  g.clearRect(0, 0, size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const light = -(dx + dy) / (d * Math.SQRT2 || 1);
      let col = face;
      if (d > r - 1) col = ink;
      else if (d > r - 2) col = light > 0.3 ? hi : light < -0.3 ? lo : faceHi;
      else if (d > r - 3) col = light > 0.6 ? faceHi : light < -0.6 ? faceLo : face;
      else if (light > 0 && d > r * 0.3 && d < r * 0.75 && dx + dy < -r * 0.6 && (x + y) % 2 === 0) col = faceHi;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }

  const lit = disabled ? lo : tokenColor(automated ? '--amber' : '--amber-mid');
  const unlit = automated && !disabled ? tokenColor('--amber-dim') : lo;
  const from = bipolar ? Math.min(value, 0.5) : 0;
  const to = bipolar ? Math.max(value, 0.5) : value;
  for (let i = 0; i <= 10; i++) {
    const a = (0.75 + (1.5 * i) / 10) * Math.PI;
    g.fillStyle = !disabled && i / 10 >= from - 1e-6 && i / 10 <= to + 1e-6 ? lit : unlit;
    g.fillRect(Math.floor(c + Math.cos(a) * ring), Math.floor(c + Math.sin(a) * ring), 1, 1);
    if (i % 5 === 0) g.fillRect(Math.floor(c + Math.cos(a) * (ring + 1)), Math.floor(c + Math.sin(a) * (ring + 1)), 1, 1);
  }

  // The pointer: every pixel whose centre lies within 0.95 px of the segment from the hub towards the rim.
  const a = (0.75 + 1.5 * value) * Math.PI;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  g.fillStyle = disabled ? lo : ink;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const along = dx * ux + dy * uy;
      if (along >= 2 && along <= r - 3 && Math.abs(dx * uy - dy * ux) <= 0.95) g.fillRect(x, y, 1, 1);
    }
  }
}
