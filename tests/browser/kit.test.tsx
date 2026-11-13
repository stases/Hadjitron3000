import { useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { EFFECTS, SOURCES } from '../../src/core/modules';
import type { FloatSpec, ParamSpec } from '../../src/core/modules';
import { fromNorm, toNorm } from '../../src/core/params';
import type { ParamValue } from '../../src/core/types';
import {
  Button,
  Dialog,
  Knob,
  MenuBar,
  ParamControl,
  Select,
  Stepper,
  useHintText,
} from '../../src/ui/kit';
import type { MenuItem } from '../../src/ui/kit';

let roots: { root: Root; host: HTMLElement }[] = [];

function render(ui: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(ui));
  roots.push({ root, host });
  return host;
}

afterEach(async () => {
  await userEvent.cleanup();
  roots.forEach(({ root, host }) => {
    root.unmount();
    host.remove();
  });
  roots = [];
});

const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};

/** Presses the left button on `el`, moves the pointer by dy and releases it. */
async function dragY(el: Element, dy: number) {
  const { x, y } = centre(el);
  await userEvent.pointer([{ coords: { x, y } }, { keys: '[MouseLeft>]' }, { coords: { x, y: y + dy } }, { keys: '[/MouseLeft]' }]);
}

const byRole = (root: ParentNode, role: string) => root.querySelector<HTMLElement>(`[role="${role}"]`)!;

function TestKnob(props: { initial: number; steps?: number; onValue(v: number): void; onEnd?(v: number): void }) {
  const [value, setValue] = useState(props.initial);
  return (
    <Knob
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onValue(v);
      }}
      onChangeEnd={props.onEnd}
      defaultValue={0.5}
      label="Cutoff"
      display={`${Math.round(value * 100)} %`}
      steps={props.steps}
      hint="Turn me."
    />
  );
}

function HintProbe() {
  return <output data-testid="hint">{useHintText()}</output>;
}

test('knob: dragging 75 px up adds half the range and ends the gesture once', async () => {
  const onValue = vi.fn();
  const onEnd = vi.fn();
  const host = render(<TestKnob initial={0.2} onValue={onValue} onEnd={onEnd} />);
  await dragY(byRole(host, 'slider'), -75);
  expect(onValue.mock.lastCall![0]).toBeCloseTo(0.7, 5);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onEnd.mock.lastCall![0]).toBeCloseTo(0.7, 5);
});

test('knob: Shift makes dragging ten times finer', async () => {
  const onValue = vi.fn();
  const host = render(<TestKnob initial={0.2} onValue={onValue} />);
  await userEvent.keyboard('{Shift>}');
  await dragY(byRole(host, 'slider'), -75);
  await userEvent.keyboard('{/Shift}');
  expect(onValue.mock.lastCall![0]).toBeCloseTo(0.25, 5);
});

test('knob: double-click resets to the default', async () => {
  const onValue = vi.fn();
  const host = render(<TestKnob initial={0.9} onValue={onValue} />);
  await userEvent.dblClick(byRole(host, 'slider'));
  expect(onValue).toHaveBeenLastCalledWith(0.5);
});

test('knob: the wheel steps by 0.02 and ends its gesture after a pause', async () => {
  const onValue = vi.fn();
  const onEnd = vi.fn();
  const host = render(<TestKnob initial={0.5} onValue={onValue} onEnd={onEnd} />);
  const knob = byRole(host, 'slider');
  await userEvent.wheel(knob, { delta: { y: -100 } });
  await userEvent.wheel(knob, { delta: { y: -100 } });
  expect(onValue.mock.lastCall![0]).toBeCloseTo(0.54, 5);
  await expect.poll(() => onEnd.mock.calls.length).toBe(1);
  expect(onEnd.mock.lastCall![0]).toBeCloseTo(0.54, 5);
});

test('knob: arrow keys step, Shift is finer, Home and End jump', async () => {
  const onValue = vi.fn();
  const host = render(<TestKnob initial={0.5} onValue={onValue} />);
  byRole(host, 'slider').focus();
  await userEvent.keyboard('{ArrowUp}');
  expect(onValue.mock.lastCall![0]).toBeCloseTo(0.52, 5);
  await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(onValue.mock.lastCall![0]).toBeCloseTo(0.518, 5);
  await userEvent.keyboard('{End}');
  expect(onValue).toHaveBeenLastCalledWith(1);
  await userEvent.keyboard('{Home}');
  expect(onValue).toHaveBeenLastCalledWith(0);
});

