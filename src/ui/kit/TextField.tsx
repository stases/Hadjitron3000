import { useHint } from './hint';

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  width?: number;
  maxLength?: number;
  autoFocus?: boolean; // a dialog puts the focus here first, with the text selected
  disabled?: boolean;
  hint?: string;
  'data-tour'?: string;
}

/** A sunken paper text field; Enter and leaving the field commit. */
export function TextField({
  value, onChange, onCommit, placeholder, width, maxLength, autoFocus, disabled, hint, 'data-tour': tour,
}: TextFieldProps) {
  const hover = useHint(hint);
  return (
    <input
      className="h-textfield"
      style={width ? { width } : undefined}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      data-autofocus={autoFocus || undefined}
      data-tour={tour}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.(value)}
      onKeyDown={(e) => e.key === 'Enter' && onCommit?.(value)}
      {...hover.props}
    />
  );
}
