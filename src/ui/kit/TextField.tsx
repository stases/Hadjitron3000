interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  width?: number;
  disabled?: boolean;
}

/** A sunken paper text field; Enter and leaving the field commit. */
export function TextField({ value, onChange, onCommit, placeholder, width, disabled }: TextFieldProps) {
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
    />
  );
}
