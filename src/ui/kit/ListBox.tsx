import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { cx } from './cx';
import { useHint } from './hint';
import { ColorChip, Icon } from './Icon';
import type { IconName } from './icons';

export type ListItem =
  | { id: string; label: string; color?: number; icon?: IconName; detail?: string; indent?: boolean }
  | { header: string };

interface ListBoxProps {
  items: ListItem[];
  value: string | null;
  onChange: (id: string) => void;
  onActivate?: (id: string) => void;
  height?: number;
  hint?: string;
}

export function ListBox({ items, value, onChange, onActivate, height, hint }: ListBoxProps) {
  const root = useRef<HTMLDivElement>(null);
  const hover = useHint(hint);
  const ids = items.flatMap((item) => ('id' in item ? [item.id] : []));

  useLayoutEffect(() => {
    root.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [value]);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = value === null ? -1 : ids.indexOf(value);
    const page = Math.max(1, Math.floor((root.current?.clientHeight ?? 0) / 16) - 1);
    const to: Record<string, number> = {
      ArrowDown: i + 1,
      ArrowUp: i < 0 ? 0 : i - 1,
      PageDown: i + page,
      PageUp: i - page,
      Home: 0,
      End: ids.length - 1,
    };
    if (e.key === 'Enter' && value !== null) onActivate?.(value);
    else if (e.key in to && ids.length) {
      const next = ids[Math.min(ids.length - 1, Math.max(0, to[e.key]))];
      if (next !== value) onChange(next);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="h-listbox" role="listbox" tabIndex={0} style={{ height }} onKeyDown={onKeyDown} {...hover.props}>
      <div className="h-listbox-scroll" ref={root}>
        {items.map((item, i) =>
          'header' in item ? (
            <div key={`h${i}`} className="h-list-header" role="presentation">
              {item.header}
            </div>
          ) : (
            <div
              key={item.id}
              className={cx('h-list-row', item.id === value && 'is-selected', item.indent && 'is-indented')}
              role="option"
              aria-selected={item.id === value}
              onPointerDown={() => item.id !== value && onChange(item.id)}
              onDoubleClick={() => onActivate?.(item.id)}
            >
              {item.color !== undefined && <ColorChip color={item.color} />}
              {item.icon && <Icon name={item.icon} />}
              <span className="h-list-label">{item.label}</span>
              {item.detail && <span className="h-list-detail">{item.detail}</span>}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
