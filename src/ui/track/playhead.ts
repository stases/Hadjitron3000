// What the transport is playing right now, polled once per frame while playing. Subscribers hear about it
// only when the step changes, so the grid can move its marker without React rendering every frame.

import { useEffect, useSyncExternalStore } from 'react';
import { position } from '../../app/audio';
import { TICKS_PER_STEP } from '../../core/defaults';
import { heardAt } from '../../core/sequencer';
import { playScope, useApp } from '../../state/store';

/** The step of the block on screen that is being heard. */
export interface Heard {
  patternId: string;
  step: number;
}

let heard: Heard | null = null;
const listeners = new Set<() => void>();

export const getHeard = () => heard;

export function subscribeHeard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: Heard | null): void {
  if (next?.patternId === heard?.patternId && next?.step === heard?.step) return;
  heard = next;
  listeners.forEach((listener) => listener());
}

/** Something derived from the play position; `select` should return a plain value. */
export function useHeard<T>(select: (heard: Heard | null) => T): T {
  return useSyncExternalStore(subscribeHeard, () => select(heard));
}

/** Follows the transport while it plays. Call once, in the view. */
export function usePlayhead(): void {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function poll() {
      const pos = position();
      const state = useApp.getState();
      const at = pos < 0 ? undefined
        : heardAt(state.project, playScope(state), Math.floor(pos) * TICKS_PER_STEP)
          .find((h) => h.pattern.id === state.patternId);
      publish(at ? { patternId: at.pattern.id, step: Math.floor(at.tick / TICKS_PER_STEP) } : null);
      frame = requestAnimationFrame(poll);
    });
    return () => {
      cancelAnimationFrame(frame);
      publish(null);
    };
  }, [playing]);
}
