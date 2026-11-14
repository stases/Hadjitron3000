import { useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { usePrefs } from '../../app/prefs';
import { levelOf } from '../../core/levels';
import {
  AMP, EFFECTS, FILTER, MODS, MODULES, OUT, PLAY, inVoice, modTargets, moduleDef, paramSpec,
} from '../../core/modules';
import type { ChoiceSpec, FloatSpec } from '../../core/modules';
import { formatAmount } from '../../core/params';
import type { Channel, ModInst, ModuleInst, Sound } from '../../core/types';
import {
  addEffect, addMod, moveEffect, removeModule, setModAmount, setModPer, setModTarget, setModuleOn, setParam,
} from '../../state/store';
import type { Owner } from '../../state/store';
import { Button, Icon, Knob, ParamControl, RackUnit, openMenu } from '../kit';
import type { MenuItem } from '../kit';
import { SendKnob, SourceSelect, paramCell, paramCells } from './controls';
import { EnvelopeDisplay } from './EnvelopeDisplay';
import { GrainsUnit } from './GrainsUnit';
import { MOD_HINTS } from './hints';
import { addMenu, useLevels, useShown } from './levels';
import type { Cell } from './levels';
import { ReductionMeter } from './ReductionMeter';
import { SamplerUnit } from './SamplerUnit';

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

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
  cells: Cell[];
  lead?: ReactNode;
  tail?: ReactNode;
}

