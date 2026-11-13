// The engine: one graph and one strip per channel, two send buses, a master rack and level with a soft clipper, and
// taps for meters and scopes.

import { SEND_MODULE, busUsed } from '../core/automation';
import type { Owner } from '../core/mixer';
import type { GainCurve, Lock, ParamRef, Project } from '../core/types';
import { Automated, dbToGain, glide } from './automation';
import { EffectRack, SendBusGraph, Strip } from './buses';
import { CHANNEL_TAP_SIZE, ChannelGraph, structureKey } from './channel';
import { Bus } from './mix';
import { decodeSample } from './samples';
import { processorsLoading } from './worklet';

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
  /** Everything heard, ahead of the master rack. */
  private readonly sum: GainNode;
  private readonly master: GainNode;
  private readonly bus: Bus;
  private readonly sends: SendBusGraph[];
  private rack: EffectRack | null = null;
  private readonly clipIn: GainNode;
  private readonly clipper: WaveShaperNode;
  private readonly taps: AnalyserNode[];
  private readonly tapData = new Float32Array(TAP_SIZE);
  private readonly channelData = new Float32Array(CHANNEL_TAP_SIZE);
  private readonly channels = new Map<string, ChannelGraph>();
  private readonly strips = new Map<string, Strip>();
  /** The strips that each channel's notes duck, by the source's id. */
  private ducked = new Map<string, Strip[]>();
  private readonly decodes = new Map<string, Promise<unknown>>();
  private project: Project | undefined;
  /** The master level's automation. */
  private readonly masterAuto = new Automated();
  private voiceCount = 0;
  private readonly serial = () => this.voiceCount++;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.sum = new GainNode(ctx);
    this.master = new GainNode(ctx);
    this.bus = new Bus(ctx, this.sum);
    this.sends = [0, 1].map(() => new SendBusGraph(ctx, this.bus));
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
    else if (project.master !== old.master && !this.masterAuto.has('out', 'level')) {
      glide(this.master.gain, dbToGain(project.master), t);
    }
    const { mixer } = project;
    if (this.rack) this.rack.set(mixer.master.chain, project.bpm);
    else this.rack = new EffectRack(this.ctx, this.sum, this.master, mixer.master.chain, project.bpm);

    const solo = project.channels.some((c) => c.solo);
    const ids = new Set(project.channels.map((c) => c.id));
    for (const [id, graph] of this.channels) {
      if (ids.has(id)) continue;
      graph.dispose();
      this.channels.delete(id);
      this.strips.get(id)!.dispose();
      this.strips.delete(id);
    }
    this.ducked = new Map();
    for (const ch of project.channels) {
      let strip = this.strips.get(ch.id);
      if (strip) strip.update(ch);
      else this.strips.set(ch.id, (strip = new Strip(this.ctx, ch, this.bus, this.sends.map((s) => s.inputs))));
      const { source } = ch.duck;
      if (source !== null && source !== ch.id) this.ducked.set(source, [...(this.ducked.get(source) ?? []), strip]);
      const audible = solo ? ch.solo : !ch.mute;
      const graph = this.channels.get(ch.id);
      const prev = old?.channels.find((c) => c.id === ch.id);
      if (graph && (prev?.sound === ch.sound || graph.key === structureKey(ch.sound))) {
        if (prev?.sound !== ch.sound || project.bpm !== old?.bpm) graph.update(ch.sound, project.bpm);
        graph.setAudible(audible);
        continue;
      }
      graph?.dispose();
      const slot = strip.inputs.take(t);
      this.channels.set(
        ch.id, new ChannelGraph(this.ctx, ch.sound, project.bpm, audible, !!graph, slot, this.serial, graph?.auto),
      );
    }
    mixer.buses.forEach((bus, i) => this.sends[i].set(bus, project.bpm, busUsed(project, i)));

    for (const [id, sample] of Object.entries(project.samples)) {
      if (!this.decodes.has(id)) this.decodes.set(id, decodeSample(id, sample.bytes).catch(() => undefined));
    }
  }

  /** Resolves when the samples are decoded and the effects made of processors have them (see worklet.ts). */
  async ready(): Promise<void> {
    await Promise.all(Object.keys(this.project?.samples ?? {}).map((id) => this.decodes.get(id)));
    await processorsLoading(this.ctx);
  }

  /**
   * Play a note; with `slide` it glides out of the note sounding before it instead of starting again. A `gain`
   * curve gives the note a level of its own over time, from the note's start. Its `locks` of parameters inside the
   * voice give that voice values of its own; locks of shared parameters are the automator's.
   */
  play(
    channelId: string, note: number, vel: number, time: number, dur: number, slide = false, gain?: GainCurve,
    locks?: readonly Lock[],
  ): void {
    const t = Math.max(time, this.ctx.currentTime);
    this.channels.get(channelId)?.start(note, vel, t, dur, slide, gain, locks);
    this.duck(channelId, t);
  }

  /**
   * Automation moves a parameter to `value`, in its own units, in a straight line that arrives at `time`; the
   * transport and the renderer call it through an Automator.
   */
  automate(ref: ParamRef, value: number, time: number): void {
    const { owner, module, param } = ref;
    if (typeof owner === 'string') {
      if (module === SEND_MODULE) this.strips.get(owner)?.automateSend(Number(param), value, time);
      else this.channels.get(owner)?.automate(module, param, value, time);
    } else if (owner.rack !== 'master') {
      this.sends[owner.rack].automate(module, param, value, time);
    } else if (module !== 'out') {
      this.rack?.automate(module, param, value, time);
    } else {
      this.masterAuto.add(module, param, value, time);
      this.master.gain.linearRampToValueAtTime(dbToGain(value), time);
    }
  }

  /** Step the automated parameters of effects that cannot ramp to their values now. */
  flushAutomation(): void {
    for (const graph of this.channels.values()) graph.flush();
    for (const bus of this.sends) bus.flush();
    this.rack?.flush();
  }

  /** The song stopped: every automated parameter goes back to its stored value. */
  endAutomation(): void {
    for (const graph of this.channels.values()) graph.endAutomation();
    for (const strip of this.strips.values()) strip.endAutomation();
    for (const bus of this.sends) bus.endAutomation();
    this.rack?.endAutomation();
    this.masterAuto.release(this.ctx.currentTime, () => undefined, 0, (_module, _param, time) =>
      this.master.gain.linearRampToValueAtTime(dbToGain(this.project!.master), time));
  }

  /** Whether automation moves a parameter in straight lines; an effect without `ramp` is stepped instead. */
  ramps(ref: ParamRef): boolean {
    const { owner, module } = ref;
    if (typeof owner === 'string') return this.channels.get(owner)?.ramps(module) ?? true;
    return owner.rack === 'master' ? this.rack?.ramps(module) ?? true : this.sends[owner.rack].ramps(module);
  }

  noteOn(channelId: string, note: number, vel: number): void {
    this.channels.get(channelId)?.start(note, vel, this.ctx.currentTime, Infinity);
    this.duck(channelId, this.ctx.currentTime);
  }

  /** A note of a channel starts at `t`: the channels that duck to it dip. */
  private duck(channelId: string, t: number): void {
    if (!this.channels.has(channelId)) return;
    for (const strip of this.ducked.get(channelId) ?? []) strip.dip(t);
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

  /** Peak levels of one channel as the mixer hears it, after level, pan, mute, solo and ducking. */
  channelLevels(channelId: string): [number, number] {
    return this.strips.get(channelId)?.levels() ?? [0, 0];
  }

  /** Peak levels of what a send bus adds to the master. */
  busLevels(index: number): [number, number] {
    return this.sends[index].levels();
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

  /** The gain reduction of a compressor in a sound's chain or a mixer rack, in dB, or 0. */
  effectReduction(owner: Owner, moduleId: string): number {
    const effect = typeof owner === 'string' ? this.channels.get(owner)?.effect(moduleId)
      : owner.rack === 'master' ? this.rack?.effect(moduleId) : this.sends[owner.rack].effect(moduleId);
    return effect?.reduction?.() ?? 0;
  }

  dispose(): void {
    for (const graph of this.channels.values()) graph.dispose();
    this.channels.clear();
    this.master.disconnect();
    this.clipper.disconnect();
  }
}
