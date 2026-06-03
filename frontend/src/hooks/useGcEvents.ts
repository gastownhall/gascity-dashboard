import { useEffect, useRef, useState } from 'react';
import { reportClientError } from '../lib/clientErrorReporting';
import { getActiveCity } from '../api/cityBase';
import { supervisorApi } from '../supervisor/client';

// gascity-dashboard-iew: EventSource against the direct supervisor transport
// path. In standalone dev this is usually the same-origin /gc-supervisor
// transport-only proxy; when folded into gc it can be the supervisor origin
// itself. The dashboard service no longer owns or parses city event DTOs.

export type GcEventConnState = 'connecting' | 'open' | 'degraded' | 'closed';
export type GcEventEnvelope = {
  type: string;
  run_id?: string;
  root_bead_id?: string;
  run?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  bead?: Record<string, unknown>;
  root?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export interface GcEventRefreshOptions {
  matches?: (event: GcEventEnvelope) => boolean;
}

/**
 * Subscribe to gc events. When an event whose type starts with any of
 * `prefixes` arrives, `onMatch` is invoked. Designed for "refresh this
 * panel when its underlying data changed" — pass refresh().
 */
export function useGcEventRefresh(
  prefixes: ReadonlyArray<string>,
  onMatch: () => void,
  options: GcEventRefreshOptions = {},
): GcEventConnState {
  const [state, setState] = useState<GcEventConnState>('connecting');
  const onMatchRef = useRef(onMatch);
  onMatchRef.current = onMatch;
  const matchesRef = useRef(options.matches);
  matchesRef.current = options.matches;
  // Stable hash of prefixes for the effect dep array.
  const prefixKey = prefixes.join(',');

  // gascity-dashboard-0sh (ported from upstream cd-tle7m): coalesce
  // event-driven refetches. A busy city emits many bead.*/session.*
  // events per second; firing onMatch per-event made consumers (e.g. the
  // Kanban) refetch /beads ungated (~1/sec), which both hammered the
  // supervisor's city-store read AND amplified its partial-read flicker
  // (td- beads vanish/reappear). Throttle to at most one onMatch per
  // COALESCE_MS (leading + trailing): a burst yields one refetch now and
  // one after it settles, never a per-event storm.
  const lastFireRef = useRef(0);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prefixes.length === 0) {
      setState('closed');
      return;
    }

    let es: EventSource | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = 1_000;
    let malformedEventReported = false;

    const COALESCE_MS = 2_500;
    const reportMalformedEventOnce = (reason: string) => {
      if (malformedEventReported) return;
      malformedEventReported = true;
      reportMalformedEvent(reason);
    };
    const fireMatch = () => {
      lastFireRef.current = Date.now();
      onMatchRef.current();
    };
    // Leading + trailing throttle: fire immediately when outside the
    // window, otherwise schedule a single trailing fire at the window
    // edge. Coalesces a burst of matching events into <=1 onMatch per
    // COALESCE_MS.
    const scheduleMatch = () => {
      const elapsed = Date.now() - lastFireRef.current;
      if (elapsed >= COALESCE_MS) {
        if (coalesceTimerRef.current) {
          clearTimeout(coalesceTimerRef.current);
          coalesceTimerRef.current = null;
        }
        fireMatch();
      } else if (coalesceTimerRef.current === null) {
        coalesceTimerRef.current = setTimeout(() => {
          coalesceTimerRef.current = null;
          if (!cancelled) fireMatch();
        }, COALESCE_MS - elapsed);
      }
    };

    const connect = () => {
      const EventSourceCtor = globalThis.EventSource;
      if (typeof EventSourceCtor !== 'function') {
        setState('closed');
        return;
      }
      const cityName = getActiveCity();
      if (cityName === null) {
        setState('closed');
        return;
      }
      // The browser sends Last-Event-ID automatically on reconnect; the
      // supervisor event stream accepts that header directly.
      es = new EventSourceCtor(supervisorApi().cityEventStreamUrl(cityName));
      setState('connecting');
      es.onopen = () => {
        if (cancelled) return;
        setState('open');
        retryDelayMs = 1_000;
      };
      // gc supervisor sends events with `event: event` (the event NAME
      // is literally "event"), not the default "message". EventSource
      // routes named events to addEventListener('<name>', ...) — only
      // unnamed events reach .onmessage. Both handlers point to the same
      // dispatch so the path is identical regardless of how the server
      // names them.
      const handleData = (msg: MessageEvent<string>) => {
        if (cancelled) return;
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(msg.data);
        } catch {
          setState('degraded');
          reportMalformedEventOnce('invalid JSON');
          return;
        }
        if (!isRecord(parsed)) {
          setState('degraded');
          reportMalformedEventOnce('missing string event type');
          return;
        }
        const t = parsed.type;
        if (typeof t !== 'string') {
          setState('degraded');
          reportMalformedEventOnce('missing string event type');
          return;
        }
        setState('open');
        for (const prefix of prefixes) {
          if (t.startsWith(prefix)) {
            const event = parsed as GcEventEnvelope;
            if (matchesRef.current?.(event) ?? true) scheduleMatch();
            break;
          }
        }
      };
      es.onmessage = handleData;
      es.addEventListener('event', handleData as EventListener);
      es.onerror = () => {
        if (cancelled) return;
        setState('closed');
        es?.close();
        es = null;
        // Exponential backoff capped at 30s.
        retryTimer = setTimeout(() => {
          retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
          connect();
        }, retryDelayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (coalesceTimerRef.current) {
        clearTimeout(coalesceTimerRef.current);
        coalesceTimerRef.current = null;
      }
      es?.close();
    };
    // We re-bind only when the prefix set changes — onMatch is captured in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixKey]);

  return state;
}

function reportMalformedEvent(reason: string): void {
  void reportClientError({
    component: 'gc-events',
    operation: 'parse event',
    message: `Malformed gc event payload: ${reason}.`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
