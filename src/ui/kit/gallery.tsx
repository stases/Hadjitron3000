// The widget gallery (kit.html): every widget in every state. A hash such as #knobs shows one section;
// #dialog and #message show the dialogs section with one of them open.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LEVEL_NAMES, byLevel } from '../../core/levels';
import { EFFECTS, MODS, SOURCES } from '../../core/modules';
import { DIVISIONS, sweep, timebase } from '../../core/scope';
import type { ModuleDef, ParamSpec } from '../../core/modules';
import { defaultParams } from '../../core/params';
import type { Params } from '../../core/types';
import {
  Button,
  Checkbox,
  ColorChip,
  Dialog,
  DialogButtons,
  Display,
  GroupBox,
  Icon,
  Knob,
  Lcd,
  Led,
  ListBox,
  MenuBar,
  MessageBox,
  Meter,
  ParamControl,
  ProgressBar,
  RackUnit,
  Scope,
  Select,
  Separator,
  Slider,
  StatusBar,
  StatusField,
  Stepper,
  TabPage,
  Tabs,
  TextField,
  Toolbar,
  Well,
  Window,
  drawLine,
  openMenu,
  tokenColor,
  useHintText,
} from './index';
import type { IconName, ListItem, MenuItem } from './index';
import { SpriteImage } from './Icon';
import { EMBLEM, ICONS } from './icons';
import { MenuPanel } from './Menu';
import { SelectList } from './Select';
import './gallery.css';

const noop = () => {};

const MENUS: { label: string; items: MenuItem[] }[] = [
  {
    label: 'File',
    items: [
      { label: 'New Project', shortcut: 'Ctrl+N', onSelect: noop },
      { label: 'Open…', shortcut: 'Ctrl+O', onSelect: noop },
      { label: 'Save', shortcut: 'Ctrl+S', onSelect: noop },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', onSelect: noop },
      'separator',
      { label: 'Export MP3…', onSelect: noop },
      'separator',
      { label: 'Quit', shortcut: 'Ctrl+Q', onSelect: noop },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo Change Cutoff', shortcut: 'Ctrl+Z', onSelect: noop },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: true },
      'separator',
      { label: 'Cut', shortcut: 'Ctrl+X', onSelect: noop },
      { label: 'Copy', shortcut: 'Ctrl+C', onSelect: noop },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: true },
      'separator',
      {
        label: 'Snap',
        items: [
          { label: 'Off', onSelect: noop },
          { label: '1/16', checked: true, onSelect: noop },
          { label: '1/8', onSelect: noop },
          { label: '1/4', onSelect: noop },
        ],
      },
      { label: 'Follow Playback', checked: true, onSelect: noop },
    ],
  },
  { label: 'Sound', items: [{ label: 'New Sound', onSelect: noop }, { label: 'Add Effect', items: [] }] },
  { label: 'Track', items: [{ label: 'Add Block', onSelect: noop }] },
  { label: 'Help', items: [{ label: 'About Hadjitron 3000…', onSelect: noop }] },
];

const SECTIONS = [
  'chrome',
  'buttons',
  'knobs',
  'sliders',
  'fields',
  'tabs',
  'lists',
  'menus',
  'displays',
  'rack',
  'grid',
  'icons',
  'dialogs',
] as const;
type Section = (typeof SECTIONS)[number];

