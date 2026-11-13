// Turns the notes of the blocks into timed notes. Pure: the transport and the offline
// renderer both call this and hand the result to the engine.

import { laneGain, noteCurve } from './arrangement';
import type { Shape } from './arrangement';
import { TICKS_PER_STEP } from './defaults';
import { barOf } from './meter';
import type { Bar } from './meter';
import type { Note, NoteEvent, Pattern, Placement, PlayScope, Project } from './types';

/** Length of one step (a sixteenth note) in seconds. */
export function stepSeconds(bpm: number): number {
  return 15 / bpm;
}

/**
 * Seconds from the start of playback to an absolute tick, which may be fractional. Swing pushes every second
 * sixteenth late by up to half a step: inside each pair of steps the first is stretched and the second squeezed,
 * and the ticks inside them move along in proportion, so ticks on the grid land exactly where the swing puts the
 * steps. Every meter has an even number of steps to the bar, so the pairs start again with each bar.
 */
export function tickTime(tick: number, bpm: number, swing: number): number {
  const s = stepSeconds(bpm);
  const step = Math.floor(tick / TICKS_PER_STEP);
  const frac = (tick - step * TICKS_PER_STEP) / TICKS_PER_STEP;
  const lean = step % 2 === 0 ? frac : 1 - frac;
  return step * s + frac * s + swing * s * 0.5 * lean;
}

/** The tick that sounds `seconds` after the start of playback, fractional: the inverse of `tickTime`. */
export function timeTick(seconds: number, bpm: number, swing: number): number {
  const s = stepSeconds(bpm);
  const pair = Math.floor(seconds / (2 * s));
  const rest = seconds - pair * 2 * s;
  const first = s * (1 + swing / 2);
  const steps = rest < first ? rest / first : 1 + (rest - first) / (2 * s - first);
  return (2 * pair + steps) * TICKS_PER_STEP;
}

export function patternSteps(pattern: Pattern, bar: Bar): number {
  return pattern.bars * bar.steps;
}

/** Length of the song in bars: the end of its last placement. */
export function songBars(project: Project): number {
  return project.song.reduce((end, p) => Math.max(end, p.bar + p.bars), 0);
}

/** Number of steps in one pass of the scope. */
export function loopSteps(project: Project, scope: PlayScope): number {
  const bar = barOf(project.meter);
  if (scope.kind === 'song') return songBars(project) * bar.steps;
  const pattern = project.patterns.find((p) => p.id === scope.patternId);
  return pattern ? patternSteps(pattern, bar) : 0;
}

/** A block being heard: at which of its ticks, and the placement that put it there (null when a block loops alone). */
export interface Heard {
  pattern: Pattern;
  tick: number;
  placement: Placement | null;
}

/** Where a block plays in one pass of the scope: from `start` until `end`, in ticks, repeating as it goes. */
interface Span {
  pattern: Pattern;
  start: number;
  end: number;
  placement: Placement | null;
}

function spans(project: Project, scope: PlayScope): Span[] {
  const { ticks } = barOf(project.meter);
  const find = (id: string) => project.patterns.find((p) => p.id === id);
  if (scope.kind === 'pattern') {
    const pattern = find(scope.patternId);
    return pattern ? [{ pattern, start: 0, end: pattern.bars * ticks, placement: null }] : [];
  }
  return project.song.flatMap((placement) => {
    const pattern = find(placement.pattern);
    const start = placement.bar * ticks;
    return pattern ? [{ pattern, start, end: start + placement.bars * ticks, placement }] : [];
  });
}

/**
 * The blocks heard at an absolute tick. Absolute ticks count from the start of playback and run on
 * past the end of the scope, which loops. Empty when the scope has nothing to play there.
 */
export function heardAt(project: Project, scope: PlayScope, tick: number): Heard[] {
  const total = loopSteps(project, scope) * TICKS_PER_STEP;
  if (total === 0) return [];
  const at = ((tick % total) + total) % total;
  const { ticks } = barOf(project.meter);
  return spans(project, scope).flatMap(({ pattern, start, end, placement }) =>
    at < start || at >= end ? [] : [{ pattern, tick: (at - start) % (pattern.bars * ticks), placement }]);
}

