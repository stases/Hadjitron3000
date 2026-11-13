import { useEffect, useRef } from 'react';

/** Closes when the pointer goes down outside every open popup and outside `keep`. */
export function useOutsidePointer(active: boolean, onOutside: () => void, keep?: { current: Element | null }) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest?.('[data-h-popup]') || keep?.current?.contains(t)) return;
      cb.current();
    };
    const onBlur = () => cb.current();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, keep]);
}
