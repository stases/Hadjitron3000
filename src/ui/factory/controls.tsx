import { usePrefs } from '../../app/prefs';
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

interface ControlProps {
  channelId: string;
  moduleId: string;
  type: string;
  spec: ParamSpec;
  params: Params;
}

/** The control of one parameter, wired to the store. The Delay's time knob only works when Sync is Free. */
export function Control({ channelId, moduleId, type, spec, params }: ControlProps) {
  const label = LABELS[type]?.[spec.id];
  return (
    <ParamControl
      spec={label ? { ...spec, label } : spec}
      value={params[spec.id]}
      onChange={(v) => setParam(channelId, moduleId, spec.id, v)}
      hint={PARAM_HINTS[type][spec.id]}
      disabled={type === 'delay' && spec.id === 'time' && params.sync !== 'free'}
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

/** A cell for every parameter of a module, in the order of the module table. */
export function paramCells(channelId: string, moduleId: string, type: string, params: Params): Cell[] {
  return MODULES[type].params
    .filter((spec) => spec.kind !== 'sample')
    .map((spec) => ({
      ids: [spec.id],
      node: <Param key={spec.id} channelId={channelId} moduleId={moduleId} type={type} spec={spec} params={params} />,
    }));
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
