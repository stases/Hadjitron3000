import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as audio from '../../src/app/audio';
import { initMidi, useMidi } from '../../src/app/midi';
import { Transport } from '../../src/app/Transport';
import { useHintText } from '../../src/ui/kit';
import { demoProject } from '../../src/presets/projects';
import * as store from '../../src/state/store';

const fake = vi.hoisted(() => ({ started: true }));

vi.mock('../../src/app/audio', async (original) => ({
  ...(await original<typeof import('../../src/app/audio')>()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  audioStarted: () => fake.started,
}));

interface FakeInput {
  id: string;
  name: string | null;
  state: 'connected' | 'disconnected';
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
}

/** A MIDI access with these inputs; `plug` and `unplug` change them and tell the page as a device would. */
function fakeAccess(...inputs: FakeInput[]) {
  const map = new Map(inputs.map((input) => [input.id, input]));
  const access = { inputs: map, onstatechange: null as (() => void) | null };
  return {
    access,
    plug(input: FakeInput) {
      map.set(input.id, input);
      access.onstatechange?.();
    },
    unplug(id: string) {
      map.get(id)!.state = 'disconnected';
      access.onstatechange?.();
    },
  };
}

const keyboard = (id: string, name: string | null = id): FakeInput =>
  ({ id, name, state: 'connected', onmidimessage: null });
const send = (input: FakeInput, ...bytes: number[]) => input.onmidimessage!({ data: new Uint8Array(bytes) });
const state = store.useApp.getState;
const channelOf = (name: string) => state().project.channels.find((c) => c.sound.name === name)!.id;

// The page has had a click or a key press; the tests set it.
let activated = true;

/** The parts of navigator the MIDI module uses. */
function stubNavigator(requestMIDIAccess: unknown): void {
  vi.stubGlobal('navigator', { requestMIDIAccess, userActivation: { get hasBeenActive() { return activated; } } });
}

async function connect(...inputs: FakeInput[]) {
  const devices = fakeAccess(...inputs);
  stubNavigator(vi.fn(async (opts: MIDIOptions) => {
    expect(opts).toEqual({ sysex: false });
    return devices.access;
  }));
  await initMidi();
  return devices;
}

beforeEach(() => {
  store.openProject(demoProject(), null);
  fake.started = true;
  activated = true;
});

afterEach(async () => {
  // Every keyboard goes away, so no notes are left behind for the next test.
  await connect();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('every connected input plays the selected sound with its velocity', async () => {
  const one = keyboard('a', 'Keystation 49');
  const two = keyboard('b', null);
  await connect(one, two);
  expect(useMidi.getState().devices).toEqual(['Keystation 49', 'MIDI keyboard']);
  const bell = channelOf('Bell');
  store.selectChannel(bell);
  send(one, 0x90, 60, 127);
  expect(audio.noteOn).toHaveBeenLastCalledWith(bell, 60, 1);
  expect(useMidi.getState().lit).toBe(true);
  await expect.poll(() => useMidi.getState().lit).toBe(false);
  // Any MIDI channel; note-on with velocity 0 and note-off both let go.
  send(two, 0x93, 64, 32);
  expect(audio.noteOn).toHaveBeenLastCalledWith(bell, 64, 32 / 127);
  send(one, 0x80, 60, 64);
  send(two, 0x93, 64, 0);
  expect(vi.mocked(audio.noteOff).mock.calls).toEqual([[bell, 60], [bell, 64]]);
  // A note let go after the selection changed stops on the sound it started on.
  send(one, 0x90, 67, 100);
  const kick = channelOf('Kick');
  store.selectChannel(kick);
  send(one, 0x80, 67, 0);
  expect(audio.noteOff).toHaveBeenLastCalledWith(bell, 67);
  // Pitch bend, other controllers and short messages are ignored.
  vi.clearAllMocks();
  send(one, 0xe0, 0, 64);
  send(one, 0xb0, 1, 127);
  send(one, 0x90, 60);
  expect(audio.noteOn).not.toHaveBeenCalled();
  expect(audio.noteOff).not.toHaveBeenCalled();
});

test('the sustain pedal holds the notes let go until it comes up', async () => {
  const one = keyboard('a');
  await connect(one);
  const bell = channelOf('Bell');
  store.selectChannel(bell);
  send(one, 0xb0, 64, 127);
  send(one, 0x90, 60, 100);
  send(one, 0x90, 64, 100);
  send(one, 0x80, 60, 0);
  send(one, 0x80, 64, 0);
  expect(audio.noteOff).not.toHaveBeenCalled();
  // Playing a held note again strikes it anew.
  send(one, 0x90, 60, 90);
  expect(vi.mocked(audio.noteOff).mock.calls).toEqual([[bell, 60]]);
  expect(audio.noteOn).toHaveBeenLastCalledWith(bell, 60, 90 / 127);
  send(one, 0xb0, 64, 0);
  // 64 was let go while the pedal was down; 60 is still held by its key.
  expect(vi.mocked(audio.noteOff).mock.calls).toEqual([[bell, 60], [bell, 64]]);
  send(one, 0x80, 60, 0);
  expect(vi.mocked(audio.noteOff).mock.calls).toEqual([[bell, 60], [bell, 64], [bell, 60]]);
});

test('keyboards plugged in or out while the app runs are picked up, and their notes let go', async () => {
  const one = keyboard('a', 'Left');
  const devices = await connect(one);
  const bell = channelOf('Bell');
  store.selectChannel(bell);
  const two = keyboard('b', 'Right');
  devices.plug(two);
  expect(useMidi.getState().devices).toEqual(['Left', 'Right']);
  send(two, 0x90, 72, 100);
  expect(audio.noteOn).toHaveBeenLastCalledWith(bell, 72, 100 / 127);
  send(one, 0x90, 48, 100);
  devices.unplug('b');
  expect(useMidi.getState().devices).toEqual(['Left']);
  expect(vi.mocked(audio.noteOff).mock.calls).toEqual([[bell, 72]]);
  devices.unplug('a');
  expect(useMidi.getState().devices).toEqual([]);
  expect(vi.mocked(audio.noteOff).mock.calls).toEqual([[bell, 72], [bell, 48]]);
});

test('without MIDI, or without permission, nothing happens and the lamp says so', async () => {
  stubNavigator(vi.fn(async () => {
    throw new DOMException('denied', 'NotAllowedError');
  }));
  await expect(initMidi()).resolves.toBeUndefined();
  stubNavigator(undefined);
  await expect(initMidi()).resolves.toBeUndefined();
  expect(useMidi.getState().devices).toEqual([]);

  function Hint() {
    return <span className="hint">{useHintText()}</span>;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<><Transport /><Hint /></>));
  const lamp = document.querySelector('.h-app-midi')!;
  expect(lamp.textContent).toBe('MIDI');
  lamp.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await expect.poll(() => document.querySelector('.hint')!.textContent).toBe('No MIDI keyboard connected.');
  lamp.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
  const one = keyboard('a', 'Keystation 49');
  await connect(one);
  lamp.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await expect.poll(() => document.querySelector('.hint')!.textContent)
    .toBe('MIDI: Keystation 49. Every key plays the selected sound.');
  send(one, 0x90, 60, 100);
  await expect.poll(() => lamp.querySelector('.h-led')!.classList.contains('is-on')).toBe(true);
  root.unmount();
  host.remove();
});

test('before the page may make sound, notes only blink the lamp', async () => {
  fake.started = false;
  activated = false;
  const one = keyboard('a');
  await connect(one);
  send(one, 0x90, 60, 100);
  expect(audio.noteOn).not.toHaveBeenCalled();
  expect(useMidi.getState()).toMatchObject({ lit: true, blocked: true });
  send(one, 0x80, 60, 0);
  expect(audio.noteOff).not.toHaveBeenCalled();
  activated = true;
  send(one, 0x90, 60, 100);
  expect(audio.noteOn).toHaveBeenCalledOnce();
  expect(useMidi.getState().blocked).toBe(false);
});
