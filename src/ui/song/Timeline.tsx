import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { position } from '../../app/audio';
import { openDialog } from '../../app/dialogStore';
import { usePrefs } from '../../app/prefs';
import { MAX_SONG_BARS, SONG_LANES } from '../../core/defaults';
import { barOf } from '../../core/meter';
import { OUT, paramSpec } from '../../core/modules';
import type { FloatSpec } from '../../core/modules';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import { songBars } from '../../core/sequencer';
import type { Lane, Placement } from '../../core/types';
import {
  addPlacement, beginGesture, commitGesture, duplicatePlacement, movePlacement, removePlacement, resizePlacement,
  selectPlacement, setLane, setPlacementFades, useApp,
} from '../../state/store';
import { useShown } from '../factory/levels';
import { Button, Slider, Well, openMenu, setHint, useHint } from '../kit';
import { SpriteImage } from '../kit/Icon';
import { barWidth, openInTrack, placementText, room } from './song';
import { Tile } from './Tile';

/** Empty bars the timeline always shows after the end of the song. */
const SPARE_BARS = 16;
const PAD = 4;
const DOUBLE_CLICK_MS = 800;

const MARKER = {
  rows: ['aaaaa', '.aaa.', '..a..'],
  colors: { a: 'var(--amber)' },
};

const LANES = Array.from({ length: SONG_LANES }, (_, i) => i);

interface Gesture {
  id: string;
  mode: 'move' | 'resize' | 'fadeIn' | 'fadeOut';
  grab: number;
  /** The fades when the gesture began, which a resize gives back as far as they fit. */
  fades: [number, number];
}

/** A lane's level has the range and taper of a sound's output level. */
const LEVEL = paramSpec(OUT, 'level') as FloatSpec;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const findPlacement = (id: string | null) => useApp.getState().project.song.find((p) => p.id === id);

const patternName = (id: string) => useApp.getState().project.patterns.find((p) => p.id === id)?.name ?? '';

const bars = (n: number) => `${n} ${n === 1 ? 'bar' : 'bars'}`;

function tileMenu(placement: Placement) {
  const { song } = useApp.getState().project;
  return [
    { label: 'Edit in Track', onSelect: () => openInTrack(placement.pattern) },
    { label: 'Sounds...', onSelect: () => openDialog({ kind: 'sounds', placementId: placement.id }) },
    {
      label: 'Duplicate',
      disabled: room(song, placement) === placement.bars,
      onSelect: () => duplicatePlacement(placement.id),
    },
    'separator' as const,
    { label: 'Remove', onSelect: () => removePlacement(placement.id) },
  ];
}

