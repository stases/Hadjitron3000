// MIDI keyboards. Every connected input plays the selected sound, like the computer keyboard: notes with their
// velocity, and the sustain pedal (controller 64) holds the notes let go while it is down. Other messages are
// ignored. Inputs that come and go while the app runs are picked up; the transport's MIDI lamp blinks on notes.

import { create } from 'zustand';
import { platform } from '../platform';
import { useApp } from '../state/store';
import { audioStarted, noteOff, noteOn } from './audio';

const BLINK_MS = 80;
const SUSTAIN = 64;

interface MidiState {
  /** The names of the connected inputs. */
  devices: string[];
  /** On for a moment after each note. */
  lit: boolean;
  /** A note came before the page was allowed to make sound. */
  blocked: boolean;
}

export const useMidi = create<MidiState>(() => ({ devices: [], lit: false, blocked: false }));

/** One input's keys: the sound each sounding note plays on, the pedal, and the notes it holds. */
interface Keys {
  sounding: Map<number, string>;
  pedal: boolean;
  sustained: Set<number>;
}

const inputs = new Map<string, Keys>();
let blink: ReturnType<typeof setTimeout> | undefined;

// The shell lets the page make sound at any time; a browser only after a click or a key press.
const maySound = () =>
  audioStarted() || platform.kind === 'electron' || (navigator.userActivation?.hasBeenActive ?? true);

function release(keys: Keys, note: number): void {
  const channelId = keys.sounding.get(note);
  if (channelId === undefined) return;
  keys.sounding.delete(note);
  keys.sustained.delete(note);
  noteOff(channelId, note);
}

function press(keys: Keys, note: number, vel: number): void {
  const blocked = !maySound();
  useMidi.setState({ lit: true, blocked });
  clearTimeout(blink);
  blink = setTimeout(() => useMidi.setState({ lit: false }), BLINK_MS);
  const { channelId } = useApp.getState();
  if (!channelId || blocked) return;
  release(keys, note);
  keys.sounding.set(note, channelId);
  noteOn(channelId, note, vel);
}

function receive(keys: Keys, data: Uint8Array | null): void {
  if (!data || data.length < 3) return;
  const [status, a, b] = data;
  const kind = status & 0xf0;
  if (kind === 0x90 && b > 0) press(keys, a, b / 127);
  else if (kind === 0x80 || kind === 0x90) {
    if (keys.pedal && keys.sounding.has(a)) keys.sustained.add(a);
    else release(keys, a);
  } else if (kind === 0xb0 && a === SUSTAIN) {
    keys.pedal = b >= 64;
    if (!keys.pedal) for (const note of keys.sustained) release(keys, note);
  }
}

/** Listen to every connected input, let go of the notes of inputs that went away, and list the names. */
function follow(access: MIDIAccess): void {
  const connected = [...access.inputs.values()].filter((input) => input.state === 'connected');
  for (const [id, keys] of inputs) {
    if (connected.some((input) => input.id === id)) continue;
    for (const note of [...keys.sounding.keys()]) release(keys, note);
    inputs.delete(id);
  }
  for (const input of connected) {
    let keys = inputs.get(input.id);
    if (!keys) {
      keys = { sounding: new Map(), pedal: false, sustained: new Set() };
      inputs.set(input.id, keys);
    }
    const own = keys;
    input.onmidimessage = (e) => receive(own, e.data);
  }
  useMidi.setState({ devices: connected.map((input) => input.name || 'MIDI keyboard') });
}

/** Ask for MIDI input (no system exclusive messages). Where it is not offered or allowed nothing happens. */
export async function initMidi(): Promise<void> {
  if (!navigator.requestMIDIAccess) return;
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    return;
  }
  access.onstatechange = () => follow(access);
  follow(access);
}
