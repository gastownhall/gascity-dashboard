import { useCallback, useEffect, useRef, useState } from 'react';
import { formatApiError } from '../api/client';
import { loadActiveConvoyRoots, type ConvoyRootsLoad } from '../supervisor/convoyReads';

// Fetch the active-convoy roots for the /convoy index (gascity-dashboard-0chv3).
//
// Mirrors useConvoyView: the convoy set changes slowly relative to a session, so
// this is static-with-explicit-refresh — it loads once on mount and exposes a
// `refresh` for the page's Refresh control rather than wiring an SSE
// auto-refresh. There is no `not_found` state: an empty city is the legitimate
// `ready` state with zero roots, which the page renders as the calm empty
// notice, not an error.

export type ConvoyRootsState =
  | { kind: 'loading' }
  | { kind: 'ready'; load: ConvoyRootsLoad; refreshing: boolean }
  | { kind: 'failed'; error: string };

export interface UseConvoyRoots {
  state: ConvoyRootsState;
  refresh: () => Promise<void>;
}

export function useConvoyRoots(): UseConvoyRoots {
  const [state, setState] = useState<ConvoyRootsState>({ kind: 'loading' });

  const load = useCallback(
    async (mode: 'initial' | 'refresh', isCurrent: () => boolean): Promise<void> => {
      setState((prev) =>
        mode === 'refresh' && prev.kind === 'ready'
          ? { ...prev, refreshing: true }
          : { kind: 'loading' },
      );
      try {
        const result = await loadActiveConvoyRoots();
        if (isCurrent()) setState({ kind: 'ready', load: result, refreshing: false });
      } catch (err) {
        if (!isCurrent()) return;
        setState({ kind: 'failed', error: formatApiError(err, 'convoy list load failed') });
      }
    },
    [],
  );

  // The live mount's freshness check. The effect rebinds it per run to a fresh
  // `() => !cancelled`, so a load — initial OR a refresh() resolving after a
  // StrictMode unmount/remount — never overwrites the current mount's state with
  // a stale result. Mirrors useConvoyView's per-effect `cancelled` guard (it has
  // a liveRootRef because its key can change; this hook has no key, so the guard
  // is purely mount-generation).
  const isCurrentRef = useRef<() => boolean>(() => true);

  useEffect(() => {
    let cancelled = false;
    isCurrentRef.current = () => !cancelled;
    void load('initial', () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Per-request generation for refresh(). Each call supersedes the previous one,
  // so two overlapping refreshes resolve in ISSUE order (latest wins) rather than
  // last-resolve-wins. Unreachable through the UI today — the Refresh control is
  // disabled while a load is in flight and refresh() has no other caller — but it
  // makes the hook correct-by-construction for any future caller, and composes
  // with (does not replace) the mount-liveness guard above.
  const refreshGenRef = useRef(0);
  const refresh = useCallback(() => {
    const generation = (refreshGenRef.current += 1);
    return load('refresh', () => isCurrentRef.current() && generation === refreshGenRef.current);
  }, [load]);

  return { state, refresh };
}
