import { tap } from '../../app/audio';
import { MAX_NOTE, MIN_NOTE, ROOT_NOTE, noteName } from '../../core/notes';
import { patternSteps } from '../../core/sequencer';
import { beginGesture, commitGesture, moveNotes, setNotesVelocity, useApp } from '../../state/store';
import { Slider, Stepper } from '../kit';
import { maxLength, rememberNote, resizeCell, rowCells } from './steps';

export function Inspector() {
  const ref = useApp((s) => s.step);
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!);
  const channel = useApp((s) => s.project.channels.find((c) => c.id === s.step?.channelId));
  const columns = patternSteps(pattern);
  const cells = rowCells(ref ? pattern.notes[ref.channelId] : undefined);
  const cell = ref && channel && ref.index < columns ? cells.get(ref.index) : undefined;
  const lead = cell?.notes[0] ?? { note: ROOT_NOTE, vel: 0.8 };
  const ids = cell?.notes.map((n) => n.id) ?? [];
  const off = !cell;
  const chord = cell && cell.notes.length > 1 ? `, ${cell.notes.length} notes` : '';
  return (
    <div className="h-track-inspector">
      <span className="h-track-which">
        {cell ? `Step ${cell.index + 1} of ${channel!.sound.name}${chord}` : 'No step selected'}
      </span>
      <span className="h-track-label">Note</span>
      <Stepper
        value={lead.note}
        min={MIN_NOTE}
        max={MAX_NOTE}
        format={noteName}
        width={56}
        disabled={off}
        onChange={(note) => {
          moveNotes(pattern.id, ref!.channelId, ids, 0, note - lead.note);
          rememberNote(ref!.channelId, note);
          tap(ref!.channelId, note, lead.vel);
        }}
        hint="The note this step plays. C3 is the sound at its own pitch."
      />
      <span className="h-track-label">Velocity</span>
      <Slider
        value={lead.vel}
        onChange={(vel) => setNotesVelocity(pattern.id, ref!.channelId, ids, Math.round(vel * 100) / 100)}
        length={100}
        disabled={off}
        hint="How hard this step hits: further right is louder."
      />
      <span className={off ? 'h-track-value h-engraved' : 'h-track-value'}>{Math.round(lead.vel * 100)} %</span>
      <span className="h-track-label">Length</span>
      <Stepper
        value={cell?.span ?? 1}
        min={1}
        max={cell ? maxLength(cells, cell.index, columns) : 1}
        width={44}
        disabled={off}
        onChange={(len) => {
          beginGesture();
          resizeCell(pattern.id, ref!.channelId, cell!, len);
          commitGesture();
        }}
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
