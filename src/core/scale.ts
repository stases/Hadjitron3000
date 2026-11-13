// Scales: which pitches belong to a key, and the nearest one that does. No scale at all is chromatic.

import { MAX_NOTE, MIN_NOTE, PITCH_NAMES } from './notes';
import type { Scale } from './types';

/** The scales on offer, as semitones above the root. */
export const SCALES: readonly { type: string; label: string; steps: readonly number[] }[] = [
  { type: 'major', label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { type: 'minor', label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { type: 'dorian', label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { type: 'phrygian', label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { type: 'lydian', label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { type: 'mixolydian', label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { type: 'harmonic', label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { type: 'majpent', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { type: 'minpent', label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { type: 'blues', label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { type: 'whole', label: 'Whole tone', steps: [0, 2, 4, 6, 8, 10] },
];

/** The scale a value names, or null when it is not one: a root 0..11 and a type of SCALES. */
export function readScale(value: unknown): Scale | null {
  if (typeof value !== 'object' || value === null) return null;
  const { root, type } = value as Record<string, unknown>;
  const ok = typeof root === 'number' && Number.isInteger(root) && root >= 0 && root < 12
    && SCALES.some((s) => s.type === type);
  return ok ? { root: root as number, type: type as string } : null;
}

const pitchClass = (note: number) => ((note % 12) + 12) % 12;

/** Whether a pitch is in the scale; every pitch is when there is none. */
export function inScale(note: number, scale: Scale | undefined): boolean {
  if (!scale) return true;
  const steps = SCALES.find((s) => s.type === scale.type)?.steps ?? [];
  return steps.includes(pitchClass(note - scale.root));
}

/** The pitch of the scale nearest to `note` inside the note range; of two as near, the lower. */
export function nearestInScale(note: number, scale: Scale | undefined): number {
  for (let d = 0; d <= 12; d++) {
    for (const candidate of [note - d, note + d]) {
      if (candidate >= MIN_NOTE && candidate <= MAX_NOTE && inScale(candidate, scale)) return candidate;
    }
  }
  return note;
}

/** The pitches of the scale from `lo` to `hi`, both included, rising. */
export function scaleNotes(scale: Scale | undefined, lo: number, hi: number): number[] {
  const notes: number[] = [];
  for (let n = Math.max(lo, MIN_NOTE); n <= Math.min(hi, MAX_NOTE); n++) if (inScale(n, scale)) notes.push(n);
  return notes;
}

/** The scale's name as the views show it, "D Minor". */
export function scaleText(scale: Scale): string {
  return `${PITCH_NAMES[scale.root]} ${SCALES.find((s) => s.type === scale.type)?.label ?? ''}`;
}
