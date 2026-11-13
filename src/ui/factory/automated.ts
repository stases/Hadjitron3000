// Knobs and faders of automated parameters: whether a row of the Song moves one, and the value it has now while the
// song plays, read from the play position so the control moves with what is heard.

import { useEffect, useState } from 'react';
import { position } from '../../app/audio';
import { pointsValue, refKey, refSpec } from '../../core/automation';
import { TICKS_PER_STEP } from '../../core/defaults';
import { barOf } from '../../core/meter';
import { fromNorm } from '../../core/params';
import { songBars } from '../../core/sequencer';
import type { ParamRef } from '../../core/types';
import { setHint } from '../kit';
import { useApp } from '../../state/store';

export interface Automation {
  /** A row with points moves the parameter while the song plays. */
  automated: boolean;
  /** Its value now, in its own units, while the song plays; null otherwise. */
  live: number | null;
}

/** The automation of a parameter, followed on every frame while the song plays. */
export function useAutomation(ref: ParamRef): Automation {
  const key = refKey(ref);
  const row = useApp((s) => s.project.automation.find((r) => r.points.length > 0 && refKey(r.target) === key));
  const following = useApp((s) => s.playing && s.scope === 'song');
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
    setLive(null);
    if (!row || !following) return;
    let frame = requestAnimationFrame(function poll() {
      frame = requestAnimationFrame(poll);
      const { project } = useApp.getState();
      const spec = refSpec(project, row.target);
      const total = songBars(project) * barOf(project.meter).ticks;
      const pos = position();
      if (!spec || pos < 0 || total === 0) return;
      setLive(fromNorm(spec, pointsValue(row.points, (pos * TICKS_PER_STEP) % total)));
    });
    return () => cancelAnimationFrame(frame);
  }, [row, following]);

  return { automated: !!row, live };
}

/** What the status bar says when an automated control is turned while the song plays, which changes nothing. */
export function automatedHint(label: string): void {
  setHint(`${label} follows its automation in the Song while the song plays. Stop to set the value it has otherwise.`);
}

/** The hint of an automated control: a sentence about that before its own. */
export const withAutomation = (automated: boolean, hint: string | undefined) =>
  automated ? `Automated in the Song: it moves along its row while the song plays. ${hint ?? ''}`.trimEnd() : hint;
