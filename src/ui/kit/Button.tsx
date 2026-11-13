import type { ReactNode } from 'react';
import { cx } from './cx';
import { useHint } from './hint';

interface ButtonProps {
  onClick: () => void;
  hint?: string;
  pressed?: boolean;
  disabled?: boolean;
  square?: boolean;
  small?: boolean;
  primary?: boolean;
  children: ReactNode;
  'data-tour'?: string;
}

export function Button({
  onClick, hint, pressed, disabled, square, small, primary, children, 'data-tour': tour,
}: ButtonProps) {
  const hover = useHint(hint);
  return (
    <button
      type="button"
      className={cx(
        'h-button',
        pressed && 'is-pressed',
        square && 'is-square',
        small && 'is-small',
        primary && 'is-primary',
      )}
      disabled={disabled}
      aria-pressed={pressed}
      data-tour={tour}
      onClick={onClick}
      {...hover.props}
    >
      <span className="h-button-face">{children}</span>
    </button>
  );
}
