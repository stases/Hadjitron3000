import { usePrefs } from '../../app/prefs';
import { levelOf } from '../../core/levels';
import { MODULES, SOURCES } from '../../core/modules';
import type { ParamSpec } from '../../core/modules';
import type { Params } from '../../core/types';
import { setParam, setSourceType } from '../../state/store';
import { ParamControl, Select } from '../kit';
import { PARAM_HINTS } from './hints';
import { sourceItems } from './levels';
import type { Cell } from './levels';

/** In the module table both delay controls are called "time"; side by side they read SYNC and TIME. */
const LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = { delay: { sync: 'Sync', time: 'Time' } };

/** Controls that only work in some settings: the Delay's Time with Sync at Free, Pulse with a square wave. */
const IDLE: Readonly<Record<string, Readonly<Record<string, (p: Params) => boolean>>>> = {
  delay: { time: (p) => p.sync !== 'free' },
  osc: { pw: (p) => p.wave !== 'square' && !(p.wave2 === 'square' && (p.mix2 as number) > 0) },
};

/** Captions over neighbouring controls that belong together. */
const GROUPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  osc: { wave2: 'Osc 2', pitch2: 'Osc 2', fine2: 'Osc 2', mix2: 'Osc 2', sub: 'Sub', subOct: 'Sub' },
  play: { mode: 'Play', glide: 'Play' },
};

interface ControlProps {
  channelId: string;
  moduleId: string;
  type: string;
  spec: ParamSpec;
  params: Params;
  disabled?: boolean;
}

/** The control of one parameter, wired to the store. */
export function Control({ channelId, moduleId, type, spec, params, disabled }: ControlProps) {
  const label = LABELS[type]?.[spec.id];
  return (
    <ParamControl
      spec={label ? { ...spec, label } : spec}
      value={params[spec.id]}
      onChange={(v) => setParam(channelId, moduleId, spec.id, v)}
      hint={PARAM_HINTS[type][spec.id]}
      disabled={disabled || !!IDLE[type]?.[spec.id]?.(params)}
    />
  );
}

/** One cell of the rack grid: a knob takes one column, any other control two. */
export function Param(props: ControlProps) {
  return (
    <div className={props.spec.kind === 'float' ? 'h-factory-cell' : 'h-factory-cell is-wide'}>
      <Control {...props} />
    </div>
  );
}

/** A cell for a parameter of a module, as the module table describes it. */
export function paramCell(props: ControlProps): Cell {
  const { moduleId, type, spec, params } = props;
  return {
    node: <Param key={`${moduleId}.${spec.id}`} {...props} />,
    level: levelOf(spec),
    changed: spec.kind !== 'sample' && params[spec.id] !== spec.def,
    group: GROUPS[type]?.[spec.id],
  };
}

/**
 * A cell for every parameter of a module that has a control, in the order of the module table; `disabled` greys
 * out some of them. The voice filter's `on` is its lamp, not a control.
 */
export function paramCells(
  channelId: string,
  moduleId: string,
  type: string,
  params: Params,
  disabled?: (id: string) => boolean,
): Cell[] {
  return MODULES[type].params
    .filter((spec) => spec.kind !== 'sample' && !(spec.kind === 'bool' && spec.id === 'on'))
    .map((spec) => paramCell({ channelId, moduleId, type, spec, params, disabled: disabled?.(spec.id) }));
}

export function SourceSelect({ channelId, type }: { channelId: string; type: string }) {
  const beginner = usePrefs((p) => p.beginner);
  const { options, more } = sourceItems(beginner, SOURCES);
  return (
    <div className="h-factory-cell is-wide">
      <div className="h-param">
        <span className="h-param-label">Type</span>
        <Select
          value={type}
          options={options}
          more={more}
          onChange={(v) => setSourceType(channelId, v)}
          hint="What makes the sound: a tone, an FM pair, plain noise or a recording."
        />
      </div>
    </div>
  );
}
