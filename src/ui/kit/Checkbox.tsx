import { cx } from './cx';
import { useHint } from './hint';
import { Icon } from './Icon';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, hint, disabled }: CheckboxProps) {
  const hover = useHint(hint);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="h-checkbox"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...hover.props}
    >
      <span className="h-checkbox-box">{checked && <Icon name="check" />}</span>
      <span className={cx('h-checkbox-label', disabled && 'h-engraved')}>{label}</span>
    </button>
  );
}