export function Timeline() {
  const song = useApp((s) => s.project.song);
  const patterns = useApp((s) => s.project.patterns);
  const channels = useApp((s) => s.project.channels);
  const patternId = useApp((s) => s.patternId);
  const placementId = useApp((s) => s.placementId);
  const length = useApp((s) => songBars(s.project));
  const lanes = useApp((s) => s.project.lanes);
  const following = useApp((s) => s.playing && s.scope === 'song');
  const bar = useApp((s) => barOf(s.project.meter));
  const beginner = usePrefs((p) => p.beginner);
  const shaping = useShown()('placement', 2);
  const w = barWidth(bar);
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const added = useRef<{ id: string | null; time: number }>({ id: null, time: 0 });
  const [fit, setFit] = useState(0);
  const count = Math.min(MAX_SONG_BARS, Math.ceil(Math.max(fit, length + SPARE_BARS) / 4) * 4);

  useEffect(() => {
    const el = scroller.current!;
    const observer = new ResizeObserver(() => setFit(Math.ceil(el.clientWidth / w)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [w]);

  useEffect(() => {
    const el = scroller.current!;
    if (!following) return;
    let shown = -1;
    let frame = requestAnimationFrame(function poll() {
      frame = requestAnimationFrame(poll);
      const steps = songBars(useApp.getState().project) * bar.steps;
      const pos = position();
      const x = pos < 0 || steps === 0 ? -1 : Math.floor(((pos % steps) * w) / bar.steps);
      if (x === shown) return;
      shown = x;
      if (x < 0) {
        delete el.dataset.now;
        return;
      }
      el.dataset.now = '';
      el.style.setProperty('--h-song-now', `${x}px`);
      const head = el.querySelector<HTMLElement>('.h-song-corner')!.offsetWidth;
      if (x + PAD < el.scrollLeft || x + PAD >= el.scrollLeft + el.clientWidth - head) {
        el.scrollLeft = x - (x % w);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      delete el.dataset.now;
    };
  }, [following, bar, w]);

  /** The bar and lane under a point, from the first lane's box and the rows' rectangles. */
  const locate = (clientX: number, clientY: number) => {
    const lanes = scroller.current!.querySelectorAll('.h-song-lane .h-song-box');
    const boxes = [...lanes].map((box) => box.getBoundingClientRect());
    const x = clientX - boxes[0].left;
    const lane = boxes.findIndex((r) => clientY < r.bottom + 3);
    return { bar: Math.floor(x / w), lane: lane < 0 ? SONG_LANES - 1 : lane, x };
  };

  /** Scroll just enough to show the whole placement. */
  const reveal = (placement: Placement) => {
    const el = scroller.current!;
    const head = el.querySelector<HTMLElement>('.h-song-corner')!.offsetWidth;
    const left = placement.bar * w;
    const right = left + placement.bars * w + PAD * 2;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth - head) el.scrollLeft = right - el.clientWidth + head;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (!target.closest('.h-song-lane')) return;
    scroller.current!.focus({ preventScroll: true });
    if (e.button !== 0) return;
    e.preventDefault();
    const tile = target.closest<HTMLElement>('.h-song-tile');
    const { bar, lane } = locate(e.clientX, e.clientY);
    let g: Gesture;
    beginGesture();
    if (tile) {
      const placement = findPlacement(tile.dataset.id!)!;
      selectPlacement(placement.id);
      const mode = target.closest('.h-song-fade.is-in') ? 'fadeIn' : target.closest('.h-song-fade.is-out') ? 'fadeOut'
        : target.closest('.h-song-edge') ? 'resize' : 'move';
      const fades: [number, number] = [placement.fadeIn ?? 0, placement.fadeOut ?? 0];
      g = { id: placement.id, mode, grab: bar - placement.bar, fades };
    } else {
      const id = addPlacement(patternId, lane, bar);
      if (!id) {
        commitGesture();
        return;
      }
      added.current = { id, time: e.timeStamp };
      g = { id, mode: 'move', grab: 0, fades: [0, 0] };
    }
    gesture.current = g;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (g.mode !== 'move') e.currentTarget.dataset.resizing = '';
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) {
      hover(e.target as Element);
      return;
    }
    const placement = findPlacement(g.id);
    if (!placement) return;
    const { bar, lane, x } = locate(e.clientX, e.clientY);
    const name = patternName(placement.pattern);
    if (g.mode === 'move') {
      const to = clamp(bar - g.grab, 0, MAX_SONG_BARS - placement.bars);
      if (to !== placement.bar || lane !== placement.lane) movePlacement(g.id, lane, to);
      const moved = findPlacement(g.id)!;
      setHint(`${placementText(name, moved)}, lane ${moved.lane + 1}`);
    } else if (g.mode === 'resize') {
      resizePlacement(g.id, Math.max(1, Math.round(x / w) - placement.bar));
      setPlacementFades(g.id, ...g.fades);
      setHint(`${name} · ${bars(findPlacement(g.id)!.bars)}`);
    } else {
      const { fadeIn = 0, fadeOut = 0 } = placement;
      const at = Math.round(x / w);
      if (g.mode === 'fadeIn') setPlacementFades(g.id, Math.min(at - placement.bar, placement.bars - fadeOut), fadeOut);
      else setPlacementFades(g.id, fadeIn, Math.min(placement.bar + placement.bars - at, placement.bars - fadeIn));
      const faded = findPlacement(g.id)!;
      setHint(g.mode === 'fadeIn' ? `${name} · fade in over ${bars(faded.fadeIn ?? 0)}`
        : `${name} · fade out over ${bars(faded.fadeOut ?? 0)}`);
    }
  };

  const hover = (target: Element) => {
    const tile = target.closest<HTMLElement>('.h-song-tile');
    const placement = tile && findPlacement(tile.dataset.id!);
    if (placement) {
      const name = patternName(placement.pattern);
      setHint(
        target.closest('.h-song-fade.is-in')
          ? `Drag this corner into the tile to fade ${name} in from silence, a bar at a time.`
          : target.closest('.h-song-fade.is-out')
            ? `Drag this corner into the tile to fade ${name} out to silence at its end, a bar at a time.`
            : target.closest('.h-song-edge')
              ? `Drag this edge sideways to make ${name} longer or shorter.`
              : `${name}: drag it to move it, double-click to edit it in the Track, right-click for more.`,
      );
    } else if (target.closest('.h-song-lane')) {
      const name = patternName(useApp.getState().patternId);
      setHint(`Click to place ${name} here; keep the button down to drag it into place.`);
    } else if (!target.closest('.h-song-ruler, .h-song-head')) {
      setHint(null);
    }
  };

  const finish = () => {
    if (!gesture.current) return;
    gesture.current = null;
    commitGesture();
    delete scroller.current!.dataset.resizing;
    setHint(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const placement = findPlacement(useApp.getState().placementId);
    if (!placement) return;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    if (e.key in move) {
      const [lane, bar] = move[e.key];
      movePlacement(placement.id, placement.lane + lane, placement.bar + bar);
      reveal(findPlacement(placement.id)!);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      removePlacement(placement.id);
    } else if (e.key === 'Escape') {
      selectPlacement(null);
    } else return;
    e.preventDefault();
  };

  const byLane = LANES.map((lane) => song.filter((p) => p.lane === lane));
  return (
    <Well className="h-song-timeline">
      <div
        ref={scroller}
        className="h-song-scroll"
        style={{ '--h-song-cell': `${w - 2}px` } as CSSProperties}
        data-tour="timeline"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onLostPointerCapture={finish}
        onPointerLeave={() => !gesture.current && setHint(null)}
        onDoubleClick={(e) => {
          // The pointer is captured, so the event goes to the scroller rather than to the tile under it.
          const under = document.elementFromPoint(e.clientX, e.clientY);
          const id = under?.closest<HTMLElement>('.h-song-tile')?.dataset.id;
          const placement = findPlacement(id ?? null);
          // The second click of a double-click on an empty bar lands on the tile the first one placed.
          const placed = id === added.current.id && e.timeStamp - added.current.time < DOUBLE_CLICK_MS;
          if (placement && !placed) openInTrack(placement.pattern);
        }}
        onContextMenu={(e) => {
          if (!(e.target as Element).closest('.h-song-lane')) return;
          e.preventDefault();
          const id = (e.target as Element).closest<HTMLElement>('.h-song-tile')?.dataset.id;
          const placement = findPlacement(id ?? null);
          if (!placement) return;
          selectPlacement(placement.id);
          openMenu(tileMenu(placement), e.clientX, e.clientY);
        }}
      >
        <Ruler count={count} width={w} />
        {LANES.map((lane) => (
          <div key={lane} className="h-song-row">
            <LaneHead lane={lane} state={lanes[lane]} />
            <div className="h-song-lane">
              <div className="h-song-box" style={{ width: count * w - 2 }}>
                <Cells count={count} />
                {byLane[lane].map((placement) => {
                  const pattern = patterns.find((p) => p.id === placement.pattern)!;
                  return (
                    <Tile
                      key={placement.id}
                      placement={placement}
                      pattern={pattern}
                      channels={channels}
                      bar={bar}
                      selected={placement.id === placementId}
                      current={pattern.id === patternId}
                      handles={!beginner || shaping || !!placement.fadeIn || !!placement.fadeOut}
                    />
                  );
                })}
                <i className="h-song-now" />
                {lane === 0 && song.length === 0 && (
                  <p className="h-song-empty">Pick a block on the left, then click a bar of a lane to put it there.</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Well>
  );
}

const Ruler = memo(function Ruler({ count, width }: { count: number; width: number }) {
  const hint = useHint('The bars of the song. While the song plays, the amber marker shows where it is.');
  return (
    <div className="h-song-ruler" {...hint.props}>
      <div className="h-song-corner" />
      <div className="h-song-ticks">
        <div className="h-song-box" style={{ width: count * width - 2 }}>
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className="h-song-tick">
              {i % 4 === 0 && i + 1}
            </span>
          ))}
          <span className="h-song-marker">
            <SpriteImage sprite={MARKER} />
          </span>
        </div>
      </div>
    </div>
  );
});

/** The head of a lane: its number, a mute button and its level, for everything the lane plays. */
const LaneHead = memo(function LaneHead({ lane, state }: { lane: number; state: Lane }) {
  const hint = useHint(`Lane ${lane + 1}. Blocks in different lanes play at the same time.`);
  const level = formatValue(LEVEL, state.level);
  return (
    <div className="h-song-head">
      <span className="h-song-number" {...hint.props}>
        {lane + 1}
      </span>
      <Button
        small
        pressed={state.mute}
        onClick={() => setLane(lane, { mute: !state.mute })}
        hint={`Mute: silence everything in lane ${lane + 1}.`}
      >
        M
      </Button>
      <Slider
        small
        length={44}
        value={toNorm(LEVEL, state.level)}
        onChange={(t) => {
          const db = fromNorm(LEVEL, t);
          setLane(lane, { level: db });
          setHint(`Lane ${lane + 1}: ${formatValue(LEVEL, db)}`);
        }}
        hint={`How loud lane ${lane + 1} is (${level}). Drag left for softer, right for louder; far left is silence.`}
      />
    </div>
  );
});

const Cells = memo(function Cells({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <i key={i} className="h-song-cell" />);
});
