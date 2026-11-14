// Small helpers for writing the factory projects as code: channels of factory sounds, rows of notes, blocks and the
// lanes of a song, locks and automation.

import { refSpec, soundSpec } from '../core/automation';
import { TICKS_PER_STEP, newChannel, newPattern, uid } from '../core/defaults';
import { barOf } from '../core/meter';
import { cleanNotes } from '../core/notes';
import type { NoteExtras } from '../core/notes';
import { toNorm } from '../core/params';
import type { AutoRow, Channel, Lane, Lock, Note, Pattern, Placement, Project } from '../core/types';
import { preset } from './index';

/** A channel for each factory sound, coloured in turn. */
export function channels(names: string[]): Channel[] {
  return names.map((name, color) => newChannel(uid('c'), preset(name), color % 8));
}

/**
 * Melody row: [step, note, length in steps, velocity, extras] with length 1 and velocity 0.8 by default. Steps may be
 * fractions for notes between the grid lines (a half step is a 32nd, a third a sixteenth triplet).
 */
export function notes(row: [number, number, number?, number?, NoteExtras?][]): Note[] {
  return cleanNotes(row.map(([step, note, len = 1, vel = 0.8, extras = {}]) => ({
    start: step * TICKS_PER_STEP, len: len * TICKS_PER_STEP, note, vel, ...extras,
  })));
}

/** Several lists of notes as one row, in order. */
export function join(...rows: Note[][]): Note[] {
  return cleanNotes(rows.flat());
}

/** Chords: [step, notes, length in steps, velocity], velocity 0.7 by default; the notes of a chord start together. */
export function chords(row: [number, number[], number, number?][]): Note[] {
  return notes(row.flatMap(([step, pitches, len, vel = 0.7]) => pitches.map((note): [number, number, number, number] =>
    [step, note, len, vel])));
}

/**
 * Drum row: x is a hit, X an accent, o a ghost note, at `note`; `extras` gives some steps a chance, a ratchet and
 * so on.
 */
export function hits(row: string, extras: Record<number, NoteExtras> = {}, note = 60): Note[] {
  const vel: Record<string, number> = { x: 0.8, X: 1, o: 0.4 };
  return notes([...row].flatMap((ch, i): [number, number, number, number, NoteExtras][] =>
    (vel[ch] ? [[i, note, 1, vel[ch], extras[i] ?? {}]] : [])));
}

/** The same extras for several steps of a drum row, such as a chance for the ghost notes. */
export function each(steps: number[], extras: NoteExtras): Record<number, NoteExtras> {
  return Object.fromEntries(steps.map((step) => [step, extras]));
}

/** A block of `bars` bars: its name, colour, the notes of some of the channels and the rows that loop on their own. */
export function block(
  name: string, color: number, bars: number, rows: Record<string, Note[]>, loops?: Record<string, number>,
): Pattern {
  return { ...newPattern(name, color), bars, notes: rows, ...(loops && { loops }) };
}

/** One row per lane: [block, first bar, bars, fade in, fade out, the channels silent in it, in channel order]. */
export function lanes(rows: [Pattern, number, number, number?, number?, string[]?][][]): Placement[] {
  return rows.flatMap((row, lane) => row.map(([p, bar, bars, fadeIn = 0, fadeOut = 0, mutes = []]) => ({
    id: uid('s'), pattern: p.id, lane, bar, bars, ...(fadeIn > 0 && { fadeIn }), ...(fadeOut > 0 && { fadeOut }),
    ...(mutes.length > 0 && { mutes }),
  })));
}

/** The levels of the four lanes of the song, in dB. */
export function laneLevels(levels: number[]): Lane[] {
  return levels.map((level) => ({ level, mute: false }));
}

/** Sends to the Room and the Echo, and ducking under another channel: [Room, Echo, ducked by, amount, release]. */
export function mix(chans: Channel[], settings: Record<string, [number, number, string?, number?, number?]>): void {
  for (const channel of chans) {
    if (!Object.hasOwn(settings, channel.sound.name)) continue;
    const [room, echo, source, amount = 0.5, release = 0.25] = settings[channel.sound.name];
    channel.sends = [room, echo];
    if (source) channel.duck = { source: chans.find((c) => c.sound.name === source)!.id, amount, release };
  }
}

/** A note's own value of a control of its channel's sound, in the control's units, such as a cutoff in hertz. */
export function lock(channel: Channel, module: string, param: string, value: number): Lock {
  const target = { module, param };
  return { target, value: toNorm(soundSpec(channel.sound, target)!, value) };
}

/** A row of automation of a channel's control: [bar, value in the control's units], a bar may be a fraction. */
export function automate(
  project: Project, owner: string, module: string, param: string, points: [number, number][],
): AutoRow {
  const target = { owner, module, param };
  const spec = refSpec(project, target)!;
  const ticks = barOf(project.meter).ticks;
  return { id: uid('a'), target, points: points.map(([bar, v]) => [Math.round(bar * ticks), toNorm(spec, v)]) };
}