/** A unit with its cells laid out by level; `lead` and `tail` stand before and after the cells in the first row. */
function LevelUnit({ type, cells, lead, tail, ...unit }: LevelUnitProps) {
  const { row, folds } = useLevels(type, cells);
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
  // A modulator can only work on each note when its target lives in the note.
  const fixed = !!mod.target && !inVoice(mod.target.module);
  const per = fixed ? 'sound' : mod.per;
  // Velocity scales a per-note modulator only. An LFO in every note starts with it, so Retrigger shows on and fixed.
  const cells = MODULES[mod.type].params.map((spec) => {
    const pinned = spec.id === 'retrigger' && per === 'note';
    const params = pinned ? { ...mod.params, retrigger: true } : mod.params;
    const disabled = pinned || (spec.id === 'vel' && per === 'sound');
    const cell = paramCell({ owner: channelId, moduleId: mod.id, type: mod.type, spec, params, disabled });
    return pinned ? { ...cell, changed: false } : cell;
  });
  const perCell: Cell = {
    node: (
      <div key="per" className="h-factory-cell is-wide is-switch">
        <div className="h-param">
          <span className="h-param-label">Works on</span>
          <div className="h-factory-switch" role="radiogroup" aria-label="Works on">
            {(['note', 'sound'] as const).map((value) => (
              <Button
                key={value}
                small
                pressed={per === value}
                disabled={fixed}
                onClick={() => setModPer(channelId, mod.id, value)}
                hint={fixed ? MOD_HINTS.fixed : MOD_HINTS[value]}
              >
                {value === 'note' ? 'Each note' : 'Whole sound'}
              </Button>
            ))}
          </div>
        </div>
      </div>
    ),
    level: 2,
    changed: per !== (mod.type === 'env' ? 'note' : 'sound'),
  };
  return (
    <LevelUnit
      name={name}
      data-tour="unit-mod"
      led={{ on: mod.on !== false, onToggle: () => setModuleOn(channelId, mod.id, mod.on === false) }}
      onRemove={() => removeModule(channelId, mod.id)}
      type={mod.type}
      cells={[perCell, ...cells]}
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
            hint={MOD_HINTS.target}
          />
        </div>
          <div className="h-factory-cell">
            <Knob
              value={(mod.amount + 1) / 2}
              onChange={(t) => setModAmount(channelId, mod.id, Math.round((t * 2 - 1) * 1000) / 1000)}
              defaultValue={0.5}
              label="Amount"
              display={spec ? formatAmount(spec, mod.amount) : `${signed(Math.round(mod.amount * 100))} %`}
              hint={MOD_HINTS.amount}
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

/** The effects of a sound's chain or a mixer rack, as units in signal order, and the button that adds one. */
export function EffectChain({ owner, chain }: { owner: Owner; chain: ModuleInst[] }) {
  const beginner = usePrefs((p) => p.beginner);
  const names = plateNames(chain);
  const last = chain.length - 1;
  return (
    <>
      {chain.map((m, i) => (
        <LevelUnit
          key={m.id}
          name={names[i]}
          data-tour={`effect-${m.type}`}
          led={{ on: m.on !== false, onToggle: () => setModuleOn(owner, m.id, m.on === false) }}
          onMoveUp={i > 0 ? () => moveEffect(owner, m.id, i - 1) : null}
          onMoveDown={i < last ? () => moveEffect(owner, m.id, i + 1) : null}
          onRemove={() => removeModule(owner, m.id)}
          type={m.type}
          cells={paramCells(owner, m.id, m.type, m.params)}
          tail={m.type === 'compressor' && <ReductionMeter owner={owner} moduleId={m.id} />}
        />
      ))}
      <AddButton
        label="Effect"
        hint="Adds an effect to the end of the chain."
        items={() => addMenu(beginner, EFFECTS, (type) => addEffect(owner, type))}
      />
    </>
  );
}

export function Rack({ channel }: { channel: Channel }) {
  const { id: channelId, sound } = channel;
  const beginner = usePrefs((p) => p.beginner);
  const modNames = plateNames(sound.mods);
  const sends = channel.sends.map((value, index): Cell => ({
    node: (
      <div key={`send${index}`} className="h-factory-cell">
        <SendKnob channelId={channelId} index={index} value={value} />
      </div>
    ),
    level: 1,
    changed: value !== 0,
    group: 'Sends',
  }));
  const play = paramCells(channelId, 'play', PLAY.type, sound.play);
  return (
    <div className="h-factory-rack">
      {sound.source.type === 'sample' ? (
        <SamplerUnit channelId={channelId} source={sound.source} play={play} />
      ) : sound.source.type === 'grains' ? (
        <GrainsUnit channelId={channelId} source={sound.source} play={play} />
      ) : (
        <LevelUnit
          name="Source"
          data-tour="unit-source"
          type={sound.source.type}
          cells={[...paramCells(channelId, 'source', sound.source.type, sound.source.params), ...play]}
          lead={<SourceSelect channelId={channelId} type={sound.source.type} />}
        />
      )}
      <LevelUnit
        name="Filter"
        data-tour="unit-filter"
        led={{ on: sound.filter.on as boolean, onToggle: () => setParam(channelId, 'filter', 'on', !sound.filter.on) }}
        type={FILTER.type}
        cells={paramCells(channelId, 'filter', FILTER.type, sound.filter)}
      />
      <LevelUnit
        name="Amp"
        data-tour="unit-amp"
        type={AMP.type}
        cells={paramCells(channelId, 'amp', AMP.type, sound.amp)}
        lead={
          <div className="h-factory-cell is-display">
            <EnvelopeDisplay params={sound.amp} width={180} height={44} />
          </div>
        }
      />
      <EffectChain owner={channelId} chain={sound.chain} />
      {sound.mods.map((m, i) => (
        <ModUnit key={m.id} channelId={channelId} sound={sound} mod={m} name={modNames[i]} />
      ))}
      <AddButton
        label="Modulator"
        hint="Adds an envelope, an LFO or a drift that can move any control marked as a target."
        items={() => addMenu(beginner, MODS, (type) => addMod(channelId, type))}
      />
      <LevelUnit
        name="Output"
        type={OUT.type}
        cells={[...paramCells(channelId, 'out', OUT.type, sound.out), ...sends]}
      />
    </div>
  );
}
