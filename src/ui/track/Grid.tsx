import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { tap } from '../../app/audio';
import { addSound } from '../../app/commands';
import { snapPitch } from '../../app/snap';
import { TICKS_PER_STEP, newNote } from '../../core/defaults';
import { barOf } from '../../core/meter';
import type { Bar } from '../../core/meter';
import { OUT, paramSpec } from '../../core/modules';
import type { FloatSpec } from '../../core/modules';
import { MAX_NOTE, MIN_NOTE, ROOT_NOTE, noteName } from '../../core/notes';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import { patternSteps } from '../../core/sequencer';
import type { Channel, Note, Pattern } from '../../core/types';
import {
  addNote, beginGesture, commitGesture, duplicateChannel, moveChannel, moveNotes, removeChannel, removeNotes,
  selectChannel, selectStep, setChannel, setNotesVelocity, setParam, setRowLoop, setView, useApp,
} from '../../state/store';
import { useShown } from '../factory/levels';
import { Button, Icon, Led, Slider, Well, openMenu, setHint, useHint } from '../kit';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';
import { Marks, markClass } from './marks';
import { getHeard, subscribeHeard, useHeard } from './playhead';
import { openRoll } from './rollState';
import type { Heard } from './playhead';
import type { Cell, Cells } from './steps';
import {
  CELL_W, cellX, columnAt, fitNotes, gapAfter, lastNote, laneWidth, makeCell, maxLength, onBeat, rememberNote,
  resizeCell, richCell, rowCells, spanWidth, stepOver,
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
  loop: 'Drag sideways to set how many steps this row plays before it starts again, against the others.',
  repeat: (step: number, loop: number) =>
    `This row starts again every ${loop} steps, so this is step ${step + 1} once more. Click to go to it.`,
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
  loop: number; // the steps the row plays before it starts again; the block's length when it has no loop
  marker: boolean; // on the row's end marker
}

/** How many steps a row of a block of `columns` steps plays before it starts again. */
export const loopOf = (pattern: Pattern, channelId: string, columns: number) =>
  Math.min(columns, pattern.loops?.[channelId] ?? columns);

function currentPattern() {
  const { project, patternId } = useApp.getState();
  return project.patterns.find((p) => p.id === patternId)!;
}

const currentBar = () => barOf(useApp.getState().project.meter);

function hitTest(target: EventTarget | null, clientX: number): Hit | null {
  const lane = (target as Element | null)?.closest?.<HTMLElement>('.h-track-lane');
  if (!lane) return null;
  const pattern = currentPattern();
  const bar = currentBar();
  const channelId = lane.dataset.channel!;
  const columns = patternSteps(pattern, bar);
  const loop = loopOf(pattern, channelId, columns);
  const cells = rowCells(pattern.notes[channelId]);
  const laneLeft = lane.firstElementChild!.getBoundingClientRect().left;
  const x = clientX - laneLeft;
  const column = columnAt(x, columns, bar);
  const start = column < 0 || column >= loop ? -1 : stepOver(cells, column);
  const marker = !!(target as Element).closest('.h-track-loop');
  return { channelId, patternId: pattern.id, cells, x, column, start, laneLeft, loop, marker };
}

/** The end of the row's loop nearest to a point of the lane: after 1 to `columns` steps. */
export function loopAt(x: number, columns: number, bar: Bar): number {
  const column = columnAt(clamp(x, 0, laneWidth(columns, bar) - 1), columns, bar);
  return clamp(column + (x >= cellX(column, bar) + CELL_W / 2 ? 1 : 0), 1, columns);
}

function onEdge(hit: Hit): boolean {
  const bar = currentBar();
  return hit.start >= 0
    && hit.x >= cellX(hit.start, bar) + spanWidth(hit.start, hit.cells.get(hit.start)!.span, bar) - EDGE_PX;
}

const ids = (cell: Cell) => cell.notes.map((n) => n.id);

