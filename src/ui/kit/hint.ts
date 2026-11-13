import { useEffect, useRef, useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setHint(text: string | null): void {
  if (text === current) return;
  current = text;
  listeners.forEach((l) => l());
}

/** The text the status bar shows: the hint of the control under the pointer, or '' when there is none. */
export function useHintText(): string {
  return useSyncExternalStore(subscribe, () => current ?? '');
}

/**
 * Shows `hint` while the pointer is over the element and clears it when the element goes away under the pointer.
 * `over` tells whether the pointer is over the element; `props` are its pointer handlers.
 */
export function useHint(hint: string | undefined) {
  const over = useRef(false);
  const shown = useRef(hint);
  shown.current = hint;
  useEffect(
    () => () => {
      if (over.current && shown.current) setHint(null);
    },
    [],
  );
  return {
    over,
    props: {
      onPointerEnter: () => {
        over.current = true;
        if (hint) setHint(hint);
      },
      onPointerLeave: () => {
        over.current = false;
        if (hint) setHint(null);
      },
    },
  };
}
