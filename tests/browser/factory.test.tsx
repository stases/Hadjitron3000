import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { channelScope, noteOff, noteOn } from '../../src/app/audio';
import { usePrefs } from '../../src/app/prefs';
import { newSound } from '../../src/core/defaults';
import { EFFECTS, MODULES, modTargets } from '../../src/core/modules';
import type { ModuleDef } from '../../src/core/modules';
import { encodeWav } from '../../src/core/wav';
import { preset } from '../../src/presets';
import { demoProject } from '../../src/presets/projects';
import {
  addEffect, addMod, moveEffect, openProject, removeModule, replaceSound, selectChannel, setModTarget, setModuleOn,
  setParam, setSample, setSourceType, useApp,
} from '../../src/state/store';
import { FactoryView } from '../../src/ui/factory';
import { PARAM_HINTS } from '../../src/ui/factory/hints';
import { addMenu, sourceItems, useFolds } from '../../src/ui/factory/levels';

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
  usePrefs.setState({ beginner: true });
  useFolds.setState({}, true);
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
const pro = () => flushSync(() => usePrefs.setState({ beginner: false }));
const knobs = (name: string) =>
  [...unit(name).querySelectorAll('[role="slider"]')].map((k) => k.getAttribute('aria-label'));
const folds = (name: string) => [...unit(name).querySelectorAll<HTMLElement>('.h-folds .h-button')];
const fold = (name: string, level: string) => folds(name).find((b) => b.textContent === level)!;
const lit = (name: string, level: string) => fold(name, level).querySelector('.h-led')!.classList.contains('is-on');
const sections = (name: string) =>
  [...unit(name).querySelectorAll('.h-rack-section-label')].map((l) => l.textContent);
const optionTexts = () => [...document.querySelectorAll('.h-select-option')].map((o) => o.textContent);
/** The open menu as text: headings in capitals, a submenu with an arrow. */
const menuText = () =>
  [...document.querySelectorAll('.h-menu')[0].children].map((el) =>
    el.classList.contains('h-menu-heading')
      ? el.textContent!.toUpperCase()
      : el.classList.contains('h-menu-separator')
        ? '-'
        : `${el.textContent}${el.getAttribute('aria-haspopup') === 'true' ? ' >' : ''}`,
  );
const addList = async (label: string) => {
  await userEvent.click(host.querySelector(`[data-tour="add-${label}"] .h-button`)!);
  const text = menuText();
  await userEvent.keyboard('{Escape}');
  return text;
};

test('the list selects channels and the header follows', async () => {
  const row = [...host.querySelectorAll('[role="option"]')].find((r) => r.textContent === 'Clap')!;
  await userEvent.click(row);
  expect(state().channelId).toBe(channel('Clap').id);
  expect(host.querySelector<HTMLInputElement>('.h-textfield')!.value).toBe('Clap');
});

