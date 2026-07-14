import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Live `prefers-reduced-motion: reduce` signal. Fails toward the safer
 * default: when `matchMedia` itself is unavailable (older browsers, and
 * every jsdom test environment that hasn't stubbed it) this reports `true`,
 * never `false` — a page must never assume unprompted autonomous motion is
 * welcome. `/reef` (specs/plans/reef-aquarium.md "Reduced motion") reads
 * this to decide whether its rAF loop may run at all.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setReduced(true);
      return;
    }
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mql.matches);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
