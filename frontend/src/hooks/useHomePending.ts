import { useEffect, useRef, useState } from 'react';
import type { AlertItem } from 'gas-city-dashboard-shared';
import { cityPath } from '../api/cityBase';
import { reportClientError } from '../lib/clientErrorReporting';

// Home-view pending-decision consumer (gascity-dashboard-26zl, R3/R16, Option A).
// Opens ONE same-origin EventSource against the backend's /home/pending/stream
// (the revised-R13 path — a single dashboard stream, not N per-session browser
// connections). The frame payload is { alerts: AlertItem[] } of kind
// 'pending-decision'; we keep the last-known set and surface a connection state
// so a dark stream renders signal-unavailable, never a false all-clear (R6/R16).

export type HomePendingConnState = 'connecting' | 'open' | 'degraded' | 'closed';

export interface HomePendingState {
  /** Last-known pending-decision alerts (retained across a transient drop). */
  readonly alerts: readonly AlertItem[];
  /** Stream liveness. Anything other than 'open' ⇒ the pending scope is not certified. */
  readonly conn: HomePendingConnState;
}

const MALFORMED_FRAME = 'Malformed home-pending stream frame.';

function parsePendingFrame(data: string): readonly AlertItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const alerts = (parsed as { alerts?: unknown }).alerts;
  if (!Array.isArray(alerts)) return null;
  return alerts as readonly AlertItem[];
}

export function useHomePending(enabled = true): HomePendingState {
  const [alerts, setAlerts] = useState<readonly AlertItem[]>([]);
  const [conn, setConn] = useState<HomePendingConnState>(enabled ? 'connecting' : 'closed');
  const malformedReportedRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      setConn('closed');
      return;
    }
    let cancelled = false;
    setConn('connecting');
    const source = new EventSource(cityPath('/home/pending/stream'), { withCredentials: true });

    source.onopen = () => {
      if (!cancelled) setConn('open');
    };
    source.addEventListener('pending', (event) => {
      if (cancelled) return;
      const next = parsePendingFrame((event as MessageEvent<string>).data);
      if (next === null) {
        if (!malformedReportedRef.current) {
          malformedReportedRef.current = true;
          void reportClientError({
            component: 'home-pending',
            operation: 'parse stream frame',
            message: MALFORMED_FRAME,
          });
        }
        setConn('degraded');
        return;
      }
      setAlerts(next);
      setConn('open');
    });
    source.onerror = () => {
      if (cancelled) return;
      // EventSource auto-reconnects unless CLOSED; reflect liveness so the
      // render can mark the pending scope unavailable (R16). Keep last-known
      // alerts — a disconnect is not a resolve.
      setConn(source.readyState === EventSource.CLOSED ? 'closed' : 'degraded');
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [enabled]);

  return { alerts, conn };
}
