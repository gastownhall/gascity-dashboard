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

/** Fail-safe freshness of the pending scope, collapsed for the render layer. */
export type HomePendingProvenance = 'fresh' | 'unavailable';

export interface HomePendingState {
  /** Last-known pending-decision alerts (retained across a transient drop). */
  readonly alerts: readonly AlertItem[];
  /** Stream liveness. Anything other than 'open' ⇒ the pending scope is not certified. */
  readonly conn: HomePendingConnState;
  /**
   * Fail-safe freshness of the pending SCOPE (gascity-dashboard-gztl, R6/R15/R16).
   * 'fresh' is asserted ONLY when the stream is open AND the latest frame's items
   * are every one fresh. Anything else — connecting, degraded, closed, no frame
   * received yet, or a frame carrying a stale/error/fixture item (which the
   * backend stamps when a per-session subscription is dark) — is 'unavailable',
   * so the home renders signal-unavailable, never a false all-clear. This gates
   * on the in-band item provenance, which `conn` alone does NOT capture: an open
   * connection over a dark aggregator is the premortem's #1 missed-alarm risk.
   */
  readonly provenance: HomePendingProvenance;
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
  // Whether the LATEST frame certified every item fresh. Frame-gated, so an
  // open connection that has not yet delivered a frame is not asserted fresh,
  // and a frame carrying a dark-source (stale) item flips it false even while
  // the connection stays open.
  const [framedFresh, setFramedFresh] = useState(false);
  const malformedReportedRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      setConn('closed');
      setFramedFresh(false);
      return;
    }
    let cancelled = false;
    setConn('connecting');
    setFramedFresh(false);
    const source = new EventSource(cityPath('/home/pending/stream'), { withCredentials: true });

    source.onopen = () => {
      // Open is necessary but NOT sufficient to certify fresh — wait for a frame.
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
        setFramedFresh(false);
        return;
      }
      setAlerts(next);
      setConn('open');
      // R15 fail-safe: certify the scope fresh only when EVERY item is fresh.
      // The backend stamps 'stale' on a dark per-session subscription, so an
      // open stream over a dark aggregator does not read as a false all-clear.
      setFramedFresh(next.every((alert) => alert.provenance === 'fresh'));
    });
    source.onerror = () => {
      if (cancelled) return;
      // EventSource auto-reconnects unless CLOSED; reflect liveness so the
      // render can mark the pending scope unavailable (R16). Keep last-known
      // alerts — a disconnect is not a resolve.
      setConn(source.readyState === EventSource.CLOSED ? 'closed' : 'degraded');
      setFramedFresh(false);
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [enabled]);

  const provenance: HomePendingProvenance =
    conn === 'open' && framedFresh ? 'fresh' : 'unavailable';
  return { alerts, conn, provenance };
}
