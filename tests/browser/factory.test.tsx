import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { channelScope, noteOff, noteOn } from '../../src/app/audio';
import { MODULES, modTargets } from '../../src/core/modules';
import { encodeWav } from '../../src/core/wav';
import { preset } from '../../src/presets';
import { demoProject } from '../../src/presets/projects';
import {
  addEffect, moveEffect, openProject, removeModule, replaceSound, selectChannel, setModuleOn, setParam, setSample,
  setSourceType, useApp,
} from '../../src/state/store';
import { FactoryView } from '../../src/ui/factory';
import { PARAM_HINTS } from '../../src/ui/factory/hints';

// What the mocked channel tap plays: a sine of this many hertz at the given note, or silence.
const tapped = vi.hoisted(() => ({ freq: 0, note: null as number | null }));

vi.mock('../../src/app/audio', () => {
  const held = new Set<string>();
  const listeners = new Set<() => void>();
  const set = (on: boolean) => (channelId: string, note: number) => {
    if (on) held.add(`${channelId}:${note}`);
    else held.delete(`${channelId}:${note}`);
    listeners.forEach((l) => l());
  };
  return {
    noteOn: vi.fn(set(true)),
    noteOff: vi.fn(set(false)),
    isHeld: (channelId: string, note: number) => held.has(`${channelId}:${note}`),
    onHeldChange: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    channelScope: vi.fn((_: string, out: Float32Array) => {
      const t = performance.now() / 1000;
      const w = 2 * Math.PI * tapped.freq;
      for (let i = 0; i < out.length; i++) out[i] = 0.4 * Math.sin(w * (t + i / 48000));
    }),
    soundingNote: () => tapped.note,
    sampleRate: () => 48000,
  };
});

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  openProject(demoProject(), null);
  host = document.createElement('div');
  host.style.cssText = 'display: flex; flex-direction: column; width: 1260px; height: 600px';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<FactoryView />));
});

afterEach(async () => {
  await userEvent.cleanup();
  root.unmount();
  host.remove();
  vi.clearAllMocks();
  tapped.freq = 0;
  tapped.note = null;
});

const state = () => useApp.getState();
const channel = (name: string) => state().project.channels.find((c) => c.sound.name === name)!;
const sound = () => state().project.channels.find((c) => c.id === state().channelId)!.sound;
const units = () => [...host.querySelectorAll<HTMLElement>('.h-rack')].map((u) => u.getAttribute('aria-label'));
const unit = (name: string) => host.querySelector<HTMLElement>(`.h-rack[aria-label="${name}"]`)!;
const show = (name: string) => flushSync(() => selectChannel(channel(name).id));

test('the list selects channels and the header follows', async () => {
  const row = [...host.querySelectorAll('[role="option"]')].find((r) => r.textContent === 'Clap')!;
  await userEvent.click(row);
  expect(state().channelId).toBe(channel('Clap').id);
  expect(host.querySelector<HTMLInputElement>('.h-textfield')!.value).toBe('Clap');
});

test('the rack has one unit per module and follows the store', async () => {
  show('Warm Pad');
  expect(units()).toEqual(['Source', 'Amp', 'Filter', 'Reverb', 'LFO', 'Output']);

  const id = channel('Warm Pad').id;
  const delay = addEffect(id, 'delay')!;
  await expect.poll(units).toEqual(['Source', 'Amp', 'Filter', 'Reverb', 'Delay', 'LFO', 'Output']);
  moveEffect(id, delay, 0);
  await expect.poll(units).toEqual(['Source', 'Amp', 'Delay', 'Filter', 'Reverb', 'LFO', 'Output']);
  removeModule(id, delay);
  await expect.poll(units).toEqual(['Source', 'Amp', 'Filter', 'Reverb', 'LFO', 'Output']);

  const lamp = () => unit('Reverb').querySelector('.h-led')!;
  expect(lamp().getAttribute('aria-pressed')).toBe('true');
  setModuleOn(id, sound().chain[1].id, false);
  await expect.poll(() => lamp().getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(lamp());
  expect(sound().chain[1].on).toBe(true);

  await userEvent.click(unit('Reverb').querySelector('.h-rack-buttons button')!);
  expect(sound().chain.map((m) => m.type)).toEqual(['reverb', 'filter']);
  await expect.poll(units).toEqual(['Source', 'Amp', 'Reverb', 'Filter', 'LFO', 'Output']);
});

test('dragging a knob sets its parameter and the type select changes the source', async () => {
  show('Warm Pad');
  const before = sound().chain[0].params.cutoff as number;
  const knob = unit('Filter').querySelector('[role="slider"][aria-label="Cutoff"]')!;
  const r = knob.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + 18);
  await userEvent.pointer([
    { coords: { x, y } }, { keys: '[MouseLeft>]' }, { coords: { x, y: y - 40 } }, { keys: '[/MouseLeft]' },
  ]);
  expect(sound().chain[0].params.cutoff).toBeGreaterThan(before);

  await userEvent.click(unit('Source').querySelector('[role="combobox"]')!);
  const noise = [...document.querySelectorAll('.h-select-option')].find((o) => o.textContent === 'Noise')!;
  await userEvent.click(noise);
  expect(sound().source.type).toBe('noise');
  await expect.poll(() => unit('Source').querySelector('.h-select-text')?.textContent).toBe('Noise');
});

