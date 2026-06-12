import { useCallback, useEffect, useRef, useState } from 'react';
import { formatApiError } from '../api/client';
import { SupervisorApiError } from '../supervisor/client';
import { loadConvoyView, type ConvoyLoad } from '../supervisor/convoyReads';

// Fetch the convoy view for a root bead (gascity-dashboard-caag, Shape A).
//
// Convoy structure changes slowly relative to a session's lifetime, so this is
// static-with-explicit-refresh — it loads on rootBeadId change and exposes a
// `refresh` for the page's Refresh control, matching useEntityLinks rather than
// wiring an SSE auto-refresh. A genuinely missing root surfaces as a distinct
// `not_found` state (not a generic failure) so the page renders an honest
// "no such convoy" message instead of an opaque error.

export type ConvoyViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; load: ConvoyLoad; refreshing: boolean }
  | { kind: 'not_found' }
  | { kind: 'failed'; error: string };

export interface UseConvoyView {
  state: ConvoyViewState;
  refresh: () => Promise<void>;
}

export function useConvoyView(rootBeadId: string | null): UseConvoyView {
  const [state, setState] = useState<ConvoyViewState>({ kind: 'idle' });
  // Latest mounted root, so a manual refresh that resolves after the route
  // param changed (or the page unmounted) discards its stale result instead of
  // clobbering the new convoy's state.
  const liveRootRef = useRef<string | null>(rootBeadId);
  liveRootRef.current = rootBeadId;

  const load = useCallback(
    async (id: string, mode: 'initial' | 'refresh', isCurrent: () => boolean): Promise<void> => {
      setState((prev) =>
        mode === 'refresh' && prev.kind === 'ready'
          ? { ...prev, refreshing: true }
          : { kind: 'loading' },
      );
      try {
        const result = await loadConvoyView(id);
        if (isCurrent()) setState({ kind: 'ready', load: result, refreshing: false });
      } catch (err) {
        if (!isCurrent()) return;
        if (err instanceof SupervisorApiError && err.status === 404) {
          setState({ kind: 'not_found' });
          return;
        }
        setState({ kind: 'failed', error: formatApiError(err, 'convoy load failed') });
      }
    },
    [],
  );

  useEffect(() => {
    if (rootBeadId === null || rootBeadId.length === 0) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    void load(rootBeadId, 'initial', () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [rootBeadId, load]);

  const refresh = useCallback(async (): Promise<void> => {
    if (rootBeadId === null || rootBeadId.length === 0) return;
    await load(rootBeadId, 'refresh', () => liveRootRef.current === rootBeadId);
  }, [rootBeadId, load]);

  return { state, refresh };
}
