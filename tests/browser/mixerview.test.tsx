// The Mixer tab: strips that edit the same values as the Factory and the Track, sends, ducking by level, the racks
// of the buses and the master, and the meters.

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { busLevels, channelLevels, effectReduction, levels } from '../../src/app/audio';
import { usePrefs } from '../../src/app/prefs';
import { newSound } from '../../src/core/defaults';
import { demoProject } from '../../src/presets/projects';
import {
  addChannel, addEffect, openProject, selectChannel, setBus, setChannel, setDuck, setParam, undo, useApp,
} from '../../src/state/store';
import { FactoryView } from '../../src/ui/factory';
import { useFolds } from '../../src/ui/factory/levels';
import { useHintText } from '../../src/ui/kit';
import { MixerView } from '../../src/ui/mixer';

vi.mock('../../src/app/audio', () => ({
  channelLevels: vi.fn(() => [0.5, 0.4]),
  busLevels: vi.fn(() => [0.1, 0.1]),
  levels: vi.fn(() => [0.3, 0.3]),
  effectReduction: vi.fn(() => -3.04),
  channelScope: vi.fn((_: string, out: Float32Array) => out.fill(0)),
  soundingNote: () => null,
  sampleRate: () => 48000,
  isHeld: () => false,
  onHeldChange: () => () => {},
  noteOn: vi.fn(),
  noteOff: vi.fn(),
}));

let root: Root;
let host: HTMLElement;

function show(view: 'mixer' | 'factory' = 'mixer') {
  flushSync(() => root.render(view === 'mixer' ? <MixerView /> : <FactoryView />));
}

beforeEach(async () => {
  await page.viewport(1400, 800);
  usePrefs.setState({ beginner: true });
  useFolds.setState({}, true);
  openProject(demoProject(), null);
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; display: flex; flex-direction: column; width: 1380px; height: 760px';
  document.body.append(host);
  root = createRoot(host);
  show();
});

afterEach(async () => {
  await userEvent.cleanup();
  root.unmount();
  host.remove();
  vi.clearAllMocks();
});

const state = () => useApp.getState();
const project = () => state().project;
const channel = (name: string) => project().channels.find((c) => c.sound.name === name)!;
const strips = () => [...host.querySelectorAll<HTMLElement>('.h-mixer-strip')].map((s) => s.getAttribute('aria-label'));
const strip = (name: string) => host.querySelector<HTMLElement>(`.h-mixer-strip[aria-label="${name}"]`)!;
const control = (name: string, label: string) =>
  strip(name).querySelector<HTMLElement>(`[role="slider"][aria-label="${label}"]`);
const value = (name: string, label: string) => Number(control(name, label)!.getAttribute('aria-valuenow'));
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
const pro = () => flushSync(() => usePrefs.setState({ beginner: false }));
const shaping = () => button(host.querySelector('.h-mixer-legend')!, 'Shaping');
const units = () => [...host.querySelectorAll('.h-mixer-rack .h-rack')].map((u) => u.getAttribute('aria-label'));
const rack = (name: string) => host.querySelector<HTMLElement>(`.h-mixer-rack .h-rack[aria-label="${name}"]`)!;

test('a strip per sound in the order of the project, then the two buses and the master', () => {
  expect(strips()).toEqual([...project().channels.map((c) => c.sound.name), 'Room', 'Echo', 'Master']);
  const chips = [...host.querySelectorAll<HTMLElement>('.h-mixer-strip .h-chip')].map((c) => c.style.background);
  expect(chips).toEqual(project().channels.map((c) => `var(--c${c.color})`));
});

test('level, pan, mute and solo are the values the Factory and the Track edit', async () => {
  const kick = channel('Kick');
  expect(value('Kick', 'Level')).toBeCloseTo((Number(kick.sound.out.level) + 48) / 54, 5);
  flushSync(() => setParam(kick.id, 'out', 'level', -24));
  expect(value('Kick', 'Level')).toBeCloseTo(24 / 54, 5);
  control('Kick', 'Level')!.focus();
  await userEvent.keyboard('{ArrowUp}');
  expect(channel('Kick').sound.out.level).toBeCloseTo(-24 + 0.02 * 54, 5);
  control('Kick', 'Pan')!.focus();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  expect(channel('Kick').sound.out.pan).toBeCloseTo(-0.08, 5);
  await userEvent.click(button(strip('Kick'), 'M')!);
  await userEvent.click(button(strip('Clap'), 'S')!);
  expect([channel('Kick').mute, channel('Clap').solo]).toEqual([true, true]);
  flushSync(() => setChannel(channel('Kick').id, { mute: false }));
  expect(button(strip('Kick'), 'M')!.getAttribute('aria-pressed')).toBe('false');
  // A strip picks its sound for the keyboard and the Factory.
  await userEvent.click(strip('Hat').querySelector('.h-mixer-head')!);
  expect(state().channelId).toBe(channel('Hat').id);
  expect(strip('Hat').classList.contains('is-active')).toBe(true);
});

