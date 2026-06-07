import {
  GC_EVENT_PREFIX,
  type RunLane,
  type RunSummary,
  type SourceState,
  type SourceStatus,
} from 'gas-city-dashboard-shared';
import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getActiveCity } from '../api/cityBase';
import { useAttentionModel } from '../attention/context';
import { resourceAttentionSeverity } from '../attention/routeHighlight';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { PartialDataNotice } from '../components/PartialDataNotice';
import { SseIndicator } from '../components/SseIndicator';
import { RunMap, RUNS_HISTORICAL_SECTION_ID } from '../components/run/RunMap';
import { useNow } from '../contexts/NowContext';
import { formatRelative } from '../hooks/time';
import { useCachedData } from '../hooks/useCachedData';
import { useGcEventRefresh } from '../hooks/useGcEvents';
import {
  loadSupervisorRunSummaryPreviewSource,
  loadSupervisorRunSummarySource,
} from '../supervisor/runSummary';

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
// supervisor listBeads({ limit: 1000 }) call (architect H2 — upstream-load
// protection during slung-pipeline bursts). The callback also no-ops
// when the runs source is in fixture-fallback mode (gc down) so
// the dashboard's own host doesn't get hammered with loadFixture calls
// every coalesce tick during a gc outage (architect H1).
//
// The app-level NowProvider refreshes relative-time labels in lane cards;
// SSE is the path for actual data updates.

const REFRESH_DEBOUNCE_MS = 10_000;
// gascity-dashboard-4xcv: bounded retry backoff for a degraded first load
// (error source, or a partial fetch that produced zero lanes). The operator
// saw an empty tab that needed 2-3 manual refreshes; these retries recover
// transient supervisor warm-up failures without her. After the budget is
// spent, SSE events and the manual Refresh button take over.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const RUN_PHASE_GRAMMAR = 'Phase grammar: intake, implementation, review, approval, finalization.';
const HISTORY_QUERY_PARAM = 'history';
const HISTORY_QUERY_VALUE = '1';

export function RunsPage() {
  const attention = useAttentionModel();
  const cityName = getActiveCity();
  const { data, loading, error, refresh } = useCachedData(
    `runs:summary:${cityName ?? 'no-city'}`,
    loadSupervisorRunSummaryPreviewSource,
    { refreshFetcher: loadSupervisorRunSummarySource },
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
  const fullRefreshKeyRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (runs === null || runs.status === 'error') return;
    const refreshKey = cityName ?? 'no-city';
    if (fullRefreshKeyRef.current === refreshKey) return;
    fullRefreshKeyRef.current = refreshKey;
    void refresh().catch(() => {
      fullRefreshKeyRef.current = null;
    });
  }, [cityName, refresh, runs]);

  // gascity-dashboard-4xcv: bounded auto-retry on a degraded load. An error
  // source (or a partial fetch with zero lanes) used to latch the page dead:
  // the SSE callback skipped non-fresh sources and the one-time full refresh
  // bailed on error, so only a manual Refresh recovered. Retry a few times
  // with backoff, and reset the budget once a healthy load lands.
  const retryAttemptRef = useRef(0);
  useEffect(() => {
    if (runs === null) return;
    const degraded =
      runs.status === 'error'
        ? true
        : runs.data.lanesPartial === true &&
          runs.data.lanes.length === 0 &&
          runs.data.blockedLanes.length === 0;
    if (!degraded) {
      retryAttemptRef.current = 0;
      return;
    }
    const delay = RETRY_DELAYS_MS[retryAttemptRef.current];
    if (delay === undefined) return;
    retryAttemptRef.current += 1;
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [runs, refresh]);

  const onSseMatch = useCallback(() => {
    // Skip when fixtures are serving (supervisor down) — every forced
    // refresh under fixture-fallback re-runs loadFixture(), which is wasted
    // file IO. An 'error' or 'stale' source is the opposite case: a bead
    // event is exactly the cue to try loading live data again
    // (gascity-dashboard-4xcv).
    if (runsStatusRef.current === null || runsStatusRef.current === 'fixture') return;
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
    ? runs.status === 'fresh'
      ? null
      : runs.status === 'fixture'
        ? 'fixture data'
        : runs.status === 'error'
          ? 'live data unavailable'
          : runs.fetchedAt
            ? `stale ${formatRelative(runs.fetchedAt, now)} ago`
            : 'stale'
    : null;

  return (
    <section>
      <PageHeader
        title="Formula Runs"
        synopsis={synopsis}
        className="md:items-start"
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
                  runs?.status === 'error' ? 'text-accent' : 'text-fg-faint'
                }`}
              >
                {freshnessLabel}
              </span>
            )}
            <div className="grid w-full min-w-[18rem] grid-cols-[7rem_minmax(6.5rem,1fr)] items-center gap-x-4 gap-y-3 sm:w-[34rem] sm:grid-cols-[7rem_6.5rem_10rem_7rem]">
              <SseIndicator state={sseState} />
              <span>
                {lanesPartial ? (
                  <PartialDataNotice
                    glyph="◐"
                    label="runs partial"
                    title="one or more rigs' recent runs were unavailable; the lane set may be incomplete"
                  />
                ) : (
                  <span aria-hidden="true" className="invisible normal-case text-body text-warn">
                    runs partial
                  </span>
                )}
              </span>
              <Button
                size="sm"
                className="w-full justify-center"
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
              <Button
                size="sm"
                className="w-full justify-center"
                onClick={() => void refresh()}
                disabled={loading}
              >
                {loading ? 'Refreshing' : 'Refresh'}
              </Button>
            </div>
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
  if (data === undefined) return 'Loading formula run lanes.';

  if (data.status !== 'error') {
    return `${data.data.totalActive} active runs across the supervisor's bead store. ${RUN_PHASE_GRAMMAR}`;
  }

  return `Run counts unavailable: ${data.error}. ${RUN_PHASE_GRAMMAR}`;
}
