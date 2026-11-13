import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

interface BoxProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** A raised putty surface. */
export function Panel({ className, style, children }: BoxProps) {
  return (
    <div className={cx('h-panel', className)} style={style}>
      {children}
    </div>
  );
}

/** A sunken putty recess, such as the one the step grid sits in. */
export function Well({ className, style, children }: BoxProps) {
  return (
    <div className={cx('h-well', className)} style={style}>
      {children}
    </div>
  );
}

export function GroupBox({ label, className, style, children }: BoxProps & { label: string }) {
  return (
    <div className={cx('h-groupbox', className)} style={style} role="group" aria-label={label}>
      <span className="h-groupbox-label">{label}</span>
      {children}
    </div>
  );
}

export function Separator({ vertical }: { vertical?: boolean }) {
  return <div className={cx('h-separator', vertical && 'is-vertical')} role="separator" />;
}

export function Toolbar({ className, style, children }: BoxProps) {
  return (
    <div className={cx('h-toolbar', className)} style={style} role="toolbar">
      {children}
    </div>
  );
}

export function StatusBar({ children }: { children?: ReactNode }) {
  return <div className="h-statusbar">{children}</div>;
}

export function StatusField({ width, children }: { width?: number; children?: ReactNode }) {
  return (
    <div className="h-statusfield" style={width ? { width } : { flex: 1 }}>
      {children}
    </div>
  );
}
