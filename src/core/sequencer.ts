// Turns the notes of the blocks into timed notes. Pure: the transport and the offline
// renderer both call this and hand the result to the engine.

import { STEPS_PER_BAR, TICKS_PER_STEP } from './defaults';
import type { NoteEvent, Pattern, Placement, PlayScope, Project } from './types';

const BAR_TICKS = STEPS_PER_BAR * TICKS_PER_STEP;

/** Length of one step (a sixteenth note) in seconds. */
export function stepSeconds(bpm: number): number {
  return 15 / bpm;
}

/**
 * Seconds from the start of playback to an absolute tick. Swing pushes every second sixteenth late by up to half
 * a step: inside each pair of steps the first is stretched and the second squeezed, and the ticks inside them
 * move along in proportion, so ticks on the grid land exactly where the swing puts the steps.
 */
export function tickTime(tick: number, bpm: number, swing: number): number {
  const s = stepSeconds(bpm);
  const step = Math.floor(tick / TICKS_PER_STEP);
  const frac = (tick - step * TICKS_PER_STEP) / TICKS_PER_STEP;
  const lean = step % 2 === 0 ? frac : 1 - frac;
  return step * s + frac * s + swing * s * 0.5 * lean;
}

export function patternSteps(pattern: Pattern): number {
  return pattern.bars * STEPS_PER_BAR;
}

/** Length of the song in bars: the end of its last placement. */
export function songBars(project: Project): number {
  return project.song.reduce((end, p) => Math.max(end, p.bar + p.bars), 0);
}

/** Number of steps in one pass of the scope. */
export function loopSteps(project: Project, scope: PlayScope): number {
  if (scope.kind === 'song') return songBars(project) * STEPS_PER_BAR;
  const pattern = project.patterns.find((p) => p.id === scope.patternId);
  return pattern ? patternSteps(pattern) : 0;
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
  const find = (id: string) => project.patterns.find((p) => p.id === id);
  if (scope.kind === 'pattern') {
    const pattern = find(scope.patternId);
    return pattern ? [{ pattern, start: 0, end: pattern.bars * BAR_TICKS, placement: null }] : [];
  }
  return project.song.flatMap((placement) => {
    const pattern = find(placement.pattern);
    const start = placement.bar * BAR_TICKS;
    return pattern ? [{ pattern, start, end: start + placement.bars * BAR_TICKS, placement }] : [];
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
  return spans(project, scope).flatMap(({ pattern, start, end, placement }) =>
    at < start || at >= end ? [] : [{ pattern, tick: (at - start) % (pattern.bars * BAR_TICKS), placement }]);
}

/**
 * The notes that start on absolute ticks in [from, to), in time order; notes on the same tick keep the order of
 * the placements, the channels and the notes. Times are seconds from the start of playback, and a note's end
 * follows the swing like its start. Mute and solo are left to the engine.
 */
export function eventsBetween(project: Project, scope: PlayScope, from: number, to: number): NoteEvent[] {
  const total = loopSteps(project, scope) * TICKS_PER_STEP;
  if (total === 0 || to <= from) return [];
  const found: { tick: number; event: NoteEvent }[] = [];
  const time = (tick: number) => tickTime(tick, project.bpm, project.swing);
  for (const { pattern, start, end } of spans(project, scope)) {
    const length = pattern.bars * BAR_TICKS;
    // Every pass of the scope that overlaps the window, then every repeat of the block inside its span.
    for (let pass = Math.floor(from / total) * total; pass < to; pass += total) {
      const first = Math.max(0, Math.floor((from - pass - start) / length));
      for (let base = pass + start + first * length; base < Math.min(to, pass + end); base += length) {
        for (const channel of project.channels) {
          for (const n of pattern.notes[channel.id] ?? []) {
            const tick = base + n.start;
            if (n.start >= length || tick >= pass + end || tick < from || tick >= to) continue;
            const at = time(tick);
            found.push({
              tick,
              event: { channelId: channel.id, time: at, dur: time(tick + n.len) - at, note: n.note, vel: n.vel },
            });
          }
        }
      }
    }
  }
  return found.sort((a, b) => a.tick - b.tick).map((f) => f.event);
}
