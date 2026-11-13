// The audio graph of one channel: voices, the shared effect chain, the modulators and the output.

import { adsrOf, envelopeSegments, releaseSegments, type Adsr } from '../core/envelope';
import { moduleDef, paramSpec } from '../core/modules';
import type { ModInst, ModuleInst, Sound } from '../core/types';
import { cut, dbToGain, glide, schedule, type Plan } from './automation';
import { Bus, mix, type Slot } from './mix';
import { EFFECT_BUILDERS, type Effect } from './modules/effects';
import { SOURCE_BUILDERS, type SourceVoice } from './modules/sources';

const MAX_VOICES = 24;
// A stolen or stopped voice fades out over 1.25 times this (5 ms).
const QUICK_RELEASE = 0.004;
const MUTE_TAU = 0.003;
export const CHANNEL_TAP_SIZE = 32768;

interface Voice {
  note: number;
  src: SourceVoice;
  gain: GainNode;
  env: Plan;
  adsr: Adsr;
  held: boolean; // a live note waiting for its note-off
  stopAt: number;
  slot: Slot;
  links: [AudioNode, AudioParam][];
  done: boolean;
}

interface Mod {
  inst: ModInst;
  node: ConstantSourceNode | OscillatorNode;
  depth: GainNode;
  depthPerAmount: number;
  env?: Plan & { note: number; held: boolean };
}

/** Everything that makes a channel's graph: when it changes the channel is rebuilt. */
export function structureKey(sound: Sound): string {
  const on = (m: ModuleInst) => m.on !== false;
  return JSON.stringify([
    sound.source.type,
    sound.chain.map((m) => [m.id, m.type, on(m)]),
    sound.mods.map((m) => [m.id, m.type, on(m), m.target]),
  ]);
}

const levelGain = (db: number) => (db <= -48 ? 0 : dbToGain(db));

export class ChannelGraph {
  readonly key: string;
  private sound: Sound;
  private bpm: number;
  private readonly voiceBus: Bus;
  private readonly effects = new Map<string, Effect>();
  private readonly mods: Mod[] = [];
  /** The summed modulation of each source parameter, connected to every voice. */
  private readonly sourceMods = new Map<string, AudioNode>();
  private voices: Voice[] = [];
  private readonly tremolo: GainNode;
  private readonly level: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly gain: GainNode;
  private analyser: AnalyserNode | null = null;
  private audible: boolean;

  constructor(
    private readonly ctx: BaseAudioContext,
    sound: Sound,
    bpm: number,
    audible: boolean,
    fadeIn: boolean,
    private readonly slot: Slot,
    private readonly serial: () => number,
  ) {
    this.key = structureKey(sound);
    this.sound = sound;
    this.bpm = bpm;
    this.audible = audible;
    this.tremolo = new GainNode(ctx);
    this.level = new GainNode(ctx, { gain: levelGain(sound.out.level as number) });
    this.panner = new StereoPannerNode(ctx, { pan: sound.out.pan as number });
    this.gain = new GainNode(ctx, { gain: audible && !fadeIn ? 1 : 0 });
    if (fadeIn) glide(this.gain.gain, audible ? 1 : 0, ctx.currentTime, MUTE_TAU);
    this.tremolo.connect(this.level).connect(this.panner).connect(this.gain).connect(slot.input);

    let next: AudioNode = this.tremolo;
    for (const m of [...sound.chain].reverse()) {
      if (m.on === false || !EFFECT_BUILDERS[m.type]) continue;
      const fx = EFFECT_BUILDERS[m.type](ctx, m.params, bpm);
      fx.output.connect(next);
      next = fx.input;
      this.effects.set(m.id, fx);
    }
    this.voiceBus = new Bus(ctx, next);

    const byTarget = new Map<string, { module: string; param: string; depths: GainNode[] }>();
    for (const inst of sound.mods) {
      if (inst.on === false || !inst.target) continue;
      const def = moduleDef(sound, inst.target.module);
      const spec = def && paramSpec(def, inst.target.param);
      const depthPerAmount = spec?.kind === 'float' && spec.mod ? spec.mod.depth : 0;
      const targets = this.moduleTargets(inst.target.module)?.[inst.target.param];
      if (!depthPerAmount || (inst.target.module !== 'source' && !targets)) continue;
      const node =
        inst.type === 'lfo'
          ? new OscillatorNode(ctx, { type: inst.params.wave as OscillatorType, frequency: inst.params.rate as number })
          : new ConstantSourceNode(ctx, { offset: 0 });
      const depth = new GainNode(ctx, { gain: inst.amount * depthPerAmount });
      node.connect(depth);
      node.start(ctx.currentTime);
      this.mods.push({ inst, node, depth, depthPerAmount });
      const key = `${inst.target.module}.${inst.target.param}`;
      if (!byTarget.has(key)) byTarget.set(key, { ...inst.target, depths: [] });
      byTarget.get(key)!.depths.push(depth);
    }
    for (const { module, param, depths } of byTarget.values()) {
      const sum = mix(ctx, depths);
      if (module === 'source') this.sourceMods.set(param, sum);
      else for (const target of this.moduleTargets(module)![param]) sum.connect(target);
    }
  }

  private moduleTargets(module: string): Record<string, AudioParam[]> | undefined {
    if (module === 'out') return { level: [this.tremolo.gain], pan: [this.panner.pan] };
    return this.effects.get(module)?.targets;
  }