test('the send knobs are named after the buses, in the strips and in the Factory\'s Output unit', async () => {
  const pad = channel('Warm Pad');
  expect([...strip('Warm Pad').querySelectorAll('[role="slider"]')].map((k) => k.getAttribute('aria-label')))
    .toEqual(['Room', 'Echo', 'Pan', 'Level']);
  control('Warm Pad', 'Room')!.focus();
  await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
  expect(channel('Warm Pad').sends).toEqual([0.21, 0]);
  // Three steps of a knob turned are one step back.
  undo();
  expect(channel('Warm Pad').sends).toEqual([0.15, 0]);
  flushSync(() => setBus(1, { name: 'Tape' }));
  expect(control('Warm Pad', 'Tape')).not.toBeNull();

  flushSync(() => selectChannel(pad.id));
  show('factory');
  const output = host.querySelector<HTMLElement>('.h-rack[aria-label="Output"]')!;
  const knobs = [...output.querySelectorAll('[role="slider"]')].map((k) => k.getAttribute('aria-label'));
  expect(knobs).toEqual(['Level', 'Pan', 'Room', 'Tape']);
  expect(output.querySelector('.h-factory-group-label')!.textContent).toBe('Sends');
  (output.querySelector('[role="slider"][aria-label="Tape"]') as HTMLElement).focus();
  await userEvent.keyboard('{End}');
  expect(channel('Warm Pad').sends).toEqual([0.15, 1]);
});

