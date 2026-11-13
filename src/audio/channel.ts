// The audio graph of one channel: voices, the shared effect chain, the modulators and the output.

import { adsrOf, envelopeSegments, releaseSegments, type Adsr } from '../core/envelope';
import { inVoice, moduleDef, paramSpec, perNote } from '../core/modules';
import type { ModInst, ModuleInst, Sound } from '../core/types';
import { cut, dbToGain, glide, schedule, type Plan } from './automation';
import { Bus, mix, type Slot } from './mix';
import { EFFECT_BUILDERS, type Effect } from './modules/effects';
import { modSource, type ModSource } from './modules/modulators';
import { SOURCE_BUILDERS, type Follower, type SourceVoice } from './modules/sources';
import { voiceFilter, type VoiceFilter } from './modules/voicefilter';

const MAX_VOICES = 24;
// A stolen or stopped voice fades out over 1.25 times this (5 ms).
const QUICK_RELEASE = 0.004;
const MUTE_TAU = 0.003;
// A forced slide takes this long when the sound's glide is 0.
const SLIDE = 0.06;
// A note is still held at the start of the next one when its key goes up more than this later.
const OVERLAP = 1e-6;
export const CHANNEL_TAP_SIZE = 32768;

/** A glide of a voice's pitch in cents from the note it was built for: c0 at t0, straight on to c1 at t1. */
interface Bend {
  t0: number;
  t1: number;
  c0: number;
  c1: number;
}

/** A modulator built inside one voice; `scale` is what the note's velocity makes of its amount. */
interface NoteMod {
  inst: ModInst;
  src: ModSource;
  depth: GainNode;
  depthPerAmount: number;
  scale: number;
  env?: Plan & { param: AudioParam };
}

interface Voice {
  note: number; // the note it plays now; a legato note moves it
  root: number; // the note it was built for
  src: SourceVoice;
  filter: VoiceFilter | null;
  gain: GainNode;
  env: Plan; // starts filter.lag after the note
  adsr: Adsr;
  held: boolean; // a live note waiting for its note-off
  gateEnd: number; // when the key goes up, Infinity while held
  stopAt: number;
  slot: Slot;
  links: [AudioNode, AudioParam][];
  mods: NoteMod[];
  bend: Bend | null;
  done: boolean;
}

interface Mod {
  inst: ModInst;
  src: ModSource;
  depth: GainNode;
  depthPerAmount: number;
  env?: Plan & { note: number; held: boolean };
}

const centsAt = (b: Bend | null, t: number) =>
  !b ? 0 : t >= b.t1 ? b.c1 : t <= b.t0 ? b.c0 : b.c0 + ((b.c1 - b.c0) * (t - b.t0)) / (b.t1 - b.t0);

/** The pitch a voice sounds at `t`, as a fractional note. */
const pitchAt = (v: Voice, t: number) => v.root + centsAt(v.bend, t) / 100;

const followerValue = (f: Follower, cents: number) =>
  'period' in f ? f.base * 2 ** (-cents / 1200) : f.base + f.k * cents;

/** Cut an envelope at `t` and fall from there over `release` seconds. */
function releaseEnv(param: AudioParam, plan: Plan, t: number, release: number): void {
  const level = cut(param, plan, t);
  plan.segs = releaseSegments(level, t - plan.t0, release);
  schedule(param, plan);
}

/** Go on from `t` as if the key were held until `end`, without starting the envelope again. */
function holdEnv(param: AudioParam, plan: Plan, t: number, adsr: Adsr, end: number): void {
  const level = cut(param, plan, t);
  plan.segs = envelopeSegments(adsr, end - plan.t0, level, t - plan.t0);
  schedule(param, plan);
}

