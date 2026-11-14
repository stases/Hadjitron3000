import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { cx } from './cx';
import { useHint } from './hint';
import { Icon } from './Icon';

export interface WindowControls {
  onMinimize?(): void;
  onMaximize?(): void;
  onClose?(): void;
}

interface TitleBarProps {
  title: string;
  icon?: ReactNode;
  active?: boolean;
  controls?: WindowControls;
  /** The window's own buttons, such as a `TitleButton` with words on it, before the standard ones. */
  buttons?: ReactNode;
  movable?: boolean;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
}

export function TitleBar({ title, icon, active = true, controls, buttons, movable, onPointerDown }: TitleBarProps) {
  return (
    <div
      className={cx('h-titlebar', !active && 'is-inactive', movable && 'is-movable')}
      onDoubleClick={controls?.onMaximize}
      onPointerDown={onPointerDown}
    >
      {icon && <span className="h-titlebar-icon">{icon}</span>}
      <span className="h-titlebar-text">{title}</span>
      {(controls || buttons) && (
        <span className="h-titlebar-buttons" onDoubleClick={(e) => e.stopPropagation()}>
          {buttons}
          {controls?.onMinimize && <TitleButton icon="minimize" label="Minimize" onClick={controls.onMinimize} />}
          {controls?.onMaximize && <TitleButton icon="maximize" label="Maximize" onClick={controls.onMaximize} />}
          {controls?.onClose && <TitleButton icon="close" label="Close" onClick={controls.onClose} />}
        </span>
      )}
    </div>
  );
}

interface TitleButtonProps {
  label: string;
  /** Without an icon the button shows its label in words. */
  icon?: 'minimize' | 'maximize' | 'close';
  hint?: string;
  onClick(): void;
}

export function TitleButton({ label, icon, hint, onClick }: TitleButtonProps) {
  const hover = useHint(hint);
  return (
    <button
      type="button"
      className={cx('h-title-button', icon === 'close' && 'is-close', !icon && 'is-text')}
      aria-label={icon && label}
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      {...hover.props}
    >
      {icon ? <Icon name={icon} /> : label}
    </button>
  );
}

interface WindowProps {
  title: string;
  icon?: ReactNode;
  active?: boolean;
  controls?: WindowControls;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Window({ title, icon, active, controls, className, style, children }: WindowProps) {
  return (
    <div className={cx('h-window', className)} style={style}>
      <TitleBar title={title} icon={icon} active={active} controls={controls} />
      {children}
    </div>
  );
}
