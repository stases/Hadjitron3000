import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { usePrefs } from '../../app/prefs';
import {
  MAX_SONG_TICKS, automationGroups, pointsValue, refKey, refLabel, refSpec, storedValue,
} from '../../core/automation';
import type { Target } from '../../core/automation';
import { TICKS_PER_STEP } from '../../core/defaults';
import { LEVEL_NAMES } from '../../core/levels';
import { barOf } from '../../core/meter';
import type { Bar } from '../../core/meter';
import { formatValue, fromNorm, toNorm } from '../../core/params';
import type { AutoRow, ParamRef, Project } from '../../core/types';
import {
  addAutomation, beginGesture, commitGesture, removeAutomation, setAutomationPoints, useApp,
} from '../../state/store';
import { toggleFold, useShown } from '../factory/levels';
import { Button, FoldToggles, Icon, openMenu, setHint, tokenColor } from '../kit';
import type { MenuItem } from '../kit';
import type { MenuCommand } from '../kit/Menu';
import { positionText } from '../track/roll';

/** The display's canvas sits inside its two-pixel bevel; points stay this far from its top and bottom. */
const BEVEL = 2;
const HEIGHT = 36;
const PAD = 2;
/** A point is hit within this many pixels. */
const HIT = 3;

const HINTS = {
  row: 'Click to add a point; drag one to move it, on the beats or anywhere with Alt; right-click or Delete removes it.',
  remove: 'Removes this row; the control keeps the value it has in its own place.',
  add: 'Adds a row that moves one control of a sound, a bus or the master along the song.',
  deep: 'Shows the automation rows, which move a control along the song; the lamp lights when the song has any.',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const yOf = (v: number) => PAD + Math.round((1 - v) * (HEIGHT - 1 - 2 * PAD));
const valueOf = (y: number) => clamp(1 - (y - PAD) / (HEIGHT - 1 - 2 * PAD), 0, 1);

/** A tick's x on the canvas: bars as wide as the lanes' cells and the line after them. */
const xOf = (tick: number, bar: Bar, width: number) => Math.round((tick * width) / bar.ticks) - BEVEL;

/** The tick under x: on the nearest beat, or on the nearest tick with `free`. */
function tickAt(x: number, bar: Bar, width: number, free: boolean): number {
  const t = clamp(((x + BEVEL) * bar.ticks) / width, 0, MAX_SONG_TICKS);
  if (free) return Math.round(t);
  const start = Math.floor(t / bar.ticks) * bar.ticks;
  const beats = [...bar.beats.map((s) => start + s * TICKS_PER_STEP), start + bar.ticks];
  return beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best));
}

/**
 * The row as an amber display: dotted bar lines, the curve in straight lines between its points, holding before the
 * first and after the last, and the points as small squares, the selected one hollow. A row without points draws the
 * stored value as a dim dashed line, since it moves nothing.
 */
function drawRow(
  canvas: HTMLCanvasElement, points: AutoRow['points'], stored: number, bar: Bar, width: number, selected: number | null,
) {
  const g = canvas.getContext('2d')!;
  const w = canvas.width;
  g.fillStyle = tokenColor('--crt');
  g.fillRect(0, 0, w, HEIGHT);
  g.fillStyle = tokenColor('--amber-dim');
  for (let b = 1; xOf(b * bar.ticks, bar, width) < w; b++) {
    const x = xOf(b * bar.ticks, bar, width) - 1;
    for (let y = b % 4 === 0 ? 0 : 1; y < HEIGHT; y += b % 4 === 0 ? 2 : 4) g.fillRect(x, y, 1, 1);
  }
  for (let x = 0; x < w; x += 4) g.fillRect(x, yOf(0.5), 1, 1);
  if (points.length === 0) {
    for (let x = 0; x < w; x += 4) g.fillRect(x, yOf(stored), 2, 1);
    return;
  }
  g.fillStyle = tokenColor('--amber');
  let last = -1;
  for (let x = 0; x < w; x++) {
    const y = yOf(pointsValue(points, ((x + BEVEL) * bar.ticks) / width));
    const top = last < 0 ? y : Math.min(y, last);
    g.fillRect(x, top, 1, Math.max(1, Math.abs(y - (last < 0 ? y : last)) + 1));
    last = y;
  }
  points.forEach(([tick, v], i) => {
    const x = xOf(tick, bar, width);
    const y = yOf(v);
    g.fillStyle = tokenColor('--amber');
    if (i !== selected) {
      g.fillRect(x - 1, y - 1, 3, 3);
      return;
    }
    g.fillRect(x - 2, y - 2, 5, 5);
    g.fillStyle = tokenColor('--crt');
    g.fillRect(x - 1, y - 1, 3, 3);
  });
}

/** The row's own points, from the store, as a drag changes them. */
const pointsOf = (id: string) => useApp.getState().project.automation.find((r) => r.id === id)?.points ?? [];

