// The mixer in the engine: each channel's strip (ducking, then the master and the sends), the two send buses, and
// the effect racks of the buses and the master.

import { BUS_LEVEL } from '../core/mixer';
import type { Channel, ModuleInst, SendBus } from '../core/types';
import { Automated, dbToGain, glide, type Placed } from './automation';
import { Bus, type Slot } from './mix';
import { EFFECT_BUILDERS, type Effect } from './modules/effects';

// A rack whose structure changes crossfades to the new one with this time constant.
const REBUILD_TAU = 0.01;
// Ducking falls to its depth in this time; the meters read this many samples.
export const DUCK_ATTACK = 0.005;
const METER_SIZE = 1024;

/** Left and right peak levels of a node's latest output, read from analysers made on first use. */
class StereoTap {
  private taps: AnalyserNode[] | null = null;
  private readonly data = new Float32Array(METER_SIZE);

  constructor(private readonly node: AudioNode) {}

  read(): [number, number] {
    if (!this.taps) {
      const ctx = this.node.context;
      const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
      this.node.connect(split);
      this.taps = [0, 1].map((i) => {
        const tap = new AnalyserNode(ctx, { fftSize: METER_SIZE });
        split.connect(tap, i);
        return tap;
      });
    }
    const [left, right] = this.taps.map((tap) => {
      tap.getFloatTimeDomainData(this.data);
      let p = 0;
      for (const v of this.data) p = Math.max(p, Math.abs(v));
      return p;
    });
    return [left, right];
  }
}

const rackKey = (chain: ModuleInst[]) => JSON.stringify(chain.map((m) => [m.id, m.type, m.on !== false]));

interface Built {
  key: string;
  chain: ModuleInst[];
  bpm: number;
  effects: Map<string, Effect>;
  head: AudioNode;
  fade: GainNode;
}

/**
 * The effects of a bus or the master in a row from `input` to `output`, made by the builders of the sounds' chains
 * with their Mix crossfading from dry to wet. Parameters change in place; a new structure is built beside the old
 * one and crossfades to it. Without effects the input goes straight through a gain of one.
 */
export class EffectRack {
  private built: Built;
  private readonly auto = new Automated();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly input: AudioNode,
    private readonly output: AudioNode,
    chain: ModuleInst[],
    bpm: number,
  ) {
    this.built = this.build(chain, bpm, false);
  }

  set(chain: ModuleInst[], bpm: number): void {
    const b = this.built;
    if (chain === b.chain && bpm === b.bpm) return;
    const now = this.ctx.currentTime;
    if (rackKey(chain) !== b.key) {
      this.retire(b);
      this.built = this.build(chain, bpm, true);
      for (const [module, param, curve] of this.auto.entries()) {
        for (const time of [now, ...curve.after(now)]) this.move(module, param, time);
      }
      return;
    }
    for (const m of chain) {
      const prev = b.chain.find((o) => o.id === m.id);
      if (prev?.params === m.params && bpm === b.bpm) continue;
      b.effects.get(m.id)?.update(this.auto.overlay(m.id, m.params, now), bpm);
    }
    b.chain = chain;
    b.bpm = bpm;
  }

  /** Automation moves a parameter of an effect to `value` in a straight line that arrives at `time`. */
  automate(module: string, param: string, value: number, time: number): void {
    this.auto.add(module, param, value, time);
    this.move(module, param, time);
  }

  /** Step the effects that cannot ramp to their automated values now. */
  flush(): void {
    this.auto.flush(this.ctx.currentTime, (module) => this.placed(module), this.built.bpm);
  }

  /** The song stopped: every automated parameter goes back to its stored value. */
  endAutomation(): void {
    this.auto.release(this.ctx.currentTime, (module) => this.placed(module), this.built.bpm);
  }

  /** Whether automation can move a parameter of an effect in straight lines rather than in steps. */
  ramps(module: string): boolean {
    const fx = this.built.effects.get(module);
    return !fx || !!fx.ramp;
  }

  private move(module: string, param: string, time: number): void {
    const placed = this.placed(module);
    if (placed) this.auto.moveEffect(module, param, placed, this.built.bpm, time);
  }

  private placed(module: string): Placed | undefined {
    const fx = this.built.effects.get(module);
    const params = this.built.chain.find((m) => m.id === module)?.params;
    return fx && params ? { fx, params } : undefined;
  }

  dispose(): void {
    this.retire(this.built);
  }

  /** The built effect of a module, absent while it is bypassed. */
  effect(moduleId: string): Effect | undefined {
    return this.built.effects.get(moduleId);
  }

  private build(chain: ModuleInst[], bpm: number, fadeIn: boolean): Built {
    const { ctx } = this;
    const fade = new GainNode(ctx, { gain: fadeIn ? 0 : 1 });
    if (fadeIn) glide(fade.gain, 1, ctx.currentTime, REBUILD_TAU);
    fade.connect(this.output);
    const effects = new Map<string, Effect>();
    let head: AudioNode = fade;
    for (const m of [...chain].reverse()) {
      if (m.on === false || !EFFECT_BUILDERS[m.type]) continue;
      const fx = EFFECT_BUILDERS[m.type](ctx, m.params, bpm, true);
      fx.output.connect(head);
      head = fx.input;
      effects.set(m.id, fx);
    }
    this.input.connect(head);
    return { key: rackKey(chain), chain, bpm, effects, head, fade };
  }

  private retire(b: Built): void {
    glide(b.fade.gain, 0, this.ctx.currentTime, REBUILD_TAU);
    for (const fx of b.effects.values()) fx.dispose();
    setTimeout(() => {
      this.input.disconnect(b.head);
      b.fade.disconnect();
    }, 100);
  }
}

