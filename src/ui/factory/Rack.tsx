import { useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { usePrefs } from '../../app/prefs';
import { levelOf } from '../../core/levels';
import { AMP, EFFECTS, MODS, MODULES, OUT, modTargets, moduleDef, paramSpec } from '../../core/modules';
import type { ChoiceSpec, FloatSpec } from '../../core/modules';
import { formatAmount } from '../../core/params';
import type { ModInst, ModuleInst, Params, Sound } from '../../core/types';
import {
  addEffect, addMod, moveEffect, removeModule, setModAmount, setModTarget, setModuleOn,
} from '../../state/store';
import { Button, Icon, Knob, ParamControl, RackUnit, openMenu } from '../kit';
import type { MenuItem } from '../kit';
import { SourceSelect, paramCells } from './controls';
import { EnvelopeDisplay } from './EnvelopeDisplay';
import { addMenu, useLevels, useShown } from './levels';
import type { Cell } from './levels';
import { SamplerUnit } from './SamplerUnit';

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
const AMOUNT_HINT = 'How far the modulator moves its target, up or down; in the middle it does nothing.';

/** Plate names in signal order, numbered when a module type occurs more than once, like the target list. */
function plateNames(modules: ModuleInst[]): string[] {
  const seen: Record<string, number> = {};
  return modules.map((m) => {
    const n = (seen[m.type] = (seen[m.type] ?? 0) + 1);
    return n > 1 ? `${MODULES[m.type].label} ${n}` : MODULES[m.type].label;
  });
}

function AddButton({ label, hint, items }: { label: string; hint: string; items: () => MenuItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="h-factory-add" ref={ref} data-tour={`add-${label.toLowerCase()}`}>
      <Button
        small
        hint={hint}
        onClick={() => {
          const r = ref.current!.getBoundingClientRect();
          openMenu(items(), r.left, r.bottom);
        }}
      >
        <Icon name="plus" />
        {label}
      </Button>
    </div>
  );
}

interface LevelUnitProps extends Omit<ComponentProps<typeof RackUnit>, 'folds' | 'children'> {
  type: string;
  params: Params;
  cells: Cell[];
  lead?: ReactNode;
  tail?: ReactNode;
}

/** A unit with its cells laid out by level; `lead` and `tail` stand before and after the cells in the first row. */
function LevelUnit({ type, params, cells, lead, tail, ...unit }: LevelUnitProps) {
  const { row, folds } = useLevels(type, params, cells);
  return (
    <RackUnit {...unit} folds={folds}>
      <div className="h-factory-row">
        {lead}
        {row}
        {tail}
      </div>
    </RackUnit>
  );
}

function ModUnit({ channelId, sound, mod, name }: { channelId: string; sound: Sound; mod: ModInst; name: string }) {
  const shown = useShown();
  const key = (t: { module: string; param: string } | null) => (t ? `${t.module}/${t.param}` : '');
  // Only targets whose control is on screen, so a beginner is not offered a knob they cannot see.
  const targets = modTargets(sound).filter((t) => {
    const owner = moduleDef(sound, t.module)!;
    return key(t) === key(mod.target) || shown(owner.type, levelOf(paramSpec(owner, t.param)!));
  });
  const target = targets.find((t) => key(t) === key(mod.target));
  const targetSpec: ChoiceSpec = {
    kind: 'choice',
    id: 'target',
    label: 'Target',
    options: [['', 'None'], ...targets.map((t) => [key(t), t.label] as const)],
    def: '',
  };
  const def = target && moduleDef(sound, target.module);
  const spec = def && (paramSpec(def, target.param) as FloatSpec);
  return (
    <LevelUnit
      name={name}
      data-tour="unit-mod"
      led={{ on: mod.on !== false, onToggle: () => setModuleOn(channelId, mod.id, mod.on === false) }}
      onRemove={() => removeModule(channelId, mod.id)}
      type={mod.type}
      params={mod.params}
      cells={paramCells(channelId, mod.id, mod.type, mod.params)}
      lead={
        <>
          <div className="h-factory-cell is-wide">
          <ParamControl
            spec={targetSpec}
            value={key(target ?? null)}
            onChange={(v) => {
              const chosen = targets.find((t) => key(t) === v);
              setModTarget(channelId, mod.id, chosen ? { module: chosen.module, param: chosen.param } : null);
            }}
            hint="Which control this modulator moves."
          />
        </div>
          <div className="h-factory-cell">
            <Knob
              value={(mod.amount + 1) / 2}
              onChange={(t) => setModAmount(channelId, mod.id, Math.round((t * 2 - 1) * 1000) / 1000)}
              defaultValue={0.5}
              label="Amount"
              display={spec ? formatAmount(spec, mod.amount) : `${signed(Math.round(mod.amount * 100))} %`}
              hint={AMOUNT_HINT}
              bipolar
            />
          </div>
        </>
      }
      tail={
        mod.type === 'env' && (
          <div className="h-factory-cell is-display">
            <EnvelopeDisplay params={mod.params} width={116} height={44} />
          </div>
        )
      }
    />
  );
}

export function Rack({ channelId, sound }: { channelId: string; sound: Sound }) {
  const beginner = usePrefs((p) => p.beginner);
  const effectNames = plateNames(sound.chain);
  const modNames = plateNames(sound.mods);
  const last = sound.chain.length - 1;
  return (
    <div className="h-factory-rack">
      {sound.source.type === 'sample' ? (
        <SamplerUnit channelId={channelId} source={sound.source} />
      ) : (
        <LevelUnit
          name="Source"
          data-tour="unit-source"
          type={sound.source.type}
          params={sound.source.params}
          cells={paramCells(channelId, 'source', sound.source.type, sound.source.params)}
          lead={<SourceSelect channelId={channelId} type={sound.source.type} />}
        />
      )}
      <LevelUnit
        name="Amp"
        data-tour="unit-amp"
        type={AMP.type}
        params={sound.amp}
        cells={paramCells(channelId, 'amp', AMP.type, sound.amp)}
        lead={
          <div className="h-factory-cell is-display">
            <EnvelopeDisplay params={sound.amp} width={180} height={44} />
          </div>
        }
      />
      {sound.chain.map((m, i) => (
        <LevelUnit
          key={m.id}
          name={effectNames[i]}
          data-tour={`unit-${m.type}`}
          led={{ on: m.on !== false, onToggle: () => setModuleOn(channelId, m.id, m.on === false) }}
          onMoveUp={i > 0 ? () => moveEffect(channelId, m.id, i - 1) : null}
          onMoveDown={i < last ? () => moveEffect(channelId, m.id, i + 1) : null}
          onRemove={() => removeModule(channelId, m.id)}
          type={m.type}
          params={m.params}
          cells={paramCells(channelId, m.id, m.type, m.params)}
        />
      ))}
      <AddButton
        label="Effect"
        hint="Adds an effect to the end of the chain."
        items={() => addMenu(beginner, EFFECTS, (type) => addEffect(channelId, type))}
      />
      {sound.mods.map((m, i) => (
        <ModUnit key={m.id} channelId={channelId} sound={sound} mod={m} name={modNames[i]} />
      ))}
      <AddButton
        label="Modulator"
        hint="Adds an envelope or an LFO that can move any control marked as a target."
        items={() => addMenu(beginner, MODS, (type) => addMod(channelId, type))}
      />
      <LevelUnit
        name="Output"
        type={OUT.type}
        params={sound.out}
        cells={paramCells(channelId, 'out', OUT.type, sound.out)}
      />
    </div>
  );
}