/** One row of automation: its remove button at the left, then the display aligned bar for bar with the lanes. */
const AutomationRow = memo(function AutomationRow({ row, project, count, width, tour }: {
  row: AutoRow;
  project: Project;
  count: number;
  width: number;
  tour: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const bar = barOf(project.meter);
  const spec = refSpec(project, row.target)!;
  const label = refLabel(project, row.target)!;
  const stored = toNorm(spec, storedValue(project, row.target));
  const chosen = selected !== null && selected < row.points.length ? selected : null;

  useLayoutEffect(
    () => drawRow(canvas.current!, row.points, stored, bar, width, chosen),
    [row.points, stored, bar, width, chosen, count],
  );

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (x: number, y: number) => row.points.findIndex(([tick, v]) =>
    Math.abs(xOf(tick, bar, width) - x) <= HIT && Math.abs(yOf(v) - y) <= HIT);
  const tell = ([tick, v]: [number, number]) =>
    setHint(`${label}: ${formatValue(spec, fromNorm(spec, v))} at ${positionText(tick, bar)}`);
  const remove = (index: number) => {
    setAutomationPoints(row.id, pointsOf(row.id).filter((_, i) => i !== index));
    setSelected(null);
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = at(e);
    let index = hit(x, y);
    beginGesture();
    if (index < 0) {
      const point: [number, number] = [tickAt(x, bar, width, e.altKey), valueOf(y)];
      index = row.points.findIndex(([tick]) => tick > point[0]);
      if (index < 0) index = row.points.length;
      setAutomationPoints(row.id, row.points.toSpliced(index, 0, point));
      tell(point);
    } else {
      tell(row.points[index]);
    }
    drag.current = index;
    setSelected(index);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const index = drag.current;
    if (index === null) {
      setHint(HINTS.row);
      return;
    }
    const points = pointsOf(row.id);
    const { x, y } = at(e);
    const lo = points[index - 1]?.[0] ?? 0;
    const hi = points[index + 1]?.[0] ?? MAX_SONG_TICKS;
    const point: [number, number] = [clamp(tickAt(x, bar, width, e.altKey), lo, hi), valueOf(y)];
    setAutomationPoints(row.id, points.with(index, point));
    tell(point);
  };

  const finish = () => {
    if (drag.current === null) return;
    drag.current = null;
    commitGesture();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && chosen !== null) remove(chosen);
    else if (e.key === 'Escape') setSelected(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="h-song-row h-song-autorow" role="group" aria-label={label} data-tour={tour}>
      <div className="h-song-head is-auto">
        <Button square small onClick={() => removeAutomation(row.id)} hint={HINTS.remove}>
          <Icon name="close" />
        </Button>
      </div>
      <div className="h-song-auto">
        <div className="h-song-autobox" style={{ width: count * width - 2 }}>
          <canvas
            ref={canvas}
            width={count * width - 2 - 2 * BEVEL}
            height={HEIGHT}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finish}
            onLostPointerCapture={finish}
            onPointerLeave={() => drag.current === null && setHint(null)}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const { x, y } = at(e);
              const index = hit(x, y);
              if (index >= 0) remove(index);
            }}
          />
          <span className="h-song-autoname">{label}</span>
          <i className="h-song-now" />
        </div>
      </div>
    </div>
  );
});

/**
 * A group's targets as menu items: one submenu for each unit or effect ("Filter", then "Cutoff"), and a target of its
 * own (a bus's Level) as an item. Parameters that have a row already are ticked and cannot be chosen again, and so
 * are their unit and their sound.
 */
function targetItems(targets: Target<ParamRef>[], taken: Set<string>): MenuCommand[] {
  const items: MenuCommand[] = [];
  for (const { target, label } of targets) {
    const split = label.lastIndexOf(' · ');
    const used = taken.has(refKey(target));
    const item: MenuCommand = {
      label: split < 0 ? label : label.slice(split + 3),
      checked: used,
      disabled: used,
      onSelect: () => addAutomation(target),
    };
    if (split < 0) {
      items.push(item);
      continue;
    }
    const unit = label.slice(0, split);
    let menu = items.find((i) => i.items && i.label === unit);
    if (!menu) items.push((menu = { label: unit, items: [] }));
    menu.items!.push(item);
    menu.checked ||= used;
  }
  return items;
}

/** The picker: each sound, then the buses and the master, each with its parameters by unit as in the target lists. */
function pickerItems(project: Project): MenuItem[] {
  const taken = new Set(project.automation.map((row) => refKey(row.target)));
  return automationGroups(project).flatMap((group, i): MenuItem[] => {
    const items = targetItems(group.targets, taken);
    return [
      ...(i === project.channels.length && i > 0 ? ['separator' as const] : []),
      { label: group.name, items, checked: items.some((item) => item.checked) },
    ];
  });
}

/**
 * The rows of automation under the lanes, and a last row with the button that adds one. Automation is Deep: in
 * beginner mode the rows and the button wait behind a toggle whose lamp lights when the song has any rows.
 */
export function AutomationRows({ count, width }: { count: number; width: number }) {
  const project = useApp((s) => s.project);
  const beginner = usePrefs((p) => p.beginner);
  const deep = useShown()('song', 3);
  const add = useRef<HTMLDivElement>(null);
  return (
    <>
      {deep && project.automation.map((row, i) => (
        <AutomationRow key={row.id} row={row} project={project} count={count} width={width} tour={`auto-${i + 1}`} />
      ))}
      <div className="h-song-row h-song-autorow is-add">
        <div className="h-song-adds" ref={add}>
          {beginner && (
            <FoldToggles
              row
              folds={[{
                label: LEVEL_NAMES[3],
                open: deep,
                lit: project.automation.length > 0,
                hint: HINTS.deep,
                onToggle: () => toggleFold('song', 3),
              }]}
            />
          )}
          {deep && (
            <Button
              small
              hint={HINTS.add}
              data-tour="add-automation"
              onClick={() => {
                const r = add.current!.getBoundingClientRect();
                openMenu(pickerItems(useApp.getState().project), r.left + (beginner ? 64 : 0), r.bottom);
              }}
            >
              <Icon name="plus" />
              Automation
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