test('ducking waits behind Shaping in beginner mode with the master rack, and is on the strips in pro', async () => {
  expect(strip('Warm Pad').querySelector('[role="combobox"]')).toBeNull();
  expect(button(strip('Master'), 'Rack')).toBeUndefined();
  expect(shaping()!.querySelector('.h-led')!.classList.contains('is-on')).toBe(false);
  flushSync(() => setDuck(channel('Warm Pad').id, { source: channel('Kick').id }));
  expect(shaping()!.querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
  await userEvent.click(shaping()!);
  expect(strip('Warm Pad').querySelector('.h-select-text')!.textContent).toBe('Kick');
  expect(button(strip('Master'), 'Rack')).toBeDefined();

  // The source list offers the other sounds; a sound never ducks to itself.
  await userEvent.click(strip('Glass Pad').querySelector('[role="combobox"]')!);
  const options = [...document.querySelectorAll('.h-select-option')].map((o) => o.textContent);
  const others = project().channels.filter((c) => c.sound.name !== 'Glass Pad').map((c) => c.sound.name);
  expect(options).toEqual(['None', ...others]);
  await userEvent.click([...document.querySelectorAll('.h-select-option')].find((o) => o.textContent === 'Kick')!);
  expect(channel('Glass Pad').duck.source).toBe(channel('Kick').id);
  control('Glass Pad', 'Amount')!.focus();
  await userEvent.keyboard('{End}');
  control('Glass Pad', 'Release')!.focus();
  await userEvent.keyboard('{Home}');
  expect(channel('Glass Pad').duck).toMatchObject({ amount: 1, release: 0.02 });

  pro();
  expect(shaping()).toBeUndefined();
  expect(strip('Bell').querySelector('[role="combobox"]')).not.toBeNull();
  expect(button(strip('Master'), 'Rack')).toBeDefined();
  expect(host.querySelector('.h-mixer-legend')!.textContent).toBe('SendsDuckPanLevel');
});

test('a bus rack takes, moves and removes effects whose knobs edit the bus, and undo brings them back', async () => {
  expect(button(strip('Room'), 'Rack')!.getAttribute('aria-pressed')).toBe('true');
  expect(units()).toEqual(['Reverb']);
  await userEvent.click(button(strip('Echo'), 'Rack')!);
  expect(units()).toEqual(['Delay']);
  expect(host.querySelector<HTMLInputElement>('.h-mixer-rack .h-textfield')!.value).toBe('Echo');

  await userEvent.click(host.querySelector('.h-mixer-rack [data-tour="add-effect"] .h-button')!);
  await userEvent.click([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent === 'Reverb')!);
  expect(units()).toEqual(['Delay', 'Reverb']);
  expect(project().mixer.buses[1].chain[1].params.mix).toBe(1);
  await userEvent.click(rack('Reverb').querySelector('.h-rack-buttons button')!);
  expect(project().mixer.buses[1].chain.map((m) => m.type)).toEqual(['reverb', 'delay']);
  expect(units()).toEqual(['Reverb', 'Delay']);

  const size = rack('Reverb').querySelector<HTMLElement>('[role="slider"][aria-label="Size"]')!;
  size.focus();
  await userEvent.keyboard('{End}');
  expect(project().mixer.buses[1].chain[0].params.size).toBe(30);
  await userEvent.click(rack('Delay').querySelector('.h-led')!);
  expect(project().mixer.buses[1].chain[1].on).toBe(false);
  await userEvent.click([...rack('Reverb').querySelectorAll('.h-rack-buttons button')].at(-1)!);
  expect(units()).toEqual(['Delay']);
  undo();
  await expect.poll(units).toEqual(['Reverb', 'Delay']);
  expect(project().mixer.buses[0].chain.map((m) => m.type)).toEqual(['reverb']);
});

test('the master rack is a Shaping control: in beginner mode the Room shows when the Shaping row folds', async () => {
  pro();
  await userEvent.click(button(strip('Master'), 'Rack')!);
  expect(host.querySelector('.h-mixer-rack-title')!.textContent).toBe('Master');
  expect(units()).toEqual([]);
  await userEvent.click(host.querySelector('.h-mixer-rack [data-tour="add-effect"] .h-button')!);
  await userEvent.click([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent === 'Drive')!);
  expect(project().mixer.master.chain.map((m) => [m.type, m.params.mix])).toEqual([['drive', 1]]);
  flushSync(() => usePrefs.setState({ beginner: true }));
  expect(units()).toEqual(['Reverb']);
  expect(button(strip('Room'), 'Rack')!.getAttribute('aria-pressed')).toBe('true');
  expect(shaping()!.querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
});

test('a compressor on a bus or the master shows how far it turns the sound down, as in the Factory', async () => {
  pro();
  const master = addEffect({ rack: 'master' }, 'compressor')!;
  const room = addEffect({ rack: 0 }, 'compressor')!;
  const reading = () => rack('Compressor').querySelector('.h-factory-meter-value')?.textContent;
  await userEvent.click(button(strip('Room'), 'Rack')!);
  await expect.poll(reading).toBe('-3.0 dB');
  expect(effectReduction).toHaveBeenCalledWith({ rack: 0 }, room);
  await userEvent.click(button(strip('Master'), 'Rack')!);
  await expect.poll(() => vi.mocked(effectReduction).mock.calls.map((c) => c[0])).toContainEqual({ rack: 'master' });
  expect(effectReduction).toHaveBeenCalledWith({ rack: 'master' }, master);
  expect(rack('Compressor').textContent).toContain('Reduction');
});

test('a bus strip has a fader, a mute and a meter; the master strip has the master level', async () => {
  control('Room', 'Level')!.focus();
  await userEvent.keyboard('{PageDown}');
  expect(project().mixer.buses[0].level).toBeCloseTo(-5.4, 5);
  await userEvent.click(button(strip('Echo'), 'M')!);
  expect(project().mixer.buses[1].mute).toBe(true);
  control('Master', 'Master')!.focus();
  await userEvent.keyboard('{Home}');
  expect(project().master).toBe(-48);
  await expect.poll(() => vi.mocked(busLevels).mock.calls.map((c) => c[0])).toContain(1);
  expect(vi.mocked(levels)).toHaveBeenCalled();
});

test('the meters read each sound only while the Mixer is on screen', async () => {
  await expect.poll(() => new Set(vi.mocked(channelLevels).mock.calls.map((c) => c[0])).size)
    .toBe(project().channels.length);
  show('factory');
  vi.mocked(channelLevels).mockClear();
  await new Promise((r) => setTimeout(r, 100));
  expect(channelLevels).not.toHaveBeenCalled();
});

test('many sounds scroll sideways under the captions', () => {
  flushSync(() => {
    for (let i = 0; i < 12; i++) addChannel(newSound('osc', `Extra ${i}`));
  });
  const well = host.querySelector<HTMLElement>('.h-mixer-scroll')!;
  expect(well.scrollWidth).toBeGreaterThan(well.clientWidth);
  const legend = host.querySelector<HTMLElement>('.h-mixer-legend')!;
  const left = legend.getBoundingClientRect().left;
  well.scrollLeft = 600;
  well.dispatchEvent(new Event('scroll'));
  expect(legend.getBoundingClientRect().left).toBe(left);
  expect(strip('Extra 11').getBoundingClientRect().left).toBeLessThan(2000);
});

const CONTROLS = '[role="slider"], [role="combobox"], button, .h-mixer-head, .h-mixer-meter';

function Status() {
  return <output className="test-hint">{useHintText()}</output>;
}

test('every control of the Mixer explains itself in the status bar', async () => {
  flushSync(() => root.render(<><MixerView /><Status /></>));
  const hint = () => host.querySelector('.test-hint')!.textContent!;
  const controls = (beginner: boolean) => {
    flushSync(() => usePrefs.setState({ beginner }));
    return ['Bell', 'Room', 'Master'].flatMap((name) => [
      ...strip(name).querySelectorAll<HTMLElement>(CONTROLS),
    ]);
  };
  const seen = new Set<string>();
  for (const beginner of [false, true]) {
    const all = [...controls(beginner), ...host.querySelectorAll<HTMLElement>('.h-mixer-legend button')];
    for (const el of all) {
      await userEvent.hover(el);
      expect(hint(), el.getAttribute('aria-label') ?? el.textContent!).toMatch(/^[A-Z].+\.$/);
      seen.add(hint());
    }
  }
  expect(seen.size).toBeGreaterThan(14);
});
