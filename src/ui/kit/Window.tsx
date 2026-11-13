import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { cx } from './cx';
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
  movable?: boolean;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
}

export function TitleBar({ title, icon, active = true, controls, movable, onPointerDown }: TitleBarProps) {
  return (
    <div
      className={cx('h-titlebar', !active && 'is-inactive', movable && 'is-movable')}
      onDoubleClick={controls?.onMaximize}
      onPointerDown={onPointerDown}
    >
      {icon && <span className="h-titlebar-icon">{icon}</span>}
      <span className="h-titlebar-text">{title}</span>
      {controls && (
        <span className="h-titlebar-buttons" onDoubleClick={(e) => e.stopPropagation()}>
          {controls.onMinimize && <TitleButton icon="minimize" label="Minimize" onClick={controls.onMinimize} />}
          {controls.onMaximize && <TitleButton icon="maximize" label="Maximize" onClick={controls.onMaximize} />}
          {controls.onClose && <TitleButton icon="close" label="Close" onClick={controls.onClose} />}
        </span>
      )}
    </div>
  );
}

function TitleButton({ icon, label, onClick }: { icon: 'minimize' | 'maximize' | 'close'; label: string; onClick(): void }) {
  return (
    <button
      type="button"
      className={cx('h-title-button', icon === 'close' && 'is-close')}
      aria-label={label}
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      <Icon name={icon} />
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
