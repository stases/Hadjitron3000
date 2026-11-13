import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './cx';

interface TabsProps {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, value, onChange }: TabsProps) {
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.id);
    (e.currentTarget.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="h-tabs" role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          className={cx('h-tab', t.id === value && 'is-selected')}
          onPointerDown={() => onChange(t.id)}
        >
          <span className="h-tab-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The raised page under a row of Tabs. */
export function TabPage({ children }: { children?: ReactNode }) {
  return (
    <div className="h-tabpage" role="tabpanel">
      {children}
    </div>
  );
}