test('the rack has one unit per module and follows the store', async () => {
  show('Warm Pad');
  const fixed = ['Source', 'Filter', 'Amp'];
  expect(units()).toEqual([...fixed, 'Filter (whole sound)', 'Reverb', 'LFO', 'Output']);

  const id = channel('Warm Pad').id;
  const delay = addEffect(id, 'delay')!;
  await expect.poll(units).toEqual([...fixed, 'Filter (whole sound)', 'Reverb', 'Delay', 'LFO', 'Output']);
  moveEffect(id, delay, 0);
  await expect.poll(units).toEqual([...fixed, 'Delay', 'Filter (whole sound)', 'Reverb', 'LFO', 'Output']);
  removeModule(id, delay);
  await expect.poll(units).toEqual([...fixed, 'Filter (whole sound)', 'Reverb', 'LFO', 'Output']);

  const lamp = () => unit('Reverb').querySelector('.h-led')!;
  expect(lamp().getAttribute('aria-pressed')).toBe('true');
  setModuleOn(id, sound().chain[1].id, false);
  await expect.poll(() => lamp().getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(lamp());
  expect(sound().chain[1].on).toBe(true);

  await userEvent.click(unit('Reverb').querySelector('.h-rack-buttons button')!);
  expect(sound().chain.map((m) => m.type)).toEqual(['reverb', 'filter']);
  await expect.poll(units).toEqual([...fixed, 'Reverb', 'Filter (whole sound)', 'LFO', 'Output']);
});

test('dragging a knob sets its parameter and the type select changes the source', async () => {
  show('Warm Pad');
  const before = sound().chain[0].params.cutoff as number;
  const knob = unit('Filter (whole sound)').querySelector('[role="slider"][aria-label="Cutoff"]')!;
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

test('beginner mode shows Basics and folds the rest into labelled sections that stay open', async () => {
  flushSync(() => replaceSound(state().channelId!, newSound('osc', 'Test')));
  expect(knobs('Source')).toEqual(['Pitch']);
  expect(folds('Source').map((b) => b.textContent)).toEqual(['Shaping', 'Deep']);
  expect(lit('Source', 'Shaping')).toBe(false);
  expect(sections('Source')).toEqual([]);
  expect(folds('Amp')).toEqual([]);
  expect(folds('Output')).toEqual([]);
  expect(knobs('Amp')).toEqual(['Attack', 'Decay', 'Sustain', 'Release']);

  await userEvent.click(fold('Source', 'Shaping'));
  expect(fold('Source', 'Shaping').getAttribute('aria-pressed')).toBe('true');
  expect(sections('Source')).toEqual(['Shaping']);
  const shaping = [
    'Fine', 'Voices', 'Spread', 'Noise', 'Pulse', 'Pitch 2', 'Fine 2', 'Mix 2', 'Sub', 'Sub Oct', 'Glide',
  ];
  expect(knobs('Source')).toEqual(['Pitch', ...shaping]);
  await userEvent.click(fold('Source', 'Deep'));
  expect(sections('Source')).toEqual(['Shaping', 'Deep']);
  expect(knobs('Source')).toEqual(['Pitch', ...shaping, 'Width']);

  show('Warm Pad');
  expect(sections('Source')).toEqual(['Shaping', 'Deep']);
  await userEvent.click(fold('Source', 'Shaping'));
  await userEvent.click(fold('Source', 'Deep'));
  expect(knobs('Source')).toEqual(['Pitch']);
});

test('a folded section with a changed control lights its lamp', async () => {
  const id = state().channelId!;
  flushSync(() => replaceSound(id, newSound('osc', 'Test')));
  flushSync(() => setParam(id, 'source', 'width', 0.9));
  expect(lit('Source', 'Shaping')).toBe(false);
  expect(lit('Source', 'Deep')).toBe(true);
  flushSync(() => setParam(id, 'source', 'width', 0.5));
  expect(lit('Source', 'Deep')).toBe(false);

  const delay = addEffect(id, 'delay')!;
  await expect.poll(() => folds('Delay').length).toBe(1);
  expect(lit('Delay', 'Shaping')).toBe(false);
  flushSync(() => setParam(id, delay, 'pingpong', true));
  expect(lit('Delay', 'Shaping')).toBe(true);
});

test('the sampler folds its controls by the same rules', async () => {
  flushSync(() => setSourceType(state().channelId!, 'sample'));
  expect(knobs('Source')).toEqual(['Pitch', 'Start', 'End']);
  expect(unit('Source').textContent).toContain('Load...');
  expect(unit('Source').textContent).not.toContain('Loop');
  await userEvent.click(fold('Source', 'Shaping'));
  expect(knobs('Source')).toEqual(['Pitch', 'Start', 'End', 'Fine', 'Glide']);
  expect(unit('Source').querySelector('.h-rack-section')!.textContent).toContain('Mode');
  expect(unit('Source').querySelector('.h-rack-section')!.textContent).toContain('Reverse');
  await userEvent.click(fold('Source', 'Deep'));
  expect(unit('Source').querySelectorAll('.h-rack-section')[1].textContent).toContain('Play');
});

test('pro mode shows every control in table order with no sections', () => {
  pro();
  show('Warm Pad');
  expect(knobs('Source')).toEqual([
    'Pitch', 'Fine', 'Voices', 'Spread', 'Width', 'Noise', 'Pulse', 'Pitch 2', 'Fine 2', 'Mix 2', 'Sub', 'Sub Oct',
    'Glide',
  ]);
  expect(knobs('Filter')).toEqual(['Cutoff', 'Reso', 'Drive', 'Key', 'Velocity']);
  expect(knobs('Reverb')).toEqual(['Size', 'Tone', 'Mix']);
  expect(host.querySelectorAll('.h-folds, .h-rack-section')).toHaveLength(0);
});

test('the Filter unit sits between Source and Amp, off until its lamp is pressed, controls by level', async () => {
  flushSync(() => replaceSound(state().channelId!, newSound('osc', 'Test')));
  expect(units()).toEqual(['Source', 'Filter', 'Amp', 'Output']);
  expect(knobs('Filter')).toEqual(['Cutoff', 'Reso']);
  expect(unit('Filter').textContent).toContain('Low pass');
  expect(folds('Filter').map((b) => b.textContent)).toEqual(['Shaping', 'Deep']);
  const lamp = () => unit('Filter').querySelector('.h-led')!;
  expect(lamp().getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(lamp());
  expect(sound().filter.on).toBe(true);
  await expect.poll(() => lamp().getAttribute('aria-pressed')).toBe('true');
  // The lamp is not a control of a section, so it lights none.
  expect(lit('Filter', 'Shaping')).toBe(false);
  await userEvent.click(fold('Filter', 'Shaping'));
  expect(knobs('Filter')).toEqual(['Cutoff', 'Reso', 'Drive']);
  expect(unit('Filter').querySelector('.h-rack-section')!.textContent).toContain('12 dB');
  await userEvent.click(fold('Filter', 'Deep'));
  expect(knobs('Filter')).toEqual(['Cutoff', 'Reso', 'Drive', 'Key', 'Velocity']);
});

test('the Source gathers Osc 2, Sub and Play under captions, and Pulse works only with a square', async () => {
  const id = state().channelId!;
  flushSync(() => replaceSound(id, newSound('osc', 'Test')));
  const groups = () => [...unit('Source').querySelectorAll('.h-factory-group')].map((g) => g.getAttribute('aria-label'));
  const group = (name: string) => unit('Source').querySelector<HTMLElement>(`.h-factory-group[aria-label="${name}"]`)!;
  const slider = (label: string) => unit('Source').querySelector(`[role="slider"][aria-label="${label}"]`)!;
  expect(groups()).toEqual([]);
  await userEvent.click(fold('Source', 'Shaping'));
  expect(groups()).toEqual(['Osc 2', 'Sub', 'Play']);
  expect([...group('Osc 2').querySelectorAll('[role="slider"]')].map((k) => k.getAttribute('aria-label')))
    .toEqual(['Pitch 2', 'Fine 2', 'Mix 2']);
  expect(group('Osc 2').querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Wave 2');
  expect(group('Play').textContent).toContain('Poly');

  expect(slider('Pulse').getAttribute('aria-disabled')).toBe('true');
  flushSync(() => setParam(id, 'source', 'wave', 'square'));
  expect(slider('Pulse').getAttribute('aria-disabled')).toBe('false');
  flushSync(() => setParam(id, 'source', 'wave', 'sawtooth'));
  flushSync(() => setParam(id, 'source', 'wave2', 'square'));
  expect(slider('Pulse').getAttribute('aria-disabled')).toBe('true');
  flushSync(() => setParam(id, 'source', 'mix2', 0.5));
  expect(slider('Pulse').getAttribute('aria-disabled')).toBe('false');
  expect(lit('Source', 'Shaping')).toBe(true);

  pro();
  expect(groups()).toEqual(['Osc 2', 'Sub', 'Play']);
  expect(sections('Source')).toEqual([]);
});

test('a modulator works on each note or the whole sound, and on the whole sound for a target outside', async () => {
  const id = state().channelId!;
  flushSync(() => replaceSound(id, newSound('osc', 'Test')));
  const env = addMod(id, 'env')!;
  await expect.poll(() => folds('Envelope').map((b) => b.textContent)).toEqual(['Shaping', 'Deep']);
  expect(unit('Envelope').textContent).not.toContain('Each note');
  await userEvent.click(fold('Envelope', 'Shaping'));
  await userEvent.click(fold('Envelope', 'Deep'));
  const choice = (label: string) =>
    [...unit('Envelope').querySelectorAll<HTMLButtonElement>('[aria-label="Works on"] .h-button')]
      .find((b) => b.textContent === label)!;
  const velocity = () => unit('Envelope').querySelector('[role="slider"][aria-label="Velocity"]')!;
  expect(choice('Each note').getAttribute('aria-pressed')).toBe('true');
  expect(velocity().getAttribute('aria-disabled')).toBe('false');
  await userEvent.click(choice('Whole sound'));
  expect(sound().mods[0].per).toBe('sound');
  await expect.poll(() => velocity().getAttribute('aria-disabled')).toBe('true');
  expect(lit('Envelope', 'Shaping')).toBe(true);
  await userEvent.click(choice('Each note'));
  expect(sound().mods[0].per).toBe('note');

  flushSync(() => setModTarget(id, env, { module: 'out', param: 'level' }));
  expect(choice('Whole sound').getAttribute('aria-pressed')).toBe('true');
  expect(choice('Each note').disabled).toBe(true);
  expect(choice('Whole sound').disabled).toBe(true);
  expect(velocity().getAttribute('aria-disabled')).toBe('true');
  expect(sound().mods[0].per).toBe('note');
  flushSync(() => setModTarget(id, env, { module: 'filter', param: 'cutoff' }));
  expect(choice('Each note').getAttribute('aria-pressed')).toBe('true');
  expect(choice('Each note').disabled).toBe(false);

  // A new LFO works on the whole sound; in pro mode the switch and Velocity stand in the row.
  addMod(id, 'lfo');
  pro();
  await expect.poll(() => units()).toContain('LFO');
  expect(unit('LFO').querySelector('[aria-label="Works on"] [aria-pressed="true"]')!.textContent).toBe('Whole sound');
  expect(knobs('LFO')).toEqual(['Amount', 'Rate', 'Velocity']);
});

test('the add lists and the source list are grouped by level in beginner mode and flat in pro mode', async () => {
  expect(await addList('effect')).toEqual(['BASICS', 'Delay', 'Reverb', 'SHAPING', 'Filter (whole sound)', 'Drive']);
  expect(await addList('modulator')).toEqual(['BASICS', 'Envelope', 'LFO']);
  await userEvent.click(unit('Source').querySelector('[role="combobox"]')!);
  expect([...document.querySelector('.h-select-list')!.children].map((el) => el.textContent)).toEqual([
    'Basics', 'Oscillator', 'Noise', 'Sampler', 'Shaping', 'FM Pair',
  ]);
  await userEvent.keyboard('{Escape}');

  pro();
  expect(await addList('effect')).toEqual(['Filter (whole sound)', 'Drive', 'Delay', 'Reverb']);
  expect(await addList('modulator')).toEqual(['Envelope', 'LFO']);
  await userEvent.click(unit('Source').querySelector('[role="combobox"]')!);
  expect(optionTexts()).toEqual(['Oscillator', 'FM Pair', 'Noise', 'Sampler']);
  expect(document.querySelector('.h-select-heading')).toBeNull();
});

test('Deep modules wait one step away: in a submenu of the add list and behind More… in the source list', () => {
  const defs: ModuleDef[] = [...EFFECTS, { type: 'deepfx', kind: 'effect', label: 'Deep One', level: 3, params: [] }];
  const add = vi.fn();
  const menu = addMenu(true, defs, add);
  expect(menu.slice(-2, -1)).toEqual(['separator']);
  const deep = menu.at(-1) as { label: string; items: { label: string; onSelect(): void }[] };
  expect(deep.label).toBe('Deep');
  expect(deep.items.map((i) => i.label)).toEqual(['Deep One']);
  deep.items[0].onSelect();
  expect(add).toHaveBeenCalledWith('deepfx');
  expect(addMenu(false, defs, add)).toHaveLength(defs.length);

  const sources = sourceItems(true, defs);
  expect(sources.options).not.toContainEqual({ value: 'deepfx', label: 'Deep One' });
  expect(sources.more).toEqual([{ heading: 'Deep' }, { value: 'deepfx', label: 'Deep One' }]);
  expect(sourceItems(false, defs).more).toEqual([]);
});

test('in beginner mode a modulator offers only targets whose control is on screen, and its current one', async () => {
  show('Warm Pad');
  const id = channel('Warm Pad').id;
  const delay = addEffect(id, 'delay')!;
  await expect.poll(() => folds('Delay').length).toBe(1);
  const targets = async () => {
    await userEvent.click(unit('LFO').querySelector('[role="combobox"]')!);
    const labels = optionTexts();
    await userEvent.keyboard('{Escape}');
    return labels;
  };
  expect(await targets()).not.toContain('Delay · Time');
  expect(await targets()).toContain('Delay · Mix');
  await userEvent.click(fold('Delay', 'Shaping'));
  expect(await targets()).toContain('Delay · Time');
  await userEvent.click(fold('Delay', 'Shaping'));

  flushSync(() => setModTarget(id, sound().mods[0].id, { module: delay, param: 'time' }));
  expect(await targets()).toContain('Delay · Time');
  expect(unit('LFO').querySelector('.h-select-text')!.textContent).toBe('Delay · Time');
});

test('the modulator target list matches modTargets in pro mode', async () => {
  pro();
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
