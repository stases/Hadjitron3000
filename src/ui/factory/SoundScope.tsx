import { useRef } from 'react';
import { channelScope, sampleRate, soundingNote } from '../../app/audio';
import { DIVISIONS, fundamental, sweep, timebase } from '../../core/scope';
import type { Sound } from '../../core/types';
import { Scope, useHint } from '../kit';

const WIDTH = 10 * 36 + 1;
const HEIGHT = 8 * 12 + 1;
const SAMPLES = 32768;

/**
 * The selected sound on its own, on a triggered scope. The timebase follows the lowest note the sound plays, so a
 * few cycles of it stand still on the screen; the last note's timebase stays while its echoes ring on.
 */
export function SoundScope({ channelId, sound }: { channelId: string; sound: Sound }) {
  const note = useRef<number | null>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const hover = useHint('The wave of this sound as you play it, like an oscilloscope; turn a knob to see it change.');
  return (
    <div className="h-factory-scope" {...hover.props}>
      <Scope
        read={(buf) => channelScope(channelId, buf)}
        width={WIDTH}
        height={HEIGHT}
        samples={SAMPLES}
        sweep={(buf) => {
          note.current = soundingNote(channelId) ?? note.current;
          const perDiv = timebase(note.current === null ? null : fundamental(sound, note.current));
          const text = `${Number((perDiv * 1000).toFixed(1))} ms/div`;
          if (readout.current && readout.current.textContent !== text) readout.current.textContent = text;
          return sweep(buf, sampleRate() * DIVISIONS * perDiv);
        }}
      />
      <span ref={readout} className="h-factory-scope-time" />
    </div>
  );
}
