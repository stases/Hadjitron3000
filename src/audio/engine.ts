// The engine: one graph per channel, a master bus with a soft clipper, and taps for meters and scopes.

import type { GainCurve, Project } from '../core/types';
import { dbToGain, glide } from './automation';
import { CHANNEL_TAP_SIZE, ChannelGraph, structureKey } from './channel';
import { Bus } from './mix';
import { decodeSample } from './samples';

// The clipper is exactly linear up to KNEE and bends towards 1 above it. Its WaveShaper sees the
// signal divided by HEADROOM, so inputs up to HEADROOM (+12 dBFS) reach the curved part.
const KNEE = 0.7;
const HEADROOM = 4;
const TAP_SIZE = 2048;

function softClip(x: number): number {
  const a = Math.abs(x);
  return a <= KNEE ? x : Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
}

let clipCurve: Float32Array<ArrayBuffer> | undefined;

function clipperCurve(): Float32Array<ArrayBuffer> {
  if (!clipCurve) {
    const n = 8193;
    clipCurve = new Float32Array(n);
    for (let i = 0; i < n; i++) clipCurve[i] = softClip(HEADROOM * ((2 * i) / (n - 1) - 1));
  }
  return clipCurve;
}

export class Engine {
  readonly ctx: BaseAudioContext;
  private readonly master: GainNode;
  private readonly bus: Bus;
  private readonly clipIn: GainNode;
  private readonly clipper: WaveShaperNode;
  private readonly taps: AnalyserNode[];
  private readonly tapData = new Float32Array(TAP_SIZE);
  private readonly channelData = new Float32Array(CHANNEL_TAP_SIZE);
  private readonly channels = new Map<string, ChannelGraph>();
  private readonly decodes = new Map<string, Promise<unknown>>();
  private project: Project | undefined;
  private voiceCount = 0;
  private readonly serial = () => this.voiceCount++;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = new GainNode(ctx);
    this.bus = new Bus(ctx, this.master);
    this.clipIn = new GainNode(ctx, { gain: 1 / HEADROOM });
    this.clipper = new WaveShaperNode(ctx, { curve: clipperCurve() });
    this.master.connect(this.clipIn).connect(this.clipper).connect(ctx.destination);
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.clipper.connect(split);
    this.taps = [0, 1].map((i) => {
      const tap = new AnalyserNode(ctx, { fftSize: TAP_SIZE });
      split.connect(tap, i);
      return tap;
    });
  }

  setProject(project: Project): void {
    const old = this.project;
    if (project === old) return;
    this.project = project;
    const t = this.ctx.currentTime;
    if (!old) this.master.gain.value = dbToGain(project.master);
    else if (project.master !== old.master) glide(this.master.gain, dbToGain(project.master), t);

    const solo = project.channels.some((c) => c.solo);
    const ids = new Set(project.channels.map((c) => c.id));
    for (const [id, graph] of this.channels) {
      if (ids.has(id)) continue;
      graph.dispose();
      this.channels.delete(id);
    }
    for (const ch of project.channels) {
      const audible = solo ? ch.solo : !ch.mute;
      const graph = this.channels.get(ch.id);
      const prev = old?.channels.find((c) => c.id === ch.id);
      if (graph && (prev?.sound === ch.sound || graph.key === structureKey(ch.sound))) {
        if (prev?.sound !== ch.sound || project.bpm !== old?.bpm) graph.update(ch.sound, project.bpm);
        graph.setAudible(audible);
        continue;
      }
      graph?.dispose();
      const fresh = new ChannelGraph(this.ctx, ch.sound, project.bpm, audible, !!graph, this.bus.take(t), this.serial);
      this.channels.set(ch.id, fresh);
    }

    for (const [id, sample] of Object.entries(project.samples)) {
      if (!this.decodes.has(id)) this.decodes.set(id, decodeSample(id, sample.bytes).catch(() => undefined));
    }
  }

  async ready(): Promise<void> {
    await Promise.all(Object.keys(this.project?.samples ?? {}).map((id) => this.decodes.get(id)));
  }

  /**
   * Play a note; with `slide` it glides out of the note sounding before it instead of starting again. A `gain`
   * curve gives the note a level of its own over time, from the note's start.
   */
  play(
    channelId: string, note: number, vel: number, time: number, dur: number, slide = false, gain?: GainCurve,
  ): void {
    this.channels.get(channelId)?.start(note, vel, Math.max(time, this.ctx.currentTime), dur, slide, gain);
  }

  noteOn(channelId: string, note: number, vel: number): void {
    this.channels.get(channelId)?.start(note, vel, this.ctx.currentTime, Infinity);
  }

  noteOff(channelId: string, note: number): void {
    this.channels.get(channelId)?.stop(note, this.ctx.currentTime);
  }

  stopAll(): void {
    for (const graph of this.channels.values()) graph.stopAll(this.ctx.currentTime);
  }

  levels(): [number, number] {
    const peak = (tap: AnalyserNode) => {
      tap.getFloatTimeDomainData(this.tapData);
      let p = 0;
      for (const v of this.tapData) p = Math.max(p, Math.abs(v));
      return p;
    };
    return [peak(this.taps[0]), peak(this.taps[1])];
  }

  scope(out: Float32Array): void {
    this.taps[0].getFloatTimeDomainData(this.tapData);
    const n = Math.min(out.length, TAP_SIZE);
    out.fill(0);
    out.set(this.tapData.subarray(TAP_SIZE - n), out.length - n);
  }

  /** The latest output of one channel, mono and before mute and solo, for the Factory's scope. */
  channelScope(channelId: string, out: Float32Array): void {
    const tap = this.channels.get(channelId)?.tap();
    const n = Math.min(out.length, CHANNEL_TAP_SIZE);
    out.fill(0);
    if (!tap) return;
    tap.getFloatTimeDomainData(this.channelData);
    out.set(this.channelData.subarray(CHANNEL_TAP_SIZE - n), out.length - n);
  }

  /** The lowest note a channel is playing now, live or from the transport, or null. */
  soundingNote(channelId: string): number | null {
    return this.channels.get(channelId)?.sounding(this.ctx.currentTime) ?? null;
  }

  dispose(): void {
    for (const graph of this.channels.values()) graph.dispose();
    this.channels.clear();
    this.master.disconnect();
    this.clipper.disconnect();
  }
}
