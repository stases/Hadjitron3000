import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { cx } from './cx';
import { setHint, useHint } from './hint';
import { Icon } from './Icon';

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  width?: number;
  hint?: string;
  disabled?: boolean;
}

const REPEAT_DELAY = 400;
const REPEAT_EVERY = 50;
const DRAG_PX = 3;

export function Stepper({ value, min, max, step = 1, onChange, format, width = 64, hint, disabled }: StepperProps) {
  const hover = useHint(hint);
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const show = format ?? ((v: number) => v.toFixed(decimals));
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [editing, setEditing] = useState<string | null>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const repeat = useRef(0);

  const fit = (v: number) => {
    const snapped = min + Math.round((v - min) / step) * step;
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
  };
  const set = (v: number) => {
    const next = fit(v);
    if (next !== latest.current.value) latest.current.onChange(next);
    latest.current.value = next;
  };
  const stopRepeat = () => clearTimeout(repeat.current);
  useEffect(() => stopRepeat, []);

  const spin = (dir: 1 | -1) => (e: PointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    set(latest.current.value + dir * step);
    const again = (delay: number) => {
      repeat.current = window.setTimeout(() => {
        set(latest.current.value + dir * step);
        again(REPEAT_EVERY);
      }, delay);
    };
    again(REPEAT_DELAY);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || editing !== null) return;
    const delta: Record<string, number> = { ArrowUp: step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 };
    if (e.key in delta) set(value + delta[e.key]);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else if (e.key === 'Enter' || e.key === 'F2') setEditing(show(value));
    else return;
    e.preventDefault();
  };

  const commit = (text: string) => {
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v)) set(v);
    setEditing(null);
  };

  return (
    <div
      className={cx('h-stepper', disabled && 'is-disabled')}
      style={{ width }}
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={show(value)}
      aria-disabled={disabled}
      tabIndex={disabled || editing !== null ? -1 : 0}
      onKeyDown={onKeyDown}
      {...hover.props}
    >
      {editing !== null ? (
        <input
          className="h-stepper-input"
          value={editing}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value);
            else if (e.key === 'Escape') setEditing(null);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      ) : (
        <span
          className={cx('h-stepper-readout', disabled && 'h-engraved')}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const steps = Math.trunc((d.y - e.clientY) / DRAG_PX);
            if (!steps) return;
            d.y -= steps * DRAG_PX;
            d.moved = true;
            set(latest.current.value + steps * step);
            setHint(show(latest.current.value));
          }}
          onLostPointerCapture={() => {
            if (drag.current?.moved) setHint(hover.over.current ? (hint ?? null) : null);
            drag.current = null;
          }}
          onDoubleClick={() => !disabled && setEditing(show(value))}
        >
          {show(value)}
        </span>
      )}
      <span className="h-stepper-buttons">
        <span className="h-spin is-up" onPointerDown={spin(1)} onLostPointerCapture={stopRepeat}>
          <Icon name="spin-up" />
        </span>
        <span className="h-spin is-down" onPointerDown={spin(-1)} onLostPointerCapture={stopRepeat}>
          <Icon name="spin-down" />
        </span>
      </span>
    </div>
  );
}
