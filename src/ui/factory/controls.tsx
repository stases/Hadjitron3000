import { MODULES, SOURCES } from '../../core/modules';
import type { ChoiceSpec, ParamSpec } from '../../core/modules';
import type { Params } from '../../core/types';
import { setParam, setSourceType } from '../../state/store';
import { ParamControl } from '../kit';
import { PARAM_HINTS } from './hints';

/** In the module table both delay controls are called "time"; side by side they read SYNC and TIME. */
const LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = { delay: { sync: 'Sync', time: 'Time' } };

const SOURCE_SPEC: ChoiceSpec = {
  kind: 'choice',
  id: 'type',
  label: 'Type',
  options: SOURCES.map((d) => [d.type, d.label] as const),
  def: 'osc',
};

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
export function Params({ channelId, moduleId, type, params }: Omit<ControlProps, 'spec'>) {
  return MODULES[type].params
    .filter((spec) => spec.kind !== 'sample')
    .map((spec) => (
      <Param key={spec.id} channelId={channelId} moduleId={moduleId} type={type} spec={spec} params={params} />
    ));
}

export function SourceSelect({ channelId, type }: { channelId: string; type: string }) {
  return (
    <div className="h-factory-cell is-wide">
      <ParamControl
        spec={SOURCE_SPEC}
        value={type}
        onChange={(v) => setSourceType(channelId, v as string)}
        hint="What makes the sound: a tone, an FM pair, plain noise or a recording."
      />
    </div>
  );
}
