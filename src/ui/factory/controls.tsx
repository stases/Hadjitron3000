import { usePrefs } from '../../app/prefs';
import { levelOf } from '../../core/levels';
import { SEND } from '../../core/mixer';
import { MODULES, SOURCES, paramSpec } from '../../core/modules';
import type { ParamSpec } from '../../core/modules';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import type { Params } from '../../core/types';
import { setParam, setSend, setSourceType, useApp } from '../../state/store';
import type { Owner } from '../../state/store';
import { Knob, ParamControl, Select } from '../kit';
import { MIXER_HINTS, PARAM_HINTS } from './hints';
import { sourceItems, useShown } from './levels';
import type { Cell } from './levels';
import { ShapeEditor } from './ShapeEditor';

/** In the module table both delay controls are called "time"; side by side they read SYNC and TIME. */
const LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = { delay: { sync: 'Sync', time: 'Time' } };

/**
 * Controls that only work in some settings: Time and Rate with Sync at Free, Pulse with a square wave, the
 * sampler's Crossfade with Loop on.
 */
const IDLE: Readonly<Record<string, Readonly<Record<string, (p: Params) => boolean>>>> = {
  sample: { xfade: (p) => !p.loop },
  delay: { time: (p) => p.sync !== 'free' },
  lfo: { rate: (p) => p.sync !== 'free' },
  phaser: { rate: (p) => p.sync !== 'free' },
  osc: { pw: (p) => p.wave !== 'square' && !(p.wave2 === 'square' && (p.mix2 as number) > 0) },
};

/** Captions over neighbouring controls that belong together. */
const GROUPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  osc: { wave2: 'Osc 2', pitch2: 'Osc 2', fine2: 'Osc 2', mix2: 'Osc 2', sub: 'Sub', subOct: 'Sub' },
  play: { mode: 'Play', glide: 'Play' },
};

/** The wave parameter of each drawing: a drawing is shown next to its wave while that is set to Draw. */
const DRAWN: Readonly<Record<string, string>> = { shape: 'wave', shape2: 'wave2' };

interface ControlProps {
  owner: Owner;
  moduleId: string;
  type: string;
  spec: ParamSpec;
  params: Params;
  disabled?: boolean;
}

/**
 * The control of one parameter, wired to the store. A choice offers the options whose level is on screen, and the
 * one it is set to.
 */
export function Control({ owner, moduleId, type, spec, params, disabled }: ControlProps) {
  const shown = useShown();
  const label = LABELS[type]?.[spec.id];
  const offered: ParamSpec =
    spec.kind === 'choice'
      ? { ...spec, options: spec.options.filter(([v, , level]) => v === params[spec.id] || shown(type, level ?? 1)) }
      : spec;
  return (
    <ParamControl
      spec={label ? { ...offered, label } : offered}
      value={params[spec.id]}
      onChange={(v) => setParam(owner, moduleId, spec.id, v)}
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

/** A cell for a parameter of a module, as the module table describes it. A drawing goes with its wave. */
export function paramCell(props: ControlProps): Cell {
  const { owner, moduleId, type, spec, params } = props;
  if (spec.kind === 'shape') {
    const wave = paramSpec(MODULES[type], DRAWN[spec.id])!;
    return {
      node: <ShapeEditor key={spec.id} owner={owner} id={spec.id} value={params[spec.id] as string} />,
      level: levelOf(wave),
      changed: params[spec.id] !== spec.def,
      group: GROUPS[type]?.[wave.id],
    };
  }
  return {
    node: <Param key={`${moduleId}.${spec.id}`} {...props} />,
    level: levelOf(spec),
    changed: spec.kind !== 'sample' && params[spec.id] !== spec.def,
    group: GROUPS[type]?.[spec.id],
  };
}

/**
 * A cell for every parameter of a module that has a control, in the order of the module table; `disabled` greys
 * out some of them. The voice filter's `on` is its lamp, not a control, and a drawing shows while its wave is Draw.
 */
export function paramCells(
  owner: Owner,
  moduleId: string,
  type: string,
  params: Params,
  disabled?: (id: string) => boolean,
): Cell[] {
  return MODULES[type].params
    .filter((spec) => spec.kind !== 'sample' && !(spec.kind === 'bool' && spec.id === 'on'))
    .filter((spec) => spec.kind !== 'shape' || params[DRAWN[spec.id]] === 'draw')
    .map((spec) => paramCell({ owner, moduleId, type, spec, params, disabled: disabled?.(spec.id) }));
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

/** How much of a channel goes to a send bus; the knob is named after the bus. */
export function SendKnob({ channelId, index, value, small }: {
  channelId: string;
  index: number;
  value: number;
  small?: boolean;
}) {
  const name = useApp((s) => s.project.mixer.buses[index].name);
  return (
    <Knob
      small={small}
      value={toNorm(SEND, value)}
      onChange={(t) => setSend(channelId, index, fromNorm(SEND, t))}
      defaultValue={toNorm(SEND, SEND.def)}
      label={name}
      display={formatValue(SEND, value)}
      hint={MIXER_HINTS.send(name)}
    />
  );
}
