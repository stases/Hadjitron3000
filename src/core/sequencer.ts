// Turns the step grid into timed notes. Pure: the transport and the offline
// renderer both call this and hand the result to the engine.

import { STEPS_PER_BAR } from './defaults';
import type { NoteEvent, Pattern, Placement, PlayScope, Project } from './types';

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

/** A block being heard: which of its steps, and the placement that put it there (null when a block loops alone). */
export interface Heard {
  pattern: Pattern;
  step: number;
  placement: Placement | null;
}

/**
 * The blocks heard at an absolute step. Absolute steps count from the start of playback and run on
 * past the end of the scope, which loops. Empty when the scope has nothing to play there.
 */
export function heardAt(project: Project, scope: PlayScope, step: number): Heard[] {
  const total = loopSteps(project, scope);
  if (total === 0) return [];
  const at = ((step % total) + total) % total;
  const find = (id: string) => project.patterns.find((p) => p.id === id);
  if (scope.kind === 'pattern') return [{ pattern: find(scope.patternId)!, step: at, placement: null }];
  return project.song.flatMap((placement) => {
    const local = at - placement.bar * STEPS_PER_BAR;
    const pattern = find(placement.pattern);
    if (!pattern || local < 0 || local >= placement.bars * STEPS_PER_BAR) return [];
    return [{ pattern, step: local % patternSteps(pattern), placement }];
  });
}

/**
 * The notes that start on absolute steps in [from, to), in time order. Times are
 * seconds from the start of playback. Mute and solo are left to the engine.
 */
export function eventsBetween(project: Project, scope: PlayScope, from: number, to: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  const s = stepSeconds(project.bpm);
  for (let abs = from; abs < to; abs++) {
    const time = stepTime(abs, project.bpm, project.swing);
    for (const { pattern, step } of heardAt(project, scope, abs)) {
      for (const channel of project.channels) {
        const cell = pattern.cells[channel.id]?.[step];
        if (cell) events.push({ channelId: channel.id, time, dur: cell.len * s, note: cell.note, vel: cell.vel });
      }
    }
  }
  return events;
}