test('the modulator target list matches modTargets', async () => {
  flushSync(() => replaceSound(state().channelId!, preset('Soft Keys')));
  await userEvent.click(unit('Envelope').querySelector('[role="combobox"]')!);
  const labels = [...document.querySelectorAll('.h-select-option')].map((o) => o.textContent);
  expect(labels).toEqual(['None', ...modTargets(sound()).map((t) => t.label)]);
  const pan = [...document.querySelectorAll('.h-select-option')].find((o) => o.textContent === 'Output · Pan')!;
  await userEvent.click(pan);
  expect(sound().mods[0].target).toEqual({ module: 'out', param: 'pan' });
  expect(unit('Envelope').querySelector('[aria-label="Amount"]')!.getAttribute('aria-valuetext')).toMatch(/%$/);
});

test('the keyboard plays notes, glides across keys and shows held notes', async () => {
  const id = state().channelId!;
  const key = (note: number) => host.querySelector<HTMLElement>(`[data-note="${note}"]`)!;
  await expect.poll(() => key(60)?.getBoundingClientRect().width).toBeGreaterThan(0);
  expect(key(60).textContent).toBe('C3A');

  const at = (note: number) => {
    const r = key(note).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 8) };
  };
  await userEvent.pointer([{ coords: at(60) }, { keys: '[MouseLeft>]' }]);
  expect(noteOn).toHaveBeenLastCalledWith(id, 60);
  await expect.poll(() => key(60).classList.contains('is-down')).toBe(true);
  await userEvent.pointer([{ coords: at(62) }]);
  expect(noteOff).toHaveBeenLastCalledWith(id, 60);
  expect(noteOn).toHaveBeenLastCalledWith(id, 62);
  await userEvent.pointer([{ keys: '[/MouseLeft]' }]);
  expect(noteOff).toHaveBeenLastCalledWith(id, 62);
  await expect.poll(() => key(62).classList.contains('is-down')).toBe(false);

  noteOn(id, 64);
  await expect.poll(() => key(64).classList.contains('is-down')).toBe(true);
  noteOff(id, 64);
});

test('the amp display redraws when an envelope parameter changes', async () => {
  const canvas = unit('Amp').querySelector('canvas')!;
  const before = canvas.toDataURL();
  setParam(state().channelId!, 'amp', 'attack', 1.5);
  await expect.poll(() => canvas.toDataURL()).not.toBe(before);
});

test('the sampler shows its empty state, then the waveform of a loaded sample', async () => {
  const id = state().channelId!;
  setSourceType(id, 'sample');
  await expect.poll(() => unit('Source').textContent).toContain('Drop an audio file here or press Load.');
  const canvas = () => unit('Source').querySelector('canvas')!;
  const empty = canvas().toDataURL();

  const n = 4410;
  const tone = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 10) * (1 - i / n));
  setSample(id, 'test-tone', { name: 'tone.wav', bytes: encodeWav({ sampleRate: 44100, channels: [tone, tone] }) });
  await expect.poll(() => unit('Source').textContent).toContain('tone.wav');
  expect(unit('Source').textContent).not.toContain('Drop an audio file');
  expect(canvas().toDataURL()).not.toBe(empty);

  const r = canvas().getBoundingClientRect();
  const y = Math.round(r.top + r.height / 2);
  await userEvent.pointer([
    { coords: { x: Math.round(r.left + 2), y } }, { keys: '[MouseLeft>]' },
    { coords: { x: Math.round(r.left + r.width / 4), y } }, { keys: '[/MouseLeft]' },
  ]);
  expect(sound().source.params.start).toBeCloseTo(0.25, 1);
  expect(sound().source.params.end).toBe(1);
});

test('every parameter in the module table has a hint', () => {
  for (const def of Object.values(MODULES)) {
    for (const p of def.params) expect(PARAM_HINTS[def.type]?.[p.id], `${def.type} ${p.id}`).toBeTruthy();
  }
});

test('the scope shows the selected sound: a resting line, then a standing wave with its timebase', async () => {
  show('Warm Pad');
  const canvas = host.querySelector<HTMLCanvasElement>('.h-factory-scope canvas')!;
  expect([canvas.width, canvas.height]).toEqual([361, 97]);
  const g = canvas.getContext('2d')!;
  /** The rows that hold a pixel of the given colour. */
  const rows = (rgb: number[]) => {
    const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
    const found = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      if (rgb.every((c, k) => data[i + k] === c)) found.add(Math.floor(i / 4 / canvas.width));
    }
    return [...found];
  };
  const amber = [255, 180, 58];
  const amberMid = [194, 127, 34];
  await expect.poll(() => rows(amberMid)).toContain(48);
  expect(rows(amber)).toEqual([]);
  expect(channelScope).toHaveBeenLastCalledWith(channel('Warm Pad').id, expect.any(Float32Array));

  tapped.freq = 440;
  tapped.note = 69;
  await expect.poll(() => rows(amber).length).toBeGreaterThan(60);
  expect(host.querySelector('.h-factory-scope-time')!.textContent).toBe('1 ms/div');
});
