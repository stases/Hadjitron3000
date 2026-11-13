import { useState } from 'react';
import { create } from 'zustand';
import { busLevels, channelLevels, levels } from '../../app/audio';
import { usePrefs } from '../../app/prefs';
import { LEVEL_NAMES } from '../../core/levels';
import { BUS_LETTERS, BUS_LEVEL, DUCK_AMOUNT, DUCK_RELEASE, MASTER_RACK_LEVEL } from '../../core/mixer';
import type { MixerRack } from '../../core/mixer';
import { OUT, paramSpec } from '../../core/modules';
import type { FloatSpec } from '../../core/modules';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import type { Channel } from '../../core/types';
import { selectChannel, setBus, setChannel, setDuck, setMaster, setParam, setView, useApp } from '../../state/store';
import { Button, ColorChip, FoldToggles, Knob, Meter, Select, Slider, TextField, useHint } from '../kit';
import { cx } from '../kit/cx';
import { SendKnob } from '../factory/controls';
import { MIXER_HINTS, PARAM_HINTS } from '../factory/hints';
import { toggleFold, useShown } from '../factory/levels';
import { EffectChain } from '../factory/Rack';
import '../factory/factory.css';
import './mixer.css';

const LEVEL = paramSpec(OUT, 'level') as FloatSpec;
const PAN = paramSpec(OUT, 'pan') as FloatSpec;
const FADER = 100;
const { mute: MUTE, solo: SOLO, master: MASTER } = MIXER_HINTS;

/** The rack shown under the strips; kept while the app runs. */
const useRack = create<{ rack: MixerRack }>(() => ({ rack: 0 }));

/** Ducking and the master rack wait behind one Shaping toggle in beginner mode. */
const useShaping = () => useShown()('mixer', MASTER_RACK_LEVEL);

/** The rack under the strips: the one chosen, or bus A while the master's waits behind Shaping. */
function useShownRack(): MixerRack {
  const chosen = useRack((s) => s.rack);
  const shaping = useShaping();
  return chosen === 'master' && !shaping ? 0 : chosen;
}

function Fader({ spec, value, onChange, read, label, hint }: {
  spec: FloatSpec;
  value: number;
  onChange: (value: number) => void;
  read: () => [number, number];
  label: string;
  hint: string;
}) {
  const meter = useHint(MIXER_HINTS.meter);
  return (
    <div className="h-mixer-fader">
      <div className="h-mixer-meter" {...meter.props}>
        <Meter read={read} vertical width={14} height={FADER} />
      </div>
      <Slider
        vertical
        length={FADER}
        value={toNorm(spec, value)}
        onChange={(t) => onChange(fromNorm(spec, t))}
        label={label}
        display={formatValue(spec, value)}
        hint={hint}
      />
    </div>
  );
}

function FloatKnob({ spec, value, onChange, hint }: {
  spec: FloatSpec;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <Knob
      small
      value={toNorm(spec, value)}
      onChange={(t) => onChange(fromNorm(spec, t))}
      defaultValue={toNorm(spec, spec.def)}
      label={spec.label}
      display={formatValue(spec, value)}
      hint={hint}
      bipolar={spec.min === -spec.max}
    />
  );
}

function ChannelStrip({ channel, others, active }: { channel: Channel; others: Channel[]; active: boolean }) {
  const { id, sound } = channel;
  const shaping = useShaping();
  const name = useHint(`${sound.name}. ${MIXER_HINTS.name}`);
  return (
    <div className={cx('h-mixer-strip', active && 'is-active')} role="group" aria-label={sound.name}>
      <div
        className="h-mixer-head"
        onPointerDown={() => selectChannel(id)}
        onDoubleClick={() => setView('factory')}
        {...name.props}
      >
        <ColorChip color={channel.color} />
        <span className="h-mixer-name">{sound.name}</span>
      </div>
      <div className="h-mixer-cell is-pair">
        {channel.sends.map((value, index) => (
          <SendKnob key={index} small channelId={id} index={index} value={value} />
        ))}
      </div>
      <div className="h-mixer-cell is-duck">
        {shaping && (
          <>
            <Select
              value={channel.duck.source ?? ''}
              options={[{ value: '', label: 'None' }, ...others.map((c) => ({ value: c.id, label: c.sound.name }))]}
              onChange={(source) => setDuck(id, { source: source || null })}
              width={92}
              hint={MIXER_HINTS.duck}
            />
            <div className="h-mixer-pair">
              <FloatKnob
                spec={DUCK_AMOUNT}
                value={channel.duck.amount}
                onChange={(amount) => setDuck(id, { amount })}
                hint={MIXER_HINTS.duckAmount}
              />
              <FloatKnob
                spec={DUCK_RELEASE}
                value={channel.duck.release}
                onChange={(release) => setDuck(id, { release })}
                hint={MIXER_HINTS.duckRelease}
              />
            </div>
          </>
        )}
      </div>
      <div className="h-mixer-cell">
        <FloatKnob
          spec={PAN}
          value={sound.out.pan as number}
          onChange={(pan) => setParam(id, 'out', 'pan', pan)}
          hint={PARAM_HINTS.out.pan}
        />
      </div>
      <Fader
        spec={LEVEL}
        value={sound.out.level as number}
        onChange={(db) => setParam(id, 'out', 'level', db)}
        read={() => channelLevels(id)}
        label="Level"
        hint={MIXER_HINTS.level(sound.name)}
      />
      <div className="h-mixer-buttons">
        <Button small pressed={channel.mute} onClick={() => setChannel(id, { mute: !channel.mute })} hint={MUTE}>
          M
        </Button>
        <Button small pressed={channel.solo} onClick={() => setChannel(id, { solo: !channel.solo })} hint={SOLO}>
          S
        </Button>
      </div>
    </div>
  );
}

