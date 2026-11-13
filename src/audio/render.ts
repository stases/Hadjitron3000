// Offline rendering of a project or a single sound, and MP3 encoding.

import { createMp3Encoder } from 'wasm-media-encoders';
import { TICKS_PER_STEP, defaultMixer, newChannel, newLanes } from '../core/defaults';
import { eventsBetween, loopSteps, stepSeconds } from '../core/sequencer';
import type {
  Channel, ModuleInst, NoteEvent, Pcm, PlayScope, Project, SampleData, Sound,
} from '../core/types';
import { Engine } from './engine';
import { playEvent } from './transport';
import { SHORT_TAILS, delayTime } from './modules/effects';

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

/** The passes round a loop with this gain that it takes to fall by 80 dB. */
const passes = (gain: number) => (gain > 0 ? Math.log(SILENCE) / Math.log(gain) : 1);

/**
 * How long a chain of effects rings after its input stops: a reverb for its size, a delay or a comb until its
 * repeats have fallen by 80 dB, Space until its tail has (longer with shimmer, and for ever while frozen, which the
 * longest tail cuts off), and the short tails of the effects without feedback.
 */
function chainTime(chain: ModuleInst[], bpm: number): number {
  let t = 0;
  for (const m of chain) {
    if (m.on === false) continue;
    const num = (id: string) => m.params[id] as number;
    t += SHORT_TAILS[m.type] ?? 0;
    if (m.type === 'reverb') t += num('size');
    if (m.type === 'delay') t += delayTime(m.params, bpm) * passes(num('feedback'));
    if (m.type === 'comb') t += passes(Math.abs(num('feedback'))) / num('freq');
    if (m.type === 'space') t += m.params.freeze ? MAX_TAIL : (80 / 60) * num('size') * (1 + num('shimmer'));
  }
  return t;
}

/** How long a sound can go on after its last note ends: its release, then its effects. */
const ringTime = (sound: Sound, bpm: number) => 1.25 * (sound.amp.release as number) + chainTime(sound.chain, bpm);

/** How long the shared effects add to that: the longest of the buses that are sent to, then the master rack. */
function mixerTime(project: Project): number {
  const buses = project.mixer.buses.filter((bus, i) => !bus.mute && project.channels.some((c) => c.sends[i] > 0));
  const longest = Math.max(0, ...buses.map((bus) => chainTime(bus.chain, project.bpm)));
  return longest + chainTime(project.mixer.master.chain, project.bpm);
}

/** The tail a render of these sounds needs to let them ring out, `shared` seconds of the mixer's effects included. */
export function ringOut(sounds: Sound[], bpm: number, shared = 0): number {
  return Math.min(MAX_TAIL, Math.max(MIN_TAIL, ...sounds.map((s) => ringTime(s, bpm) + shared)));
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
  const tail = opts.tail ?? ringOut(project.channels.map((c) => c.sound), project.bpm, mixerTime(project));
  const steps = loopSteps(project, scope) * loops;
  const loopSeconds = steps * stepSeconds(project.bpm);
  const events = eventsBetween(project, scope, 0, steps * TICKS_PER_STEP);
  const buf = await render(project, events, loopSeconds + tail, sampleRate, onProgress);
  return trimmed(buf, Math.round(loopSeconds * sampleRate));
}

/**
 * One render for each sound heard in the scope (one the mix lets through that has notes there), each that sound
 * soloed through the normal graph: its effects, the master level and the soft clipper apply as in the mix. They all
 * get the tail of the whole project and the length of the longest, so they line up.
 */
export async function renderStems(
  project: Project,
  scope: PlayScope,
  opts: { loops?: number; tail?: number; onProgress?: (fraction: number, channel: Channel) => void } = {},
): Promise<{ channel: Channel; pcm: Pcm }[]> {
  const { loops, tail, onProgress } = opts;
  const solo = project.channels.some((c) => c.solo);
  const heard = new Set(eventsBetween(project, scope, 0, loopSteps(project, scope) * TICKS_PER_STEP)
    .map((e) => e.channelId));
  const channels = project.channels.filter((c) => heard.has(c.id) && (solo ? c.solo : !c.mute));
  const stems: { channel: Channel; pcm: Pcm }[] = [];
  for (const [index, channel] of channels.entries()) {
    const alone = { ...project, channels: project.channels.map((c) => ({ ...c, solo: c.id === channel.id })) };
    const pcm = await renderProject(alone, scope, {
      loops, tail, onProgress: (f) => onProgress?.((index + f) / channels.length, channel),
    });
    stems.push({ channel, pcm });
  }
  const length = Math.max(0, ...stems.map((s) => s.pcm.channels[0].length));
  return stems.map(({ channel, pcm }) => ({
    channel,
    pcm: {
      sampleRate: pcm.sampleRate,
      channels: pcm.channels.map((data) => {
        const padded = new Float32Array(length);
        padded.set(data);
        return padded;
      }),
    },
  }));
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
    mixer: defaultMixer(),
    channels: [newChannel('sound', sound, 0)],
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
