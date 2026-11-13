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
  /** 'note' builds the modulator in every note, which only works on a target inside the note (see perNote). */
  per: 'note' | 'sound';
  target: ModTarget | null;
  amount: number; // -1..1, scaled by the target parameter's ModSpec
}

/**
 * A sound: source -> filter -> amp envelope -> effect chain -> output, with modulators on the side. Source, filter
 * and amp are built for every note.
 */
export interface Sound {
  name: string;
  source: ModuleInst;
  play: Params; // parameters of the PLAY module definition: poly, mono or legato, and glide
  filter: Params; // parameters of the FILTER module definition, its lamp included
  amp: Params; // parameters of the AMP module definition
  chain: ModuleInst[];
  mods: ModInst[];
  out: Params; // parameters of the OUT module definition
}

/** Sidechain ducking: every note of the source channel dips this channel's level, which then recovers. */
export interface Duck {
  source: string | null; // channel id, never the channel's own
  amount: number; // 0..1: how far the level dips, as a share of full level
  release: number; // seconds to recover
}

/** A row of the Track grid: one sound plus its mixer state. */
export interface Channel {
  id: string;
  sound: Sound;
  color: number; // index into the channel colour palette, 0..7
  mute: boolean;
  solo: boolean;
  /** 0..1 of the channel sent to bus A and bus B, after its level, pan, mute, solo and ducking. */
  sends: [number, number];
  duck: Duck;
}

/** A send bus: a shared effect chain that channels send to, with its own level, summed into the master. */
export interface SendBus {
  name: string;
  chain: ModuleInst[];
  level: number; // dB, the bottom of the range is silence
  mute: boolean;
}

/** The shared part of the mix: two send buses, and the master's effect chain ahead of the master level. */
export interface Mixer {
  buses: [SendBus, SendBus];
  master: { chain: ModuleInst[] };
}

/** A note of a row. Times are in ticks, TICKS_PER_STEP to a step. */
export interface Note {
  id: string; // unique within the block
  start: number; // ticks from the start of the block, integer, >= 0
  len: number; // ticks, integer, >= 1
  note: number; // MIDI note number, 60 = C3
  vel: number; // 0..1
  // Extras, absent when they have their default value:
  chance?: number; // 1..99: the percent of passes it plays on; absent plays every time
  ratchet?: number; // 2, 3, 4, 6 or 8: played that many times inside its length; absent plays once
  slide?: boolean; // true: the pitch glides in from the row's previous note
  hold?: boolean; // true: a drone, sounding to the end of its placement (or of the block played on repeat)
}

/** A note before the store gives it an id. */
export type NoteInit = Omit<Note, 'id'>;

/** A block: a few bars of notes for any of the project's sounds. The Track edits one, the Song arranges them. */
export interface Pattern {
  id: string;
  name: string;
  color: number; // index into the colour palette, 0..7
  bars: number; // 1..MAX_BARS, in the project's meter
  notes: Record<string, Note[]>; // channel id -> its notes, sorted by start, then pitch
  /**
   * Rows that loop on their own: channel id -> steps, 1 up to less than the block's length. The row's notes inside
   * that many steps repeat end to end for the whole block; its notes after them are silent. Absent when no row does.
   */
  loops?: Record<string, number>;
}

/** A block placed on the song timeline. Blocks in different lanes play together. */
export interface Placement {
  id: string;
  pattern: string; // pattern id
  lane: number; // 0..SONG_LANES-1; placements in one lane never overlap
  bar: number; // first bar, from 0
  bars: number; // length on the timeline: a shorter block repeats, a longer one is cut off
  // Absent when they have their default value:
  fadeIn?: number; // bars, 1..: the sound rises from silence over this many bars at the start
  fadeOut?: number; // bars, 1..: and falls to silence over this many at the end; fadeIn + fadeOut <= bars
  mutes?: string[]; // ids of the channels that are silent here, in channel order
}

/** One lane of the song: a level in dB (-48 is silence) and a mute, for everything its placements play. */
export interface Lane {
  level: number; // -48..6
  mute: boolean;
}

/** A block on its own, outside a project: its notes together with the sounds that play them. */
export interface Block {
  name: string;
  color: number;
  bars: number;
  tracks: { sound: Sound; notes: Note[]; loop?: number }[]; // loop: the row's own length in steps, when it has one
  samples: Record<string, SampleData>; // the samples its sounds use
}

/** An imported audio file, kept as its original encoded bytes. */
export interface SampleData {
  name: string;
  bytes: Uint8Array;
}

/** A key: its root as a pitch class (0 is C) and the kind of scale, one of SCALES in core/scale.ts. */
export interface Scale {
  root: number; // 0..11
  type: string;
}

/** A time signature as [beats, unit]: [7, 8] is 7/8. One of METERS in core/meter.ts. */
export type Meter = [beats: number, unit: 4 | 8];

export interface Project {
  name: string;
  bpm: number; // 40..240
  swing: number; // 0..1, off-beat sixteenths are delayed by swing * half a step
  meter: Meter; // the same for every bar of every block
  scale?: Scale; // the key the views help to stay in; absent is chromatic
  master: number; // dB
  mixer: Mixer;
  channels: Channel[];
  patterns: Pattern[];
  song: Placement[];
  lanes: Lane[]; // SONG_LANES entries
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
  slide?: boolean; // the pitch glides in from the previous note of the row
  gain?: GainCurve; // the note's own level over time, from the fades of its placement and the level of its lane
}

/**
 * Breakpoints of a gain in seconds from the start of a note, at least one, the first at 0; the gain goes in
 * straight lines from one to the next and holds the last value from there on.
 */
export type GainCurve = [seconds: number, gain: number][];

/** Rendered audio: one Float32Array per output channel (always two). */
export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
}
