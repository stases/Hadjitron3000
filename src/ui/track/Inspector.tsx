import { tap } from '../../app/audio';
import { modKey } from '../../app/shortcuts';
import { MAX_NOTE, MIN_NOTE, ROOT_NOTE, noteName } from '../../core/notes';
import { patternSteps } from '../../core/sequencer';
import { beginGesture, commitGesture, moveNotes, setNotesVelocity, updateNotes, useApp } from '../../state/store';
import { Slider, Stepper } from '../kit';
import { BAR_TICKS, parsePosition, parseSteps, positionText, stepsText } from './roll';
import { nudgeSelection, useRoll } from './rollState';
import { maxLength, rememberNote, resizeCell, rowCells } from './steps';

/** The bar under the grid or the roll: the selected step or notes, to read and change. */
export function Inspector({ roll }: { roll: boolean }) {
  return roll ? <NoteInspector /> : <StepInspector />;
}

function StepInspector() {
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

/**
 * The notes selected in the roll; several are changed together and keep their differences. Length and start step
 * by the snap from where they are, so a note between grid lines stays there, as when it is dragged.
 */
function NoteInspector() {
  const ids = useRoll((s) => s.selected);
  const snap = useRoll((s) => s.snap);
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!);
  const channel = useApp((s) => s.project.channels.find((c) => c.id === s.channelId)!);
  const ticks = pattern.bars * BAR_TICKS;
  const notes = (pattern.notes[channel.id] ?? []).filter((n) => n.start < ticks && ids.includes(n.id));
  const lead = notes[0] ?? { start: 0, len: snap, note: ROOT_NOTE, vel: 0.8 };
  const all = notes.map((n) => n.id);
  const off = notes.length === 0;
  const which = off ? 'No note selected'
    : `${notes.length === 1 ? noteName(lead.note) : `${notes.length} notes`} of ${channel.sound.name}`;
  return (
    <div className="h-track-inspector">
      <span className="h-track-which">{which}</span>
      <span className="h-track-label">Note</span>
      <Stepper
        value={lead.note}
        min={MIN_NOTE}
        max={MAX_NOTE}
        format={noteName}
        width={56}
        disabled={off}
        onChange={(note) => {
          moveNotes(pattern.id, channel.id, all, 0, note - lead.note);
          tap(channel.id, note, lead.vel);
        }}
        hint="The pitch of the selected notes. Several move together, so a chord keeps its shape."
      />
      <span className="h-track-label">Velocity</span>
      <Slider
        value={lead.vel}
        onChange={(vel) => setNotesVelocity(pattern.id, channel.id, all, Math.round(vel * 100) / 100)}
        length={100}
        disabled={off}
        hint="How hard the selected notes play: further right is louder."
      />
      <span className={off ? 'h-track-value h-engraved' : 'h-track-value'}>{Math.round(lead.vel * 100)} %</span>
      <span className="h-track-label">Length</span>
      <Stepper
        value={lead.len}
        min={((lead.len - 1) % snap) + 1}
        max={ticks}
        step={snap}
        format={stepsText}
        parse={parseSteps}
        width={52}
        disabled={off}
        onChange={(len) => {
          updateNotes(pattern.id, channel.id, notes.map((n) =>
            ({ ...n, len: Math.min(Math.max(1, n.len + len - lead.len), ticks - n.start) })));
          useRoll.setState({ length: len });
        }}
        hint="How long the selected notes are, in steps of a sixteenth: 0.5 is a thirty-second. It changes by the snap."
      />
      <span className="h-track-label">Start</span>
      <Stepper
        value={lead.start}
        min={lead.start % snap}
        max={ticks - 1}
        step={snap}
        format={positionText}
        parse={parsePosition}
        width={84}
        disabled={off}
        onChange={(start) => nudgeSelection(start - lead.start, 0)}
        hint="Where the first selected note starts, as bar.beat.sixteenth, with ticks after a plus (24 to a sixteenth)."
      />
      {off && (
        <span className="h-track-help">
          {`Click: add a note · Drag: move · Edges: length · Shift-drag: select · ${modKey('C')} ${modKey('V')}: `
            + 'copy, paste'}
        </span>
      )}
    </div>
  );
}