test('knob: steps snap dragging, keys and the wheel to evenly spaced positions', async () => {
  const onValue = vi.fn();
  const host = render(<TestKnob initial={0} steps={5} onValue={onValue} />);
  const knob = byRole(host, 'slider');
  await dragY(knob, -40);
  expect(onValue.mock.calls.map((c) => c[0])).toEqual([0.25]);
  await userEvent.keyboard('{ArrowUp}');
  expect(onValue).toHaveBeenLastCalledWith(0.5);
  await userEvent.wheel(knob, { delta: { y: -100 } });
  expect(onValue).toHaveBeenLastCalledWith(0.75);
});

function TestStepper({ onValue }: { onValue(v: number): void }) {
  const [value, setValue] = useState(120);
  return (
    <Stepper
      value={value}
      min={20}
      max={300}
      step={0.5}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

test('stepper: spin buttons, arrow keys, dragging and typing a value', async () => {
  const onValue = vi.fn();
  const host = render(<TestStepper onValue={onValue} />);
  const [up, down] = host.querySelectorAll('.h-spin');
  await userEvent.click(up);
  expect(onValue).toHaveBeenLastCalledWith(120.5);
  await userEvent.click(down);
  await userEvent.click(down);
  expect(onValue).toHaveBeenLastCalledWith(119.5);

  byRole(host, 'spinbutton').focus();
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');
  expect(onValue).toHaveBeenLastCalledWith(120.5);
  await userEvent.keyboard('{PageDown}');
  expect(onValue).toHaveBeenLastCalledWith(115.5);

  await dragY(host.querySelector('.h-stepper-readout')!, -9);
  expect(onValue).toHaveBeenLastCalledWith(117);

  await userEvent.dblClick(host.querySelector('.h-stepper-readout')!);
  const input = host.querySelector('input')!;
  expect(document.activeElement).toBe(input);
  await userEvent.keyboard('{Control>}a{/Control}98.26{Enter}');
  expect(onValue).toHaveBeenLastCalledWith(98.5);
  expect(host.querySelector('input')).toBeNull();

  await userEvent.dblClick(host.querySelector('.h-stepper-readout')!);
  await userEvent.keyboard('{Control>}a{/Control}50{Escape}');
  expect(onValue).toHaveBeenLastCalledWith(98.5);
  expect(host.querySelector('.h-stepper-readout')!.textContent).toBe('98.5');
});

test('stepper: holding a spin button repeats', async () => {
  const onValue = vi.fn();
  const host = render(<TestStepper onValue={onValue} />);
  const up = host.querySelector('.h-spin')!;
  const { x, y } = centre(up);
  await userEvent.pointer([{ coords: { x, y } }, { keys: '[MouseLeft>]' }]);
  await new Promise((r) => setTimeout(r, 650));
  await userEvent.pointer({ keys: '[/MouseLeft]' });
  expect(onValue.mock.calls.length).toBeGreaterThan(3);
});

const OPTIONS = [
  { value: 'lowpass', label: 'Low pass' },
  { value: 'highpass', label: 'High pass' },
  { value: 'bandpass', label: 'Band pass' },
];

function TestSelect({ onValue }: { onValue(v: string): void }) {
  const [value, setValue] = useState('lowpass');
  return (
    <Select
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

const openList = () => document.querySelector('.h-select-list');

test('select: opens on click, chooses with the mouse, closes on an outside click', async () => {
  const onValue = vi.fn();
  const host = render(<TestSelect onValue={onValue} />);
  const field = byRole(host, 'combobox');
  await userEvent.click(field);
  expect(openList()).not.toBeNull();
  await userEvent.click(openList()!.children[2]);
  expect(onValue).toHaveBeenLastCalledWith('bandpass');
  expect(openList()).toBeNull();
  expect(field.textContent).toBe('Band pass');

  await userEvent.click(field);
  expect(openList()).not.toBeNull();
  await userEvent.pointer({ coords: { x: 600, y: 500 }, keys: '[MouseLeft]' });
  expect(openList()).toBeNull();
  expect(onValue).toHaveBeenCalledTimes(1);
});

test('select: keyboard', async () => {
  const onValue = vi.fn();
  const host = render(<TestSelect onValue={onValue} />);
  byRole(host, 'combobox').focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(onValue).toHaveBeenLastCalledWith('highpass');
  await userEvent.keyboard('{Enter}');
  expect(openList()).not.toBeNull();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onValue).toHaveBeenLastCalledWith('bandpass');
  expect(openList()).toBeNull();
  await userEvent.keyboard('{Enter}{ArrowUp}{Escape}');
  expect(openList()).toBeNull();
  expect(onValue).toHaveBeenCalledTimes(2);
  await userEvent.keyboard('l');
  expect(onValue).toHaveBeenLastCalledWith('lowpass');
});

function menus(spy: (what: string) => void): { label: string; items: MenuItem[] }[] {
  return [
    {
      label: 'File',
      items: [
        { label: 'New', onSelect: () => spy('new') },
        { label: 'Save', disabled: true, onSelect: () => spy('save') },
        'separator',
        { label: 'Recent', items: [{ label: 'Demo.h3k', onSelect: () => spy('demo') }] },
      ],
    },
    { label: 'Edit', items: [{ label: 'Undo', shortcut: 'Ctrl+Z', onSelect: () => spy('undo') }] },
  ];
}

const openMenus = () => [...document.querySelectorAll('.h-menu')];
const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.h-menu-item')].find((el) => el.textContent?.includes(label))!;

test('menu bar: open, switch by moving across, choose, Escape', async () => {
  const spy = vi.fn();
  const host = render(<MenuBar menus={menus(spy)} />);
  const [file, edit] = host.querySelectorAll<HTMLElement>('.h-menubar-item');
  await userEvent.click(file);
  expect(openMenus()).toHaveLength(1);
  expect(item('New')).toBeTruthy();
  await userEvent.hover(edit);
  expect(item('Undo')).toBeTruthy();
  expect(item('New')).toBeUndefined();
  await userEvent.click(item('Undo'));
  expect(spy).toHaveBeenCalledWith('undo');
  expect(openMenus()).toHaveLength(0);

  await userEvent.click(file);
  await userEvent.keyboard('{Escape}');
  expect(openMenus()).toHaveLength(0);
});

test('menu bar: disabled items do nothing; submenus and arrow keys work', async () => {
  const spy = vi.fn();
  const host = render(<MenuBar menus={menus(spy)} />);
  await userEvent.click(host.querySelector('.h-menubar-item')!);
  await userEvent.pointer({ coords: centre(item('Save')), keys: '[MouseLeft]' });
  expect(spy).not.toHaveBeenCalled();
  expect(openMenus()).toHaveLength(1);

  await userEvent.hover(item('Recent'));
  expect(openMenus()).toHaveLength(2);
  await userEvent.click(item('Demo.h3k'));
  expect(spy).toHaveBeenCalledWith('demo');
  expect(openMenus()).toHaveLength(0);

  await userEvent.click(host.querySelector('.h-menubar-item')!);
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');
  expect(openMenus()).toHaveLength(2);
  await userEvent.keyboard('{ArrowLeft}');
  expect(openMenus()).toHaveLength(1);
  await userEvent.keyboard('{ArrowRight}{ArrowRight}');
  expect(item('Undo')).toBeTruthy();
  await userEvent.keyboard('{Enter}');
  expect(spy).toHaveBeenLastCalledWith('undo');
  expect(openMenus()).toHaveLength(0);
});

test('dialog: Escape closes it, the app behind gets no input, Tab stays inside', async () => {
  const behind = vi.fn();
  const onClose = vi.fn();
  const host = render(
    <>
      <Button onClick={behind}>Behind</Button>
      <Dialog title="Settings" onClose={onClose}>
        <Button onClick={() => {}}>One</Button>
        <Button primary onClick={() => {}}>
          Two
        </Button>
      </Dialog>
    </>,
  );
  const back = host.querySelector('button')!;
  await expect.poll(() => document.activeElement?.textContent).toBe('Two');

  await userEvent.pointer({ coords: centre(back), keys: '[MouseLeft]' });
  back.focus();
  expect(behind).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(back);

  expect(document.activeElement?.textContent).toBe('Two');
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement?.textContent).toBe('One');
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(document.activeElement?.textContent).toBe('Two');

  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
});

function TestParam({ spec, onValue }: { spec: ParamSpec; onValue(v: ParamValue): void }) {
  const [value, setValue] = useState<ParamValue>(spec.kind === 'sample' ? '' : spec.def);
  return (
    <ParamControl
      spec={spec}
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

const param = (type: string, id: string) =>
  [...SOURCES, ...EFFECTS].find((d) => d.type === type)!.params.find((p) => p.id === id)!;

test('param control: a logarithmic float travels along its taper', async () => {
  const cutoff = param('filter', 'cutoff') as FloatSpec;
  const onValue = vi.fn();
  const host = render(<TestParam spec={cutoff} onValue={onValue} />);
  const knob = byRole(host, 'slider');
  expect(Number(knob.getAttribute('aria-valuenow'))).toBeCloseTo(toNorm(cutoff, 2000), 6);
  expect(knob.textContent).toContain('2.00 kHz');

  const travel = Math.round((toNorm(cutoff, 2000) - 0.5) * 150);
  await dragY(knob, travel);
  const expected = fromNorm(cutoff, toNorm(cutoff, 2000) - travel / 150);
  expect(onValue.mock.lastCall![0]).toBeCloseTo(expected, 6);
  expect(expected).toBeGreaterThan(600);
  expect(expected).toBeLessThan(660);
  expect(knob.textContent).toContain(' Hz');

  await userEvent.dblClick(knob);
  expect(onValue).toHaveBeenLastCalledWith(2000);
});

test('param control: a coarse linear float clicks into whole steps', async () => {
  const onValue = vi.fn();
  const host = render(<TestParam spec={param('osc', 'voices')} onValue={onValue} />);
  await dragY(byRole(host, 'slider'), -30);
  expect(onValue.mock.calls.map((c) => c[0])).toEqual([2]);
});

test('param control: a choice is a select and the waves are four toggles', async () => {
  const onMode = vi.fn();
  const host = render(<TestParam spec={param('filter', 'mode')} onValue={onMode} />);
  await userEvent.click(byRole(host, 'combobox'));
  await userEvent.click(openList()!.children[1]);
  expect(onMode).toHaveBeenLastCalledWith('highpass');

  const onWave = vi.fn();
  const waves = render(<TestParam spec={param('osc', 'wave')} onValue={onWave} />);
  const buttons = waves.querySelectorAll('button');
  expect(buttons).toHaveLength(4);
  expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(buttons[1]);
  expect(onWave).toHaveBeenLastCalledWith('triangle');
  expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
});

test('param control: a bool is a checkbox and a sample renders nothing', async () => {
  const onValue = vi.fn();
  const host = render(<TestParam spec={param('delay', 'pingpong')} onValue={onValue} />);
  await userEvent.click(byRole(host, 'checkbox'));
  expect(onValue).toHaveBeenLastCalledWith(true);
  expect(render(<TestParam spec={param('sample', 'sample')} onValue={onValue} />).childElementCount).toBe(0);
});

test('hints: shown while hovered, and a dragged knob shows its label and value', async () => {
  const onValue = vi.fn();
  const host = render(
    <>
      <Button onClick={() => {}} hint="Starts playback.">
        Play
      </Button>
      <TestKnob initial={0.2} onValue={onValue} />
      <HintProbe />
    </>,
  );
  const hint = () => host.querySelector('output')!.textContent;
  expect(hint()).toBe('');
  await userEvent.hover(host.querySelector('button')!);
  await expect.poll(hint).toBe('Starts playback.');
  await userEvent.unhover(host.querySelector('button')!);
  await expect.poll(hint).toBe('');

  const knob = byRole(host, 'slider');
  const { x, y } = centre(knob);
  await userEvent.pointer([{ coords: { x, y } }, { keys: '[MouseLeft>]' }, { coords: { x, y: y - 30 } }]);
  await expect.poll(hint).toBe('Cutoff: 40 %');
  await userEvent.pointer({ keys: '[/MouseLeft]' });
  await expect.poll(hint).toBe('Turn me.');
});