const busGain = (bus: SendBus) => (bus.mute || bus.level <= BUS_LEVEL.min ? 0 : dbToGain(bus.level));

/**
 * A send bus: the sends of the channels added up, then its rack, its level and mute, into a slot of the master. The
 * part after the sum is built the first time a channel sends to the bus, so an unused bus costs nothing.
 */
export class SendBusGraph {
  /** Where the channels' sends come in, one slot each. */
  readonly inputs: Bus;
  private readonly sum: GainNode;
  private out: { rack: EffectRack; gain: GainNode; tap: StereoTap } | null = null;
  private bus: SendBus | null = null;
  private readonly auto = new Automated();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly master: Bus,
  ) {
    this.sum = new GainNode(ctx);
    this.inputs = new Bus(ctx, this.sum);
  }

  set(bus: SendBus, bpm: number, used: boolean): void {
    const { ctx } = this;
    if (this.out) {
      this.out.rack.set(bus.chain, bpm);
      if (busGain(bus) !== busGain(this.bus!) && !this.auto.has('out', 'level')) {
        glide(this.out.gain.gain, busGain(bus), ctx.currentTime);
      }
    } else if (used) {
      const gain = new GainNode(ctx, { gain: busGain(bus) });
      gain.connect(this.master.take(ctx.currentTime).input);
      this.out = { rack: new EffectRack(ctx, this.sum, gain, bus.chain, bpm), gain, tap: new StereoTap(gain) };
    }
    this.bus = bus;
  }

  /** Automation moves the bus's level (module 'out') or a parameter of its rack, before the bus is used nothing. */
  automate(module: string, param: string, value: number, time: number): void {
    if (module !== 'out') {
      this.out?.rack.automate(module, param, value, time);
      return;
    }
    this.auto.add(module, param, value, time);
    this.out?.gain.gain.linearRampToValueAtTime(busGain({ ...this.bus!, level: value }), time);
  }

  flush(): void {
    this.out?.rack.flush();
  }

  endAutomation(): void {
    this.out?.rack.endAutomation();
    this.auto.release(this.ctx.currentTime, () => undefined, 0, (_module, _param, time) =>
      this.out?.gain.gain.linearRampToValueAtTime(busGain(this.bus!), time));
  }

  ramps(module: string): boolean {
    return this.out?.rack.ramps(module) ?? true;
  }

  /** The built effect of a module of the bus's rack, absent before the bus is used. */
  effect(moduleId: string): Effect | undefined {
    return this.out?.rack.effect(moduleId);
  }

  /** Peak levels of what the bus adds to the master. */
  levels(): [number, number] {
    return this.out?.tap.read() ?? [0, 0];
  }
}

