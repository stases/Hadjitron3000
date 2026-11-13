import type { ChoiceSpec, ParamSpec } from '../../core/modules';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import type { ParamValue } from '../../core/types';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';
import { Knob } from './Knob';
import { Select } from './Select';

interface ParamControlProps {
  spec: ParamSpec;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
  hint?: string;
}

/** A float with at most this many positions gets a knob that clicks into each one. */
const MAX_KNOB_STEPS = 50;
const WAVES = ['sine', 'triangle', 'sawtooth', 'square'] as const;

const isWaveChoice = (spec: ChoiceSpec) =>
  spec.options.length === WAVES.length && spec.options.every(([v], i) => v === WAVES[i]);

export function ParamControl({ spec, value, onChange, hint }: ParamControlProps) {
  switch (spec.kind) {
    case 'float': {
      const count = spec.step && (spec.taper ?? 'lin') === 'lin' ? Math.round((spec.max - spec.min) / spec.step) + 1 : 0;
      return (
        <Knob
          value={toNorm(spec, value as number)}
          onChange={(t) => onChange(fromNorm(spec, t))}
          defaultValue={toNorm(spec, spec.def)}
          label={spec.label}
          display={formatValue(spec, value)}
          hint={hint}
          steps={count > 1 && count <= MAX_KNOB_STEPS ? count : undefined}
        />
      );
    }
    case 'choice':
      return (
        <div className="h-param">
          <span className="h-param-label">{spec.label}</span>
          {isWaveChoice(spec) ? (
            <div className="h-param-waves" role="radiogroup" aria-label={spec.label}>
              {spec.options.map(([v, label]) => (
                <Button key={v} square pressed={v === value} onClick={() => onChange(v)} hint={hint ?? label}>
                  <Icon name={`wave-${v as (typeof WAVES)[number]}`} />
                </Button>
              ))}
            </div>
          ) : (
            <Select
              value={value as string}
              options={spec.options.map(([v, label]) => ({ value: v, label }))}
              onChange={onChange}
              hint={hint}
            />
          )}
        </div>
      );
    case 'bool':
      return <Checkbox checked={value as boolean} onChange={onChange} label={spec.label} hint={hint} />;
    case 'sample':
      return null;
  }
}
