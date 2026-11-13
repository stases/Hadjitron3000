// The filter inside every note: one or two resonant stages, with an optional drive between them.

import type { Params } from '../../core/types';
import { glide } from '../automation';
import { DRIVE_RANGE, driveCurve, filterQ, makeup, preGain } from './effects';
import type { Follower } from './sources';

export interface VoiceFilter {
  input: AudioNode;
  output: AudioNode;
  /** Mod targets, by parameter id. */
  targets: Record<string, AudioParam[]>;
  /** The cutoff follows a glide as far as key tracking says. */
  followers: Follower[];
  /** Seconds the drive delays the sound; the amp envelope waits as long. */
  lag: number;
  update(p: Params): void;
}

// The drive's shaper runs at twice the rate; Chromium's 2x oversampling delays it by 128 samples.
const DRIVE_LATENCY = 128;
// The Drive effect is tuned for a sine at -12 dBFS; inside a voice the sound runs at full scale, four times that.
const VOICE_LEVEL = 4;
// Velocity -> cutoff at 100 % moves a note of velocity 0 this many cents below one of velocity 1.
const VEL_SPAN = 4800;
const num = (p: Params, id: string) => p[id] as number;

/** The second of two stages has no resonance of its own: a flat low or high pass, or a band pass like the first. */
const secondQ = (p: Params) => (p.mode === 'bandpass' ? filterQ(p) : -3.0103);

/** Key tracking moves the cutoff with the note around C3; velocity moves it down for softer notes. */
export function voiceFilter(ctx: BaseAudioContext, p: Params, note: number, vel: number): VoiceFilter {
  const detune = num(p, 'key') * (note - 60) * 100 + num(p, 'vel') * (vel - 1) * VEL_SPAN;
  const stage = (Q: number) =>
    new BiquadFilterNode(ctx, { type: p.mode as BiquadFilterType, frequency: num(p, 'cutoff'), Q, detune });
  const stages = [stage(filterQ(p))];
  if (p.slope === '24') stages.push(stage(secondQ(p)));
  let output: AudioNode = stages[0];
  let drive: { pre: GainNode; post: GainNode } | null = null;
  if (num(p, 'drive') > 0) {
    drive = {
      pre: new GainNode(ctx, { gain: preGain(num(p, 'drive')) / DRIVE_RANGE / VOICE_LEVEL }),
      post: new GainNode(ctx, { gain: makeup('soft', num(p, 'drive')) * VOICE_LEVEL }),
    };
    const shaper = new WaveShaperNode(ctx, { curve: driveCurve('soft'), oversample: '2x' });
    output = output.connect(drive.pre).connect(shaper).connect(drive.post);
  }
  if (stages[1]) output = output.connect(stages[1]);
  return {
    input: stages[0],
    output,
    targets: { cutoff: stages.map((s) => s.detune) },
    followers: stages.map((s) => ({ param: s.detune, base: detune, k: num(p, 'key') })),
    lag: drive ? DRIVE_LATENCY / ctx.sampleRate : 0,
    update(p) {
      const t = ctx.currentTime;
      stages.forEach((s, i) => {
        s.type = p.mode as BiquadFilterType;
        glide(s.frequency, num(p, 'cutoff'), t);
        glide(s.Q, i ? secondQ(p) : filterQ(p), t);
      });
      if (!drive) return;
      glide(drive.pre.gain, preGain(num(p, 'drive')) / DRIVE_RANGE / VOICE_LEVEL, t);
      glide(drive.post.gain, makeup('soft', num(p, 'drive')) * VOICE_LEVEL, t);
    },
  };
}
