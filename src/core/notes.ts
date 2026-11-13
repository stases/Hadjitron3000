// Pitches are MIDI numbers; 60 is C3 and plays a sound at its own pitch. Below them, the notes of a row.

import { uid } from './defaults';
import { MAX_TICKS } from './meter';
import type { Lock, Note, NoteInit } from './types';

/** The names of the twelve pitch classes, from C. */
export const PITCH_NAMES: readonly string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const ROOT_NOTE = 60;
export const MIN_NOTE = 12; // C-1
export const MAX_NOTE = 108; // C7

export function noteName(note: number): string {
  return PITCH_NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 2);
}

export function noteFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function isBlackKey(note: number): boolean {
  return PITCH_NAMES[((note % 12) + 12) % 12].length === 2;
}

/** Computer keyboard as a piano: key -> semitones above the C of the current octave. */
export const KEY_SEMITONES: Readonly<Record<string, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

/** The order of a row's notes: by start, then by pitch. */
export function compareNotes(a: NoteInit, b: NoteInit): number {
  return a.start - b.start || a.note - b.note;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The most locks a note can carry. */
export const MAX_LOCKS = 2;

/** The ratchet choices besides playing once. */
export const RATCHETS: readonly number[] = [2, 3, 4, 6, 8];

export type NoteExtras = Pick<Note, 'chance' | 'ratchet' | 'slide' | 'hold' | 'locks'>;

/**
 * Locks as a note keeps them: at most two, each naming a module and a parameter with a value in 0..1, one per target.
 * Whether its sound has that parameter is checked where the sound is known.
 */
function readLocks(value: unknown): Lock[] {
  const locks: Lock[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const target = (entry as Record<string, unknown> | null)?.target as Record<string, unknown> | undefined;
    const { value: v } = entry as Record<string, unknown>;
    const { module, param } = target ?? {};
    if (typeof module !== 'string' || typeof param !== 'string' || typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (locks.some((l) => l.target.module === module && l.target.param === param)) continue;
    if (locks.push({ target: { module, param }, value: clamp(v, 0, 1) }) === MAX_LOCKS) break;
  }
  return locks;
}

/** The extras of a note that differ from their defaults, made valid; a chance of 100 or more is no chance at all. */
export function noteExtras(raw: Record<string, unknown>): NoteExtras {
  const extras: NoteExtras = {};
  const chance = typeof raw.chance === 'number' ? Math.round(raw.chance) : NaN;
  if (chance < 100) extras.chance = Math.max(1, chance);
  if (typeof raw.ratchet === 'number' && RATCHETS.includes(raw.ratchet)) extras.ratchet = raw.ratchet;
  if (raw.slide === true) extras.slide = true;
  if (raw.hold === true) extras.hold = true;
  const locks = readLocks(raw.locks);
  if (locks.length > 0) extras.locks = locks;
  return extras;
}

/**
 * A row's notes made valid and sorted: whole ticks, starts inside the longest block, pitches and velocities in
 * range, extras only where set, unique ids, and never two notes with the same start and pitch (the first one stays).
 */
export function cleanNotes(notes: readonly (NoteInit & { id?: string })[]): Note[] {
  const reserved = new Set(notes.flatMap((n) => (n.id ? [n.id] : [])));
  const ids = new Set<string>();
  const taken = new Set<string>();
  const clean: Note[] = [];
  for (const n of notes) {
    const start = Math.round(n.start);
    const note = clamp(Math.round(n.note), MIN_NOTE, MAX_NOTE);
    const key = `${start}:${note}`;
    if (!(start >= 0 && start < MAX_TICKS) || taken.has(key)) continue;
    taken.add(key);
    let id = n.id ?? '';
    if (id === '' || ids.has(id)) {
      do { id = uid('n'); } while (ids.has(id) || reserved.has(id));
    }
    ids.add(id);
    clean.push({
      id, start, len: clamp(Math.round(n.len), 1, MAX_TICKS), note, vel: clamp(n.vel, 0, 1), ...noteExtras({ ...n }),
    });
  }
  return clean.sort(compareNotes);
}
