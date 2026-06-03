import { useEffect, useState } from 'react';
import {
  eventsStreamUrl,
  fetchBeads,
  fetchMail,
  fetchSessions,
  fetchSnapshot,
  type DashboardSnapshot,
  type GcBead,
  type GcMailItem,
  type GcSession,
} from './api.ts';

export type ConnState = 'connecting' | 'open' | 'degraded' | 'closed';

export interface CityState {
  readonly sessions: readonly GcSession[];
  readonly snapshot: DashboardSnapshot | null;
  readonly beads: readonly GcBead[];
  readonly mail: readonly GcMailItem[];
  readonly error: string | null;
  readonly conn: ConnState;
}

const INITIAL: CityState = {
  sessions: [],
  snapshot: null,
  beads: [],
  mail: [],
  error: null,
  conn: 'connecting',
};

// Same coalescing window as the web hook (frontend/src/hooks/useGcEvents.ts):
// a busy city emits many events per second; refetching per-event would hammer
// the backend (and the snapshot is the heaviest read). Leading + trailing
// throttle → at most one refresh per window, plus one after the burst settles.
const COALESCE_MS = 2_500;
// Any of these prefixes means the operator-visible state may have moved.
const REFRESH_PREFIXES = ['session.', 'bead.', 'run.', 'agent.', 'mail.'];

/**
 * Loads sessions + snapshot + beads for a city and refreshes them (coalesced)
 * on SSE activity. Read-only; no writes, no supervisor coupling.
 */
export function useCity(baseUrl: string, city: string): CityState {
  const [state, setState] = useState<CityState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = 1_000;
    let lastFire = 0;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

    // Each feed updates its own slice as it lands — sessions are fast, the
    // snapshot is slow; waiting for all three would stall the fast paint.
    const refresh = (): void => {
      void fetchSessions(baseUrl, city)
        .then((list) => {
          if (!cancelled) setState((p) => ({ ...p, sessions: list.items, error: null }));
        })
        .catch((err: unknown) => {
          if (!cancelled) setState((p) => ({ ...p, error: reason(err) }));
        });
      void fetchSnapshot(baseUrl, city)
        .then((snap) => {
          if (!cancelled) setState((p) => ({ ...p, snapshot: snap }));
        })
        .catch(() => {
          /* snapshot is supplementary (health pane); don't clobber the list */
        });
      void fetchBeads(baseUrl, city)
        .then((beads) => {
          if (!cancelled) setState((p) => ({ ...p, beads }));
        })
        .catch(() => {
          /* beads are supplementary (peek pane) */
        });
      void fetchMail(baseUrl, city)
        .then((mail) => {
          if (!cancelled) setState((p) => ({ ...p, mail }));
        })
        .catch(() => {
          /* mail is supplementary (ledger pane) */
        });
    };

    const scheduleRefresh = (): void => {
      const elapsed = Date.now() - lastFire;
      if (elapsed >= COALESCE_MS) {
        if (coalesceTimer) {
          clearTimeout(coalesceTimer);
          coalesceTimer = null;
        }
        lastFire = Date.now();
        refresh();
      } else if (coalesceTimer === null) {
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null;
          if (cancelled) return;
          lastFire = Date.now();
          refresh();
        }, COALESCE_MS - elapsed);
      }
    };

    const connect = (): void => {
      const EventSourceCtor = globalThis.EventSource;
      if (typeof EventSourceCtor !== 'function') {
        setState((prev) => ({ ...prev, conn: 'closed' }));
        return;
      }
      es = new EventSourceCtor(eventsStreamUrl(baseUrl, city));
      setState((prev) => ({ ...prev, conn: 'connecting' }));
      es.onopen = () => {
        if (cancelled) return;
        retryDelayMs = 1_000;
        setState((prev) => ({ ...prev, conn: 'open' }));
        // Resync on (re)connect: a stream that dropped (e.g. the backend
        // restarted) may have missed events, so the snapshot/sessions could be
        // stale. Coalesced, so the initial mount refresh + this don't double up.
        scheduleRefresh();
      };
      const handle = (msg: MessageEvent<string>): void => {
        if (cancelled) return;
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(msg.data);
        } catch {
          setState((prev) => ({ ...prev, conn: 'degraded' }));
          return;
        }
        const type =
          parsed && typeof parsed === 'object' && 'type' in parsed
            ? (parsed as { type: unknown }).type
            : null;
        if (typeof type !== 'string') {
          setState((prev) => ({ ...prev, conn: 'degraded' }));
          return;
        }
        setState((prev) => ({ ...prev, conn: 'open' }));
        if (REFRESH_PREFIXES.some((p) => type.startsWith(p))) scheduleRefresh();
      };
      es.onmessage = handle;
      es.addEventListener('event', handle as EventListener);
      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        es = null;
        setState((prev) => ({ ...prev, conn: 'closed' }));
        retryTimer = setTimeout(() => {
          retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
          connect();
        }, retryDelayMs);
      };
    };

    refresh();
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (coalesceTimer) clearTimeout(coalesceTimer);
      es?.close();
    };
  }, [baseUrl, city]);

  return state;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
