import { useEffect, useState } from 'react';

/** True while a window, the app's or the Guide Book's own, has the focus, for the colour of its title bar. */
export function useWindowActive(target: Window = window): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const on = () => setActive(true);
    const off = () => setActive(false);
    target.addEventListener('focus', on);
    target.addEventListener('blur', off);
    return () => {
      target.removeEventListener('focus', on);
      target.removeEventListener('blur', off);
    };
  }, [target]);
  return active;
}
