import { tap } from '../../app/audio';
import { MAX_NOTE, MIN_NOTE, ROOT_NOTE, noteName } from '../../core/notes';
import { patternSteps } from '../../core/sequencer';
import type { Step } from '../../core/types';
import { patchStep, useApp } from '../../state/store';
import { Slider, Stepper } from '../kit';
import { maxLength, rememberNote } from './steps';

const NO_STEP: Step = { note: ROOT_NOTE, vel: 0.8, len: 1 };

export function Inspector() {
  const ref = useApp((s) => s.step);
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!);
  const channel = useApp((s) => s.project.channels.find((c) => c.id === s.step?.channelId));
  const columns = patternSteps(pattern);
  const found = ref && channel && ref.index < columns ? pattern.cells[ref.channelId]?.[ref.index] : undefined;
  const step = found ?? NO_STEP;
  const off = !found;
  const patch = (change: Partial<Step>) => ref && patchStep(pattern.id, ref.channelId, ref.index, change);
  return (
    <div className="h-track-inspector">
      <span className="h-track-which">
        {found ? `Step ${ref!.index + 1} of ${channel!.sound.name}` : 'No step selected'}
      </span>
      <span className="h-track-label">Note</span>
      <Stepper
        value={step.note}
        min={MIN_NOTE}
        max={MAX_NOTE}
        format={noteName}
        width={56}
        disabled={off}
        onChange={(note) => {
          patch({ note });
          rememberNote(ref!.channelId, note);
          tap(ref!.channelId, note, step.vel);
        }}
        hint="The note this step plays. C3 is the sound at its own pitch."
      />
      <span className="h-track-label">Velocity</span>
      <Slider
        value={step.vel}
        onChange={(vel) => patch({ vel: Math.round(vel * 100) / 100 })}
        length={100}
        disabled={off}
        hint="How hard this step hits: further right is louder."
      />
      <span className={off ? 'h-track-value h-engraved' : 'h-track-value'}>{Math.round(step.vel * 100)} %</span>
      <span className="h-track-label">Length</span>
      <Stepper
        value={step.len}
        min={1}
        max={off ? 1 : maxLength(pattern.cells[ref!.channelId], ref!.index, columns)}
        width={44}
        disabled={off}
        onChange={(len) => patch({ len })}
        hint="How many steps this note is held for."
      />
      {off && (
        <span className="h-track-help">
          Click: add or remove · Drag: note · Drag the edge: length · Right-click: pick
        </span>
      )}
    </div>
  );
}
