import {
  GC_EVENT_PREFIX,
  type RunLane,
  type RunSummary,
  type SourceState,
  type SourceStatus,
} from 'gas-city-dashboard-shared';
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getActiveCity } from '../api/cityBase';
import { useAttentionModel } from '../attention/context';
import { resourceAttentionSeverity } from '../attention/routeHighlight';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { PartialDataNotice } from '../components/PartialDataNotice';
import { SseIndicator } from '../components/SseIndicator';
import {
  RunMap,
  RUNS_HISTORICAL_SECTION_ID,
} from '../components/run/RunMap';
import { useNow } from '../contexts/NowContext';
import { formatRelative } from '../hooks/time';
import { useCachedData } from '../hooks/useCachedData';
import { useGcEventRefresh } from '../hooks/useGcEvents';
import { loadSupervisorRunSummarySource } from '../supervisor/runSummary';

// /runs route (gascity-dashboard-0t6, made live in
// gascity-dashboard-bqn). Reads the direct supervisor run summary source
// through useCachedData for the initial cache-warm paint. Both the manual
// Refresh button and the SSE-driven onMatch callback share that one loader
// path, so the in-memory run-summary cache and React state always reflect the
// same refresh result — no last-write-wins race between concurrent initial
// load and event-driven refresh.
//
// Live updates: useGcEventRefresh subscribes to the direct supervisor city
// event stream and
// fires onMatch when a bead.* event arrives. The hook coalesces its
// own bursts to ~1 fire per 2.5s; we layer a 10s in-component debounce
// floor on top because runs refresh triggers a full upstream
// gc.listBeads({ limit: 1000 }) call (architect H2 — upstream-load
// protection during slung-pipeline bursts). The callback also no-ops
// when the runs source is in fixture-fallback mode (gc down) so
// the dashboard's own host doesn't get hammered with loadFixture calls
// every coalesce tick during a gc outage (architect H1).
//
// The app-level NowProvider refreshes relative-time labels in lane cards;
// SSE is the path for actual data updates.

const REFRESH_DEBOUNCE_MS = 10_000;
const RUN_PHASE_GRAMMAR =
  'Phase grammar: intake, implementation, review, approval, finalization.';
const HISTORY_QUERY_PARAM = 'history';
const HISTORY_QUERY_VALUE = '1';

