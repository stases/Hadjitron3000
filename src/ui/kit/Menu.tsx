import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { cx } from './cx';
import { setHint } from './hint';
import { Icon } from './Icon';
import { useOutsidePointer } from './popup';

export interface MenuCommand {
  label: string;
  shortcut?: string;
  onSelect?(): void;
  disabled?: boolean;
  checked?: boolean;
  items?: MenuItem[];
  /** Shown in the status bar while the item is highlighted. */
  hint?: string;
}

/** A command, a line between groups, or the title of the group below it, which cannot be chosen. */
export type MenuItem = MenuCommand | 'separator' | { heading: string };

const command = (item: MenuItem | undefined): item is MenuCommand =>
  !!item && item !== 'separator' && !('heading' in item);
const selectable = (item: MenuItem | undefined): item is MenuCommand => command(item) && !item.disabled;

function nextSelectable(items: MenuItem[], from: number, dir: 1 | -1): number {
  for (let k = 1; k <= items.length; k++) {
    const i = (((from + dir * k) % items.length) + items.length) % items.length;
    if (selectable(items[i])) return i;
  }
  return -1;
}

interface MenuPanelProps {
  items: MenuItem[];
  active: number;
  style?: CSSProperties;
  panelRef?: Ref<HTMLDivElement>;
  onItemEnter?: (index: number) => void;
  onItemClick?: (index: number) => void;
  onPointerLeave?: () => void;
}

/** The raised menu panel with its rows; the open menus and the gallery both draw it. */
export function MenuPanel({ items, active, style, panelRef, onItemEnter, onItemClick, onPointerLeave }: MenuPanelProps) {
  return (
    <div className="h-menu" role="menu" data-h-popup ref={panelRef} style={style} onPointerLeave={onPointerLeave}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="h-menu-separator" role="separator" />
        ) : 'heading' in item ? (
          <div key={i} className="h-menu-heading" role="presentation">
            {item.heading}
          </div>
        ) : (
          <div
            key={i}
            data-index={i}
            className={cx('h-menu-item', i === active && 'is-active', item.disabled && 'is-disabled')}
            role="menuitem"
            aria-disabled={item.disabled}
            aria-haspopup={!!item.items}
            onPointerEnter={() => onItemEnter?.(i)}
            onClick={() => onItemClick?.(i)}
          >
            <span className="h-menu-check">{item.checked && <Icon name="check" />}</span>
            <span className="h-menu-label">{item.label}</span>
            {item.shortcut && <span className="h-menu-shortcut">{item.shortcut}</span>}
            <span className="h-menu-arrow">{item.items && <Icon name="caret-right" />}</span>
          </div>
        ),
      )}
    </div>
  );
}

interface MenuPopupProps {
  items: MenuItem[];
  x: number;
  y: number;
  /** Where the right edge goes when the menu does not fit to the right of x. */
  flipX?: number;
  /** Where the bottom edge goes when the menu does not fit below y. */
  flipY?: number;
  keyboard?: boolean;
  onClose: () => void;
  onBack?: () => void;
  onNavigate?: (dir: 1 | -1) => void;
}

