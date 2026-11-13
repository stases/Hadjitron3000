import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { tap } from '../../app/audio';
import { addSound } from '../../app/commands';
import { STEPS_PER_BAR } from '../../core/defaults';
import { OUT, paramSpec } from '../../core/modules';
import type { FloatSpec } from '../../core/modules';
import { MAX_NOTE, MIN_NOTE, ROOT_NOTE, noteName } from '../../core/notes';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import { patternSteps } from '../../core/sequencer';
import type { Channel, Step } from '../../core/types';
import {
  duplicateChannel, moveChannel, patchStep, removeChannel, selectChannel, selectStep, setChannel, setParam, setStep,
  setView, useApp,
} from '../../state/store';
import { Button, Icon, Led, Slider, Well, openMenu, setHint, useHint } from '../kit';
import { cx } from '../kit/cx';
import { SpriteImage } from '../kit/Icon';
import { getHeard, subscribeHeard, useHeard } from './playhead';
import type { Heard } from './playhead';
import type { Cells } from './steps';
import { CELL_W, cellX, columnAt, lastNote, laneWidth, maxLength, rememberNote, spanWidth, stepOver } from './steps';

const LEVEL = paramSpec(OUT, 'level') as FloatSpec;
const PITCH_PX = 4;
const EDGE_PX = 5;
const STILL_PX = 3;
const NEW_VEL = 0.8;
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
  edge: 'Drag this edge sideways to make the step longer or shorter.',
};

/** The step being edited by the pointer, drawn from here until the gesture ends and the store takes it. */
interface Draft {
  channelId: string;
  index: number;
  step: Step;
}

interface Gesture extends Draft {
  mode: 'press' | 'paint' | 'pitch' | 'length';
  created: boolean;
  base: number;
  laneLeft: number;
  x: number;
  y: number;
  moved: boolean;
  painted: number;
}

interface Hit {
  channelId: string;
  patternId: string;
  cells: Cells | undefined;
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
  const cells = pattern.cells[channelId];
  const laneLeft = lane.firstElementChild!.getBoundingClientRect().left;
  const x = clientX - laneLeft;
  const column = columnAt(x, patternSteps(pattern));
  const start = column < 0 ? -1 : stepOver(cells, column);
  return { channelId, patternId: pattern.id, cells, x, column, start, laneLeft };
}

