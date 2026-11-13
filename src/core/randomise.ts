// The randomiser: fills a stretch of a row with notes drawn from a seed, so a result can be kept or drawn again, and
// the same seed always gives the same notes.

import { hashUnit } from './hash';
import { scaleNotes } from './scale';
import type { Bar } from './meter';
import type { NoteInit, Scale } from './types';

/** The grids notes are placed on, in ticks. */
export const RANDOM_GRIDS: readonly { label: string; ticks: number }[] = [
  { label: '1/16', ticks: 24 },
  { label: '1/8', ticks: 48 },
  { label: '1/32', ticks: 12 },
  { label: '1/8 triplet', ticks: 32 },
  { label: '1/16 triplet', ticks: 16 },
];

const RATCHET_CHOICES = [2, 3, 4];
const CHANCE_CHOICES = [25, 50, 75];
const VELOCITY = 0.8;
const LONGEST = 4; // grid units a note may last at full length variation

export interface RandomSettings {
  density: number; // 0..1: the share of the grid positions that get a note
  grid: number; // ticks
  centre: number; // the pitch the notes gather around
  range: number; // semitones above and below the centre
  length: number; // 0..1: from every note one grid unit long to up to four
  velocity: number; // 0..1: from every note at 80 % to anywhere from 40 % to full
  ratchet: number; // 0..1: the share of notes that get a ratchet of 2, 3 or 4
  chance: number; // 0..1: the share of notes that get a chance of 25, 50 or 75 %
  seed: number;
}

/**
 * Notes for the ticks from `from` until `to`. The grid lines start again at every bar. Of the n lines, the
 * density's share (rounded) gets a note, chosen by the seed; each note takes a pitch of the scale (chromatic without
 * one) within the range around the centre, and its length, velocity, ratchet and chance by the seed too. No note
 * reaches past `to`.
 */
export function randomNotes(
  s: RandomSettings, scale: Scale | undefined, bar: Bar, from: number, to: number,
): NoteInit[] {
  const lines: number[] = [];
  for (let barStart = Math.floor(from / bar.ticks) * bar.ticks; barStart < to; barStart += bar.ticks) {
    for (let t = barStart; t < barStart + bar.ticks && t < to; t += s.grid) if (t >= from) lines.push(t);
  }
  const draw = (what: string, at: number) => hashUnit(`${s.seed}/${what}/${at}`);
  const count = Math.round(s.density * lines.length);
  const chosen = [...lines].sort((a, b) => draw('on', a) - draw('on', b)).slice(0, count).sort((a, b) => a - b);
  const pitches = scaleNotes(scale, s.centre - s.range, s.centre + s.range);
  if (pitches.length === 0) return [];
  return chosen.map((start) => {
    const units = 1 + Math.floor(draw('len', start) * (1 + (LONGEST - 1) * s.length));
    const vel = Math.min(1, VELOCITY + s.velocity * (draw('vel', start) - 0.5) * 0.8);
    const note: NoteInit = {
      start,
      len: Math.min(units * s.grid, to - start),
      note: pitches[Math.floor(draw('pitch', start) * pitches.length)],
      vel: Math.round(vel * 100) / 100,
    };
    if (draw('ratchet', start) < s.ratchet) {
      note.ratchet = RATCHET_CHOICES[Math.floor(draw('ratchets', start) * RATCHET_CHOICES.length)];
    }
    if (draw('chance', start) < s.chance) {
      note.chance = CHANCE_CHOICES[Math.floor(draw('chances', start) * CHANCE_CHOICES.length)];
    }
    return note;
  });
}
