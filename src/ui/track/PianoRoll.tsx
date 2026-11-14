import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { tap } from '../../app/audio';
import { toggleScaleSnap, usePrefs } from '../../app/prefs';
import { snapPitch } from '../../app/snap';
import { TICKS_PER_STEP } from '../../core/defaults';
import { LEVEL_NAMES } from '../../core/levels';
import { barOf } from '../../core/meter';
import type { Bar } from '../../core/meter';
import { MAX_NOTE, MIN_NOTE, PITCH_NAMES, ROOT_NOTE, isBlackKey, noteName } from '../../core/notes';
import { SCALES } from '../../core/scale';
import { patternSteps } from '../../core/sequencer';
import type { Channel, Note, Scale } from '../../core/types';
import {
  addNote, beginGesture, commitGesture, selectChannel, setNotesVelocity, setRowLoop, setScale, updateNotes, useApp,
} from '../../state/store';
import { toggleFold, useShown } from '../factory/levels';
import { Button, ColorChip, FoldToggles, Select, Separator, Well, setHint, useHint } from '../kit';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';
import { Ruler, followPage, loopAt, loopOf } from './Grid';
import { Marks, markClass } from './marks';
import { getHeard, subscribeHeard } from './playhead';
import {
  ROW_H, SHEET_H, SNAPS, drawnLength, dragNotes, endX, gapsBackground, noteAt, noteBox, noteY, notesIn, pitchAt,
  positionText, sheetBackground, snapCeil, snapFloor, stepsText, tickAt, tickX, velocityGroup,
} from './roll';
import type { Box, Part } from './roll';
import { closeRoll, rollRow, selectNotes, useRoll } from './rollState';
import { openRandomise } from './tools';
import { cellX, laneWidth } from './steps';
import './roll.css';

const STILL_PX = 3;
const VEL_H = 40;
const VEL_TOP = 4;
const NEW = 'new';

const PASTE_MARK = {
  rows: ['ttttttt', '.ttttt.', '..ttt..', '...t...'],
  colors: { t: 'var(--sel)' },
};

const RULER_HINT = 'Click to put the paste mark here; drag along the ruler to choose a stretch for Randomise.';
const LOOP_HINT = 'Drag sideways to set how many steps this row plays before it starts again, against the others.';

const HINTS = {
  repeat: 'This row starts again here, so these notes are its loop once more. Click one to go to the note it repeats.',
  empty: 'Click to add a note, and keep the button down to drag out its length. Shift-drag or right-drag selects.',
  body: 'Drag to move the note in time and pitch, with the other selected notes. Shift-click adds it to the selection.',
  start: 'Drag this edge to move where the note starts; its end stays.',
  end: 'Drag this edge to make the note longer or shorter.',
};

