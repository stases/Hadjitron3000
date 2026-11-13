import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, Ref } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { useHint } from './hint';
import { Icon } from './Icon';
import { useOutsidePointer } from './popup';

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  width?: number;
  hint?: string;
  disabled?: boolean;
}

const VISIBLE_ROWS = 10;
const ROW = 16;

/** The paper list with the selection bar; the open select and the gallery both draw it. */
export function SelectList({
  options,
  active,
  style,
  listRef,
  onRowEnter,
  onRowClick,
}: {
  options: Option[];
  active: number;
  style?: CSSProperties;
  listRef?: Ref<HTMLDivElement>;
  onRowEnter?: (index: number) => void;
  onRowClick?: (index: number) => void;
}) {
  return (
    <div className="h-select-list" role="listbox" data-h-popup ref={listRef} style={style}>
      {options.map((o, i) => (
        <div
          key={o.value}
          className={cx('h-select-option', i === active && 'is-active')}
          role="option"
          aria-selected={i === active}
          onPointerEnter={() => onRowEnter?.(i)}
          onClick={() => onRowClick?.(i)}
        >
          {o.label}
        </div>
      ))}
    </div>
  );
}

export function Select({ value, options, onChange, width = 120, hint, disabled }: SelectProps) {
  const hover = useHint(hint);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const index = options.findIndex((o) => o.value === value);
  const current = options[index];

  useOutsidePointer(open, () => setOpen(false), field);

  useLayoutEffect(() => {
    if (!open || !field.current || !list.current) return;
    const r = field.current.getBoundingClientRect();
    const h = list.current.offsetHeight;
    const below = r.bottom + h <= innerHeight;
    setPlace({ left: Math.round(r.left), top: Math.round(below ? r.bottom : r.top - h) });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const row = list.current?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, index));
    setPlace(null);
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    if (options[i] && options[i].value !== value) onChange(options[i].value);
  };
  const jump = (from: number, letter: string) => {
    for (let k = 1; k <= options.length; k++) {
      const i = (from + k) % options.length;
      if (options[i].label.toLowerCase().startsWith(letter)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const at = open ? active : index;
    const move = (i: number) => (open ? setActive(i) : choose(i));
    const last = options.length - 1;
    if (e.key === 'ArrowDown' && e.altKey) {
      if (open) choose(active);
      else show();
    } else if (e.key === 'ArrowDown') move(Math.min(last, at + 1));
    else if (e.key === 'ArrowUp') move(Math.max(0, at - 1));
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(last);
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4') {
      if (open) choose(active);
      else show();
    } else if (e.key === 'Escape' && open) setOpen(false);
    else if (e.key === 'Tab' && open) {
      setOpen(false);
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const i = jump(at, e.key.toLowerCase());
      if (i < 0) return;
      move(i);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={field}
      className={cx('h-select', open && 'is-open', disabled && 'is-disabled')}
      style={{ width }}
      role="combobox"
      aria-expanded={open}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0 || !e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        if (open) setOpen(false);
        else show();
      }}
      onKeyDown={onKeyDown}
      {...hover.props}
    >
      <span className={cx('h-select-text', disabled && 'h-engraved')}>{current?.label ?? ''}</span>
      <span className="h-select-button">
        <Icon name="caret-down" />
      </span>
      {open &&
        createPortal(
          <SelectList
            options={options}
            active={active}
            listRef={list}
            style={{
              position: 'fixed',
              width,
              maxHeight: VISIBLE_ROWS * ROW + 2,
              left: place?.left ?? 0,
              top: place?.top ?? 0,
              visibility: place ? undefined : 'hidden',
            }}
            onRowEnter={setActive}
            onRowClick={choose}
          />,
          document.body,
        )}
    </div>
  );
}
