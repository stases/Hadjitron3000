import { memo, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { position } from '../../app/audio';
import { MAX_SONG_BARS, SONG_LANES, STEPS_PER_BAR } from '../../core/defaults';
import { songBars } from '../../core/sequencer';
import type { Placement } from '../../core/types';
import {
  addPlacement, beginGesture, commitGesture, duplicatePlacement, movePlacement, removePlacement, resizePlacement,
  selectPlacement, useApp,
} from '../../state/store';
import { Well, openMenu, setHint, useHint } from '../kit';
import { SpriteImage } from '../kit/Icon';
import { BAR_W, openInTrack, placementText, room } from './song';
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
  mode: 'move' | 'resize';
  grab: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const findPlacement = (id: string | null) => useApp.getState().project.song.find((p) => p.id === id);

const patternName = (id: string) => useApp.getState().project.patterns.find((p) => p.id === id)?.name ?? '';

const bars = (n: number) => `${n} ${n === 1 ? 'bar' : 'bars'}`;

function tileMenu(placement: Placement) {
  const { song } = useApp.getState().project;
  return [
    { label: 'Edit in Track', onSelect: () => openInTrack(placement.pattern) },
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
  const following = useApp((s) => s.playing && s.scope === 'song');
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const added = useRef<{ id: string | null; time: number }>({ id: null, time: 0 });
  const [fit, setFit] = useState(0);
  const count = Math.min(MAX_SONG_BARS, Math.ceil(Math.max(fit, length + SPARE_BARS) / 4) * 4);

  useEffect(() => {
    const el = scroller.current!;
    const observer = new ResizeObserver(() => setFit(Math.ceil(el.clientWidth / BAR_W)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = scroller.current!;
    if (!following) return;
    let shown = -1;
    let frame = requestAnimationFrame(function poll() {
      frame = requestAnimationFrame(poll);
      const steps = songBars(useApp.getState().project) * STEPS_PER_BAR;
      const pos = position();
      const x = pos < 0 || steps === 0 ? -1 : Math.floor(((pos % steps) * BAR_W) / STEPS_PER_BAR);
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
        el.scrollLeft = x - (x % BAR_W);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      delete el.dataset.now;
    };
  }, [following]);

  /** The bar and lane under a point, from the first lane's box and the rows' rectangles. */
  const locate = (clientX: number, clientY: number) => {
    const lanes = scroller.current!.querySelectorAll('.h-song-lane .h-song-box');
    const boxes = [...lanes].map((box) => box.getBoundingClientRect());
    const bar = Math.floor((clientX - boxes[0].left) / BAR_W);
    const lane = boxes.findIndex((r) => clientY < r.bottom + 3);
    return { bar, lane: lane < 0 ? SONG_LANES - 1 : lane, x: clientX - boxes[0].left };
  };

  /** Scroll just enough to show the whole placement. */
  const reveal = (placement: Placement) => {
    const el = scroller.current!;
    const head = el.querySelector<HTMLElement>('.h-song-corner')!.offsetWidth;
    const left = placement.bar * BAR_W;
    const right = left + placement.bars * BAR_W + PAD * 2;
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
      g = { id: placement.id, mode: target.closest('.h-song-edge') ? 'resize' : 'move', grab: bar - placement.bar };
    } else {
      const id = addPlacement(patternId, lane, bar);
      if (!id) {
        commitGesture();
        return;
      }
      added.current = { id, time: e.timeStamp };
      g = { id, mode: 'move', grab: 0 };
    }
    gesture.current = g;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (g.mode === 'resize') e.currentTarget.dataset.resizing = '';
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
    } else {
      resizePlacement(g.id, Math.max(1, Math.round(x / BAR_W) - placement.bar));
      setHint(`${name} · ${bars(findPlacement(g.id)!.bars)}`);
    }
  };

  const hover = (target: Element) => {
    const tile = target.closest<HTMLElement>('.h-song-tile');
    const placement = tile && findPlacement(tile.dataset.id!);
    if (placement) {
      const name = patternName(placement.pattern);
      setHint(
        target.closest('.h-song-edge')
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
        <Ruler count={count} />
        {LANES.map((lane) => (
          <div key={lane} className="h-song-row">
            <LaneLabel lane={lane} />
            <div className="h-song-lane">
              <div className="h-song-box" style={{ width: count * BAR_W - 2 }}>
                <Cells count={count} />
                {byLane[lane].map((placement) => {
                  const pattern = patterns.find((p) => p.id === placement.pattern)!;
                  return (
                    <Tile
                      key={placement.id}
                      placement={placement}
                      pattern={pattern}
                      channels={channels}
                      selected={placement.id === placementId}
                      current={pattern.id === patternId}
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

const Ruler = memo(function Ruler({ count }: { count: number }) {
  const hint = useHint('The bars of the song. While the song plays, the amber marker shows where it is.');
  return (
    <div className="h-song-ruler" {...hint.props}>
      <div className="h-song-corner" />
      <div className="h-song-ticks">
        <div className="h-song-box" style={{ width: count * BAR_W - 2 }}>
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

function LaneLabel({ lane }: { lane: number }) {
  const hint = useHint(`Lane ${lane + 1}. Blocks in different lanes play at the same time.`);
  return (
    <div className="h-song-head" {...hint.props}>
      {lane + 1}
    </div>
  );
}

const Cells = memo(function Cells({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <i key={i} className="h-song-cell" />);
});