function useSection(): Section | null {
  const read = () => {
    const h = location.hash.slice(1);
    if (h === 'dialog' || h === 'message') return 'dialogs';
    return (SECTIONS as readonly string[]).includes(h) ? (h as Section) : null;
  };
  const [section, setSection] = useState(read);
  useEffect(() => {
    const on = () => setSection(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return section;
}

function Row({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="g-row">
      {label && <span className="g-row-label">{label}</span>}
      {children}
    </div>
  );
}

/** Puts keyboard focus on the first focusable element inside, so its focus look can be photographed. */
function Focused({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus({ preventScroll: true });
  }, []);
  return (
    <span ref={ref} className="g-focused">
      {children}
    </span>
  );
}

function ChromeSection() {
  return (
    <GroupBox label="Windows, menus and bars" className="g-wide">
      <div className="g-cols">
        <Window
          title="Active window"
          icon={<Icon name="app" />}
          controls={{ onMinimize: noop, onMaximize: noop, onClose: noop }}
          style={{ width: 300 }}
        >
          <MenuBar menus={MENUS} />
          <Separator />
          <Toolbar>
            <Button square pressed onClick={noop} hint="Play">
              <Icon name="play" />
            </Button>
            <Button square onClick={noop} hint="Stop">
              <Icon name="stop" />
            </Button>
            <Separator vertical />
            <Button onClick={noop}>Tap</Button>
          </Toolbar>
          <StatusBar>
            <StatusField>Ready.</StatusField>
            <StatusField width={70}>44.1 kHz</StatusField>
          </StatusBar>
        </Window>
        <Window title="Inactive window" icon={<Icon name="app" />} active={false} controls={{ onClose: noop }} style={{ width: 260 }}>
          <div className="g-pad">A window without focus has a grey title bar.</div>
        </Window>
        <Window title="No buttons" style={{ width: 200 }}>
          <div className="g-pad">Without controls no buttons are drawn.</div>
        </Window>
      </div>
    </GroupBox>
  );
}

function ButtonsSection() {
  const [mode, setMode] = useState('pattern');
  const [loop, setLoop] = useState(true);
  return (
    <GroupBox label="Buttons">
      <Row label="Normal">
        <Button onClick={noop} hint="A plain button.">
          Tap
        </Button>
        <Button primary onClick={noop} hint="The default button of a dialog.">
          OK
        </Button>
        <Focused>
          <Button onClick={noop}>Focused</Button>
        </Focused>
        <Button disabled onClick={noop}>
          Disabled
        </Button>
      </Row>
      <Row label="Toggles">
        <span className="g-joined">
          <Button pressed={mode === 'pattern'} onClick={() => setMode('pattern')}>
            Pattern
          </Button>
          <Button pressed={mode === 'song'} onClick={() => setMode('song')}>
            Song
          </Button>
        </span>
        <Button pressed={loop} onClick={() => setLoop(!loop)}>
          <Icon name="sample" /> Loop
        </Button>
      </Row>
      <Row label="Square">
        <Button square pressed onClick={noop}>
          <Icon name="play" />
        </Button>
        <Button square onClick={noop}>
          <Icon name="stop" />
        </Button>
        <Button square onClick={noop}>
          <Icon name="folder" />
        </Button>
        <Button square onClick={noop}>
          <Icon name="floppy" />
        </Button>
        <Button square disabled onClick={noop}>
          <Icon name="speaker" />
        </Button>
      </Row>
      <Row label="Small">
        <Button small onClick={noop}>
          M
        </Button>
        <Button small pressed onClick={noop}>
          S
        </Button>
        <Button small square onClick={noop}>
          <Icon name="up" />
        </Button>
        <Button small square onClick={noop}>
          <Icon name="down" />
        </Button>
        <Button small square onClick={noop}>
          <Icon name="close" />
        </Button>
        <Button small square disabled onClick={noop}>
          <Icon name="plus" />
        </Button>
      </Row>
    </GroupBox>
  );
}

function DemoKnob({ v, ...rest }: { v: number; label: string; small?: boolean; steps?: number; disabled?: boolean }) {
  const [value, setValue] = useState(v);
  const display = rest.steps ? String(Math.round(value * (rest.steps - 1)) + 1) : `${Math.round(value * 100)} %`;
  return (
    <Knob
      {...rest}
      value={value}
      onChange={setValue}
      defaultValue={v}
      display={display}
      hint={`${rest.label}. Drag up or down; double-click resets.`}
    />
  );
}

function KnobsSection() {
  return (
    <GroupBox label="Knobs">
      <Row>
        <DemoKnob v={0} label="Min" />
        <DemoKnob v={0.25} label="Quarter" />
        <DemoKnob v={0.5} label="Half" />
        <DemoKnob v={0.75} label="Mix" />
        <DemoKnob v={1} label="Max" />
        <Focused>
          <DemoKnob v={0.62} label="Focus" />
        </Focused>
        <DemoKnob v={0.4} label="Off" disabled />
      </Row>
      <Row>
        <DemoKnob v={0} label="Small" small />
        <DemoKnob v={0.5} label="Small" small />
        <DemoKnob v={0.9} label="Small" small />
        <DemoKnob v={2 / 6} label="Voices" steps={7} />
        <DemoKnob v={0.3} label="Small" small disabled />
      </Row>
    </GroupBox>
  );
}

function SlidersSection() {
  const [a, setA] = useState(0.3);
  const [b, setB] = useState(0.7);
  const [c, setC] = useState(0.5);
  return (
    <GroupBox label="Sliders">
      <div className="g-cols">
        <div className="g-stack">
          <Slider value={a} onChange={setA} hint="A trackbar." />
          <Slider value={b} onChange={setB} label="Volume" display={`${Math.round(b * 100)} %`} length={160} />
          <Slider value={0.5} onChange={noop} label="Disabled" display="50 %" disabled />
        </div>
        <Slider vertical value={c} onChange={setC} length={90} label="Level" display={`${Math.round(c * 100)}`} />
      </div>
    </GroupBox>
  );
}

const WAVE_OPTIONS = [
  { value: 'lowpass', label: 'Low pass' },
  { value: 'highpass', label: 'High pass' },
  { value: 'bandpass', label: 'Band pass' },
  { value: 'notch', label: 'Notch' },
  { value: 'peak', label: 'Peak' },
];

function FieldsSection() {
  const [sel, setSel] = useState('lowpass');
  const [bpm, setBpm] = useState(128);
  const [bars, setBars] = useState(2);
  const [name, setName] = useState('Warm Pluck');
  const [blank, setBlank] = useState('');
  const [check, setCheck] = useState(true);
  const [check2, setCheck2] = useState(false);
  return (
    <GroupBox label="Fields">
      <div className="g-cols">
        <div className="g-stack">
          <Row label="Select">
            <Select value={sel} options={WAVE_OPTIONS} onChange={setSel} hint="Filter mode." />
          </Row>
          <Row label="Focused">
            <Focused>
              <Select value="highpass" options={WAVE_OPTIONS} onChange={noop} />
            </Focused>
          </Row>
          <Row label="Disabled">
            <Select value="bandpass" options={WAVE_OPTIONS} onChange={noop} disabled />
          </Row>
          <Row label="Open">
            <div className="g-open-select">
              <Select value="highpass" options={WAVE_OPTIONS} onChange={noop} />
              <SelectList options={WAVE_OPTIONS} active={2} style={{ width: 120 }} />
            </div>
          </Row>
        </div>
        <div className="g-stack">
          <Row label="Stepper">
            <Stepper value={bpm} min={20} max={300} step={0.1} onChange={setBpm} hint="Tempo." />
            <Stepper value={bars} min={1} max={8} onChange={setBars} width={48} format={(v) => `${v} b`} />
          </Row>
          <Row label="Disabled">
            <Stepper value={4} min={1} max={8} onChange={noop} width={40} disabled />
          </Row>
          <Row label="Text">
            <TextField value={name} onChange={setName} width={120} />
          </Row>
          <Row label="Empty">
            <TextField value={blank} onChange={setBlank} placeholder="Sound name" width={120} />
          </Row>
          <Row label="Disabled">
            <TextField value="Read only" onChange={noop} width={120} disabled />
          </Row>
          <Row label="Check">
            <Checkbox checked={check} onChange={setCheck} label="Loop" hint="Play the sample in a loop." />
            <Checkbox checked={check2} onChange={setCheck2} label="Reverse" />
          </Row>
          <Row label="">
            <Checkbox checked onChange={noop} label="Disabled" disabled />
            <Checkbox checked={false} onChange={noop} label="Off" disabled />
          </Row>
        </div>
      </div>
    </GroupBox>
  );
}

function TabsSection() {
  const [tab, setTab] = useState('track');
  return (
    <GroupBox label="Tabs">
      <div style={{ width: 280 }}>
        <Tabs
          tabs={[
            { id: 'factory', label: 'Factory' },
            { id: 'track', label: 'Track' },
            { id: 'song', label: 'Song' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <TabPage>
          <div style={{ height: 60 }}>The {tab} page.</div>
        </TabPage>
      </div>
    </GroupBox>
  );
}

const LIST: ListItem[] = [
  { header: 'In this track' },
  { id: 'kick', label: 'Kick', color: 0 },
  { id: 'snare', label: 'Snare', color: 1 },
  { id: 'hat', label: 'Hat', color: 2 },
  { id: 'pluck', label: 'Warm Pluck', color: 4 },
  { id: 'pad', label: 'Pad', color: 6 },
  { header: 'Library' },
  { id: 'sub', label: 'Sub Bass', icon: 'note' },
  { id: 'kalimba', label: 'Kalimba', icon: 'note' },
  { id: 'tape', label: 'Tape Keys', icon: 'note' },
  { id: 'rain', label: 'Rain', icon: 'noise' },
  { id: 'vinyl', label: 'Vinyl Crackle', icon: 'sample' },
  { id: 'bell', label: 'Glass Bell', icon: 'note' },
];

function ListsSection() {
  const [a, setA] = useState<string | null>('pluck');
  const [b, setB] = useState<string | null>('tape');
  return (
    <GroupBox label="Lists">
      <div className="g-cols">
        <div style={{ width: 150 }}>
          <ListBox items={LIST.slice(0, 11)} value={a} onChange={setA} />
        </div>
        <Focused>
          <div style={{ width: 150 }}>
            <ListBox items={LIST} value={b} onChange={setB} height={130} />
          </div>
        </Focused>
      </div>
    </GroupBox>
  );
}

/** Opens Edit > Snap on the demo menu bar with synthetic input, so the open menu can be photographed. */
function useOpenDemoMenu(ref: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const keys = ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown'];
    const timers: number[] = [];
    document.fonts.ready.then(() => {
      const item = ref.current?.querySelectorAll('.h-menubar-item')[1];
      item?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      keys.forEach((key, i) =>
        timers.push(window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })), 30 * (i + 1))),
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [ref]);
}

function MenusSection() {
  const bar = useRef<HTMLDivElement>(null);
  useOpenDemoMenu(bar);
  return (
    <GroupBox label="Menus" className="g-wide">
      <div className="g-cols">
        <div className="g-menu-demo" ref={bar}>
          <Window title="Menu bar" style={{ width: 280 }}>
            <MenuBar menus={MENUS} />
          </Window>
        </div>
        <div className="g-stack">
          <Button
            onClick={() =>
              openMenu(
                [{ label: 'Rename…', onSelect: noop }, { label: 'Duplicate', onSelect: noop }, 'separator', { label: 'Delete', onSelect: noop }],
                200,
                200,
              )
            }
          >
            Popup menu
          </Button>
          <MenuPanel
            items={[
              { label: 'Rename…' },
              { label: 'Duplicate' },
              { label: 'Colour', items: [] },
              'separator',
              { label: 'Delete', disabled: true },
            ]}
            active={1}
          />
          <MenuPanel
            items={[
              { heading: 'Basics' },
              { label: 'Filter' },
              { label: 'Delay' },
              { heading: 'Shaping' },
              { label: 'Drive' },
              'separator',
              { label: 'Deep', items: [] },
            ]}
            active={2}
          />
        </div>
      </div>
    </GroupBox>
  );
}

function fakeSignal(buf: Float32Array) {
  const t = performance.now() / 1000;
  for (let i = 0; i < buf.length; i++) {
    const x = i / buf.length;
    const env = Math.exp(-((x * 2 + t) % 1) * 3);
    buf[i] = 0.75 * env * Math.sin(2 * Math.PI * (x * 5 + t * 0.3)) * (0.8 + 0.2 * Math.sin(2 * Math.PI * x * 17));
  }
}

const BENCH_RATE = 48000;

/** A plucked 220 Hz tone every six seconds, so the bench scope shows a running, a held and a resting trace. */
function fakeNote(buf: Float32Array) {
  const now = performance.now() / 1000;
  for (let i = 0; i < buf.length; i++) {
    const t = (now - (buf.length - 1 - i) / BENCH_RATE) % 6;
    const ph = 2 * Math.PI * 220 * t;
    buf[i] = t < 1.5 ? 0.6 * Math.exp(-2 * t) * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph)) : 0;
  }
}

const benchSweep = (buf: Float32Array) => sweep(buf, BENCH_RATE * DIVISIONS * timebase(220));

function fakeLevels(): [number, number] {
  const t = performance.now() / 1000;
  const beat = Math.exp(-((t * 2) % 1) * 4);
  return [0.05 + beat * 0.9, 0.04 + beat * 0.75];
}

function drawEnvelope(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = tokenColor('--amber-dim');
  for (let x = 2; x < w; x += 4) for (let y = 3; y < h; y += 12) g.fillRect(x, y, 1, 1);
  const amber = tokenColor('--amber');
  const bottom = h - 5;
  let px = 4;
  let py = bottom;
  const to = (x: number, y: number) => {
    drawLine(g, px, py, x, y, amber);
    px = x;
    py = y;
  };
  to(10, 5);
  for (let x = 11; x <= 70; x++) to(x, Math.round(32 - 27 * Math.exp(-(x - 10) / 14)));
  to(120, py);
  for (let x = 121; x <= w - 5; x++) to(x, Math.round(bottom - (bottom - 32) * Math.exp(-(x - 120) / 10)));
}

function DisplaysSection() {
  const [leds, setLeds] = useState([true, false, true, true]);
  return (
    <GroupBox label="Displays" className="g-wide">
      <Row>
        <Lcd big>
          128.0 <small>BPM</small>
        </Lcd>
        <Lcd>C3 · 1/16</Lcd>
        <Scope read={fakeSignal} width={150} height={30} />
        <Meter read={fakeLevels} />
        <Meter read={fakeLevels} vertical width={14} height={52} />
        <Display width={170} height={52} draw={drawEnvelope} />
      </Row>
      <Row label="Bench scope">
        <Scope read={fakeNote} sweep={benchSweep} width={361} height={97} samples={8192} />
      </Row>
      <Row label="Lamps">
        {(['red', 'green', 'amber'] as const).map((c) => (
          <span className="g-pair" key={c}>
            <Led on color={c} />
            <Led on={false} color={c} />
          </span>
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((c) => (
          <span className="g-pair" key={c}>
            <Led on color={c} />
            <Led on={false} color={c} />
          </span>
        ))}
        {leds.map((on, i) => (
          <Led
            key={i}
            on={on}
            onClick={() => setLeds(leds.map((v, j) => (j === i ? !v : v)))}
            hint="Click to switch the lamp."
          />
        ))}
      </Row>
      <Row label="Progress">
        <div style={{ width: 200 }}>
          <ProgressBar value={0.62} />
        </div>
        <div style={{ width: 120 }}>
          <ProgressBar value={1} />
        </div>
      </Row>
    </GroupBox>
  );
}

function ModuleRack({ def, led, moves }: { def: ModuleDef; led?: boolean; moves?: boolean }) {
  const [params, setParams] = useState<Params>(() => defaultParams(def));
  const [on, setOn] = useState(true);
  return (
    <RackUnit
      name={def.label}
      led={led ? { on, onToggle: () => setOn(!on) } : undefined}
      onMoveUp={moves ? noop : undefined}
      onMoveDown={moves ? noop : undefined}
      onRemove={moves ? noop : undefined}
    >
      {def.params.map((p) => (
        <ParamControl
          key={p.id}
          spec={p}
          value={params[p.id]}
          onChange={(v) => setParams({ ...params, [p.id]: v })}
          hint={`${p.label}.`}
        />
      ))}
    </RackUnit>
  );
}

/** A unit in beginner mode: Basics in the row, the other levels behind fold toggles (Shaping open). */
function FoldedRack({ def }: { def: ModuleDef }) {
  const defaults = defaultParams(def);
  const [params, setParams] = useState<Params>(() => ({ ...defaults, voices: 3 }));
  const [open, setOpen] = useState<Record<number, boolean>>({ 2: true });
  const groups = byLevel(def.params);
  const control = (p: ParamSpec) => (
    <ParamControl
      key={p.id}
      spec={p}
      value={params[p.id]}
      onChange={(v) => setParams({ ...params, [p.id]: v })}
      hint={`${p.label}.`}
    />
  );
  return (
    <RackUnit
      name={def.label}
      folds={([2, 3] as const).map((level) => ({
        label: LEVEL_NAMES[level],
        open: !!open[level],
        lit: groups[level].some((p) => params[p.id] !== defaults[p.id]),
        hint: `${LEVEL_NAMES[level]} controls.`,
        onToggle: () => setOpen({ ...open, [level]: !open[level] }),
        children: groups[level].map(control),
      }))}
    >
      {groups[1].map(control)}
    </RackUnit>
  );
}

function RackSection() {
  const fm = SOURCES.find((d) => d.type === 'fm')!;
  const osc = SOURCES.find((d) => d.type === 'osc')!;
  const sampler = SOURCES.find((d) => d.type === 'sample')!;
  return (
    <GroupBox label="Rack units" className="g-wide">
      <div className="g-rack">
        <ModuleRack def={osc} />
        <FoldedRack def={osc} />
        <ModuleRack def={fm} />
        <ModuleRack def={sampler} />
        {EFFECTS.map((d) => (
          <ModuleRack key={d.type} def={d} led moves />
        ))}
        {MODS.map((d) => (
          <ModuleRack key={d.type} def={d} led />
        ))}
      </div>
    </GroupBox>
  );
}

const GRID_ROWS: { name: string; color: number; on: boolean; solo?: boolean; steps: Record<number, string | true> }[] = [
  { name: 'Kick', color: 0, on: true, steps: { 0: true, 4: true, 8: true, 12: true, 16: true, 20: true, 24: true, 27: true } },
  { name: 'Snare', color: 1, on: true, steps: { 4: true, 12: true, 20: true, 28: true, 30: true } },
  { name: 'Hat', color: 2, on: true, solo: true, steps: { 2: true, 6: true, 10: true, 14: true, 16: true, 18: true, 22: true, 26: true, 30: true, 31: true } },
  { name: 'Warm Pluck', color: 4, on: true, steps: { 0: 'C3', 4: 'G3', 10: 'A#3', 15: 'D4', 20: 'C3', 24: 'G3', 28: 'F3' } },
  { name: 'Pad', color: 6, on: false, steps: { 0: 'C2', 16: 'G2' } },
];
const LONG: Record<string, number> = { 'Pad:0': 6, 'Pad:16': 4, 'Warm Pluck:10': 2 };
const PLAY = 6;

function GridSection() {
  return (
    <GroupBox label="Step grid (mock-up of the Track view)" className="g-wide">
      <Well className="g-grid">
        <div />
        <div className="g-ruler">
          {Array.from({ length: 32 }, (_, i) => (
            <span key={i} className={i === PLAY ? 'is-now' : undefined}>
              {i === PLAY ? '▾' : i % 16 === 0 ? i / 16 + 1 : i % 4 === 0 ? '·' : ''}
            </span>
          ))}
        </div>
        {GRID_ROWS.map((row) => (
          <GridRow key={row.name} {...row} />
        ))}
      </Well>
    </GroupBox>
  );
}

const CELL = 24;
const GAP = 2;
const BEAT_GAP = 4;

/** Width of a note of `len` steps from step `i`, across the cell gaps and the wider gaps after each beat. */
const noteWidth = (i: number, len: number) => {
  let w = len * CELL + (len - 1) * GAP;
  for (let j = i; j < i + len - 1; j++) if (j % 4 === 3) w += BEAT_GAP;
  return w;
};

function GridRow({ name, color, on, solo, steps }: (typeof GRID_ROWS)[number]) {
  const cells: ReactNode[] = [];
  for (let i = 0; i < 32; ) {
    const step = steps[i];
    const len = step ? (LONG[`${name}:${i}`] ?? 1) : 1;
    const last = i + len - 1;
    const style = step ? ({ '--cell': `var(--c${color})`, width: noteWidth(i, len) } as CSSProperties) : undefined;
    cells.push(
      <div
        key={i}
        className={[
          'g-cell',
          i % 4 === 0 && 'is-beat',
          step && 'is-on',
          PLAY >= i && PLAY <= last && 'is-now',
          last % 4 === 3 && 'is-group-end',
        ]
          .filter(Boolean)
          .join(' ')}
        style={style}
      >
        {typeof step === 'string' ? step : ''}
      </div>,
    );
    i += len;
  }
  return (
    <>
      <div className="g-track-head">
        <Led on={on} color={color} />
        <span className="g-track-name">{name}</span>
        <Button small onClick={noop} pressed={!on}>
          M
        </Button>
        <Button small onClick={noop} pressed={solo}>
          S
        </Button>
      </div>
      <div className="g-cells">{cells}</div>
    </>
  );
}

const ICON_NAMES = Object.keys(ICONS) as IconName[];

function IconsSection() {
  return (
    <GroupBox label="Icons and emblem" className="g-wide">
      <div className="g-icons">
        {ICON_NAMES.map((n) => (
          <span key={n} className="g-icon" title={n}>
            <Icon name={n} />
            <span className="g-icon-name">{n}</span>
          </span>
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((c) => (
          <span key={c} className="g-icon">
            <ColorChip color={c} />
            <span className="g-icon-name">chip {c}</span>
          </span>
        ))}
      </div>
      <div className="g-emblems">
        <SpriteImage sprite={EMBLEM} />
        <span className="g-emblem-title">
          <Icon name="app" />
        </span>
      </div>
    </GroupBox>
  );
}

/** #dialog and #message open one of the two, so each can be photographed. */
function DialogsSection() {
  const [dialog, setDialog] = useState(location.hash === '#dialog');
  const [box, setBox] = useState(location.hash === '#message');
  const [bpm, setBpm] = useState(128);
  const [name, setName] = useState('Untitled');
  return (
    <GroupBox label="Dialogs">
      <Row>
        <Button onClick={() => setDialog(true)}>Project Settings…</Button>
        <Button onClick={() => setBox(true)}>Message…</Button>
      </Row>
      {dialog && (
        <Dialog title="Project Settings" onClose={() => setDialog(false)} width={300}>
          <div className="g-form">
            <span>Name:</span>
            <TextField value={name} onChange={setName} width={160} />
            <span>Tempo:</span>
            <Stepper value={bpm} min={20} max={300} step={0.1} onChange={setBpm} format={(v) => `${v.toFixed(1)}`} />
            <span />
            <Checkbox checked onChange={noop} label="Loop the song" />
          </div>
          <DialogButtons>
            <Button primary onClick={() => setDialog(false)}>
              OK
            </Button>
            <Button onClick={() => setDialog(false)}>Cancel</Button>
          </DialogButtons>
        </Dialog>
      )}
      {box && (
        <MessageBox
          title="Hadjitron 3000"
          icon="warning"
          text="Save changes to Untitled.h3k before closing? Your changes will be lost if you don't save them."
          buttons={[
            { label: 'Save', value: 'save', primary: true },
            { label: "Don't Save", value: 'discard' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChoose={() => setBox(false)}
        />
      )}
    </GroupBox>
  );
}

function Gallery() {
  const section = useSection();
  const hint = useHintText();
  const show = (s: Section) => section === null || section === s;
  return (
    <div className="g-desk">
      <Window
        title="Hadjitron 3000 – Widget Kit"
        icon={<Icon name="app" />}
        controls={{ onMinimize: noop, onMaximize: noop, onClose: noop }}
        className="g-window"
      >
        <MenuBar menus={MENUS} />
        <Separator />
        <div className="g-sections">
          {show('chrome') && <ChromeSection />}
          {show('buttons') && <ButtonsSection />}
          {show('knobs') && <KnobsSection />}
          {show('sliders') && <SlidersSection />}
          {show('fields') && <FieldsSection />}
          {show('tabs') && <TabsSection />}
          {show('lists') && <ListsSection />}
          {show('menus') && <MenusSection />}
          {show('displays') && <DisplaysSection />}
          {show('rack') && <RackSection />}
          {show('grid') && <GridSection />}
          {show('icons') && <IconsSection />}
          {show('dialogs') && <DialogsSection />}
        </div>
        <StatusBar>
          <StatusField>{hint || 'Ready.'}</StatusField>
          <StatusField width={120}>{section ? `#${section}` : 'All sections'}</StatusField>
          <StatusField width={70}>44.1 kHz</StatusField>
        </StatusBar>
      </Window>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Gallery />);
