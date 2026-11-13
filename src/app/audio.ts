// The audio controller: the one place where the store meets the engine.
// Views call these functions; nothing else in the interface touches Web Audio.

import { Engine, Transport, renderProject } from '../audio';
import { newLanes } from '../core/defaults';
import type { Block, Channel, Project, SampleData, Sound } from '../core/types';
import { playScope, useApp } from '../state/store';

const PREVIEW_ID = 'preview';
const BLOCK_TAIL_SECONDS = 2;

interface BlockAudition {
  player: AudioBufferSourceNode | null; // null while the block is still being rendered
}

let engine: Engine | null = null;
let transport: Transport | null = null;
// A library sound being auditioned. It lives in the engine only, never in the project.
let preview: { channel: Channel; samples: Record<string, SampleData> } | null = null;
// A library block being auditioned: rendered offline on its own, then played as one buffer.
let blockAudition: BlockAudition | null = null;

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

/** The project a block plays in on its own: one channel per track, at the open project's tempo, swing and meter. */
function blockProject(block: Block): Project {
  const { bpm, swing, meter, master } = useApp.getState().project;
  const channels = block.tracks.map((track, i) => ({
    id: `b${i}`, sound: track.sound, color: 0, mute: false, solo: false,
  }));
  const notes = Object.fromEntries(block.tracks.map((track, i) => [`b${i}`, track.notes]));
  return {
    name: block.name, bpm, swing, meter, master, channels, song: [], lanes: newLanes(), samples: block.samples,
    patterns: [{ id: 'block', name: block.name, color: block.color, bars: block.bars, notes }],
  };
}

/** Play a block that is not in the project once (browsing the block library). It is rendered first, then played. */
export async function auditionBlock(block: Block): Promise<void> {
  const e = boot();
  stopBlock();
  const playing: BlockAudition = { player: null };
  blockAudition = playing;
  const pcm = await renderProject(blockProject(block), { kind: 'pattern', patternId: 'block' }, {
    tail: BLOCK_TAIL_SECONDS, sampleRate: e.ctx.sampleRate,
  });
  if (blockAudition !== playing) return;
  const buffer = e.ctx.createBuffer(2, pcm.channels[0].length, pcm.sampleRate);
  pcm.channels.forEach((data, i) => buffer.getChannelData(i).set(data));
  playing.player = e.ctx.createBufferSource();
  playing.player.buffer = buffer;
  playing.player.connect(e.ctx.destination);
  playing.player.start();
}

function stopBlock(): void {
  blockAudition?.player?.stop();
  blockAudition = null;
}

/** Forget the auditioned sound and stop an auditioned block (closing a library). */
export function endAudition(): void {
  preview = null;
  stopBlock();
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

/** The latest output of one channel, whether it is muted or not, for the Factory's scope. */
export function channelScope(channelId: string, out: Float32Array): void {
  if (engine) engine.channelScope(channelId, out);
  else out.fill(0);
}

/** The lowest note a channel is playing now, from the keyboard or the transport, or null. */
export function soundingNote(channelId: string): number | null {
  return engine?.soundingNote(channelId) ?? null;
}

export function sampleRate(): number {
  return engine?.ctx.sampleRate ?? 0;
}
