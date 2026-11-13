import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { tap } from '../../app/audio';
import { addSound } from '../../app/commands';
import { STEPS_PER_BAR, TICKS_PER_STEP, newNote } from '../../core/defaults';
import { OUT, paramSpec } from '../../core/modules';
import type { FloatSpec } from '../../core/modules';
import { MAX_NOTE, MIN_NOTE, ROOT_NOTE, noteName } from '../../core/notes';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import { patternSteps } from '../../core/sequencer';
import type { Channel, Note } from '../../core/types';
import {
  addNote, beginGesture, commitGesture, duplicateChannel, moveChannel, moveNotes, removeChannel, removeNotes,
  selectChannel, selectStep, setChannel, setNotesVelocity, setParam, setView, useApp,
} from '../../state/store';
import { Button, Icon, Led, Slider, Well, openMenu, setHint, useHint } from '../kit';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';
import { getHeard, subscribeHeard, useHeard } from './playhead';
import { openRoll } from './rollState';
import type { Heard } from './playhead';
import type { Cell, Cells } from './steps';
import {
  CELL_W, cellX, columnAt, fitNotes, lastNote, laneWidth, makeCell, maxLength, rememberNote, resizeCell, richCell,
  rowCells, spanWidth, stepOver,
} from './steps';

const LEVEL = paramSpec(OUT, 'level') as FloatSpec;
const PITCH_PX = 4;
const EDGE_PX = 5;
const STILL_PX = 3;
const WHEEL_VEL = 0.05;
const CELL_H = 22;
const LANE_PAD = 4;

const MARKER = {
  rows: ['aaaaa', '.aaa.', '..a..'],
  colors: { a: 'var(--amber)' },
};

const HINTS = {
  empty: 'Click to add a step here; keep the button down and move sideways to add more.',
  step: 'Click to take this step out, drag up or down to change its note, scroll to make it louder or softer.',
  rich: 'Double-click to open these notes in the piano roll. Drag up or down to move them, scroll to make them louder.',
  edge: 'Drag this edge sideways to make the step longer or shorter.',
};

/** The cell being edited by the pointer, drawn from here until the gesture ends and the store takes it. */
interface Draft {
  channelId: string;
  cell: Cell;
}

interface Gesture extends Draft {
  mode: 'press' | 'paint' | 'pitch' | 'length';
  created: boolean;
  original: Cell;
  shift: number; // semitones
  columns: number; // length of the key
  laneLeft: number;
  x: number;
  y: number;
  moved: boolean;
  painted: number;
}

interface Hit {
  channelId: string;
  patternId: string;
  cells: Cells;
  x: number;
  column: number;
  start: number;
  laneLeft: number;
}

function currentPattern() {
  const { project, patternId } = useApp.getState();
  return project.patterns.find((p) => p.id === patternId)!;
}

function hitTest(target: EventTarget | null, clientX: number): Hit | null {
  const lane = (target as Element | null)?.closest?.<HTMLElement>('.h-track-lane');
  if (!lane) return null;
  const pattern = currentPattern();
  const channelId = lane.dataset.channel!;
  const cells = rowCells(pattern.notes[channelId]);
  const laneLeft = lane.firstElementChild!.getBoundingClientRect().left;
  const x = clientX - laneLeft;
  const column = columnAt(x, patternSteps(pattern));
  const start = column < 0 ? -1 : stepOver(cells, column);
  return { channelId, patternId: pattern.id, cells, x, column, start, laneLeft };
}

const onEdge = (hit: Hit) =>
  hit.start >= 0 && hit.x >= cellX(hit.start) + spanWidth(hit.start, hit.cells.get(hit.start)!.span) - EDGE_PX;

const ids = (cell: Cell) => cell.notes.map((n) => n.id);