const onEdge = (hit: Hit) =>
  hit.start >= 0 && hit.x >= cellX(hit.start) + spanWidth(hit.start, hit.cells![hit.start].len) - EDGE_PX;

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
      const step = hit.cells![hit.start];
      const vel = clamp(Math.round((step.vel - Math.sign(e.deltaY) * WHEEL_VEL) * 100) / 100, 0, 1);
      selectStep({ channelId: hit.channelId, index: hit.start });
      patchStep(hit.patternId, hit.channelId, hit.start, { vel });
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
    const step = created ? { note: lastNote(hit.channelId), vel: NEW_VEL, len: 1 } : hit.cells![index];
    const g: Gesture = {
      channelId: hit.channelId, index, step, created, base: step.note,
      mode: !created && onEdge(hit) ? 'length' : 'press',
      laneLeft: hit.laneLeft, x: e.clientX, y: e.clientY, moved: false, painted: index,
    };
    gesture.current = g;
    selectStep({ channelId: g.channelId, index });
    if (created) {
      setDraft(g);
      tap(g.channelId, step.note, step.vel);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) {
      const hit = hitTest(e.target, e.clientX);
      setHint(!hit || hit.column < 0 ? null : hit.start < 0 ? HINTS.empty : onEdge(hit) ? HINTS.edge : HINTS.step);
      return;
    }
    const pattern = currentPattern();
    const patternId = pattern.id;
    const n = patternSteps(pattern);
    const column = clamp(columnAt(clamp(e.clientX - g.laneLeft, 0, laneWidth(n) - 1), n), 0, n - 1);
    const dy = g.y - e.clientY;
    if (g.mode === 'press') {
      if (Math.abs(dy) >= PITCH_PX) g.mode = 'pitch';
      else if (g.created && column !== g.index) {
        g.mode = 'paint';
        setStep(patternId, g.channelId, g.index, g.step);
        setDraft(null);
      } else if (Math.abs(e.clientX - g.x) > STILL_PX) g.moved = true;
    }
    if (g.mode === 'pitch') {
      const note = clamp(g.base + Math.trunc(dy / PITCH_PX), MIN_NOTE, MAX_NOTE);
      if (note !== g.step.note) {
        g.step = { ...g.step, note };
        setDraft({ ...g });
        tap(g.channelId, note, g.step.vel);
      }
      setHint(noteName(note));
    } else if (g.mode === 'length') {
      const len = clamp(column - g.index + 1, 1, maxLength(pattern.cells[g.channelId], g.index, n));
      if (len !== g.step.len) {
        g.step = { ...g.step, len };
        setDraft({ ...g });
      }
      setHint(`Length ${len}`);
    } else if (g.mode === 'paint') {
      const dir = Math.sign(column - g.painted);
      for (let c = g.painted + dir; dir !== 0 && c !== column + dir; c += dir) {
        if (stepOver(currentPattern().cells[g.channelId], c) >= 0) continue;
        setStep(patternId, g.channelId, c, { ...g.step });
        tap(g.channelId, g.step.note, g.step.vel);
      }
      g.painted = column;
    }
  };

  const finish = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    const patternId = currentPattern().id;
    if (g.created && (g.mode === 'press' || g.mode === 'pitch')) {
      setStep(patternId, g.channelId, g.index, g.step);
    } else if (g.mode === 'press' && !g.moved) {
      setStep(patternId, g.channelId, g.index, null);
      selectStep(null);
    } else if (g.mode === 'pitch') {
      patchStep(patternId, g.channelId, g.index, { note: g.step.note });
    } else if (g.mode === 'length') {
      patchStep(patternId, g.channelId, g.index, { len: g.step.len });
    }
    if (g.created || g.mode === 'pitch') rememberNote(g.channelId, g.step.note);
    setDraft(null);
    setHint(null);
  };

  return (
    <Well className="h-track-grid">
      <div
        ref={scroller}
        className="h-track-scroll"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onLostPointerCapture={finish}
        onPointerLeave={() => !gesture.current && setHint(null)}
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
            cells={pattern.cells[channel.id]}
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
function followPage(el: HTMLElement, heard: Heard): void {
  const head = el.querySelector<HTMLElement>('.h-track-corner')?.offsetWidth ?? 0;
  const x = cellX(heard.step) + LANE_PAD;
  const view = el.clientWidth - head;
  if (x >= el.scrollLeft && x + CELL_W <= el.scrollLeft + view) return;
  el.scrollLeft = cellX(heard.step - (heard.step % STEPS_PER_BAR));
}

const Ruler = memo(function Ruler({ columns }: { columns: number }) {
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
        </div>
      </div>
    </div>
  );
});

interface RowProps {
  channel: Channel;
  index: number;
  cells: Cells | undefined;
  columns: number;
  active: boolean;
  selected: number;
  draft: Draft | null;
}

const Row = memo(function Row({ channel, index, cells, columns, active, selected, draft }: RowProps) {
  const shown: Record<number, Step> = { ...cells };
  if (draft) shown[draft.index] = draft.step;
  // Steps left past the end when the pattern was shortened stay in the document but are not drawn.
  const keys = Object.keys(shown).map(Number).filter((i) => i < columns);
  const span = (i: number) => spanWidth(i, Math.min(shown[i].len, columns - i));
  return (
    <div className="h-track-row">
      <Header channel={channel} index={index} active={active} />
      <div className="h-track-lane" data-channel={channel.id}>
        <div
          className="h-track-box"
          style={{ width: laneWidth(columns), '--cell': `var(--c${channel.color})` } as CSSProperties}
        >
          <EmptyCells columns={columns} />
          <i className="h-track-now" />
          {keys.map((i) => (
            <StepKey key={i} index={i} step={shown[i]} width={span(i)} />
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

function StepKey({ index, step, width }: { index: number; step: Step; width: number }) {
  const style = { left: cellX(index), width, '--lit': `${Math.round(step.vel * CELL_H)}px` } as CSSProperties;
  return (
    <div className={cx('h-track-step', width > CELL_W && 'is-long')} style={style}>
      {step.note !== ROOT_NOTE && noteName(step.note)}
    </div>
  );
}

function Lamp({ channelId, color }: { channelId: string; color: number }) {
  const on = useHeard((heard) => {
    if (!heard) return false;
    const cells = useApp.getState().project.patterns.find((p) => p.id === heard.patternId)?.cells[channelId];
    return stepOver(cells, heard.step) >= 0;
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