function MenuPopup({ items, x, y, flipX, flipY, keyboard, onClose, onBack, onNavigate }: MenuPopupProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => (keyboard ? nextSelectable(items, -1, 1) : -1));
  const [sub, setSub] = useState<{ index: number; rect: DOMRect; keyboard: boolean } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const subRef = useRef(sub);
  subRef.current = sub;
  const activeItem = items[active];
  const hint = command(activeItem) ? activeItem.hint : undefined;

  useEffect(() => {
    if (!hint) return;
    setHint(hint);
    return () => setHint(null);
  }, [hint]);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w > innerWidth) left = flipX !== undefined && flipX - w >= 0 ? flipX - w : innerWidth - w;
    if (top + h > innerHeight) top = flipY !== undefined && flipY - h >= 0 ? flipY - h : innerHeight - h;
    setPos({ left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)) });
  }, [x, y, flipX, flipY]);

  const openSub = (index: number, kb: boolean) => {
    const row = panel.current?.querySelector(`[data-index="${index}"]`);
    if (row) setSub({ index, rect: row.getBoundingClientRect(), keyboard: kb });
  };

  const choose = (index: number, kb: boolean) => {
    const item = items[index];
    if (!selectable(item)) return;
    if (item.items) {
      setActive(index);
      openSub(index, kb);
      return;
    }
    onClose();
    item.onSelect?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (subRef.current) return;
      const item = items[active];
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
          setActive(nextSelectable(items, active, e.key === 'ArrowDown' ? 1 : -1));
          break;
        case 'ArrowRight':
          if (command(item) && item.items) openSub(active, true);
          else onNavigate?.(1);
          break;
        case 'ArrowLeft':
          if (onBack) onBack();
          else onNavigate?.(-1);
          break;
        case 'Escape':
          if (onBack) onBack();
          else onClose();
          break;
        case 'Enter':
        case ' ':
          if (active >= 0) choose(active, true);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const subItems = sub ? items[sub.index] : undefined;
  return createPortal(
    <>
      <MenuPanel
        items={items}
        active={active}
        panelRef={panel}
        style={{ position: 'fixed', left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? undefined : 'hidden' }}
        onItemEnter={(i) => {
          const item = items[i];
          if (!selectable(item)) {
            setActive(-1);
            setSub(null);
            return;
          }
          setActive(i);
          if (!item.items) setSub(null);
          else if (sub?.index !== i) openSub(i, false);
        }}
        onItemClick={(i) => choose(i, false)}
        onPointerLeave={() => !subRef.current && setActive(-1)}
      />
      {sub && command(subItems) && subItems.items && (
        <MenuPopup
          key={sub.index}
          items={subItems.items}
          x={Math.round(sub.rect.right) - 3}
          y={Math.round(sub.rect.top) - 3}
          flipX={Math.round(sub.rect.left) + 3}
          flipY={Math.round(sub.rect.bottom) + 3}
          keyboard={sub.keyboard}
          onClose={onClose}
          onBack={() => setSub(null)}
          onNavigate={onNavigate}
        />
      )}
    </>,
    document.body,
  );
}

export function MenuBar({ menus }: { menus: { label: string; tour?: string; items: MenuItem[] }[] }) {
  const bar = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ index: number; keyboard: boolean } | null>(null);
  useOutsidePointer(!!open, () => setOpen(null), bar);

  const rect = open && bar.current?.children[open.index]?.getBoundingClientRect();
  return (
    <div className="h-menubar" role="menubar" ref={bar}>
      {menus.map((menu, i) => (
        <div
          key={menu.label}
          className={cx('h-menubar-item', open?.index === i && 'is-open')}
          role="menuitem"
          aria-haspopup
          aria-expanded={open?.index === i}
          data-tour={menu.tour}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            setOpen(open?.index === i ? null : { index: i, keyboard: false });
          }}
          onPointerEnter={() => open && open.index !== i && setOpen({ index: i, keyboard: false })}
        >
          {menu.label}
        </div>
      ))}
      {open && rect && (
        <MenuPopup
          key={open.index}
          items={menus[open.index].items}
          x={Math.round(rect.left)}
          y={Math.round(rect.bottom)}
          flipY={Math.round(rect.top)}
          keyboard={open.keyboard}
          onClose={() => setOpen(null)}
          onNavigate={(dir) =>
            setOpen({ index: (open.index + dir + menus.length) % menus.length, keyboard: true })
          }
        />
      )}
    </div>
  );
}

function ContextMenu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  useOutsidePointer(true, onClose);
  return <MenuPopup items={items} x={x} y={y} flipX={x} flipY={y} onClose={onClose} />;
}

/** Shows a popup menu with its top-left corner at a point in the window, kept on screen. */
export function openMenu(items: MenuItem[], x: number, y: number): void {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };
  root.render(<ContextMenu items={items} x={Math.round(x)} y={Math.round(y)} onClose={close} />);
}