/** The cell's notes moved by `shift` semitones, as the draft shows them. */
function moved(cell: Cell, shift: number): Cell {
  return makeCell(cell.index, cell.notes.map((n) => ({ ...n, note: n.note + shift })));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const stepsHint = (steps: number) => `This row plays ${steps} ${steps === 1 ? 'step' : 'steps'}, then starts again.`;

export function Grid() {
  const channels = useApp((s) => s.project.channels);
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!);
  const selected = useApp((s) => s.step);
  const channelId = useApp((s) => s.channelId);
  const bar = useApp((s) => barOf(s.project.meter));
  const deep = useShown()('grid', 3);
  const [draft, setDraft] = useState<Draft | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const loopDrag = useRef<{ channelId: string; laneLeft: number; steps: number } | null>(null);
  const columns = patternSteps(pattern, bar);
  // Rows of their own length are Deep: in beginner mode the markers show once a row of the block has one.
  const markers = deep || !!pattern.loops;

  useEffect(() => {
    const el = scroller.current!;
    const show = () => {
      const heard = getHeard();
      if (!heard || heard.patternId !== pattern.id) {
        delete el.dataset.now;
        return;
      }
      el.dataset.now = '';
      el.style.setProperty('--h-track-now', `${cellX(heard.step, bar)}px`);
      followPage(el, heard, bar);
    };
    show();
    return subscribeHeard(show);
  }, [pattern.id, columns, bar]);

  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      const hit = hitTest(e.target, e.clientX);
      if (!hit || hit.start < 0 || hit.marker || gesture.current) return;
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
    if (hit.column < 0 && !hit.marker) return;
    if (e.button === 2) {
      if (hit.start >= 0) selectStep({ channelId: hit.channelId, index: hit.start });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (!hit.marker && hit.column >= hit.loop) {
      // A repeat is not edited; it leads to the step it repeats.
      const index = hit.column % hit.loop;
      selectStep({ channelId: hit.channelId, index });
      const el = scroller.current!;
      const x = cellX(index, currentBar()) + LANE_PAD;
      if (x < el.scrollLeft) el.scrollLeft = x;
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (hit.marker) {
      loopDrag.current = { channelId: hit.channelId, laneLeft: hit.laneLeft, steps: hit.loop };
      beginGesture();
      setHint(stepsHint(hit.loop));
      return;
    }
    const created = hit.start < 0;
    const index = created ? hit.column : hit.start;
    const cell = created
      ? makeCell(index, [{ id: 'new', ...newNote(index * TICKS_PER_STEP, snapPitch(lastNote(hit.channelId))) }])
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
    const drag = loopDrag.current;
    if (drag) {
      const steps = loopAt(e.clientX - drag.laneLeft, patternSteps(currentPattern(), currentBar()), currentBar());
      if (steps !== drag.steps) {
        drag.steps = steps;
        setRowLoop(currentPattern().id, drag.channelId, steps);
      }
      setHint(stepsHint(steps));
      return;
    }
    const g = gesture.current;
    if (!g) {
      const hit = hitTest(e.target, e.clientX);
      setHint(!hit || hit.column < 0 ? null : hit.marker ? HINTS.loop
        : hit.column >= hit.loop ? HINTS.repeat(hit.column % hit.loop, hit.loop)
          : hit.start < 0 ? HINTS.empty : onEdge(hit) ? HINTS.edge
            : richCell(hit.cells.get(hit.start)!) ? HINTS.rich : HINTS.step);
      return;
    }
    const pattern = currentPattern();
    const patternId = pattern.id;
    const bar = currentBar();
    const n = patternSteps(pattern, bar);
    const column = clamp(columnAt(clamp(e.clientX - g.laneLeft, 0, laneWidth(n, bar) - 1), n, bar), 0, n - 1);
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
      const lead = notes[0];
      const pointed = snapPitch(lead.note + Math.trunc(dy / PITCH_PX));
      const shift = clamp(pointed - lead.note, MIN_NOTE - Math.min(...pitches), MAX_NOTE - Math.max(...pitches));
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
      // Painting stops where the row starts again.
      const to = Math.min(column, loopOf(pattern, g.channelId, n) - 1);
      const dir = Math.sign(to - g.painted);
      const note = g.cell.notes[0];
      for (let c = g.painted + dir; dir !== 0 && c !== to + dir; c += dir) {
        if (stepOver(rowCells(currentPattern().notes[g.channelId]), c) >= 0) continue;
        addNote(patternId, g.channelId, { ...note, start: c * TICKS_PER_STEP });
        tap(g.channelId, note.note, note.vel);
      }
      g.painted = to;
    }
  };

  const finish = () => {
    if (loopDrag.current) {
      loopDrag.current = null;
      commitGesture();
      setHint(null);
    }
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
        {channels.length > 0 && <Ruler columns={columns} bar={bar} />}
        {channels.map((channel, i) => (
          <Row
            key={channel.id}
            channel={channel}
            index={i}
            notes={pattern.notes[channel.id]}
            columns={columns}
            loop={loopOf(pattern, channel.id, columns)}
            marker={markers}
            bar={bar}
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
export function followPage(el: HTMLElement, heard: Heard, bar: Bar): void {
  const head = el.querySelector<HTMLElement>('.h-track-corner')?.offsetWidth ?? 0;
  const x = cellX(heard.step, bar) + LANE_PAD;
  const view = el.clientWidth - head;
  if (x >= el.scrollLeft && x + CELL_W <= el.scrollLeft + view) return;
  el.scrollLeft = cellX(heard.step - (heard.step % bar.steps), bar);
}

/** Bar numbers and beat ticks over the lanes, the play marker, and whatever marks a view adds. */
export const Ruler = memo(function Ruler({ columns, bar, children }: {
  columns: number;
  bar: Bar;
  children?: ReactNode;
}) {
  return (
    <div className="h-track-ruler">
      <div className="h-track-corner" />
      <div className="h-track-ticks">
        <div className="h-track-box" style={{ width: laneWidth(columns, bar) }}>
          {Array.from({ length: columns }, (_, i) => (
            <span
              key={i}
              className={cx('h-track-tick', i % bar.steps === 0 ? 'is-bar' : onBeat(i, bar) && 'is-beat')}
              style={{ marginRight: gapAfter(i, bar) }}
            >
              {i % bar.steps === 0 && i / bar.steps + 1}
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
  loop: number;
  marker: boolean;
  bar: Bar;
  active: boolean;
  selected: number;
  draft: Draft | null;
}

/**
 * A row of the grid. A row with a loop of its own draws its steps after the loop as dimmed repeats of the loop, and
 * the notes it keeps there, silent, struck out; the end marker sits after the last step of the loop.
 */
const Row = memo(function Row({
  channel, index, notes, columns, loop, marker, bar, active, selected, draft,
}: RowProps) {
  const shown = rowCells(notes);
  if (draft) shown.set(draft.cell.index, draft.cell);
  // Notes left past the end when the pattern was shortened stay in the document but are not drawn.
  const keys = [...shown.keys()].filter((i) => i < columns).sort((a, b) => a - b);
  const span = (i: number, cell = shown.get(i)!) => spanWidth(i, Math.min(cell.span, columns - i), bar);
  const width = laneWidth(columns, bar);
  const live = keys.filter((i) => i < loop);
  const repeats = live.flatMap((i) =>
    Array.from({ length: Math.ceil((columns - i) / loop) - 1 }, (_, k) => i + (k + 1) * loop));
  return (
    <div className="h-track-row" data-tour={`row-${channel.sound.name}`}>
      <Header channel={channel} index={index} active={active} />
      <div className="h-track-lane" data-channel={channel.id}>
        <div className="h-track-box" style={{ width, '--cell': `var(--c${channel.color})` } as CSSProperties}>
          <EmptyCells columns={columns} loop={loop} bar={bar} />
          <i className="h-track-now" />
          {live.filter((i) => shown.get(i)!.notes.some((n) => n.hold)).map((i) => {
            const left = cellX(i, bar) + span(i);
            return left < width && (
              <i key={`hold${i}`} className="h-track-hold" style={{ left, width: width - left }} />
            );
          })}
          {repeats.map((j) => {
            const cell = shown.get(j % loop)!;
            return <StepKey key={`r${j}`} cell={cell} left={cellX(j, bar)} width={span(j, cell)} kind="is-repeat" />;
          })}
          {keys.map((i) => (
            <StepKey
              key={i}
              cell={shown.get(i)!}
              left={cellX(i, bar)}
              width={span(i)}
              kind={i >= loop && 'is-silent'}
            />
          ))}
          {keys.includes(selected) && (
            <i className="h-track-sel" style={{ left: cellX(selected, bar), width: span(selected) }} />
          )}
          {marker && <i className="h-track-loop" style={{ left: cellX(loop - 1, bar) + CELL_W - 3 }} />}
        </div>
      </div>
    </div>
  );
});

const EmptyCells = memo(function EmptyCells({ columns, loop, bar }: { columns: number; loop: number; bar: Bar }) {
  return Array.from({ length: columns }, (_, i) => (
    <i
      key={i}
      className={cx('h-track-cell', onBeat(i, bar) && 'is-beat', i >= loop && 'is-beyond')}
      style={{ marginRight: gapAfter(i, bar) }}
    />
  ));
});

/**
 * A cell's key: the lowest note's name (none for C3 alone), "+2" when two more notes start in the step, a mark
 * where a note starts off the grid line, and the marks of the notes' extras.
 */
function StepKey({ cell, left, width, kind }: { cell: Cell; left: number; width: number; kind?: string | false }) {
  const [lead, ...rest] = cell.notes;
  const style = { left, width, '--lit': `${Math.round(lead.vel * CELL_H)}px` } as CSSProperties;
  const offsets = [...new Set(cell.notes.map((n) => n.start % TICKS_PER_STEP).filter((t) => t > 0))];
  return (
    <div
      className={cx(
        'h-track-step', width > CELL_W && 'is-long', rest.length > 0 && 'is-chord', markClass(cell.notes), kind,
      )}
      style={style}
    >
      {rest.length > 0 && <span className="h-track-more">+{rest.length}</span>}
      {(lead.note !== ROOT_NOTE || rest.length > 0) && noteName(lead.note)}
      {offsets.map((t) => (
        <i key={t} className="h-track-offset" style={{ left: Math.round((t * CELL_W) / TICKS_PER_STEP) }} />
      ))}
      <Marks notes={cell.notes} width={width} />
    </div>
  );
}

function Lamp({ channelId, color }: { channelId: string; color: number }) {
  const on = useHeard((heard) => {
    if (!heard) return false;
    const { project } = useApp.getState();
    const pattern = project.patterns.find((p) => p.id === heard.patternId);
    if (!pattern) return false;
    const loop = loopOf(pattern, channelId, patternSteps(pattern, barOf(project.meter)));
    return stepOver(rowCells(pattern.notes[channelId]), heard.step % loop) >= 0;
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