/**
 * Whether a note with a chance plays on one pass of its block. The answer is a hash of the note, the block and the
 * pass, so it is the same on every play and in an export.
 */
export function plays(note: Note, patternId: string, pass: number): boolean {
  if (note.chance === undefined) return true;
  let h = 0x811c9dc5;
  for (const c of `${patternId}/${note.id}/${pass}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) % 100 < note.chance;
}

/**
 * The notes that start on absolute ticks in [from, to), in time order; notes on the same tick keep the order of
 * the placements, the channels and the notes. Times are seconds from the start of playback, and a note's end
 * follows the swing like its start. Mute and solo are left to the engine.
 *
 * A note with a chance plays on a pass when `plays` says so; its pass is how often the block has started since
 * playback began, or in the song the bar where this repeat of its placement starts. A ratchet plays the note that
 * many times, evenly inside its length, each that long; repeats past the end of the block or the placement are
 * left out. A held note sounds from its start to the end of its placement, or of the block when it plays on
 * repeat, and only the placement's first repeat of the block starts it; with a ratchet the last repeat is held.
 *
 * In the song a muted lane plays nothing, and neither do the sounds a placement mutes. A placement with a fade, or
 * in a lane that is not at 0 dB, gives each of its notes a gain curve (`noteCurve`); other notes carry none.
 */
export function eventsBetween(project: Project, scope: PlayScope, from: number, to: number): NoteEvent[] {
  const total = loopSteps(project, scope) * TICKS_PER_STEP;
  if (total === 0 || to <= from) return [];
  const found: { tick: number; event: NoteEvent }[] = [];
  const time = (tick: number) => tickTime(tick, project.bpm, project.swing);
  const { ticks } = barOf(project.meter);
  for (const { pattern, start, end, placement } of spans(project, scope)) {
    const length = pattern.bars * ticks;
    const level = placement ? laneGain(project.lanes[placement.lane]) : 1;
    if (level === 0) continue;
    const { fadeIn = 0, fadeOut = 0, mutes = [] } = placement ?? {};
    const shape: Shape | null = level !== 1 || fadeIn > 0 || fadeOut > 0
      ? { length: end - start, fadeIn: fadeIn * ticks, fadeOut: fadeOut * ticks, level } : null;
    // Every pass of the scope that overlaps the window, then every repeat of the block inside its span.
    for (let pass = Math.floor(from / total) * total; pass < to; pass += total) {
      const origin = pass + start;
      const first = Math.max(0, Math.floor((from - origin) / length));
      const stop = pass + end;
      for (let repeat = first; origin + repeat * length < Math.min(to, stop); repeat++) {
        const base = origin + repeat * length;
        const seed = placement ? placement.bar + repeat * pattern.bars : base / length;
        for (const channel of project.channels) {
          if (mutes.includes(channel.id)) continue;
          for (const n of pattern.notes[channel.id] ?? []) {
            const begin = base + n.start;
            if (n.start >= length || begin >= to || begin + n.len <= from || (n.hold && repeat > 0)) continue;
            if (!plays(n, pattern.id, seed)) continue;
            const times = n.ratchet ?? 1;
            const each = n.len / times;
            for (let r = 0; r < times; r++) {
              const tick = begin + r * each;
              if (tick >= base + length || tick >= stop || tick < from || tick >= to) continue;
              const at = time(tick);
              const until = n.hold && r === times - 1 ? stop : tick + each;
              const event: NoteEvent = {
                channelId: channel.id, time: at, dur: time(until) - at, note: n.note, vel: n.vel,
              };
              if (n.slide && r === 0) event.slide = true;
              if (shape) event.gain = noteCurve(shape, tick - origin, until - origin, (t) => time(origin + t));
              found.push({ tick, event });
            }
          }
        }
      }
    }
  }
  return found.sort((a, b) => a.tick - b.tick).map((f) => f.event);
}