function BusStrip({ index }: { index: 0 | 1 }) {
  const bus = useApp((s) => s.project.mixer.buses[index]);
  const shown = useShownRack() === index;
  const head = useHint(MIXER_HINTS.bus(BUS_LETTERS[index], bus.name));
  return (
    <div className="h-mixer-strip is-bus" role="group" aria-label={bus.name}>
      <div className="h-mixer-head" {...head.props}>
        <span className="h-mixer-letter">{BUS_LETTERS[index]}</span>
        <span className="h-mixer-name">{bus.name}</span>
      </div>
      <div className="h-mixer-cell">
        <Button pressed={shown} onClick={() => useRack.setState({ rack: index })} hint={MIXER_HINTS.busRack(bus.name)}>
          Rack
        </Button>
      </div>
      <div className="h-mixer-cell is-duck" />
      <div className="h-mixer-cell" />
      <Fader
        spec={BUS_LEVEL}
        value={bus.level}
        onChange={(level) => setBus(index, { level })}
        read={() => busLevels(index)}
        label="Level"
        hint={MIXER_HINTS.busLevel(bus.name)}
      />
      <div className="h-mixer-buttons">
        <Button
          small
          pressed={bus.mute}
          onClick={() => setBus(index, { mute: !bus.mute })}
          hint={MIXER_HINTS.busMute(bus.name)}
        >
          M
        </Button>
      </div>
    </div>
  );
}

function MasterStrip() {
  const master = useApp((s) => s.project.master);
  const shaping = useShaping();
  const shown = useShownRack() === 'master';
  const head = useHint(MIXER_HINTS.masterStrip);
  return (
    <div className="h-mixer-strip is-master" role="group" aria-label="Master">
      <div className="h-mixer-head" {...head.props}>
        <span className="h-mixer-name">Master</span>
      </div>
      <div className="h-mixer-cell" />
      <div className="h-mixer-cell is-duck">
        {shaping && (
          <Button pressed={shown} onClick={() => useRack.setState({ rack: 'master' })} hint={MIXER_HINTS.masterRack}>
            Rack
          </Button>
        )}
      </div>
      <div className="h-mixer-cell" />
      <Fader spec={BUS_LEVEL} value={master} onChange={setMaster} read={levels} label="Master" hint={MASTER} />
      <div className="h-mixer-buttons" />
    </div>
  );
}

/** Captions for the rows at the left, and in beginner mode the toggle that shows the Shaping row. */
function Legend() {
  const beginner = usePrefs((p) => p.beginner);
  const shaping = useShaping();
  const lit = useApp((s) => s.project.channels.some((c) => c.duck.source !== null)
    || s.project.mixer.master.chain.length > 0);
  return (
    <div className="h-mixer-legend">
      <span />
      <span className="h-mixer-caption">Sends</span>
      <div className="h-mixer-caption is-duck">
        {beginner && (
          <FoldToggles
            folds={[{
              label: LEVEL_NAMES[2],
              open: shaping,
              lit,
              hint: 'Shows the ducking of each sound and the master rack; the lamp lights when either is in use.',
              onToggle: () => toggleFold('mixer', MASTER_RACK_LEVEL),
            }]}
          />
        )}
        {shaping && <span>Duck</span>}
      </div>
      <span className="h-mixer-caption">Pan</span>
      <span className="h-mixer-caption is-fader">Level</span>
      <span />
    </div>
  );
}

/** The effects of the bus or the master chosen in the strips, as rack units. */
function RackPanel({ rack }: { rack: MixerRack }) {
  const mixer = useApp((s) => s.project.mixer);
  const [draft, setDraft] = useState<string | null>(null);
  const chain = rack === 'master' ? mixer.master.chain : mixer.buses[rack].chain;
  return (
    <div className="h-mixer-rack">
      <div className="h-mixer-rack-head">
        {rack === 'master' ? (
          <span className="h-mixer-rack-title">Master</span>
        ) : (
          <>
            <span className="h-mixer-rack-title">{`Bus ${BUS_LETTERS[rack]}`}</span>
            <TextField
              value={draft ?? mixer.buses[rack].name}
              onChange={(name) => {
                setDraft(name);
                setBus(rack, { name });
              }}
              onCommit={() => setDraft(null)}
              width={140}
              hint={MIXER_HINTS.busName}
            />
          </>
        )}
        <span className="h-mixer-rack-note">
          {rack === 'master'
            ? 'Works on everything you hear, before the master level.'
            : 'Every sound can send to it with its send knob.'}
        </span>
      </div>
      <div className="h-factory-well">
        <div className="h-factory-scroll">
          <div className="h-factory-rack">
            <EffectChain owner={{ rack }} chain={chain} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MixerView() {
  const channels = useApp((s) => s.project.channels);
  const channelId = useApp((s) => s.channelId);
  const rack = useShownRack();
  return (
    <div className="h-mixer">
      <div className="h-mixer-well">
        <div className="h-mixer-scroll">
          <div className="h-mixer-strips">
            <Legend />
            {channels.map((c) => (
              <ChannelStrip
                key={c.id}
                channel={c}
                others={channels.filter((o) => o.id !== c.id)}
                active={c.id === channelId}
              />
            ))}
            <BusStrip index={0} />
            <BusStrip index={1} />
            <MasterStrip />
          </div>
        </div>
      </div>
      <RackPanel key={String(rack)} rack={rack} />
    </div>
  );
}
