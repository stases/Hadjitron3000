import { useHint } from './hint';

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  width?: number;
  disabled?: boolean;
  hint?: string;
}

/** A sunken paper text field; Enter and leaving the field commit. */
export function TextField({ value, onChange, onCommit, placeholder, width, disabled, hint }: TextFieldProps) {
  const hover = useHint(hint);
  return (
    <input
      className="h-textfield"
      style={width ? { width } : undefined}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.(value)}
      onKeyDown={(e) => e.key === 'Enter' && onCommit?.(value)}
      {...hover.props}
    />
  );
}
