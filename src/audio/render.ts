// Offline rendering of a project or a single sound, and MP3 encoding.

import { createMp3Encoder } from 'wasm-media-encoders';
import { TICKS_PER_STEP, newLanes } from '../core/defaults';
import { eventsBetween, loopSteps, stepSeconds } from '../core/sequencer';
import type { NoteEvent, Pcm, PlayScope, Project, SampleData, Sound } from '../core/types';
import { Engine } from './engine';
import { playEvent } from './transport';
import { delayTime } from './modules/effects';

// Rendering pauses this often (in audio seconds) to schedule the next notes and report progress.
const CHUNK = 0.5;
const SILENCE = 1e-4; // -80 dB
const TRIM_PAD = 0.05;
// The tail after the last note is long enough for every sound to ring out, within these bounds; the silence at its
// end is trimmed off afterwards.
const MIN_TAIL = 6;
const MAX_TAIL = 60;

const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

/** Render `seconds` of the project, handing each event to the engine shortly before it plays. */
async function render(
  project: Project,
  events: NoteEvent[],
  seconds: number,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const engine = new Engine(ctx);
  engine.setProject(project);
  await engine.ready();
  let i = 0;
  const scheduleUntil = (t: number) => {
    for (; i < events.length && events[i].time < t; i++) {
      playEvent(engine, events[i], events[i].time);
    }
  };
  // Suspensions land on render-quantum boundaries, possibly a little after `t`, so notes are
  // scheduled a whole chunk ahead of the one about to play.
  scheduleUntil(2 * CHUNK);
  for (let t = CHUNK; t < length / sampleRate; t += CHUNK) {
    void ctx.suspend(t).then(() => {
      scheduleUntil(t + 2 * CHUNK);
      onProgress?.(t / (length / sampleRate));
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  onProgress?.(1);
  return buf;
}

/**
 * How long a sound can go on after its last note ends: its release, then each effect in turn, a reverb for its size
 * and a delay until its echoes have fallen by 80 dB.
 */
function ringTime(sound: Sound, bpm: number): number {
  let t = 1.25 * (sound.amp.release as number);
  for (const m of sound.chain) {
    if (m.on === false) continue;
    if (m.type === 'reverb') t += m.params.size as number;
    if (m.type === 'delay') {
      const feedback = m.params.feedback as number;
      t += delayTime(m.params, bpm) * (feedback > 0 ? Math.log(SILENCE) / Math.log(feedback) : 1);
    }
  }
  return t;
}

/** The tail a render of these sounds needs to let them ring out. */
export function ringOut(sounds: Sound[], bpm: number): number {
  return Math.min(MAX_TAIL, Math.max(MIN_TAIL, ...sounds.map((s) => ringTime(s, bpm))));
}

/** The channels cut after the last sample above -80 dB (plus a short pad), but never shorter than `min` frames. */
function trimmed(buf: AudioBuffer, min: number): Pcm {
  const data = [buf.getChannelData(0), buf.getChannelData(1)];
  let last = -1;
  for (const d of data) for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > SILENCE) last = i;
  const sound = last < 0 ? 0 : last + 1 + Math.round(TRIM_PAD * buf.sampleRate);
  const end = Math.min(buf.length, Math.max(min, sound));
  return { sampleRate: buf.sampleRate, channels: data.map((d) => d.slice(0, end)) };
}

export async function renderProject(
  project: Project,
  scope: PlayScope,
  opts: { loops?: number; tail?: number; sampleRate?: number; onProgress?: (fraction: number) => void } = {},
): Promise<Pcm> {
  const { loops = 1, sampleRate = 44100, onProgress } = opts;
  const tail = opts.tail ?? ringOut(project.channels.map((c) => c.sound), project.bpm);
  const steps = loopSteps(project, scope) * loops;
  const loopSeconds = steps * stepSeconds(project.bpm);
  const events = eventsBetween(project, scope, 0, steps * TICKS_PER_STEP);
  const buf = await render(project, events, loopSeconds + tail, sampleRate, onProgress);
  return trimmed(buf, Math.round(loopSeconds * sampleRate));
}

export async function renderSound(
  sound: Sound,
  samples: Record<string, SampleData>,
  opts: { note?: number; vel?: number; dur?: number; tail?: number; sampleRate?: number } = {},
): Promise<Pcm> {
  const { note = 60, vel = 0.8, dur = 1, tail = ringOut([sound], 120), sampleRate = 44100 } = opts;
  const project: Project = {
    name: sound.name,
    bpm: 120,
    swing: 0,
    meter: [4, 4],
    master: 0,
    channels: [{ id: 'sound', sound, color: 0, mute: false, solo: false }],
    patterns: [],
    song: [],
    lanes: newLanes(),
    samples,
  };
  const buf = await render(project, [{ channelId: 'sound', time: 0, dur, note, vel }], dur + tail, sampleRate);
  return trimmed(buf, 0);
}

export async function encodeMp3(pcm: Pcm, kbps = 192, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  const encoder = await createMp3Encoder();
  encoder.configure({ sampleRate: pcm.sampleRate, channels: 2, bitrate: kbps } as Parameters<typeof encoder.configure>[0]);
  const [left, right] = pcm.channels;
  // Encode in slices of about a quarter second and yield in between, so the page stays responsive.
  const slice = 1152 * 10;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += slice) {
    parts.push(encoder.encode([left.subarray(i, i + slice), right.subarray(i, i + slice)]).slice());
    onProgress?.(Math.min(1, (i + slice) / left.length));
    await yieldToPage();
  }
  parts.push(encoder.finalize().slice());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
