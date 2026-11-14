import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { useDialogs } from '../dialogStore';
import { markDone, useTour } from './tourStore';
import type { TourStep } from './tourStore';
import './tour.css';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FRAME = 3; // between the target and its frame

const selector = (name: string) => `[data-tour="${name}"]`;

const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b
  && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** Where the target shows: its box cut to the boxes around it that hide what overflows them, such as a scroller. */
function measure(name: string | undefined): Box | null {
  const el = name ? document.querySelector(selector(name)) : null;
  if (!el) return null;
  let { left, top, right, bottom } = el.getBoundingClientRect();
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(box);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const r = box.getBoundingClientRect();
    if (overflowX !== 'visible') [left, right] = [Math.max(left, r.left), Math.min(right, r.right)];
    if (overflowY !== 'visible') [top, bottom] = [Math.max(top, r.top), Math.min(bottom, r.bottom)];
  }
  return right > left && bottom > top
    ? { left: Math.round(left), top: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
    : null;
}

/** How far to scroll so that as much of a span as fits lies between `from` and `to`. */
const shift = (lo: number, hi: number, from: number, to: number) =>
  lo < from ? lo - from : hi > to ? Math.min(hi - to, lo - from) : 0;

/**
 * Scrolls the nearest scrolling box around an element so that as much of the element as fits is in view, inside
 * the box's scrollbars.
 */
function reveal(el: Element): void {
  const box = scroller(el);
  if (!box) return;
  const r = el.getBoundingClientRect();
  const view = box.getBoundingClientRect();
  const left = view.left + box.clientLeft;
  const top = view.top + box.clientTop;
  box.scrollTop += shift(r.top, r.bottom, top, top + box.clientHeight);
  box.scrollLeft += shift(r.left, r.right, left, left + box.clientWidth);
}

/** The nearest box around an element that scrolls. */
function scroller(el: Element): Element | null {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box);
    if (overflowY === 'auto' || overflowY === 'scroll') return box;
  }
  return null;
}

/**
 * Where the target is, followed on every frame so the frame keeps up with the app. The target is scrolled into view
 * when it appears, and again when the app moves it out of view, as when a unit is added above it; when the user
 * scrolls it away, it stays away.
 */
function useTarget(name: string | undefined): Box | null {
  const [box, setBox] = useState(() => measure(name));
  useEffect(() => {
    let shown: Element | null = null;
    let was: Box | null = null;
    let scrolled = '';
    let frame = requestAnimationFrame(function loop() {
      const el = name ? document.querySelector(selector(name)) : null;
      const around = el && scroller(el);
      const at = around ? `${around.scrollTop},${around.scrollLeft}` : '';
      if (el && (el !== shown || (was && !measure(name) && at === scrolled))) {
        reveal(el);
        shown = el;
      }
      const next = measure(name);
      was = next;
      scrolled = around ? `${around.scrollTop},${around.scrollLeft}` : '';
      setBox((prev) => (sameBox(prev, next) ? prev : next));
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [name]);
  return box;
}

/** Marks the step done when the user presses its target, for steps the store cannot see. */
function usePress(step: TourStep): void {
  useEffect(() => {
    if (step.done !== 'press' || !step.target) return;
    const name = selector(step.target);
    const onDown = (e: Event) => {
      if ((e.target as Element).closest?.(name)) markDone();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [step]);
}

/** Watches the current step: ticks it off once the user has done it, and frames the control it points at. */
function Watch({ step }: { step: TourStep }) {
  const start = useTour((s) => s.start)!;
  const state = useApp();
  const dialog = useDialogs((s) => s.dialog);
  const met = typeof step.done === 'function' && step.done({ state, start, dialog });
  const target = useTarget(step.target);

  useEffect(() => {
    if (met) markDone();
  }, [met]);
  usePress(step);

  return target && (
    <div
      className="h-tour-frame"
      style={{
        left: target.left - FRAME,
        top: target.top - FRAME,
        width: target.width + 2 * FRAME,
        height: target.height + 2 * FRAME,
      }}
    />
  );
}

/** The running steps: a frame around the control the current one is about. The Guide Book shows their words. */
export function Tour() {
  const step = useTour((s) => s.steps?.[s.index]);
  const index = useTour((s) => s.index);
  return step && <Watch key={index} step={step} />;
}
