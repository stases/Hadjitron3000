import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { useApp } from '../../state/store';
import { Button, Icon, TitleBar } from '../../ui/kit';
import { useDialogs } from '../dialogStore';
import { LESSONS } from './lessons';
import type { LessonId, TourStep } from './lessons';
import { closeTour, markDone, nextStep, previousStep, useTour } from './tourStore';
import './tour.css';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Layout {
  target: Box | null;
  width: number; // of the window
  height: number;
}

const MARGIN = 4; // between the coach and the edge of the window
const GAP = 10; // between the frame and the coach
const FRAME = 3; // between the target and its frame

const selector = (name: string) => `[data-tour="${name}"]`;

function sameLayout(a: Layout, b: Layout): boolean {
  const t = a.target;
  const u = b.target;
  return a.width === b.width && a.height === b.height && (t === u || (!!t && !!u
    && t.left === u.left && t.top === u.top && t.width === u.width && t.height === u.height));
}

function measure(name: string | undefined): Layout {
  const r = name ? document.querySelector(selector(name))?.getBoundingClientRect() : undefined;
  const target = r && r.width > 0 && r.height > 0
    ? { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    : null;
  return { target, width: innerWidth, height: innerHeight };
}

/** Scrolls the nearest scrolling box around an element so that as much of the element as fits is in view. */
function reveal(el: Element): void {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const r = el.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (r.top < view.top) box.scrollTop -= view.top - r.top;
    else if (r.bottom > view.bottom) box.scrollTop += Math.min(r.bottom - view.bottom, r.top - view.top);
    return;
  }
}

/** The window and the target, followed on every frame so the frame and the coach keep up with the app. */
function useLayout(name: string | undefined): Layout {
  const [layout, setLayout] = useState(() => measure(name));
  useEffect(() => {
    let shown = false;
    let frame = requestAnimationFrame(function loop() {
      const el = !shown && name ? document.querySelector(selector(name)) : null;
      if (el) {
        reveal(el);
        shown = true;
      }
      const next = measure(name);
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [name]);
  return layout;
}

/**
 * Where a coach of w by h goes: beside the target (below, above, right, left), lined up with its right end when the
 * target is wide, since the controls of a wide area sit at its left. When it fits nowhere beside it, it goes into the
 * bottom right corner of the target, which in every view is where the empty space is. Without a target it sits in
 * the middle of the window.
 */
function placeCoach(layout: Layout, w: number, h: number): { x: number; y: number } {
  const fit = (x: number, y: number) => ({
    x: Math.max(MARGIN, Math.min(Math.round(x), layout.width - w - MARGIN)),
    y: Math.max(MARGIN, Math.min(Math.round(y), layout.height - h - MARGIN)),
  });
  const { target } = layout;
  if (!target) return fit((layout.width - w) / 2, (layout.height - h) / 2);
  const left = target.left - FRAME;
  const top = target.top - FRAME;
  const right = target.left + target.width + FRAME;
  const bottom = target.top + target.height + FRAME;
  const x = right - left > 2 * w ? right - w : left;
  const spots = [fit(x, bottom + GAP), fit(x, top - GAP - h), fit(right + GAP, top), fit(left - GAP - w, top)];
  const covers = (p: { x: number; y: number }) => p.x < right && p.x + w > left && p.y < bottom && p.y + h > top;
  return spots.find((p) => !covers(p)) ?? fit(right - GAP - w, bottom - GAP - h);
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

function Coach({ lesson, index }: { lesson: LessonId; index: number }) {
  const { title, steps } = LESSONS[lesson];
  const step = steps[index];
  const start = useTour((s) => s.start)!;
  const latched = useTour((s) => s.done);
  const state = useApp();
  const dialog = useDialogs((s) => s.dialog);
  const met = typeof step.done === 'function' && step.done({ state, start, dialog });
  const done = latched || met;
  const layout = useLayout(step.target);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [moved, setMoved] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (met) markDone();
  }, [met]);
  usePress(step);
  useLayoutEffect(() => {
    const el = box.current!;
    if (size?.w !== el.offsetWidth || size.h !== el.offsetHeight) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  });

  const pos = moved ?? (size && placeCoach(layout, size.w, size.h));
  const startMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pos) return;
    e.preventDefault();
    const from = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: globalThis.PointerEvent) =>
      setMoved({ x: Math.round(ev.clientX - from.x), y: Math.max(0, Math.round(ev.clientY - from.y)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const { target } = layout;
  const last = index === steps.length - 1;
  return (
    <>
      {target && (
        <div
          className="h-tour-frame"
          style={{
            left: target.left - FRAME,
            top: target.top - FRAME,
            width: target.width + 2 * FRAME,
            height: target.height + 2 * FRAME,
          }}
        />
      )}
      <div
        ref={box}
        className="h-tour"
        role="dialog"
        aria-label={`Tutorial: ${title}`}
        style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? undefined : 'hidden' }}
      >
        <TitleBar title={`Tutorial: ${title}`} controls={{ onClose: closeTour }} movable onPointerDown={startMove} />
        <div className="h-tour-body">
          <p className="h-tour-title">{step.title}</p>
          <p className="h-tour-text">{step.text}</p>
          <div className="h-tour-foot">
            <span className="h-tour-count">
              Step {index + 1} of {steps.length}
            </span>
            {step.done && done && (
              <span className="h-tour-done">
                <Icon name="check" />
                Done
              </span>
            )}
            <span className="h-tour-spacer" />
            <Button onClick={previousStep} disabled={index === 0}>
              Back
            </Button>
            <Button primary={done || !step.done} onClick={nextStep}>
              {last ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** The running tutorial: a small window beside the control the current step is about, and a frame around it. */
export function Tour() {
  const lesson = useTour((s) => s.lesson);
  const index = useTour((s) => s.index);
  return lesson && <Coach key={`${lesson} ${index}`} lesson={lesson} index={index} />;
}