export function RunsPage() {
  const attention = useAttentionModel();
  const cityName = getActiveCity();
  const { data, loading, error, refresh } = useCachedData(
    `runs:summary:${cityName ?? 'no-city'}`,
    loadSupervisorRunSummarySource,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  // gascity-dashboard-yh5i: ?history=1 toggles the historical lane
  // section. Pure render-time state — the summary already carries both
  // active + historical arrays, so the toggle does not trigger a fetch
  // and useCachedData's run-summary cache key stays stable across modes.
  const showHistory = searchParams.get(HISTORY_QUERY_PARAM) === HISTORY_QUERY_VALUE;
  const now = useNow();
  const runsStatusRef = useRef<SourceStatus | null>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const lastRefreshAtRef = useRef(0);
  const runs = data ?? null;
  runsStatusRef.current = runs?.status ?? null;
  const runsData =
    runs?.status === 'fresh' || runs?.status === 'fixture' || runs?.status === 'stale'
      ? runs.data
      : null;
  const totalHistorical = runsData?.totalHistorical ?? 0;
  // gascity-dashboard-n6f1: the backend now degrades (not collapses) when a
  // single rig's recent-run query fails, flagging lanesPartial. Surface it
  // so the operator reads a short lane set as "some rigs unavailable" rather
  // than "everything's done." Mirrors the roster-partial signal in Agents.tsx.
  const lanesPartial = runsData?.lanesPartial === true;

  const toggleHistory = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (showHistory) {
          next.delete(HISTORY_QUERY_PARAM);
        } else {
          next.set(HISTORY_QUERY_PARAM, HISTORY_QUERY_VALUE);
        }
        return next;
      },
      { replace: false },
    );
  }, [showHistory, setSearchParams]);

  const onSseMatch = useCallback(() => {
    // Skip when supervisor is unreachable — every forced refresh under
    // fixture-fallback re-runs loadFixture(), which is wasted file IO.
    if (runsStatusRef.current !== "fresh") return;
    // Skip when an explicit refresh is already in flight. Without this
    // guard, a fast SSE event firing while a slow upstream call is
    // still resolving lets two requests race; older-completion can
    // overwrite newer data via last-write-wins in setCached.
    if (loadingRef.current) return;
    const elapsed = Date.now() - lastRefreshAtRef.current;
    if (elapsed < REFRESH_DEBOUNCE_MS) return;
    lastRefreshAtRef.current = Date.now();
    void refresh().catch(() => {
      // Reset on error so the next event retries instead of being
      // silently dropped for the rest of the 10s debounce window.
      lastRefreshAtRef.current = 0;
    });
  }, [refresh]);

  const sseState = useGcEventRefresh([GC_EVENT_PREFIX.bead], onSseMatch);
  const runAttentionSeverity = useCallback(
    (lane: RunLane) => resourceAttentionSeverity(attention, 'runs', lane.id),
    [attention],
  );

  const synopsis = runSynopsis(data);

  const freshnessLabel = runs
    ? runs.status === "fresh"
      ? null
      : runs.status === "fixture"
        ? "fixture data"
        : runs.status === "error"
          ? "live data unavailable"
          : runs.fetchedAt
            ? `stale ${formatRelative(runs.fetchedAt, now)} ago`
            : "stale"
    : null;

  return (
    <section>
      <PageHeader
        title="Formula Runs"
        synopsis={synopsis}
        meta={
          <>
            {error && (
              <span className="normal-case text-body text-accent" role="alert">
                {error}
              </span>
            )}
            {freshnessLabel !== null && (
              <span
                className={`text-label uppercase tracking-wider tnum ${
                  runs?.status === "error" ? "text-accent" : "text-fg-faint"
                }`}
              >
                {freshnessLabel}
              </span>
            )}
            <PartialDataNotice
              show={lanesPartial}
              label="runs partial"
              title="one or more rigs' recent runs were unavailable; the lane set may be incomplete"
            />
            <SseIndicator state={sseState} />
            <Button
              size="sm"
              onClick={toggleHistory}
              // yh5i: disable only when the toggle is off AND there's
              // nothing to show. If the user already opened history
              // (showHistory=true) we must let them close it, even if
              // the last historical lane has since dropped out — otherwise
              // a back-button + SSE refresh sequence locks the toggle open.
              disabled={!showHistory && totalHistorical === 0}
              aria-expanded={showHistory}
              // aria-controls only references the historical section's id
              // when that element is actually in the DOM; the WAI-ARIA
              // spec requires referenced ids to exist.
              {...(showHistory ? { 'aria-controls': RUNS_HISTORICAL_SECTION_ID } : {})}
              aria-label={
                showHistory
                  ? 'Hide historical formula runs.'
                  : totalHistorical === 0
                    ? 'No completed formula runs in the current window.'
                    : `Show ${totalHistorical} completed formula runs.`
              }
            >
              {showHistory
                ? 'Hide history'
                : totalHistorical > 0
                  ? `Show history (${totalHistorical})`
                  : 'Show history'}
            </Button>
            <Button size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? "Refreshing" : "Refresh"}
            </Button>
          </>
        }
      />

      {data === undefined || runs === null ? (
        <p className="text-body text-fg-muted italic">Loading formula runs.</p>
      ) : (
        <RunMap
          source={runs}
          now={now}
          showHistory={showHistory}
          attentionSeverity={runAttentionSeverity}
        />
      )}
    </section>
  );
}

function runSynopsis(data: SourceState<RunSummary> | undefined): string {
  if (data === undefined) return "Loading formula run lanes.";

  if (data.status !== 'error') {
    return `${data.data.totalActive} active runs across the supervisor's bead store. ${RUN_PHASE_GRAMMAR}`;
  }

  return `Run counts unavailable: ${data.error}. ${RUN_PHASE_GRAMMAR}`;
}