  /** Apply a sound with the same structure in place. */
  update(sound: Sound, bpm: number): void {
    const old = this.sound;
    const t = this.ctx.currentTime;
    this.sound = sound;
    for (const m of sound.chain) {
      const prev = old.chain.find((o) => o.id === m.id);
      if (prev?.params !== m.params || bpm !== this.bpm) this.effects.get(m.id)?.update(m.params, bpm);
    }
    this.bpm = bpm;
    for (const mod of this.mods) {
      const inst = sound.mods.find((m) => m.id === mod.inst.id)!;
      if (inst === mod.inst) continue;
      mod.inst = inst;
      glide(mod.depth.gain, inst.amount * mod.depthPerAmount, t);
      if (mod.node instanceof OscillatorNode) {
        mod.node.type = inst.params.wave as OscillatorType;
        glide(mod.node.frequency, inst.params.rate as number, t);
      }
    }
    if (sound.out !== old.out) {
      glide(this.level.gain, levelGain(sound.out.level as number), t);
      glide(this.panner.pan, sound.out.pan as number, t);
    }
  }

  setAudible(audible: boolean): void {
    if (audible === this.audible) return;
    this.audible = audible;
    glide(this.gain.gain, audible ? 1 : 0, this.ctx.currentTime, MUTE_TAU);
  }

  /** The channel's output after level and pan, summed to mono, ahead of mute and solo. Made on first use. */
  tap(): AnalyserNode {
    if (!this.analyser) {
      this.analyser = new AnalyserNode(this.ctx, {
        fftSize: CHANNEL_TAP_SIZE, channelCount: 1, channelCountMode: 'explicit',
      });
      this.panner.connect(this.analyser);
    }
    return this.analyser;
  }

  /** The lowest note sounding at `t`, release tails included, or null. */
  sounding(t: number): number | null {
    let low: number | null = null;
    for (const v of this.voices) if (!v.done && v.env.t0 <= t && v.stopAt > t) low = Math.min(low ?? v.note, v.note);
    return low;
  }

  /** Start a note at `t`, held for `gate` seconds (Infinity for a live note). */
  start(note: number, vel: number, t: number, gate: number): void {
    this.retriggerEnvelopes(note, t, gate);
    const src = SOURCE_BUILDERS[this.sound.source.type]?.(this.ctx, this.sound.source.params, note, t, this.serial());
    if (!src) return;
    this.voices = this.voices.filter((v) => v.stopAt > t && !v.done);
    while (this.voices.length >= MAX_VOICES) this.release(this.voices.shift()!, t, QUICK_RELEASE);

    const adsr = adsrOf(this.sound.amp);
    const length = src.length ?? gate;
    const env: Plan = { t0: t, scale: vel * vel, segs: envelopeSegments(adsr, length) };
    const gain = new GainNode(this.ctx, { gain: 0 });
    schedule(gain.gain, env);
    const slot = this.voiceBus.take(t);
    src.output.connect(gain).connect(slot.input);
    const links: [AudioNode, AudioParam][] = [];
    for (const [param, sum] of this.sourceMods) {
      for (const target of src.targets[param] ?? []) {
        sum.connect(target);
        links.push([sum, target]);
      }
    }
    const held = length === Infinity;
    const voice: Voice = { note, src, gain, env, adsr, held, stopAt: Infinity, slot, links, done: false };
    if (!voice.held) this.scheduleStop(voice);
    src.nodes[0].onended = () => this.end(voice);
    this.voices.push(voice);
  }

  /** Release the held voices of a live note. */
  stop(note: number, t: number): void {
    for (const v of this.voices) if (v.held && v.note === note) this.release(v, t, v.adsr.release);
    for (const { node, env, inst } of this.mods) {
      if (!(node instanceof ConstantSourceNode) || !env?.held || env.note !== note) continue;
      env.held = false;
      const level = cut(node.offset, env, t);
      env.segs = releaseSegments(level, t - env.t0, adsrOf(inst.params).release);
      schedule(node.offset, env);
    }
  }

  /** Release every voice quickly (transport stop). */
  stopAll(t: number): void {
    for (const v of this.voices) if (v.stopAt > t) this.release(v, t, QUICK_RELEASE);
  }

  dispose(): void {
    const t = this.ctx.currentTime;
    glide(this.gain.gain, 0, t, MUTE_TAU);
    for (const v of this.voices) v.done = true;
    for (const v of this.voices) for (const n of v.src.nodes) n.stop(t + 0.03);
    for (const mod of this.mods) mod.node.stop(t + 0.03);
    for (const fx of this.effects.values()) fx.dispose();
    this.slot.until = t + 0.2;
    setTimeout(() => {
      this.gain.disconnect();
      this.panner.disconnect();
    }, 100);
  }

  private release(v: Voice, t: number, release: number): void {
    v.held = false;
    const level = cut(v.gain.gain, v.env, t);
    v.env.segs = releaseSegments(level, t - v.env.t0, release);
    schedule(v.gain.gain, v.env);
    this.scheduleStop(v);
  }

  private scheduleStop(v: Voice): void {
    v.stopAt = v.slot.until = v.env.t0 + v.env.segs[v.env.segs.length - 1].end;
    for (const n of v.src.nodes) n.stop(v.stopAt);
  }

  private end(v: Voice): void {
    if (v.done) return;
    v.done = true;
    v.gain.disconnect();
    for (const [sum, param] of v.links) sum.disconnect(param);
    this.voices = this.voices.filter((x) => x !== v);
  }

  /** Modulation envelopes restart on every note, from wherever they are, and follow that note. */
  private retriggerEnvelopes(note: number, t: number, gate: number): void {
    for (const mod of this.mods) {
      if (!(mod.node instanceof ConstantSourceNode)) continue;
      const from = mod.env ? cut(mod.node.offset, mod.env, t) : 0;
      const segs = envelopeSegments(adsrOf(mod.inst.params), gate, from);
      mod.env = { t0: t, scale: 1, segs, note, held: gate === Infinity };
      schedule(mod.node.offset, mod.env);
    }
  }
}