type Gesture =
  | { kind: 'add'; note: Note; x: number; moved: boolean }
  | {
    kind: 'drag'; part: Part; grab: Note; origin: Note[]; next: Note[]; x: number; t: number; pitch: number;
    moved: boolean;
  }
  | { kind: 'band'; x: number; y: number; base: readonly string[]; hit: Note | null; moved: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const sameNote = (a: Note, b: Note) => a.start === b.start && a.len === b.len && a.note === b.note;

const describe = (n: Note, bar: Bar) =>
  `${noteName(n.note)} at ${positionText(n.start, bar)}, ${stepsText(n.len)} ${
    n.len === TICKS_PER_STEP ? 'step' : 'steps'}`;

/** Pointer position inside an element, in whole pixels. */
function local(el: Element, e: { clientX: number; clientY: number }) {
  const r = el.getBoundingClientRect();
  return { x: Math.floor(e.clientX - r.left), y: Math.floor(e.clientY - r.top) };
}

/** The row's notes with the ones being dragged in their new places. */
function withDraft(notes: readonly Note[], draft: readonly Note[] | null): Note[] {
  if (!draft) return [...notes];
  const byId = new Map(draft.map((n) => [n.id, n]));
  return [...notes.map((n) => byId.get(n.id) ?? n), ...draft.filter((n) => n.id === NEW)];
}

const SCALE_OPTIONS = [{ value: '', label: 'Chromatic' }, ...SCALES.map((s) => ({ value: s.type, label: s.label }))];
const ROOT_OPTIONS = PITCH_NAMES.map((name, i) => ({ value: String(i), label: name }));

/** The scale of the song, Snap to Scale and Randomise: Shaping, behind a toggle at the right end in beginner mode. */
function ScaleTools({ scale }: { scale: Scale | undefined }) {
  const snap = usePrefs((p) => p.scaleSnap);
  return (
    <span className="h-track-group" role="group" aria-label={LEVEL_NAMES[2]}>
      <Separator vertical />
      <span className="h-track-label">Scale</span>
      <Select
        value={scale ? String(scale.root) : ''}
        options={scale ? ROOT_OPTIONS : [{ value: '', label: '–' }]}
        onChange={(v) => setScale({ root: Number(v), type: scale!.type })}
        width={44}
        disabled={!scale}
        hint="The root of the scale: the note it is named after, whose rows are lightest."
      />
      <Select
        value={scale?.type ?? ''}
        options={SCALE_OPTIONS}
        onChange={(v) => setScale(v ? { root: scale?.root ?? 0, type: v } : null)}
        width={128}
        hint="The scale of the song: the rows of the notes outside it are shaded. Chromatic leaves every note open."
      />
      <Button
        pressed={snap && !!scale}
        disabled={!scale}
        onClick={toggleScaleSnap}
        hint="Snap to Scale: new, dragged, recorded and typed notes land on the scale. Notes already there stay put."
      >
        Snap to scale
      </Button>
      <Button onClick={openRandomise} hint="Fills this row, or the stretch dragged on the ruler, with random notes.">
        Randomise…
      </Button>
    </span>
  );
}

/** The roll's own toolbar: back to the grid, the sound it shows, the snap, the scale and where Paste goes. */
export function RollBar() {
  const name = useApp((s) => s.project.channels.find((c) => c.id === s.channelId)?.sound.name ?? '');
  const color = useApp((s) => s.project.channels.find((c) => c.id === s.channelId)?.color ?? 0);
  const scale = useApp((s) => s.project.scale);
  const snap = useRoll((s) => s.snap);
  const mark = useRoll((s) => s.mark);
  const range = useRoll((s) => s.range);
  const bar = useApp((s) => barOf(s.project.meter));
  const beginner = usePrefs((p) => p.beginner);
  const shaping = useShown()('roll', 2);
  const markHint = useHint('Paste puts copied notes here. Copy moves it right after the copied notes; '
    + 'click the ruler to move it yourself, or drag along it to choose a stretch for Randomise.');
  return (
    <div className="h-track-bar h-roll-bar" data-tour="roll-tools">
      <Button onClick={closeRoll} hint="Back to the step grid of all sounds. Esc does the same with no note selected.">
        Grid
      </Button>
      <span className="h-roll-title">
        <ColorChip color={color} />
        {name}
      </span>
      <Separator vertical />
      <span className="h-track-label">Snap</span>
      <Select
        value={String(snap)}
        options={SNAPS.map((s) => ({ value: String(s.ticks), label: s.label }))}
        onChange={(v) => useRoll.setState({ snap: Number(v) })}
        width={112}
        hint="The grid notes snap to while you draw, move and stretch them. Hold Alt while dragging to place freely."
      />
      {shaping && <ScaleTools scale={scale} />}
      <span className="h-track-used" {...markHint.props}>
        {range && `${positionText(range.from, bar)} to ${positionText(range.to, bar)} · `}
        Paste at {positionText(mark, bar)}
      </span>
      {beginner && (
        <FoldToggles
          row
          folds={[{
            label: LEVEL_NAMES[2],
            open: shaping,
            lit: !!scale,
            hint: 'Shows the scale of the song and Randomise; the lamp lights when the song has a scale.',
            onToggle: () => toggleFold('roll', 2),
          }]}
        />
      )}
    </div>
  );
}

/** One row of the current block as notes over pitch and time, with a lane of velocities underneath. */
export function PianoRoll() {
  const channels = useApp((s) => s.project.channels);
  const pattern = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!);
  const channelId = useApp((s) => s.channelId)!;
  const bar = useApp((s) => barOf(s.project.meter));
  const scale = useApp((s) => s.project.scale);
  const selected = useRoll((s) => s.selected);
  const snap = useRoll((s) => s.snap);
  const mark = useRoll((s) => s.mark);
  const range = useRoll((s) => s.range);
  const deep = useShown()('grid', 3);
  const [draft, setDraft] = useState<Note[] | null>(null);
  const [band, setBand] = useState<Box | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  // A press on the ruler: a click puts the paste mark, a drag chooses a stretch; or the row's end marker is dragged.
  const ruler = useRef<{ kind: 'mark' | 'loop'; x: number; moved: boolean } | null>(null);
  const columns = patternSteps(pattern, bar);
  const ticks = columns * TICKS_PER_STEP;
  const loopSteps = loopOf(pattern, channelId, columns);
  const loop = loopSteps * TICKS_PER_STEP;
  const row = pattern.notes[channelId];
  const channel = channels.find((c) => c.id === channelId)!;

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

  // Open on the notes of the row, or around C3 when it has none.
  useLayoutEffect(() => {
    const el = scroller.current!;
    const pitches = rollRow().notes.map((n) => n.note);
    const centre = pitches.length > 0 ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : ROOT_NOTE;
    const head = el.querySelector<HTMLElement>('.h-roll-head')!.offsetHeight;
    const foot = el.querySelector<HTMLElement>('.h-roll-foot')!.offsetHeight;
    el.scrollTop = Math.round(noteY(centre) + ROW_H / 2 - (el.clientHeight - head - foot) / 2);
  }, [channelId, pattern.id]);

  const finish = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    const { patternId } = rollRow();
    if (g.kind === 'add') {
      const { id: _, ...note } = g.note;
      const id = addNote(patternId, channelId, note);
      if (id) selectNotes([id]);
      if (g.moved) useRoll.setState({ length: note.len });
    } else if (g.kind === 'drag') {
      if (g.moved) {
        const before = useApp.getState().project;
        updateNotes(patternId, channelId, g.next);
        if (useApp.getState().project === before && g.next.some((n, i) => !sameNote(n, g.origin[i]))) {
          setHint('A note is already there, so nothing moved.');
        }
        if (g.part !== 'body') useRoll.setState({ length: g.next.find((n) => n.id === g.grab.id)!.len });
      } else if (useRoll.getState().selected.length > 1) {
        selectNotes([g.grab.id]);
      }
    } else if (!g.moved && g.base.length === 0) {
      selectNotes(g.hit ? [g.hit.id] : []);
    }
    if (g.kind !== 'band') commitGesture();
    setDraft(null);
    setBand(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current || (e.button !== 0 && e.button !== 2)) return;
    const { x, y } = local(sheet.current!, e);
    const { notes } = rollRow();
    if (e.button === 0 && !e.shiftKey && tickAt(x, columns, bar) >= loop) {
      // Past the row's loop nothing is edited; a repeated note leads to the note it repeats.
      e.preventDefault();
      const original = noteAt(notes, tickX(tickAt(x, columns, bar) % loop, bar), y, loop, bar);
      if (original) {
        selectNotes([original.note.id]);
        const el = scroller.current!;
        const left = tickX(original.note.start, bar);
        if (left < el.scrollLeft) el.scrollLeft = left;
      }
      return;
    }
    const hit = noteAt(notes, x, y, ticks, bar);
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 2 || (e.shiftKey && !hit)) {
      const base = e.shiftKey ? selected : [];
      gesture.current = { kind: 'band', x, y, base, hit: hit?.note ?? null, moved: false };
      return;
    }
    if (hit && e.shiftKey) {
      const id = hit.note.id;
      selectNotes(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
      return;
    }
    beginGesture();
    if (hit) {
      const ids = selected.includes(hit.note.id) ? selected : [hit.note.id];
      const origin = notes.filter((n) => ids.includes(n.id));
      selectNotes(ids);
      gesture.current = {
        kind: 'drag', part: hit.part, grab: hit.note, origin, next: origin, x, t: tickAt(x, columns, bar),
        pitch: pitchAt(y), moved: false,
      };
      tap(channelId, hit.note.note, hit.note.vel);
      setHint(describe(hit.note, bar));
      return;
    }
    selectNotes([]);
    const unit = e.altKey ? 1 : snap;
    const start = snapFloor(Math.min(tickAt(x, columns, bar), ticks - 1), unit);
    const len = Math.min(useRoll.getState().length, ticks - start);
    const note = { id: NEW, start, len, note: snapPitch(pitchAt(y)), vel: 0.8 };
    gesture.current = { kind: 'add', note, x, moved: false };
    setDraft([note]);
    tap(channelId, note.note, note.vel);
    setHint(describe(note, bar));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const { x, y } = local(sheet.current!, e);
    const t = tickAt(x, columns, bar);
    if (!g) {
      const hit = noteAt(rollRow().notes, x, y, ticks, bar);
      const where = positionText(snapFloor(Math.min(t, ticks - 1), snap), bar);
      setHint(t >= loop ? HINTS.repeat : hit ? HINTS[hit.part] : `${noteName(pitchAt(y))} at ${where}. ${HINTS.empty}`);
      return;
    }
    const unit = e.altKey ? 1 : snap;
    if (g.kind === 'add') {
      g.moved ||= Math.abs(x - g.x) > STILL_PX;
      if (!g.moved) return;
      g.note = { ...g.note, len: drawnLength(g.note.start, t, unit, ticks) };
      setDraft([g.note]);
      setHint(describe(g.note, bar));
    } else if (g.kind === 'drag') {
      const pitch = g.part === 'body' ? pitchAt(y) - g.pitch : 0;
      g.moved ||= Math.abs(x - g.x) > STILL_PX || pitch !== 0;
      if (!g.moved) return;
      const moved = dragNotes(g.origin, g.grab, g.part, t - g.t, pitch, unit, ticks);
      // Moved up or down, every note lands on the scale while Snap to Scale is on.
      const next = pitch === 0 ? moved : moved.map((n) => ({ ...n, note: snapPitch(n.note) }));
      const lead = next.find((n) => n.id === g.grab.id)!;
      if (lead.note !== g.next.find((n) => n.id === g.grab.id)!.note) tap(channelId, lead.note, lead.vel);
      g.next = next;
      setDraft(next);
      setHint(describe(lead, bar));
    } else {
      g.moved ||= Math.abs(x - g.x) > STILL_PX || Math.abs(y - g.y) > STILL_PX;
      if (!g.moved) return;
      const box = { left: Math.min(x, g.x), top: Math.min(y, g.y), right: Math.max(x, g.x), bottom: Math.max(y, g.y) };
      const ids = notesIn(rollRow().notes, box, ticks, bar);
      selectNotes([...g.base, ...ids.filter((id) => !g.base.includes(id))]);
      setBand(box);
      setHint(`${noteName(pitchAt(y))} at ${positionText(Math.min(t, ticks - 1), bar)}`);
    }
  };

  const rulerX = (e: ReactPointerEvent) => local(scroller.current!.querySelector('.h-roll-head .h-track-box')!, e).x;
  const rulerUp = () => {
    const r = ruler.current;
    if (!r) return;
    ruler.current = null;
    if (r.kind === 'loop') commitGesture();
    else if (!r.moved) {
      useRoll.setState({ mark: snapFloor(Math.min(tickAt(r.x, columns, bar), ticks - 1), snap), range: null });
    }
  };

  const shown = withDraft(row ?? [], draft).filter((n) => n.start < ticks);
  const width = laneWidth(columns, bar);
  return (
    <Well className="h-track-grid h-roll">
      <div ref={scroller} className="h-track-scroll h-roll-scroll" data-tour="roll">
        <div className="h-roll-head">
          <div
            onPointerDown={(e) => {
              const x = rulerX(e);
              if (e.button !== 0 || x < 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const onLoop = !!(e.target as Element).closest('.h-roll-loop');
              ruler.current = { kind: onLoop ? 'loop' : 'mark', x, moved: false };
              if (onLoop) beginGesture();
            }}
            onPointerMove={(e) => {
              const r = ruler.current;
              if (!r) {
                setHint((e.target as Element).closest('.h-roll-loop') ? LOOP_HINT : RULER_HINT);
                return;
              }
              const x = rulerX(e);
              r.moved ||= Math.abs(x - r.x) > STILL_PX;
              if (r.kind === 'loop') {
                const steps = loopAt(x, columns, bar);
                setRowLoop(pattern.id, channelId, steps);
                setHint(`This row plays ${steps} ${steps === 1 ? 'step' : 'steps'}, then starts again.`);
              } else if (r.moved) {
                const from = snapFloor(tickAt(Math.min(x, r.x), columns, bar), snap);
                const end = snapCeil(tickAt(Math.max(x, r.x), columns, bar), snap);
                const to = Math.min(ticks, Math.max(from + snap, end));
                useRoll.setState({ range: { from, to } });
                setHint(`From ${positionText(from, bar)} to ${positionText(to, bar)}`);
              }
            }}
            onPointerUp={rulerUp}
            onLostPointerCapture={rulerUp}
            onPointerLeave={() => !ruler.current && setHint(null)}
          >
            <Ruler columns={columns} bar={bar}>
              {range && (
                <i
                  className="h-roll-range"
                  style={{ left: tickX(range.from, bar), width: endX(range.to, bar) - tickX(range.from, bar) }}
                />
              )}
              {mark < ticks && (
                <span className="h-roll-mark" style={{ left: tickX(mark, bar) - 3 }}>
                  <SpriteImage sprite={PASTE_MARK} />
                </span>
              )}
              {(deep || pattern.loops) && <i className="h-roll-loop" style={{ left: endX(loop, bar) - 4 }} />}
            </Ruler>
          </div>
          {channels.map((c) => (
            <Overview
              key={c.id}
              channel={c}
              notes={pattern.notes[c.id]}
              columns={columns}
              bar={bar}
              active={c.id === channelId}
            />
          ))}
        </div>
        <div className="h-roll-body">
          <Keys channelId={channelId} root={scale?.root ?? null} />
          <div className="h-roll-sheet">
            <div
              ref={sheet}
              className="h-roll-notes"
              style={{
                width: laneWidth(columns, bar),
                height: SHEET_H,
                ...sheetBackground(snap, bar, scale),
                '--cell': `var(--c${channel.color})`,
              } as CSSProperties}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finish}
              onLostPointerCapture={finish}
              onPointerLeave={() => !gesture.current && setHint(null)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <i className="h-roll-now" />
              {loop < ticks && (
                <i className="h-roll-beyond" style={{ left: endX(loop, bar), width: width - endX(loop, bar) }} />
              )}
              <Notes notes={shown} selected={selected} ticks={ticks} loop={loop} bar={bar} width={width} />
              {band && (
                <i
                  className="h-roll-band"
                  style={{
                    left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top,
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <Velocities notes={shown} selected={selected} columns={columns} bar={bar} channelId={channelId} />
      </div>
    </Well>
  );
}

/**
 * The notes of the row, with a line from each held one to the end of the block, drawn under all the notes. A row
 * with a loop of its own repeats the notes inside it, dimmed, up to the end of the block, and strikes out those after.
 */
const Notes = memo(function Notes({ notes, selected, ticks, loop, bar, width: sheet }: {
  notes: Note[];
  selected: readonly string[];
  ticks: number;
  loop: number;
  bar: Bar;
  width: number;
}) {
  const boxes = new Map(notes.map((n) => [n.id, noteBox(n, ticks, bar)]));
  const live = notes.filter((n) => n.start < loop);
  const repeats = live.flatMap((n) => Array.from({ length: Math.ceil((ticks - n.start) / loop) - 1 }, (_, k) =>
    ({ ...n, start: n.start + (k + 1) * loop })));
  return (
    <>
      {repeats.map((n) => {
        const box = noteBox(n, ticks, bar);
        return (
          <i
            key={`${n.id}@${n.start}`}
            className="h-roll-note is-repeat"
            style={{ left: box.left, top: box.top, width: box.right - box.left }}
          />
        );
      })}
      {live.filter((n) => n.hold && boxes.get(n.id)!.right < sheet).map((n) => {
        const { right, top } = boxes.get(n.id)!;
        return <i key={`hold${n.id}`} className="h-roll-hold" style={{ left: right, top, width: sheet - right }} />;
      })}
      {notes.map((n) => {
        const box = boxes.get(n.id)!;
        const width = box.right - box.left;
        const style = {
          left: box.left, top: box.top, width, '--shade': `${Math.round(30 + 70 * n.vel)}%`,
        } as CSSProperties;
        return (
          <div
            key={n.id}
            className={cx(
              'h-roll-note', selected.includes(n.id) && 'is-selected', markClass([n]), n.start >= loop && 'is-silent',
            )}
            style={style}
          >
            {width >= 24 && noteName(n.note)}
            <Marks notes={[n]} width={width} />
          </div>
        );
      })}
    </>
  );
});

/** A thin row per sound above the roll, showing where its notes are; click one to edit that sound. */
const Overview = memo(function Overview({ channel, notes, columns, bar, active }: {
  channel: Channel;
  notes: Note[] | undefined;
  columns: number;
  bar: Bar;
  active: boolean;
}) {
  const hover = useHint(`${channel.sound.name}. Click to show this sound in the piano roll.`);
  const ticks = columns * TICKS_PER_STEP;
  return (
    <div
      className={cx('h-roll-mini', active && 'is-active')}
      onPointerDown={() => selectChannel(channel.id)}
      {...hover.props}
    >
      <span className="h-roll-mini-name">{channel.sound.name}</span>
      <div className="h-roll-mini-lane">
        <div
          className="h-roll-mini-box"
          style={{
            width: laneWidth(columns, bar), ...gapsBackground(bar), '--cell': `var(--c${channel.color})`,
          } as CSSProperties}
        >
          {(notes ?? []).filter((n) => n.start < ticks).map((n) => {
            const end = n.hold ? ticks : Math.min(n.start + n.len, ticks);
            const left = tickX(n.start, bar);
            return <i key={n.id} className="h-roll-mini-note" style={{ left, width: endX(end, bar) - left }} />;
          })}
        </div>
      </div>
    </div>
  );
});

/** The piano down the left edge, the scale's root keys marked: click or drag over the keys to hear the sound. */
const Keys = memo(function Keys({ channelId, root }: { channelId: string; root: number | null }) {
  const [down, setDown] = useState<number | null>(null);
  const hover = useHint('Click or drag over the keys to hear the sound at each pitch.');
  const play = (note: number) => {
    setDown(note);
    tap(channelId, note);
  };
  const keys = [];
  for (let note = MAX_NOTE; note >= MIN_NOTE; note--) {
    keys.push(
      <div
        key={note}
        className={cx('h-roll-key', isBlackKey(note) ? 'is-black' : 'is-white', note % 12 === 0 && 'is-c',
          note % 12 === 5 && 'is-f', down === note && 'is-down', root === note % 12 && 'is-root')}
      >
        {note % 12 === 0 && noteName(note)}
      </div>,
    );
  }
  return (
    <div
      className="h-roll-keys"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        play(pitchAt(local(e.currentTarget, e).y));
      }}
      onPointerMove={(e) => {
        const note = pitchAt(local(e.currentTarget, e).y);
        if (down !== null && note !== down) play(note);
      }}
      onLostPointerCapture={() => setDown(null)}
      {...hover.props}
    >
      {keys}
    </div>
  );
});

/** The velocity lane: one bar per note at its start, as high as the note is loud. Drag over them to set them. */
function Velocities({ notes, selected, columns, bar, channelId }: {
  notes: Note[];
  selected: readonly string[];
  columns: number;
  bar: Bar;
  channelId: string;
}) {
  const active = useRef(false);
  const hover = useHint('Drag a bar up or down to set how hard its notes play; drag sideways to set several in turn.');
  const range = VEL_H - VEL_TOP - 1;
  const set = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { x, y } = local(e.currentTarget, e);
    const group = velocityGroup(rollRow().notes, useRoll.getState().selected, x, bar);
    if (group.length === 0) return;
    const vel = clamp(Math.round(((VEL_H - 1 - y) / range) * 100) / 100, 0, 1);
    setNotesVelocity(rollRow().patternId, channelId, group.map((n) => n.id), vel);
    setHint(`Velocity ${Math.round(vel * 100)} %`);
  };
  const end = () => {
    if (!active.current) return;
    active.current = false;
    commitGesture();
  };
  const order = [...notes.filter((n) => !selected.includes(n.id)), ...notes.filter((n) => selected.includes(n.id))];
  return (
    <div className="h-roll-foot">
      <span className="h-roll-foot-name">VELOCITY</span>
      <div className="h-roll-vel-lane">
        <div
          className="h-roll-vel-box"
          style={{ width: laneWidth(columns, bar) }}
          onPointerDown={(e) => {
            if (e.button !== 0 || active.current) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            active.current = true;
            beginGesture();
            set(e);
          }}
          onPointerMove={(e) => active.current && set(e)}
          onPointerUp={end}
          onLostPointerCapture={end}
          {...hover.props}
        >
          {order.map((n) => (
            <i
              key={n.id}
              className={cx('h-roll-vel', selected.includes(n.id) && 'is-selected')}
              style={{ left: tickX(n.start, bar), height: Math.max(2, Math.round(n.vel * range) + 1) }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
