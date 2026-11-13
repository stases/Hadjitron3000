import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Icon } from './Icon';
import { TitleBar } from './Window';

const FOCUSABLE =
  'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

interface DialogProps {
  title: string;
  onClose: () => void;
  width?: number;
  children?: ReactNode;
}

/** A modal window in a portal. It blocks the app behind it, starts centred and moves by its title bar. */
export function Dialog({ title, onClose, width, children }: DialogProps) {
  const layer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setPos({
      x: Math.max(0, Math.floor((innerWidth - el.offsetWidth) / 2)),
      y: Math.max(0, Math.floor((innerHeight - el.offsetHeight) / 2)),
    });
  }, []);

  useEffect(() => {
    const self = layer.current;
    const before = document.activeElement as HTMLElement | null;
    const siblings = [...document.body.children];
    const others = siblings
      .slice(0, self ? siblings.indexOf(self) : 0)
      .filter((el): el is HTMLElement => el instanceof HTMLElement && !el.inert);
    others.forEach((el) => (el.inert = true));
    return () => {
      others.forEach((o) => (o.inert = false));
      before?.focus?.();
    };
  }, []);

  const placed = pos !== null;
  useEffect(() => {
    const el = box.current;
    if (!placed || !el || el.contains(document.activeElement)) return;
    const first = el.querySelector<HTMLElement>('[data-autofocus]')
      ?? el.querySelector<HTMLElement>('.h-button.is-primary') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    first.focus();
    if (first instanceof HTMLInputElement) first.select();
  }, [placed]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab' && box.current) {
      const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!all.length) return e.preventDefault();
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === all.length - 1 ? 0 : i + 1;
      e.preventDefault();
      all[next].focus();
    }
  };

  const startMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pos) return;
    e.preventDefault();
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: globalThis.PointerEvent) =>
      setPos({ x: Math.round(ev.clientX - start.x), y: Math.max(0, Math.round(ev.clientY - start.y)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return createPortal(
    <div className="h-dialog-layer" ref={layer} onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div
        ref={box}
        className="h-dialog"
        role="dialog"
        aria-modal
        aria-label={title}
        tabIndex={-1}
        style={{ width, left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? undefined : 'hidden' }}
        onKeyDown={onKeyDown}
      >
        <TitleBar title={title} controls={{ onClose }} movable onPointerDown={startMove} />
        <div className="h-dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function DialogButtons({ children }: { children?: ReactNode }) {
  return <div className="h-dialog-buttons">{children}</div>;
}

interface MessageBoxProps {
  title: string;
  icon: 'info' | 'warning' | 'error' | 'question';
  text: ReactNode;
  buttons: { label: string; value: string; primary?: boolean }[];
  onChoose: (value: string) => void;
}

/** A Dialog with an icon, a message and a row of buttons. Escape and the close box choose the last button. */
export function MessageBox({ title, icon, text, buttons, onChoose }: MessageBoxProps) {
  return (
    <Dialog title={title} onClose={() => onChoose(buttons[buttons.length - 1].value)}>
      <div className="h-message">
        <Icon name={icon} />
        <div className="h-message-text">{text}</div>
      </div>
      <div className="h-message-buttons">
        {buttons.map((b) => (
          <Button key={b.value} primary={b.primary} onClick={() => onChoose(b.value)}>
            {b.label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