/** The cell's notes moved by `shift` semitones, as the draft shows them. */
function moved(cell: Cell, shift: number): Cell {
  return makeCell(cell.index, cell.notes.map((n) => ({ ...n, note: n.note + shift })));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Grid() {
  const channels = useApp((s) => s.project.channels);
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!);
  const selected = useApp((s) => s.step);
  const channelId = useApp((s) => s.channelId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const columns = patternSteps(pattern);

  useEffect(() => {
    const el = scroller.current!;
    const show = () => {
      const heard = getHeard();
      if (!heard || heard.patternId !== pattern.id) {
        delete el.dataset.now;
        return;
      }
      const x = cellX(heard.step);
      el.dataset.now = '';
      el.style.setProperty('--h-track-now', `${x}px`);
      followPage(el, heard);
    };
    show();
    return subscribeHeard(show);
  }, [pattern.id, columns]);

  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      const hit = hitTest(e.target, e.clientX);
      if (!hit || hit.start < 0 || gesture.current) return;
      e.preventDefault();
      const cell = hit.cells.get(hit.start)!;
      const vel = clamp(Math.round((cell.notes[0].vel - Math.sign(e.deltaY) * WHEEL_VEL) * 100) / 100, 0, 1);
      selectStep({ channelId: hit.channelId, index: hit.start });
      setNotesVelocity(hit.patternId, hit.channelId, ids(cell), vel);
      setHint(`Velocity ${Math.round(vel * 100)} %`);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const hit = hitTest(e.target, e.clientX);
    if (!hit) return;
    selectChannel(hit.channelId);
    if (hit.column < 0) return;
    if (e.button === 2) {
      if (hit.start >= 0) selectStep({ channelId: hit.channelId, index: hit.start });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const created = hit.start < 0;
    const index = created ? hit.column : hit.start;
    const cell = created
      ? makeCell(index, [{ id: 'new', ...newNote(index * TICKS_PER_STEP, lastNote(hit.channelId)) }])
      : hit.cells.get(index)!;
    const g: Gesture = {
      channelId: hit.channelId, cell, original: cell, created, shift: 0, columns: cell.span,
      mode: !created && onEdge(hit) ? 'length' : 'press',
      laneLeft: hit.laneLeft, x: e.clientX, y: e.clientY, moved: false, painted: index,
    };
    gesture.current = g;
    beginGesture();
    selectStep({ channelId: g.channelId, index });
    if (created) {
      setDraft(g);
      tap(g.channelId, cell.notes[0].note, cell.notes[0].vel);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) {
      const hit = hitTest(e.target, e.clientX);
      setHint(!hit || hit.column < 0 ? null : hit.start < 0 ? HINTS.empty : onEdge(hit) ? HINTS.edge
        : richCell(hit.cells.get(hit.start)!) ? HINTS.rich : HINTS.step);
      return;
    }
    const pattern = currentPattern();
    const patternId = pattern.id;
    const n = patternSteps(pattern);
    const column = clamp(columnAt(clamp(e.clientX - g.laneLeft, 0, laneWidth(n) - 1), n), 0, n - 1);
    const dy = g.y - e.clientY;
    const { index, notes } = g.original;
    if (g.mode === 'press') {
      if (Math.abs(dy) >= PITCH_PX) g.mode = 'pitch';
      else if (g.created && column !== index) {
        g.mode = 'paint';
        addNote(patternId, g.channelId, g.cell.notes[0]);
        setDraft(null);
      } else if (Math.abs(e.clientX - g.x) > STILL_PX) g.moved = true;
    }
    if (g.mode === 'pitch') {
      const pitches = notes.map((n) => n.note);
      const shift = clamp(Math.trunc(dy / PITCH_PX), MIN_NOTE - Math.min(...pitches), MAX_NOTE - Math.max(...pitches));
      const lead = notes[0];
      if (shift !== g.shift) {
        g.shift = shift;
        g.cell = moved(g.original, shift);
        setDraft({ ...g });
        tap(g.channelId, lead.note + shift, lead.vel);
      }
      setHint(noteName(lead.note + shift));
    } else if (g.mode === 'length') {
      const len = clamp(column - index + 1, 1, maxLength(rowCells(pattern.notes[g.channelId]), index, n));
      if (len !== g.columns) {
        g.columns = len;
        g.cell = makeCell(index, fitNotes(g.original, len));
        setDraft({ ...g });
      }
      setHint(`Length ${len}`);
    } else if (g.mode === 'paint') {
      const dir = Math.sign(column - g.painted);
      const note = g.cell.notes[0];
      for (let c = g.painted + dir; dir !== 0 && c !== column + dir; c += dir) {
        if (stepOver(rowCells(currentPattern().notes[g.channelId]), c) >= 0) continue;
        addNote(patternId, g.channelId, { ...note, start: c * TICKS_PER_STEP });
        tap(g.channelId, note.note, note.vel);
      }
      g.painted = column;
    }
  };

  const finish = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    const patternId = currentPattern().id;
    const lead = g.cell.notes[0];
    if (g.created && (g.mode === 'press' || g.mode === 'pitch')) {
      addNote(patternId, g.channelId, lead);
    } else if (g.mode === 'press' && !g.moved) {
      // A click selects what the grid cannot show whole, so that it is not lost by accident.
      if (!richCell(g.original)) {
        removeNotes(patternId, g.channelId, ids(g.original));
        selectStep(null);
      }
    } else if (g.mode === 'pitch') {
      moveNotes(patternId, g.channelId, ids(g.original), 0, g.shift);
    } else if (g.mode === 'length') {
      resizeCell(patternId, g.channelId, g.original, g.columns);
    }
    commitGesture();
    if (g.created || g.mode === 'pitch') rememberNote(g.channelId, lead.note);
    setDraft(null);
    setHint(null);
  };

  return (
    <Well className="h-track-grid">
      <div
        ref={scroller}
        className="h-track-scroll"
        data-tour="grid"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onLostPointerCapture={finish}
        onPointerLeave={() => !gesture.current && setHint(null)}
        onDoubleClick={(e) => {
          // The pointer was captured by the scroller, so the event's target is the scroller itself.
          const hit = hitTest(document.elementFromPoint(e.clientX, e.clientY), e.clientX);
          const cell = hit && hit.start >= 0 ? hit.cells.get(hit.start)! : null;
          if (cell && richCell(cell)) openRoll(hit!.channelId, ids(cell));
        }}
        onContextMenu={(e) => {
          if ((e.target as Element).closest('.h-track-lane')) e.preventDefault();
        }}
      >
        {channels.length > 0 && <Ruler columns={columns} />}
        {channels.map((channel, i) => (
          <Row
            key={channel.id}
            channel={channel}
            index={i}
            notes={pattern.notes[channel.id]}
            columns={columns}
            active={channel.id === channelId}
            selected={selected?.channelId === channel.id ? selected.index : -1}
            draft={draft?.channelId === channel.id ? draft : null}
          />
        ))}
        <div className="h-track-row">
          <div className="h-track-add">
            <Button onClick={addSound} hint="Pick a sound from the library and add it as a new row.">
              <Icon name="plus" /> Add sound…
            </Button>
          </div>
          {channels.length === 0 && (
            <span className="h-track-empty">
              No sounds yet. Add one from the library, or drop audio files here to play them as samples.
            </span>
          )}
        </div>
      </div>
    </Well>
  );
}

