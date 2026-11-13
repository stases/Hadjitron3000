// The audio controller: the one place where the store meets the engine.
// Views call these functions; nothing else in the interface touches Web Audio.

import { Engine, Metronome, Transport, loadProcessors, outputDelay, renderProject } from '../audio';
import { arpOf } from '../core/arp';
import { newChannel, newLanes } from '../core/defaults';
import { barOf } from '../core/meter';
import type { Owner } from '../core/mixer';
import { heardTick } from '../core/record';
import type { Clock } from '../core/record';
import { tickTime } from '../core/sequencer';
import type { Block, Channel, Project, SampleData, Sound } from '../core/types';
import { playScope, setPlaying, useApp } from '../state/store';
import { LiveArp } from './arp';
import { usePrefs } from './prefs';

const PREVIEW_ID = 'preview';
const BLOCK_TAIL_SECONDS = 2;

interface BlockAudition {
  player: AudioBufferSourceNode | null; // null while the block is still being rendered
}

let engine: Engine | null = null;
let transport: Transport | null = null;
let metronome: Metronome | null = null;
let arp: LiveArp | null = null;
// The keys held through the arpeggiator, as "channelId:note", so that letting go goes the same way.
const arpKeys = new Set<string>();
// Play starts after a bar of clicks.
let countingIn = false;
// Counts the times Play is pressed, so that only the latest start goes ahead once the processors are in.
let starts = 0;
// Resolves once the live context has the custom processors, or knows it cannot have them.
let processors: Promise<boolean> = Promise.resolve(false);
// What the status bar says about the audio when there is no hint, such as effects that could not be loaded.
let notice = '';
const noticeListeners = new Set<() => void>();
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
    processors = loadProcessors(engine.ctx);
    void processors.then((ok) => ok || setNotice('Crusher, Tape, Comb and Space could not be loaded, so they are off.'));
    engine.setProject(heard());
    transport = new Transport(engine, () => ({ project: heard(), scope: playScope(useApp.getState()) }));
    metronome = new Metronome(engine.ctx, () => ({
      clock: transport!.clock(), bar: barOf(useApp.getState().project.meter), on: usePrefs.getState().metronome,
    }));
    const e = engine;
    arp = new LiveArp({
      now: () => e.ctx.currentTime,
      clock: () => transport!.clock(),
      tempo: () => useApp.getState().project,
      settings: (channelId) => {
        const sound = heard().channels.find((c) => c.id === channelId)?.sound;
        return sound ? arpOf(sound.play) : null;
      },
      play: (channelId, note, vel, time, dur) => e.play(channelId, note, vel, time, dur),
    });
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
      const { project } = state;
      const lead = countingIn ? tickTime(barOf(project.meter).ticks, project.bpm, project.swing) : 0;
      const start = ++starts;
      // The first time, the effects made of processors are ready a moment after the context. A Stop pressed in
      // that moment, or a newer Play, wins.
      void processors.then(() => {
        if (start !== starts || !useApp.getState().playing) return;
        transport!.start(lead);
        metronome!.start();
      });
    } else {
      starts++;
      transport?.stop();
      metronome?.stop();
    }
    countingIn = false;
  });
}

/** Start playing after one bar of clicks, so the first note can be played on time. */
export function countIn(): void {
  countingIn = true;
  setPlaying(true);
}

/** Whether the audio context exists, so that sound may be made without a click or a key press first. */
export function audioStarted(): boolean {
  return engine !== null;
}

/** The transport's clock while it plays, or null. */
export function clock(): Clock | null {
  return transport?.clock() ?? null;
}

/** How long sound takes from the context's clock to the ear, in seconds. */
export function latency(): number {
  return engine ? outputDelay(engine.ctx) : 0;
}

/** The audio context's clock, 0 before there is one. */
export function contextTime(): number {
  return engine?.ctx.currentTime ?? 0;
}

/** The tick being heard right now, fractional and negative during the count-in; null when stopped. */
export function heardNow(): number | null {
  const c = clock();
  return c && heardTick(c, contextTime(), latency());
}

/** A note played by hand: its channel, pitch, velocity (null when it is let go) and context time. */
export interface LiveNote {
  channelId: string;
  note: number;
  vel: number | null;
  time: number;
}

const liveListeners = new Set<(e: LiveNote) => void>();

/** Hear about every note played and let go by hand (keyboard, piano keys, MIDI). Returns the unsubscribe function. */
export function onLiveNote(listener: (e: LiveNote) => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

function setNotice(text: string): void {
  notice = text;
  noticeListeners.forEach((listener) => listener());
}

export function audioNotice(): string {
  return notice;
}

/** Subscribe to changes of the audio notice (for useSyncExternalStore). Returns the unsubscribe function. */
export function onAudioNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
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

/** Hold a note on a channel (keyboard, piano keys); with the sound's arpeggiator on, it joins the notes it plays. */
export function noteOn(channelId: string, note: number, vel = 0.8): void {
  const e = boot();
  const key = `${channelId}:${note}`;
  if (arp!.takes(channelId)) {
    arpKeys.add(key);
    arp!.down(channelId, note, vel);
  } else {
    e.noteOn(channelId, note, vel);
  }
  setHeld(channelId, note, true);
  liveListeners.forEach((listener) => listener({ channelId, note, vel, time: e.ctx.currentTime }));
}

export function noteOff(channelId: string, note: number): void {
  const key = `${channelId}:${note}`;
  if (arpKeys.delete(key)) arp?.up(channelId, note);
  else engine?.noteOff(channelId, note);
  setHeld(channelId, note, false);
  const time = engine?.ctx.currentTime ?? 0;
  liveListeners.forEach((listener) => listener({ channelId, note, vel: null, time }));
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
  preview = { channel: newChannel(PREVIEW_ID, sound, 0), samples };
  e.setProject(heard());
  await e.ready();
  if (preview?.channel.sound === sound) e.play(PREVIEW_ID, note, 0.8, e.ctx.currentTime + 0.005, 0.5);
}

/**
 * The project a block plays in on its own: one channel per track, at the open project's tempo, swing and meter and
 * through its master. Its sounds send nothing to the buses.
 */
function blockProject(block: Block): Project {
  const { bpm, swing, meter, master, mixer } = useApp.getState().project;
  const channels = block.tracks.map((track, i) => newChannel(`b${i}`, track.sound, 0));
  const notes = Object.fromEntries(block.tracks.map((track, i) => [`b${i}`, track.notes]));
  const loops = Object.fromEntries(block.tracks.flatMap((track, i) => (track.loop ? [[`b${i}`, track.loop]] : [])));
  return {
    name: block.name, bpm, swing, meter, master, mixer, channels, song: [], lanes: newLanes(), automation: [],
    samples: block.samples,
    patterns: [{ id: 'block', name: block.name, color: block.color, bars: block.bars, notes, loops }],
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

/** Peak levels of one channel in the mix, after its level, pan, mute, solo and ducking. */
export function channelLevels(channelId: string): [number, number] {
  return engine?.channelLevels(channelId) ?? [0, 0];
}

/** Peak levels of what a send bus adds to the master. */
export function busLevels(index: number): [number, number] {
  return engine?.busLevels(index) ?? [0, 0];
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

/** How far a compressor in a sound's chain or a mixer rack turns the sound down now, in dB (0 or below). */
export function effectReduction(owner: Owner, moduleId: string): number {
  return engine?.effectReduction(owner, moduleId) ?? 0;
}

export function sampleRate(): number {
  return engine?.ctx.sampleRate ?? 0;
}
