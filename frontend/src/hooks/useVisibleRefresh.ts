import { useEffect, useRef } from 'react';

export interface VisibleRefreshOptions {
  enabled?: boolean;
}

/**
 * Promise-aware visible polling for refresh callbacks whose data/error state
 * lives elsewhere. This hook deliberately waits for the first interval tick;
 * callers that need an initial load should do that explicitly or use a loader
 * hook such as `useAbortableVisibleRefresh()`. It does, however, re-read
 * immediately when the tab returns to the foreground (see the visibilitychange
 * listener) so reads taken before a long hidden period refresh on refocus.
 */
export function useVisibleRefresh(
  refresh: () => Promise<void>,
  intervalMs: number,
  options: VisibleRefreshOptions = {},
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const inFlightRef = useRef(false);

  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.hidden) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      void refreshRef.current().finally(() => {
        inFlightRef.current = false;
      });
    };

    const interval = window.setInterval(tick, intervalMs);

    // gascity-dashboard-4q60: an ambient dashboard spends most of its life in a
    // backgrounded tab, where tick() bails on document.hidden — so every polled
    // read ages past its stale threshold while hidden and no re-read fires. On a
    // fixed-interval poll alone, refocus would show a false 'stale' mark for up
    // to one interval until the next tick lands. Re-read the moment the tab
    // becomes visible so fetchedAt advances before that stale window renders.
    const onVisibilityChange = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