/** When the play position runs off the visible part of the lanes, turn the page to the bar it is in. */
export function followPage(el: HTMLElement, heard: Heard): void {
  const head = el.querySelector<HTMLElement>('.h-track-corner')?.offsetWidth ?? 0;
  const x = cellX(heard.step) + LANE_PAD;
  const view = el.clientWidth - head;
  if (x >= el.scrollLeft && x + CELL_W <= el.scrollLeft + view) return;
  el.scrollLeft = cellX(heard.step - (heard.step % STEPS_PER_BAR));
}

/** Bar numbers and beat ticks over the lanes, the play marker, and whatever marks a view adds. */
export const Ruler = memo(function Ruler({ columns, children }: { columns: number; children?: ReactNode }) {
  return (
    <div className="h-track-ruler">
      <div className="h-track-corner" />
      <div className="h-track-ticks">
        <div className="h-track-box" style={{ width: laneWidth(columns) }}>
          {Array.from({ length: columns }, (_, i) => (
            <span key={i} className="h-track-tick">
              {i % STEPS_PER_BAR === 0 && i / STEPS_PER_BAR + 1}
            </span>
          ))}
          <span className="h-track-marker">
            <SpriteImage sprite={MARKER} />
          </span>
          {children}
        </div>
      </div>
    </div>
  );
});

interface RowProps {
  channel: Channel;
  index: number;
  notes: Note[] | undefined;
  columns: number;
  active: boolean;
  selected: number;
  draft: Draft | null;
}

const Row = memo(function Row({ channel, index, notes, columns, active, selected, draft }: RowProps) {
  const shown = rowCells(notes);
  if (draft) shown.set(draft.cell.index, draft.cell);
  // Notes left past the end when the pattern was shortened stay in the document but are not drawn.
  const keys = [...shown.keys()].filter((i) => i < columns).sort((a, b) => a - b);
  const span = (i: number) => spanWidth(i, Math.min(shown.get(i)!.span, columns - i));
  return (
    <div className="h-track-row" data-tour={`row-${channel.sound.name}`}>
      <Header channel={channel} index={index} active={active} />
      <div className="h-track-lane" data-channel={channel.id}>
        <div
          className="h-track-box"
          style={{ width: laneWidth(columns), '--cell': `var(--c${channel.color})` } as CSSProperties}
        >
          <EmptyCells columns={columns} />
          <i className="h-track-now" />
          {keys.map((i) => (
            <StepKey key={i} cell={shown.get(i)!} width={span(i)} />
          ))}
          {keys.includes(selected) && (
            <i className="h-track-sel" style={{ left: cellX(selected), width: span(selected) }} />
          )}
        </div>
      </div>
    </div>
  );
});

