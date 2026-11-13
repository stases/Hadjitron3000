import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { LEVEL_NAMES } from '../core/levels';
import { DEFAULT_METER, METERS, meterText } from '../core/meter';
import type { FloatSpec } from '../core/modules';
import { formatValue, fromNorm, toNorm } from '../core/params';
import { setBpm, setMaster, setMeter, setPlaying, setScope, setSwing, useApp } from '../state/store';
import { toggleFold, useShown } from '../ui/factory/levels';
import { Button, FoldToggles, Icon, Knob, Lcd, Meter, Scope, Select, Separator, Toolbar, setHint } from '../ui/kit';
import { levels, scope } from './audio';
import { fail } from './dialogStore';
import { usePrefs } from './prefs';

const SWING: FloatSpec = { kind: 'float', id: 'swing', label: 'Swing', min: 0, max: 1, def: 0, unit: '%' };
const MASTER: FloatSpec = {
  kind: 'float', id: 'master', label: 'Master', min: -48, max: 6, def: 0, unit: 'dB', step: 0.5,
};

const MIN_BPM = 40;
const MAX_BPM = 240;
const PX_PER_BPM = 2;
const TAP_WINDOW_MS = 2000;
const TAPS = 5;
const TEMPO_HINT = 'Tempo in beats per minute. Drag up or down, use the wheel, or double-click to type.';

const roundBpm = (bpm: number) => Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 10) / 10;

function Tempo() {
  const bpm = useApp((s) => s.project.bpm);
  const [typing, setTyping] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; start: number } | null>(null);
  const over = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = -Math.sign(e.deltaY);
      if (dir) setBpm(roundBpm(useApp.getState().project.bpm + dir * (e.shiftKey ? 0.1 : 1)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || typing !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, start: bpm };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    const next = roundBpm(e.shiftKey ? d.start + dy / 10 : Math.round(d.start + dy / PX_PER_BPM));
    if (next !== useApp.getState().project.bpm) setBpm(next);
    setHint(`Tempo: ${next.toFixed(1)} BPM`);
  };
  const onPointerUp = () => {
    drag.current = null;
    setHint(over.current ? TEMPO_HINT : null);
  };

  const commit = (text: string) => {
    if (cancelled.current) return;
    setTyping(null);
    const value = Number(text.trim().replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(value) || value < MIN_BPM || value > MAX_BPM) {
      void fail(`The tempo must be a number from ${MIN_BPM} to ${MAX_BPM}.`);
    } else if (roundBpm(value) !== bpm) {
      setBpm(roundBpm(value));
    }
  };

  return (
    <div
      ref={root}
      className="h-app-tempo"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onPointerEnter={() => {
        over.current = true;
        if (!drag.current) setHint(TEMPO_HINT);
      }}
      onPointerLeave={() => {
        over.current = false;
        if (!drag.current) setHint(null);
      }}
      onDoubleClick={() => {
        cancelled.current = false;
        setTyping(bpm.toFixed(1));
      }}
    >
      <Lcd big>
        {typing === null ? (
          <span className="h-app-bpm" role="spinbutton" aria-label="Tempo" aria-valuenow={bpm}>
            {bpm.toFixed(1)}
          </span>
        ) : (
          <input
            className="h-app-bpm"
            aria-label="Tempo"
            value={typing}
            autoFocus
            maxLength={5}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTyping(e.target.value)}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                cancelled.current = true;
                setTyping(null);
              }
            }}
          />
        )}{' '}
        <small>BPM</small>
      </Lcd>
    </div>
  );
}

/**
 * The time signature of the project, a Deep control: in beginner mode it waits behind a Deep toggle whose lamp is lit
 * when the project is not in 4/4.
 */
function TimeSignature() {
  const meter = useApp((s) => s.project.meter);
  const beginner = usePrefs((p) => p.beginner);
  const shown = useShown()('transport', 3);
  const text = meterText(meter);
  return (
    <>
      {beginner && (
        <FoldToggles
          row
          folds={[{
            label: LEVEL_NAMES[3],
            open: shown,
            lit: text !== meterText(DEFAULT_METER),
            hint: 'Shows the time signature; the lamp lights when the song is not in 4/4.',
            onToggle: () => toggleFold('transport', 3),
          }]}
        />
      )}
      {shown && (
        <Select
          value={text}
          options={METERS.map((m) => ({ value: meterText(m), label: meterText(m) }))}
          onChange={(value) => setMeter(METERS.find((m) => meterText(m) === value)!)}
          width={56}
          hint="Time signature: how many beats make a bar, for every block. Notes keep their places when it changes."
        />
      )}
    </>
  );
}

function TransportKnob({ spec, value, onChange, hint }: {
  spec: FloatSpec;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <Knob
      small
      side
      value={toNorm(spec, value)}
      onChange={(t) => onChange(fromNorm(spec, t))}
      defaultValue={toNorm(spec, spec.def)}
      label={spec.label}
      display={formatValue(spec, value)}
      hint={hint}
    />
  );
}

/** Sets the tempo from the spacing of the last few taps. */
function useTapTempo(): () => void {
  const taps = useRef<number[]>([]);
  return () => {
    const now = performance.now();
    const last = taps.current[taps.current.length - 1];
    taps.current = last !== undefined && now - last < TAP_WINDOW_MS ? [...taps.current, now].slice(-TAPS) : [now];
    const t = taps.current;
    if (t.length < 2) return;
    setBpm(roundBpm(60000 / ((t[t.length - 1] - t[0]) / (t.length - 1))));
  };
}

export function Transport() {
  const playing = useApp((s) => s.playing);
  const swing = useApp((s) => s.project.swing);
  const master = useApp((s) => s.project.master);
  const playScope = useApp((s) => s.scope);
  const tapTempo = useTapTempo();

  return (
    <Toolbar className="h-app-transport">
      <Button
        square
        pressed={playing}
        onClick={() => setPlaying(true)}
        hint="Play from the start (Space)."
        data-tour="play"
      >
        <Icon name="play" />
      </Button>
      <Button square onClick={() => setPlaying(false)} hint="Stop playing (Space).">
        <Icon name="stop" />
      </Button>
      <Separator vertical />
      <Tempo />
      <TimeSignature />
      <Button onClick={tapTempo} hint="Tap a few times in time to set the tempo.">
        Tap
      </Button>
      <TransportKnob spec={SWING} value={swing} onChange={setSwing} hint="Pushes every second sixteenth a little late." />
      <Separator vertical />
      <div className="h-app-joined">
        <Button
          pressed={playScope === 'pattern'}
          onClick={() => setScope('pattern')}
          hint="Play the current block over and over."
        >
          Block
        </Button>
        <Button
          pressed={playScope === 'song'}
          onClick={() => setScope('song')}
          hint="Play the whole song, with the blocks of all lanes together."
        >
          Song
        </Button>
      </div>
      <Separator vertical />
      <div className="h-app-spacer" />
      <Scope read={scope} width={150} height={30} />
      <Meter read={levels} />
      <TransportKnob spec={MASTER} value={master} onChange={setMaster} hint="Volume of everything you hear and export." />
    </Toolbar>
  );
}
