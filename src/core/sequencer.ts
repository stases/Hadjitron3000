// Turns the step grid into timed notes. Pure: the transport and the offline
// renderer both call this and hand the result to the engine.

import { STEPS_PER_BAR } from './defaults';
import type { NoteEvent, Pattern, PlayScope, Project } from './types';

/** Length of one step (a sixteenth note) in seconds. */
export function stepSeconds(bpm: number): number {
  return 15 / bpm;
}

/** Seconds from the start of playback to the start of a step. Every second sixteenth is pushed late by the swing. */
export function stepTime(step: number, bpm: number, swing: number): number {
  const s = stepSeconds(bpm);
  return step * s + (step % 2 === 1 ? swing * s * 0.5 : 0);
}

export function patternSteps(pattern: Pattern): number {
  return pattern.bars * STEPS_PER_BAR;
}

/** The patterns one pass of the scope plays, in order. */
export function scopePatterns(project: Project, scope: PlayScope): Pattern[] {
  const ids = scope.kind === 'song' ? project.song : [scope.patternId];
  return ids.flatMap((id) => project.patterns.find((p) => p.id === id) ?? []);
}

/** Number of steps in one pass of the scope. */
export function loopSteps(project: Project, scope: PlayScope): number {
  return scopePatterns(project, scope).reduce((n, p) => n + patternSteps(p), 0);
}

/**
 * Where an absolute step falls. Absolute steps count from the start of playback and
 * run on past the end of the scope, which loops. `index` is the position in the
 * scope's pattern list. Null when the scope has nothing to play.
 */
export function locate(project: Project, scope: PlayScope, step: number): { pattern: Pattern; index: number; step: number } | null {
  const patterns = scopePatterns(project, scope);
  const total = patterns.reduce((n, p) => n + patternSteps(p), 0);
  if (total === 0) return null;
  let rest = ((step % total) + total) % total;
  for (let index = 0; index < patterns.length; index++) {
    const n = patternSteps(patterns[index]);
    if (rest < n) return { pattern: patterns[index], index, step: rest };
    rest -= n;
  }
  return null;
}

/**
 * The notes that start on absolute steps in [from, to), in time order. Times are
 * seconds from the start of playback. Mute and solo are left to the engine.
 */
export function eventsBetween(project: Project, scope: PlayScope, from: number, to: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  const s = stepSeconds(project.bpm);
  for (let abs = from; abs < to; abs++) {
    const at = locate(project, scope, abs);
    if (!at) break;
    const time = stepTime(abs, project.bpm, project.swing);
    for (const channel of project.channels) {
      const cell = at.pattern.cells[channel.id]?.[at.step];
      if (cell) events.push({ channelId: channel.id, time, dur: cell.len * s, note: cell.note, vel: cell.vel });
    }
  }
  return events;
}
