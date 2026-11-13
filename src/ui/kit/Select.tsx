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

/** An option, or the title of the options below it, which cannot be chosen. */
export type SelectItem = Option | { heading: string };
/** A row of the open list: an item, or the More… row that shows the hidden items. */
type Row = SelectItem | 'more';

interface SelectProps {
  value: string;
  options: SelectItem[];
  /** Items kept behind a More… row at the end of the list until it is chosen or the value is one of them. */
  more?: SelectItem[];
  onChange: (value: string) => void;
  width?: number;
  hint?: string;
  disabled?: boolean;
}

const VISIBLE_ROWS = 10;
const ROW = 16;

const isOption = (row: Row | undefined): row is Option => typeof row === 'object' && 'value' in row;
const selectable = (row: Row | undefined) => row === 'more' || isOption(row);

/** The paper list with the selection bar; the open select and the gallery both draw it. */
export function SelectList({
  options,
  active,
  style,
  listRef,
  onRowEnter,
  onRowClick,
}: {
  options: Row[];
  active: number;
  style?: CSSProperties;
  listRef?: Ref<HTMLDivElement>;
  onRowEnter?: (index: number) => void;
  onRowClick?: (index: number) => void;
}) {
  return (
    <div
      className="h-select-list"
      role="listbox"
      data-h-popup
      ref={listRef}
      style={style}
      onPointerDown={(e) => e.preventDefault()}
    >
      {options.map((o, i) =>
        typeof o === 'object' && 'heading' in o ? (
          <div key={`heading:${o.heading}`} className="h-select-heading" role="presentation">
            {o.heading}
          </div>
        ) : (
          <div
            key={o === 'more' ? 'more' : o.value}
            className={cx('h-select-option', i === active && 'is-active')}
            role="option"
            aria-selected={i === active}
            onPointerEnter={() => onRowEnter?.(i)}
            onClick={() => onRowClick?.(i)}
          >
            {o === 'more' ? 'More…' : o.label}
          </div>
        ),
      )}
    </div>
  );
}

export function Select({ value, options, more = [], onChange, width = 120, hint, disabled }: SelectProps) {
  const hover = useHint(hint);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const values = [...options, ...more].filter(isOption);
  const index = values.findIndex((o) => o.value === value);
  const current = values[index];
  const rowsFor = (all: boolean): Row[] => (all ? [...options, ...more] : more.length ? [...options, 'more'] : options);
  const rows = rowsFor(expanded);

  useOutsidePointer(open, () => setOpen(false), field);

  useLayoutEffect(() => {
    if (!open || !field.current || !list.current) return;
    const r = field.current.getBoundingClientRect();
    const h = list.current.offsetHeight;
    const below = r.bottom + h <= innerHeight;
    setPlace({ left: Math.round(r.left), top: Math.round(below ? r.bottom : r.top - h) });
  }, [open, expanded]);

  useLayoutEffect(() => {
    if (!open) return;
    const row = list.current?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    const all = more.some((o) => isOption(o) && o.value === value);
    const at = rowsFor(all).findIndex((o) => isOption(o) && o.value === value);
    setExpanded(all);
    setActive(at >= 0 ? at : rowsFor(all).findIndex(selectable));
    setPlace(null);
    setOpen(true);
  };
  const pick = (row: Row | undefined) => {
    if (row === 'more') {
      setExpanded(true);
      setActive(rowsFor(true).findIndex((o, i) => i >= options.length && isOption(o)));
      return;
    }
    if (!isOption(row)) return;
    setOpen(false);
    if (row.value !== value) onChange(row.value);
  };
  const choose = (i: number) => pick(rows[i]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Open, the keys move through the rows of the list; closed, through every option.
    const nav: Row[] = open ? rows : values;
    const at = open ? active : index;
    const move = (i: number) => (i < 0 ? undefined : open ? setActive(i) : pick(nav[i]));
    const step = (from: number, dir: 1 | -1) => {
      for (let i = from + dir; i >= 0 && i < nav.length; i += dir) if (selectable(nav[i])) return i;
      return from;
    };
    const jump = (letter: string) => {
      for (let k = 1; k <= nav.length; k++) {
        const i = (at + k) % nav.length;
        const row = nav[i];
        if (isOption(row) && row.label.toLowerCase().startsWith(letter)) return i;
      }
      return -1;
    };
    if (e.key === 'ArrowDown' && e.altKey) {
      if (open) choose(active);
      else show();
    } else if (e.key === 'ArrowDown') move(step(at, 1));
    else if (e.key === 'ArrowUp') move(step(at, -1));
    else if (e.key === 'Home') move(step(-1, 1));
    else if (e.key === 'End') move(step(nav.length, -1));
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4') {
      if (open) choose(active);
      else show();
    } else if (e.key === 'Escape' && open) setOpen(false);
    else if (e.key === 'Tab' && open) {
      setOpen(false);
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const i = jump(e.key.toLowerCase());
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
            options={rows}
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
