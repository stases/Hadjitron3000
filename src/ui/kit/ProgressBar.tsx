import { useLayoutEffect, useRef, useState } from 'react';

const BLOCK = 8;
const GAP = 2;

/** A shallow sunken bar filled with whole blocks, value 0..1; at 1 the last block is cut to fit. */
export function ProgressBar({ value }: { value: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setInner(el.clientWidth - 4);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const capacity = Math.floor((inner + GAP) / (BLOCK + GAP));
  const v = Math.min(1, Math.max(0, value));
  const width = v >= 1 ? inner : Math.max(0, Math.round(v * capacity) * (BLOCK + GAP) - GAP);
  return (
    <div className="h-progress" ref={root} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={1}>
      <div className="h-progress-fill" style={{ width }} />
    </div>
  );
}
