import type { ReactNode } from 'react';
import { tap } from '../../app/audio';
import { usePrefs } from '../../app/prefs';
import { modKey } from '../../app/shortcuts';
import { LEVEL_NAMES } from '../../core/levels';
import { barOf } from '../../core/meter';
import { MAX_NOTE, MIN_NOTE, RATCHETS, ROOT_NOTE, noteName } from '../../core/notes';
import type { NoteExtras } from '../../core/notes';
import { patternSteps } from '../../core/sequencer';
import { soundSpec, soundTargets } from '../../core/automation';
import { moduleParams } from '../../core/modules';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import type { Lock, ModTarget, Note, Sound } from '../../core/types';
import {
  beginGesture, commitGesture, moveNotes, setNotesExtras, setNotesLock, setNotesVelocity, updateNotes, useApp,
} from '../../state/store';
import { toggleFold, useShown } from '../factory/levels';
import { Checkbox, FoldToggles, Knob, Select, Separator, Slider, Stepper } from '../kit';
import { parsePosition, parseSteps, positionText, stepsText } from './roll';
import { nudgeSelection, useRoll } from './rollState';
import { maxLength, rememberNote, resizeCell, rowCells } from './steps';

/** The bar under the grid or the roll: the selected step or notes, to read and change. */
export function Inspector({ roll }: { roll: boolean }) {
  return roll ? <NoteInspector /> : <StepInspector />;
}

const FOLD_HINTS = {
  2: 'Shows Chance, Slide and Hold for the selected notes; the lamp lights when one of them has any of these.',
  3: 'Shows Ratchet and the locks of the selected notes; the lamp lights when one of them has a ratchet or a lock.',
} as const;

const RATCHET_OPTIONS = [
  { value: '1', label: 'Off' },
  ...RATCHETS.map((r) => ({ value: String(r), label: `${r}x` })),
];

const targetKey = (t: ModTarget) => `${t.module}/${t.param}`;

/** The value a control of the sound has, 0..1 through its taper: where a new lock of it starts. */
const ownValue = (sound: Sound, target: ModTarget) =>
  toNorm(soundSpec(sound, target)!, moduleParams(sound, target.module)![target.param] as number);

/**
 * One of a note's two locks: which control of its sound it holds, and at what value, shown in that control's units.
 * A new lock starts at the control's own value. The second waits until the first is set.
 */
function LockField({ slot, sound, notes, setLock }: {
  slot: number;
  sound: Sound | undefined;
  notes: readonly Note[];
  setLock: (slot: number, lock: Lock | null) => void;
}) {
  const targets = sound ? soundTargets(sound) : [];
  const lock = notes[0]?.locks?.[slot];
  const spec = sound && lock && soundSpec(sound, lock.target);
  const off = notes.length === 0 || (slot > 0 && !notes[0]?.locks?.length);
  return (
    <>
      <span className="h-track-label">{`Lock ${slot + 1}`}</span>
      <Select
        value={lock ? targetKey(lock.target) : ''}
        options={[{ value: '', label: 'None' }, ...targets.map((t) => ({ value: targetKey(t.target), label: t.label }))]}
        onChange={(v) => {
          const target = targets.find((t) => targetKey(t.target) === v)?.target;
          setLock(slot, target ? { target, value: ownValue(sound!, target) } : null);
        }}
        width={132}
        disabled={off}
        hint="Lock: the selected notes get their own value of one control of their sound while they play."
      />
      <Knob
        small
        side
        value={lock?.value ?? 0}
        onChange={(value) => setLock(slot, { target: lock!.target, value })}
        label={spec ? spec.label : 'Value'}
        display={spec ? formatValue(spec, fromNorm(spec, lock!.value)) : '-'}
        disabled={off || !spec}
        hint="The value the selected notes lock, in the control's own units."
      />
    </>
  );
}

/**
 * The inspector's row: what is selected and its Basics, then the extras of its notes by level, and a line of help
 * while nothing is selected. Each level is a group that wraps onto a second line when the row is too narrow. In
 * beginner mode Shaping and Deep wait behind toggles at the right end, as in the Factory's rack units.
 */
