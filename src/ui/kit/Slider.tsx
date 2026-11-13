import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { cx } from './cx';
import { setHint, useHint } from './hint';
import { SpriteImage } from './Icon';
import type { Sprite } from './icons';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  vertical?: boolean;
  /** A short horizontal trackbar with a small thumb and no ticks, for tight rows. */
  small?: boolean;
  length?: number;
  label?: string;
  display?: string;
  hint?: string;
  disabled?: boolean;
  /** Something else moves the value (automation in the Song): the groove glows amber. */
  automated?: boolean;
}

const THUMB_ROWS = [
  'hhhhhhhhhhk',
  'hFFFFFFFFlk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  'hFffffffflk',
  '.hFffffflk.',
  '..hFffflk..',
  '...hFflk...',
  '....hlk....',
  '.....k.....',
];
const COLORS = { h: 'var(--hi)', F: 'var(--face-hi)', f: 'var(--face)', l: 'var(--lo)', k: 'var(--ink)' };
const THUMB: Sprite = { rows: THUMB_ROWS, colors: COLORS };
const THUMB_VERTICAL: Sprite = {
  rows: [...THUMB_ROWS[0]].map((_, x) => THUMB_ROWS.map((row) => row[x]).join('')),
  colors: COLORS,
};
const SMALL_THUMB: Sprite = {
  rows: ['hhhhhhk', 'hFFFFlk', ...Array<string>(11).fill('hFffflk'), 'hlllllk', 'kkkkkkk'],
  colors: COLORS,
};
const TICKS = 11;
const KEY_STEP = 0.02;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The Windows 98 trackbar: a groove, a pointed thumb and tick marks. Value 0..1, up and right are more. */
export function Slider(props: SliderProps) {
  const { value, onChange, vertical, small, length = 120, label, display, hint, disabled, automated } = props;
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null);
  const hover = useHint(hint);
  const [dragging, setDragging] = useState(false);
  const thumbW = small ? 7 : 11;
  const travel = length - thumbW;
  const offset = Math.round(clamp01(value) * travel);
  const caption = label ? `${label}: ${display ?? ''}` : (display ?? '');

  useEffect(() => {
    if (dragging && caption) setHint(caption);
  }, [dragging, caption]);

  const along = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return vertical ? r.bottom - e.clientY : e.clientX - r.left;
  };
  const moveTo = (pos: number) => {
    const v = clamp01(pos / travel);
    if (v !== value) onChange(v);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = along(e);
    const onThumb = p >= offset && p < offset + thumbW;
    grab.current = onThumb ? p - offset : Math.floor(thumbW / 2);
    if (!onThumb) moveTo(p - grab.current);
    setDragging(true);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? KEY_STEP / 10 : KEY_STEP;
    const to: Record<string, number> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + 0.1,
      PageDown: value - 0.1,
      Home: 0,
      End: 1,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    const v = clamp01(to[e.key]);
    if (v !== value) onChange(v);
  };

  const ticks = small
    ? []
    : Array.from({ length: TICKS }, (_, i) => Math.floor(thumbW / 2) + Math.round((i * travel) / (TICKS - 1)));
  return (
    <div
      className={cx(
        'h-slider', vertical && 'is-vertical', small && 'is-small', disabled && 'is-disabled', automated && 'is-automated',
      )}
    >
      {(label || display) && !vertical && (
        <div className="h-slider-caption">
          <span className={cx('h-slider-label', disabled && 'h-engraved')}>{label}</span>
          <span className={cx('h-slider-value', disabled && 'h-engraved')}>{display}</span>
        </div>
      )}
      <div
        ref={track}
        className="h-slider-track"
        style={vertical ? { height: length } : { width: length }}
        role="slider"
        aria-label={label}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={display}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => grab.current !== null && moveTo(along(e) - grab.current)}
        onLostPointerCapture={() => {
          grab.current = null;
          setDragging(false);
          setHint(hover.over.current ? (hint ?? null) : null);
        }}
        {...hover.props}
        onKeyDown={onKeyDown}
      >
        <i className="h-slider-groove" />
        {ticks.map((t) => (
          <i key={t} className="h-slider-tick" style={vertical ? { bottom: t } : { left: t }} />
        ))}
        <span className="h-slider-thumb" style={vertical ? { bottom: offset } : { left: offset }}>
          <SpriteImage sprite={small ? SMALL_THUMB : vertical ? THUMB_VERTICAL : THUMB} />
        </span>
      </div>
      {(label || display) && vertical && (
        <div className="h-slider-caption">
          <span className={cx('h-slider-label', disabled && 'h-engraved')}>{label}</span>
          <span className={cx('h-slider-value', disabled && 'h-engraved')}>{display}</span>
        </div>
      )}
    </div>
  );
}
