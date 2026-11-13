// The Hadjitron 3000 document model. Everything is plain JSON except SampleData.bytes.

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

/** One module of a sound: the source, an effect in the chain, or a modulator. */
export interface ModuleInst {
  id: string; // unique within the sound; the source is always "source"
  type: string; // key of a ModuleDef in core/modules.ts
  params: Params;
  on?: boolean; // effects and modulators only: false means bypassed
}

/** A float parameter of the source ("source"), amp ("amp"), output ("out") or a chain module (its id). */
export interface ModTarget {
  module: string;
  param: string;
}

export interface ModInst extends ModuleInst {
  target: ModTarget | null;
  amount: number; // -1..1, scaled by the target parameter's ModSpec
}

/** A sound: source -> amp envelope -> effect chain -> output, with modulators on the side. */
export interface Sound {
  name: string;
  source: ModuleInst;
  amp: Params; // parameters of the AMP module definition
  chain: ModuleInst[];
  mods: ModInst[];
  out: Params; // parameters of the OUT module definition
}

/** A row of the Track grid: one sound plus its mixer state. */
export interface Channel {
  id: string;
  sound: Sound;
  color: number; // index into the channel colour palette, 0..7
  mute: boolean;
  solo: boolean;
}

/** A note of a row. Times are in ticks, TICKS_PER_STEP to a step. */
export interface Note {
  id: string; // unique within the block
  start: number; // ticks from the start of the block, integer, >= 0
  len: number; // ticks, integer, >= 1
  note: number; // MIDI note number, 60 = C3
  vel: number; // 0..1
}

/** A note before the store gives it an id. */
export type NoteInit = Omit<Note, 'id'>;

/** A block: a few bars of notes for any of the project's sounds. The Track edits one, the Song arranges them. */
export interface Pattern {
  id: string;
  name: string;
  color: number; // index into the colour palette, 0..7
  bars: number; // 1..MAX_BARS, sixteen steps per bar
  notes: Record<string, Note[]>; // channel id -> its notes, sorted by start, then pitch
}

/** A block placed on the song timeline. Blocks in different lanes play together. */
export interface Placement {
  id: string;
  pattern: string; // pattern id
  lane: number; // 0..SONG_LANES-1; placements in one lane never overlap
  bar: number; // first bar, from 0
  bars: number; // length on the timeline: a shorter block repeats, a longer one is cut off
}

/** A block on its own, outside a project: its notes together with the sounds that play them. */
export interface Block {
  name: string;
  color: number;
  bars: number;
  tracks: { sound: Sound; notes: Note[] }[];
  samples: Record<string, SampleData>; // the samples its sounds use
}

/** An imported audio file, kept as its original encoded bytes. */
export interface SampleData {
  name: string;
  bytes: Uint8Array;
}

export interface Project {
  name: string;
  bpm: number; // 40..240
  swing: number; // 0..1, off-beat sixteenths are delayed by swing * half a step
  master: number; // dB
  channels: Channel[];
  patterns: Pattern[];
  song: Placement[];
  samples: Record<string, SampleData>; // keyed by sample id (content hash)
}

/** What the transport plays: one block on repeat, or the song on repeat. */
export type PlayScope = { kind: 'pattern'; patternId: string } | { kind: 'song' };

/** A note with absolute timing, as produced by the sequencer and consumed by the engine. */
export interface NoteEvent {
  channelId: string;
  time: number; // seconds from the start of playback
  dur: number; // seconds
  note: number;
  vel: number;
}

/** Rendered audio: one Float32Array per output channel (always two). */
export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
}