function InspectorRow({ which, notes, sound, setExtras, setLock, help, children }: {
  which: string;
  notes: readonly Note[];
  sound: Sound | undefined;
  setExtras: (extras: NoteExtras) => void;
  setLock: (slot: number, lock: Lock | null) => void;
  help: string;
  children: ReactNode;
}) {
  const beginner = usePrefs((p) => p.beginner);
  const shown = useShown();
  const off = notes.length === 0;
  const lead: Partial<Note> = notes[0] ?? {};
  const chance = lead.chance ?? 100;
  const sections = [
    {
      level: 2 as const,
      lit: notes.some((n) => n.chance !== undefined || n.slide || n.hold),
      fields: (
        <>
          <span className="h-track-label">Chance</span>
          <Slider
            value={chance / 100}
            onChange={(v) => setExtras({ chance: Math.max(1, Math.round(v * 100)) })}
            length={60}
            disabled={off}
            hint="How often the selected notes play, in percent of the times the block comes round. Right is always."
          />
          <span className={off ? 'h-track-value h-engraved' : 'h-track-value'}>{chance} %</span>
          <Checkbox
            label="Slide"
            checked={!!lead.slide}
            onChange={(slide) => setExtras({ slide })}
            disabled={off}
            hint="Slide: the pitch glides into the selected notes from the note before them on this row."
          />
          <Checkbox
            label="Hold"
            checked={!!lead.hold}
            onChange={(hold) => setExtras({ hold })}
            disabled={off}
            hint="Hold: a drone that sounds to the end of its place in the song, or of the block while the block plays."
          />
        </>
      ),
    },
    {
      level: 3 as const,
      lit: notes.some((n) => n.ratchet !== undefined || !!n.locks),
      fields: (
        <>
          <span className="h-track-label">Ratchet</span>
          <Select
            value={String(lead.ratchet ?? 1)}
            options={RATCHET_OPTIONS}
            onChange={(v) => setExtras({ ratchet: Number(v) })}
            width={52}
            disabled={off}
            hint="Ratchet: play the selected notes this many times, evenly inside their length, for rolls and stutters."
          />
          <LockField slot={0} sound={sound} notes={notes} setLock={setLock} />
          <LockField slot={1} sound={sound} notes={notes} setLock={setLock} />
        </>
      ),
    },
  ];
  return (
    <div className="h-track-inspector" data-tour="inspector">
      <div className="h-track-fields">
        <span className="h-track-group">
          <span className="h-track-which">{which}</span>
          {children}
        </span>
        {sections.filter((s) => shown('note', s.level)).map((s) => (
          <span key={s.level} className="h-track-group" role="group" aria-label={LEVEL_NAMES[s.level]}>
            <Separator vertical />
            {s.fields}
          </span>
        ))}
        {off && <span className="h-track-help">{help}</span>}
      </div>
      {beginner && (
        <FoldToggles
          row
          folds={sections.map((s) => ({
            label: LEVEL_NAMES[s.level],
            open: shown('note', s.level),
            lit: s.lit,
            hint: FOLD_HINTS[s.level],
            onToggle: () => toggleFold('note', s.level),
          }))}
        />
      )}
    </div>
  );
}

function StepInspector() {
  const ref = useApp((s) => s.step);
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!);
  const channel = useApp((s) => s.project.channels.find((c) => c.id === s.step?.channelId));
  const bar = useApp((s) => barOf(s.project.meter));
  const columns = patternSteps(pattern, bar);
  const cells = rowCells(ref ? pattern.notes[ref.channelId] : undefined);
  const cell = ref && channel && ref.index < columns ? cells.get(ref.index) : undefined;
  const lead = cell?.notes[0] ?? { note: ROOT_NOTE, vel: 0.8 };
  const ids = cell?.notes.map((n) => n.id) ?? [];
  const off = !cell;
  const chord = cell && cell.notes.length > 1 ? `, ${cell.notes.length} notes` : '';
  return (
    <InspectorRow
      which={cell ? `Step ${cell.index + 1} of ${channel!.sound.name}${chord}` : 'No step selected'}
      notes={cell?.notes ?? []}
      sound={channel?.sound}
      setExtras={(extras) => setNotesExtras(pattern.id, ref!.channelId, ids, extras)}
      setLock={(slot, lock) => setNotesLock(pattern.id, ref!.channelId, ids, slot, lock)}
      help="Click: add or remove · Drag: note · Drag the edge: length · Right-click: pick"
    >
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
    </InspectorRow>
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
  const bar = useApp((s) => barOf(s.project.meter));
  const ticks = pattern.bars * bar.ticks;
  const notes = (pattern.notes[channel.id] ?? []).filter((n) => n.start < ticks && ids.includes(n.id));
  const lead = notes[0] ?? { start: 0, len: snap, note: ROOT_NOTE, vel: 0.8 };
  const all = notes.map((n) => n.id);
  const off = notes.length === 0;
  return (
    <InspectorRow
      which={off ? 'No note selected'
        : `${notes.length === 1 ? noteName(lead.note) : `${notes.length} notes`} of ${channel.sound.name}`}
      notes={notes}
      sound={channel.sound}
      setExtras={(extras) => setNotesExtras(pattern.id, channel.id, all, extras)}
      setLock={(slot, lock) => setNotesLock(pattern.id, channel.id, all, slot, lock)}
      help={`Click: add a note · Drag: move · Edges: length · Shift-drag: select · ${modKey('C')} ${modKey('V')}: `
        + 'copy, paste'}
    >
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
        format={(t) => positionText(t, bar)}
        parse={(text) => parsePosition(text, bar)}
        width={84}
        disabled={off}
        onChange={(start) => nudgeSelection(start - lead.start, 0)}
        hint="Where the first selected note starts, as bar.beat.sixteenth, with ticks after a plus (24 to a sixteenth)."
      />
    </InspectorRow>
  );
}
