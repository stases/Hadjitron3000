// The audio controller: the one place where the store meets the engine.
// Views call these functions; nothing else in the interface touches Web Audio.

import { Engine, Transport } from '../audio';
import type { Channel, Project, SampleData, Sound } from '../core/types';
import { playScope, useApp } from '../state/store';

const PREVIEW_ID = 'preview';

let engine: Engine | null = null;
let transport: Transport | null = null;
// A library sound being auditioned. It lives in the engine only, never in the project.
let preview: { channel: Channel; samples: Record<string, SampleData> } | null = null;

/** The project as the engine should hear it: the document plus the sound being auditioned. */
function heard(): Project {
  const { project } = useApp.getState();
  if (!preview) return project;
  const channel = { ...preview.channel, solo: project.channels.some((c) => c.solo) };
  return { ...project, channels: [...project.channels, channel], samples: { ...project.samples, ...preview.samples } };
}

/** Create the audio context on first use (browsers only allow sound after a click or a key press). */
function boot(): Engine {
  if (!engine) {
    engine = new Engine(new AudioContext({ latencyHint: 'interactive' }));
    engine.setProject(heard());
    transport = new Transport(engine, () => ({ project: heard(), scope: playScope(useApp.getState()) }));
  }
  const ctx = engine.ctx as AudioContext;
  if (ctx.state === 'suspended') void ctx.resume();
  return engine;
}

/** Keep the engine and the transport in step with the store. Call once at startup. */
export function initAudio(): void {
  useApp.subscribe((state, prev) => {
    if (state.project !== prev.project) engine?.setProject(heard());
    if (state.playing === prev.playing) return;
    if (state.playing) {
      boot();
      transport!.start();
    } else {
      transport?.stop();
    }
  });
}

// Notes held right now, as "channelId:note", so the on-screen keyboard can light its keys.
const held = new Set<string>();
const heldListeners = new Set<() => void>();

function setHeld(channelId: string, note: number, on: boolean): void {
  const key = `${channelId}:${note}`;
  if (held.has(key) === on) return;
  if (on) held.add(key);
  else held.delete(key);
  heldListeners.forEach((listener) => listener());
}

/** Hold a note on a channel (keyboard, piano keys). */
export function noteOn(channelId: string, note: number, vel = 0.8): void {
  boot().noteOn(channelId, note, vel);
  setHeld(channelId, note, true);
}

export function noteOff(channelId: string, note: number): void {
  engine?.noteOff(channelId, note);
  setHeld(channelId, note, false);
}

export function isHeld(channelId: string, note: number): boolean {
  return held.has(`${channelId}:${note}`);
}

/** Subscribe to changes of the held notes (for useSyncExternalStore). Returns the unsubscribe function. */
export function onHeldChange(listener: () => void): () => void {
  heldListeners.add(listener);
  return () => heldListeners.delete(listener);
}

/** Play a short note on a channel (clicking a step, changing its pitch). */
export function tap(channelId: string, note: number, vel = 0.8, dur = 0.25): void {
  const e = boot();
  e.play(channelId, note, vel, e.ctx.currentTime + 0.005, dur);
}

/** Audition a sound that is not in the project (browsing the library). */
export async function audition(sound: Sound, samples: Record<string, SampleData> = {}, note = 60): Promise<void> {
  const e = boot();
  preview = { channel: { id: PREVIEW_ID, sound, color: 0, mute: false, solo: false }, samples };
  e.setProject(heard());
  await e.ready();
  if (preview?.channel.sound === sound) e.play(PREVIEW_ID, note, 0.8, e.ctx.currentTime + 0.005, 0.5);
}

/** Forget the auditioned sound (closing the library). */
export function endAudition(): void {
  preview = null;
  engine?.setProject(heard());
}

/** The absolute step being heard (fractional), or -1 when stopped. */
export function position(): number {
  return transport?.position() ?? -1;
}

/** Peak levels of the master output, left and right. */
export function levels(): [number, number] {
  return engine?.levels() ?? [0, 0];
}

/** The latest master output for the oscilloscope. */
export function scope(out: Float32Array): void {
  if (engine) engine.scope(out);
  else out.fill(0);
}

export function sampleRate(): number {
  return engine?.ctx.sampleRate ?? 0;
}