/** Everything that makes a channel's graph: when it changes the channel is rebuilt. */
export function structureKey(sound: Sound): string {
  const on = (m: ModuleInst) => m.on !== false;
  return JSON.stringify([
    sound.source.type,
    sound.chain.map((m) => [m.id, m.type, on(m)]),
    sound.mods.map((m) => [m.id, m.type, on(m), m.target, perNote(m)]),
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
  /** The summed modulation of each parameter inside the voice ("source.pitch"), connected to every voice. */
  private readonly voiceMods = new Map<string, AudioNode>();
  /** Modulators built inside every voice. */
  private noteMods: { inst: ModInst; depthPerAmount: number }[] = [];
  /** Source parameters that a modulator moves. */
  private readonly modulated = new Set<string>();
  private voices: Voice[] = [];
  /** Live keys held down, the latest last: a one-note sound falls back to the one below when a key goes up. */
  private keys: { note: number; vel: number }[] = [];
  /** The note started last, where the next one glides from when nothing sounds any more. */
  private lastNote: number | null = null;
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
      if (!depthPerAmount || (!inVoice(inst.target.module) && !targets)) continue;
      if (inst.target.module === 'source') this.modulated.add(inst.target.param);
      if (perNote(inst)) {
        this.noteMods.push({ inst, depthPerAmount });
        continue;
      }
      const src = modSource(ctx, inst.type, inst.params, bpm, { t0: ctx.currentTime, perNote: false, seed: serial });
      const depth = new GainNode(ctx, { gain: inst.amount * depthPerAmount });
      src.output.connect(depth);
      this.mods.push({ inst, src, depth, depthPerAmount });
      const key = `${inst.target.module}.${inst.target.param}`;
      if (!byTarget.has(key)) byTarget.set(key, { ...inst.target, depths: [] });
      byTarget.get(key)!.depths.push(depth);
    }
    for (const [key, { module, param, depths }] of byTarget) {
      const sum = mix(ctx, depths);
      if (inVoice(module)) this.voiceMods.set(key, sum);
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
    const tempo = bpm !== this.bpm;
    const t = this.ctx.currentTime;
    this.sound = sound;
    for (const m of sound.chain) {
      const prev = old.chain.find((o) => o.id === m.id);
      if (prev?.params !== m.params || tempo) this.effects.get(m.id)?.update(m.params, bpm);
    }
    this.bpm = bpm;
    const inst = (id: string) => sound.mods.find((m) => m.id === id)!;
    for (const mod of this.mods) {
      if (inst(mod.inst.id) === mod.inst && !tempo) continue;
      mod.inst = inst(mod.inst.id);
      glide(mod.depth.gain, mod.inst.amount * mod.depthPerAmount, t);
      mod.src.update(mod.inst.params, bpm);
    }
    this.noteMods = this.noteMods.map((m) => ({ ...m, inst: inst(m.inst.id) }));
    for (const v of this.voices) {
      if (sound.filter !== old.filter) v.filter?.update(sound.filter);
      if (sound.source.params !== old.source.params) v.src.redraw?.(sound.source.params, t);
      for (const m of v.mods) {
        if (inst(m.inst.id) === m.inst && !tempo) continue;
        m.inst = inst(m.inst.id);
        glide(m.depth.gain, m.inst.amount * m.depthPerAmount * m.scale, t);
        m.src.update(m.inst.params, bpm);
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

  /**
   * Start a note at `t`, held for `gate` seconds (Infinity for a live note). In Mono and Legato a new note takes
   * over from the one before; Legato ties it to a note still held instead of starting again. `slide` ties it to
   * the latest note still sounding whatever the mode, gliding into it.
   */
  start(note: number, vel: number, t: number, gate: number, slide = false): void {
    const mode = this.sound.play.mode as string;
    const glideTime = this.sound.play.glide as number;
    if (gate === Infinity) this.keys = [...this.keys.filter((k) => k.note !== note), { note, vel }];
    const last = this.voices.findLast((v) => !v.done && v.stopAt > t);
    if (last && (slide || (mode === 'legato' && last.gateEnd > t + OVERLAP))) {
      this.tie(last, note, t, gate, slide && glideTime === 0 ? SLIDE : glideTime);
      return;
    }
    const from = last ? pitchAt(last, t) : this.lastNote;
    this.lastNote = note;
    this.restartMods(note, t, gate);
    const { type, params } = this.sound.source;
    const src = SOURCE_BUILDERS[type]?.(this.ctx, params, {
      note, t0: t, serial: this.serial(), modulated: this.modulated,
    });
    if (!src) return;
    this.voices = this.voices.filter((v) => v.stopAt > t && !v.done);
    if (mode !== 'poly') for (const v of this.voices) this.release(v, t, QUICK_RELEASE);
    while (this.voices.length >= MAX_VOICES) this.release(this.voices.shift()!, t, QUICK_RELEASE);

    const filter = this.sound.filter.on ? voiceFilter(this.ctx, this.sound.filter, note, vel) : null;
    const adsr = adsrOf(this.sound.amp);
    const length = src.length ?? gate;
    const env: Plan = { t0: t + (filter?.lag ?? 0), scale: vel * vel, segs: envelopeSegments(adsr, length) };
    const gain = new GainNode(this.ctx, { gain: 0 });
    schedule(gain.gain, env);
    const slot = this.voiceBus.take(t);
    let out = src.output;
    if (filter) {
      src.output.connect(filter.input);
      out = filter.output;
    }
    out.connect(gain).connect(slot.input);
    const targets = (module: string, param: string) =>
      (module === 'source' ? src.targets : filter?.targets)?.[param] ?? [];
    const links: [AudioNode, AudioParam][] = [];
    for (const [key, sum] of this.voiceMods) {
      const [module, param] = key.split('.');
      for (const target of targets(module, param)) {
        sum.connect(target);
        links.push([sum, target]);
      }
    }
    const mods = this.noteMods.map(({ inst, depthPerAmount }): NoteMod => {
      const share = inst.params.vel as number;
      const scale = 1 - share + share * vel;
      const src = modSource(this.ctx, inst.type, inst.params, this.bpm, { t0: t, perNote: true, seed: this.serial });
      const depth = new GainNode(this.ctx, { gain: inst.amount * depthPerAmount * scale });
      src.output.connect(depth);
      for (const target of targets(inst.target!.module, inst.target!.param)) depth.connect(target);
      const mod: NoteMod = { inst, src, depth, depthPerAmount, scale };
      if (src.level) {
        mod.env = { t0: t, scale: 1, segs: envelopeSegments(adsrOf(inst.params), length), param: src.level };
        schedule(src.level, mod.env);
      }
      return mod;
    });
    const held = length === Infinity;
    const voice: Voice = {
      note, root: note, src, filter, gain, env, adsr, held, gateEnd: t + length, stopAt: Infinity, slot, links, mods,
      bend: null, done: false,
    };
    if (glideTime > 0 && from !== null && from !== note) this.bend(voice, t, from, note, glideTime);
    if (!voice.held) this.scheduleStop(voice);
    src.nodes[0].onended = () => this.end(voice);
    this.voices.push(voice);
  }

  /** Release the held voices of a live note. A one-note sound goes back to the latest key still down. */
  stop(note: number, t: number): void {
    this.keys = this.keys.filter((k) => k.note !== note);
    const back = this.keys.at(-1);
    if (back && this.sound.play.mode !== 'poly' && this.voices.some((v) => v.held && v.note === note)) {
      this.start(back.note, back.vel, t, Infinity);
      return;
    }
    for (const v of this.voices) {
      if (!v.held || v.note !== note) continue;
      this.release(v, t, v.adsr.release);
      for (const m of v.mods) if (m.env) releaseEnv(m.env.param, m.env, t, adsrOf(m.inst.params).release);
    }
    for (const { src, env, inst } of this.mods) {
      if (!src.level || !env?.held || env.note !== note) continue;
      env.held = false;
      releaseEnv(src.level, env, t, adsrOf(inst.params).release);
    }
  }

  /** Release every voice quickly (transport stop). */
  stopAll(t: number): void {
    this.keys = [];
    for (const v of this.voices) if (v.stopAt > t) this.release(v, t, QUICK_RELEASE);
  }

  dispose(): void {
    const t = this.ctx.currentTime;
    glide(this.gain.gain, 0, t, MUTE_TAU);
    for (const v of this.voices) v.done = true;
    for (const v of this.voices) this.stopNodes(v, t + 0.03);
    for (const mod of this.mods) mod.src.stop(t + 0.03);
    for (const fx of this.effects.values()) fx.dispose();
    this.slot.until = t + 0.2;
    setTimeout(() => {
      this.gain.disconnect();
      this.panner.disconnect();
    }, 100);
  }

  /** Move a sounding voice to a new note: its pitch glides there and its envelopes go on as if held. */
  private tie(v: Voice, note: number, t: number, gate: number, time: number): void {
    this.bend(v, t, pitchAt(v, t), note, time);
    v.note = note;
    this.lastNote = note;
    if (v.src.length !== undefined) return;
    v.held = gate === Infinity;
    v.gateEnd = t + gate;
    const lag = v.filter?.lag ?? 0;
    holdEnv(v.gain.gain, v.env, t + lag, v.adsr, v.gateEnd + lag);
    for (const m of v.mods) if (m.env) holdEnv(m.env.param, m.env, t, adsrOf(m.inst.params), v.gateEnd);
    for (const mod of this.mods) {
      if (!mod.src.level || !mod.env) continue;
      holdEnv(mod.src.level, mod.env, t, adsrOf(mod.inst.params), v.gateEnd);
      mod.env.note = note;
      mod.env.held = v.held;
    }
    if (!v.held) this.scheduleStop(v);
  }

  /** Glide the pitch of a voice from note `from` to note `to`, straight in cents, over `time` seconds from `t`. */
  private bend(v: Voice, t: number, from: number, to: number, time: number): void {
    const c0 = (from - v.root) * 100;
    const c1 = (to - v.root) * 100;
    const ramping = !!v.bend && t > v.bend.t0 && t < v.bend.t1;
    for (const f of [...v.src.followers, ...(v.filter?.followers ?? [])]) {
      const ramp = (value: number, at: number) =>
        'period' in f ? f.param.exponentialRampToValueAtTime(value, at) : f.param.linearRampToValueAtTime(value, at);
      f.param.cancelScheduledValues(t);
      // Inside a ramp the rest of it was just cancelled; a ramp to the value it has now keeps the curve whole.
      if (ramping) ramp(followerValue(f, c0), t);
      else f.param.setValueAtTime(followerValue(f, c0), t);
      if (time > 0) ramp(followerValue(f, c1), t + time);
      else f.param.setValueAtTime(followerValue(f, c1), t);
    }
    v.bend = { t0: t, t1: t + time, c0, c1 };
  }

  private release(v: Voice, t: number, release: number): void {
    v.held = false;
    v.gateEnd = Math.min(v.gateEnd, t);
    releaseEnv(v.gain.gain, v.env, t + (v.filter?.lag ?? 0), release);
    this.scheduleStop(v);
  }

  private scheduleStop(v: Voice): void {
    v.stopAt = v.slot.until = v.env.t0 + v.env.segs[v.env.segs.length - 1].end;
    this.stopNodes(v, v.stopAt);
  }

  private stopNodes(v: Voice, t: number): void {
    for (const n of v.src.nodes) n.stop(t);
    for (const m of v.mods) m.src.stop(t);
  }

  private end(v: Voice): void {
    if (v.done) return;
    v.done = true;
    v.gain.disconnect();
    for (const [sum, param] of v.links) sum.disconnect(param);
    this.voices = this.voices.filter((x) => x !== v);
  }

  /**
   * Modulation envelopes of the whole sound restart on every note, from wherever they are, and follow that note;
   * LFOs fade in again and restart their wave when they are set to.
   */
  private restartMods(note: number, t: number, gate: number): void {
    for (const mod of this.mods) {
      if (!mod.src.level) {
        mod.src.noteOn(t);
        continue;
      }
      const from = mod.env ? cut(mod.src.level, mod.env, t) : 0;
      const segs = envelopeSegments(adsrOf(mod.inst.params), gate, from);
      mod.env = { t0: t, scale: 1, segs, note, held: gate === Infinity };
      schedule(mod.src.level, mod.env);
    }
  }
}