const EmptyCells = memo(function EmptyCells({ columns }: { columns: number }) {
  return Array.from({ length: columns }, (_, i) => <i key={i} className="h-track-cell" />);
});

/**
 * A cell's key: the lowest note's name (none for C3 alone), "+2" when two more notes start in the step, and a mark
 * where a note starts off the grid line.
 */
function StepKey({ cell, width }: { cell: Cell; width: number }) {
  const [lead, ...rest] = cell.notes;
  const style = { left: cellX(cell.index), width, '--lit': `${Math.round(lead.vel * CELL_H)}px` } as CSSProperties;
  const offsets = [...new Set(cell.notes.map((n) => n.start % TICKS_PER_STEP).filter((t) => t > 0))];
  return (
    <div className={cx('h-track-step', width > CELL_W && 'is-long', rest.length > 0 && 'is-chord')} style={style}>
      {rest.length > 0 && <span className="h-track-more">+{rest.length}</span>}
      {(lead.note !== ROOT_NOTE || rest.length > 0) && noteName(lead.note)}
      {offsets.map((t) => (
        <i key={t} className="h-track-offset" style={{ left: Math.round((t * CELL_W) / TICKS_PER_STEP) }} />
      ))}
    </div>
  );
}

function Lamp({ channelId, color }: { channelId: string; color: number }) {
  const on = useHeard((heard) => {
    if (!heard) return false;
    const notes = useApp.getState().project.patterns.find((p) => p.id === heard.patternId)?.notes[channelId];
    return stepOver(rowCells(notes), heard.step) >= 0;
  });
  return <Led on={on} color={color} hint="This lamp lights up while the sound is playing a step." />;
}

function channelMenu(channelId: string, index: number, count: number) {
  return [
    { label: 'Edit Sound', onSelect: () => openInFactory(channelId) },
    { label: 'Duplicate', onSelect: () => duplicateChannel(channelId) },
    'separator' as const,
    { label: 'Move Up', disabled: index === 0, onSelect: () => moveChannel(channelId, index - 1) },
    { label: 'Move Down', disabled: index === count - 1, onSelect: () => moveChannel(channelId, index + 1) },
    'separator' as const,
    { label: 'Remove', onSelect: () => removeChannel(channelId) },
  ];
}

function openInFactory(channelId: string): void {
  selectChannel(channelId);
  setView('factory');
}

const Header = memo(function Header({ channel, index, active }: { channel: Channel; index: number; active: boolean }) {
  const { id, sound } = channel;
  const nameHint = useHint(`${sound.name}. Double-click to open it in the Factory; right-click for more.`);
  const level = sound.out.level as number;
  return (
    <div
      className={cx('h-track-head', active && 'is-active')}
      onPointerDown={() => selectChannel(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        selectChannel(id);
        openMenu(channelMenu(id, index, useApp.getState().project.channels.length), e.clientX, e.clientY);
      }}
    >
      <Lamp channelId={id} color={channel.color} />
      <span className="h-track-name" onDoubleClick={() => openInFactory(id)} {...nameHint.props}>
        {sound.name}
      </span>
      <Button
        small
        square
        onClick={() => openRoll(id)}
        hint={`Open ${sound.name} in the piano roll, for chords and notes between the steps.`}
      >
        <Icon name="roll" />
      </Button>
      <Button
        small
        pressed={channel.mute}
        onClick={() => setChannel(id, { mute: !channel.mute })}
        hint="Mute: silence this sound."
      >
        M
      </Button>
      <Button
        small
        pressed={channel.solo}
        onClick={() => setChannel(id, { solo: !channel.solo })}
        hint="Solo: hear only this sound, and any others that are soloed too."
      >
        S
      </Button>
      <Slider
        small
        length={40}
        value={toNorm(LEVEL, level)}
        onChange={(t) => {
          const db = fromNorm(LEVEL, t);
          setParam(id, 'out', 'level', db);
          setHint(`Level: ${formatValue(LEVEL, db)}`);
        }}
        hint={`How loud ${sound.name} is (${formatValue(LEVEL, level)}). Drag left for softer, right for louder.`}
      />
    </div>
  );
});