type Point = [time: number, value: number];

/** The value of straight lines through `points` at `t`: 1 before the first, the last value after the last. */
function valueAt(points: Point[], t: number): number {
  const i = points.findLastIndex(([time]) => time <= t);
  if (i < 0) return 1;
  const [t0, v0] = points[i];
  if (i === points.length - 1) return v0;
  const [t1, v1] = points[i + 1];
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

/**
 * Where a channel's graph goes: through its ducking gain to a slot of the master and to the sends of both buses. It
 * lives as long as its channel, so a rebuilt sound keeps its sends and its ducking.
 */
export class Strip {
  /** The channel's graph, and the one fading out after a rebuild, one slot each. */
  readonly inputs: Bus;
  private readonly duck: GainNode;
  private readonly sends: GainNode[];
  private readonly slots: Slot[];
  private readonly tap: StereoTap;
  private readonly auto = new Automated();
  private channel: Channel;
  /** The ducking gain as straight lines between these points, from the last one before now. */
  private points: Point[] = [];
  /** Note starts of the source still to come, laid on top of each other again when an earlier one arrives. */
  private dips: number[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    channel: Channel,
    master: Bus,
    buses: Bus[],
  ) {
    const t = ctx.currentTime;
    this.channel = channel;
    this.duck = new GainNode(ctx);
    this.inputs = new Bus(ctx, this.duck);
    const out = master.take(t);
    this.duck.connect(out.input);
    this.slots = [out];
    this.sends = buses.map((bus, i) => {
      const send = new GainNode(ctx, { gain: channel.sends[i] });
      const slot = bus.take(t);
      this.duck.connect(send).connect(slot.input);
      this.slots.push(slot);
      return send;
    });
    this.tap = new StereoTap(this.duck);
  }

  update(channel: Channel): void {
    const t = this.ctx.currentTime;
    this.sends.forEach((send, i) => {
      if (channel.sends[i] !== this.channel.sends[i] && !this.auto.has('send', String(i))) {
        glide(send.gain, channel.sends[i], t);
      }
    });
    this.channel = channel;
  }

  /** Automation moves send `index` to `value` in a straight line that arrives at `time`. */
  automateSend(index: number, value: number, time: number): void {
    this.auto.add('send', String(index), value, time);
    this.sends[index].gain.linearRampToValueAtTime(value, time);
  }

  endAutomation(): void {
    this.auto.release(this.ctx.currentTime, () => undefined, 0, (_module, param, time) =>
      this.sends[Number(param)].gain.linearRampToValueAtTime(this.channel.sends[Number(param)], time));
  }

  /** A note of the ducking source starts at `t`: the level dips by the amount and recovers over the release. */
  dip(t: number): void {
    const { amount, release } = this.channel.duck;
    if (amount <= 0) return;
    const now = this.ctx.currentTime;
    const param = this.duck.gain;
    const kept = this.points.findLastIndex(([time]) => time <= now);
    this.points = this.points.slice(Math.max(0, kept));
    this.dips = [...this.dips.filter((d) => d >= now && d !== t), t].sort((a, b) => a - b);
    const ramping = this.points.some(([time]) => time > t);
    const value = valueAt(this.points, t);
    param.cancelScheduledValues(t);
    // Inside a ramp the rest of it was just cancelled; a ramp to the value it has at `t` keeps the line whole.
    if (ramping) param.linearRampToValueAtTime(value, t);
    else param.setValueAtTime(value, t);
    for (const d of this.dips.filter((d) => d >= t)) {
      const from = valueAt(this.points, d);
      this.points = this.points.filter(([time]) => time < d);
      this.points.push([d, from], [d + DUCK_ATTACK, Math.min(from, 1 - amount)], [d + DUCK_ATTACK + release, 1]);
    }
    for (const [time, value] of this.points) if (time > t) param.linearRampToValueAtTime(value, time);
  }

  levels(): [number, number] {
    return this.tap.read();
  }

  dispose(): void {
    const t = this.ctx.currentTime;
    for (const slot of this.slots) slot.until = t + 0.2;
    setTimeout(() => this.duck.disconnect(), 100);
  }
}
