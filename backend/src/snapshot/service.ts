import type {
  AlertItem,
  CityStatusSummary,
  DashboardHeadline,
  DashboardMetric,
  DashboardRuntimeConfig,
  DashboardSnapshot,
  DashboardSources,
  GcSession,
  GcSessionList,
  ResourceSummary,
  RunSummary,
  SourceAvailableState,
  SourceName,
  SourceState,
  SourceStatus,
  WorkSummary,
} from 'gas-city-dashboard-shared';

import type { GcClient } from '../gc-client.js';
import { deriveRunAlerts } from './alerts.js';
import { SourceCache } from './cache.js';
import { createSupervisorPendingSubscriber } from './pending-subscriber.js';
import { PendingStore } from './pending-store.js';
import {
  PendingSubscriptionManager,
  type SessionStreamSubscriber,
} from './pending-subscriptions.js';
import { createCityStatusSourceCache } from './collectors/cityStatus.js';
import { createResourcesSourceCache } from './collectors/resources.js';
import { createRunsSourceCache } from './collectors/runs.js';
import { createWorkSourceCache } from './collectors/work.js';
import { fixtureSourceLoader } from './fixtures/loader.js';
import { fixtureSessions } from './fixtures/snapshot.js';
import {
  advanceProgressMarks,
  deriveRunHealth,
  type LaneProgressMark,
} from './health.js';

/**
 * TTL for the shared sessions cache (gascity-dashboard-3ax). Matches the
 * city collector's 45s — the tighter of city(45s)/runs(60s) — so the
 * bead×session join in the health engine never reads session liveness
 * staler than the city view already shows.
 */
export const SESSIONS_CACHE_TTL_MS = 45 * 1000;

// SnapshotService — gascity-dashboard-8nj. Composes the active SourceCaches
// behind one aggregate getSnapshot()/refresh() facade. Runtime collectors use
// GcClient HTTP calls as the canonical supervisor contract. Only sources with
// visible dashboard product surface participate in the snapshot contract.
// Runs runs the lane builder over gc.listBeads({ limit }) with the
// co-located runBeadFilter.

export const SOURCE_NAMES = [
  'city',
  'resources',
  'runs',
  'work',
] as const satisfies readonly SourceName[];

export interface SourceCacheMap {
  city: SourceCache<CityStatusSummary>;
  resources: SourceCache<ResourceSummary>;
  runs: SourceCache<RunSummary>;
  work: SourceCache<WorkSummary>;
}

export interface SnapshotHealth {
  ok: true;
  uptimeSeconds: number;
  lastSnapshotAt: string | null;
  lastSnapshotDurationMs: number | null;
  lastRefreshAt: string | null;
  lastRefreshDurationMs: number | null;
  sources: Record<SourceName, SourceStatus>;
}

export interface SnapshotService {
  getSnapshot: () => Promise<DashboardSnapshot>;
  refresh: (sources?: readonly SourceName[]) => Promise<DashboardSnapshot>;
  health: () => SnapshotHealth;
  /**
   * Current city-wide pending-decision alerts (gascity-dashboard-mbcy, R3).
   * Sourced from the per-session pending aggregator, which is fed as a side
   * effect of each snapshot read reconciling its active-session set. Empty
   * when no aggregator is wired (fixtures / no gc) or nothing is pending.
   * Layer 3 (26zl) streams this to the home view.
   */
  pendingAlerts: () => readonly AlertItem[];
  /**
   * Register a live pending-feed consumer (gascity-dashboard-26zl, Layer 3).
   * The aggregator activates (starts subscribing to active sessions) while ≥1
   * consumer is registered and tears down when the last unsubscribes — so no
   * SSE fan-out runs without a consumer. `listener` fires on every change; read
   * the current set via pendingAlerts(). Returns an unsubscribe function.
   */
  streamPending: (listener: () => void) => () => void;
  /** Tear down the pending aggregator's subscriptions + consumers (shutdown). */
  closePending: () => void;
}

export interface CreateSnapshotServiceOptions {
  /** Shared GcClient instance — must NOT be re-instantiated per request. */
  gc?: GcClient | undefined;
  /** Pre-built cache map. Tests inject this directly for spy-tracked loaders. */
  caches?: SourceCacheMap | undefined;
  /**
   * Shared sessions cache (gascity-dashboard-3ax). Feeds BOTH the city
   * collector's listSessions seam and the run-health engine's
   * bead×session join, so one gc.listSessions() per TTL window backs both —
   * never a 2nd independent fetch (PRD R2). NOT a wire-shape source: raw
   * sessions stay off /api/snapshot (payload size). Tests may inject a
   * spy-tracked cache; otherwise built from `gc`.
   */
  sessions?: SourceCache<GcSessionList> | undefined;
  /**
   * Per-session pending subscriber (gascity-dashboard-mbcy). Injected in tests
   * with a fake; in production defaults to the supervisor SSE subscriber when
   * `gc` is present and fixtures are off. When neither is available the pending
   * aggregator stays inert (pendingAlerts() === []).
   */
  pendingSubscriber?: SessionStreamSubscriber | undefined;
  config: DashboardRuntimeConfig;
  now?: (() => Date) | undefined;
  uptimeSeconds?: (() => number) | undefined;
}

/** Sessions worth observing for pending decisions — the live (active) ones. */
function activeSessionIds(items: readonly GcSession[]): string[] {
  return items.filter((session) => session.state === 'active').map((session) => session.id);
}

const sourceNameSet = new Set<string>(SOURCE_NAMES);

export function createSnapshotService(
  options: CreateSnapshotServiceOptions,
): SnapshotService {
  const now = options.now ?? (() => new Date());
  const startedAtMs = Date.now();
  const uptimeSeconds =
    options.uptimeSeconds ?? (() => Math.max(0, (Date.now() - startedAtMs) / 1000));
  // Sessions cache first — the city collector's seam reads from it, so it
  // must exist before buildDefaultCaches wires city.
  const sessionsCache = options.sessions ?? buildSessionsCache(options);
  const caches = options.caches ?? buildDefaultCaches(options, sessionsCache);

  // Cross-cycle progress marks for the monotonicity predicate (R1) +
  // hysteresis (R8). Ephemeral process state, NOT a persistence layer (R7):
  // it carries no historical baseline and resets on restart. Advanced ONLY
  // when the runs cache produces a STRICTLY NEWER generation (monotonic on
  // fetchedAt), so concurrent GET/POST builds reading one frozen generation
  // can't clobber the streak. The advance is synchronous, so each build runs
  // it atomically before yielding — this safety holds ONLY because enrichRuns
  // contains no `await`; do not introduce one inside it.
  let progressMarks = new Map<string, LaneProgressMark>();
  let marksFetchedAt: string | null = null;

  // Per-session pending aggregator (gascity-dashboard-mbcy, R3, Option A). The
  // store is always present (cheap, in-memory); the manager only runs when a
  // subscriber is available — injected in tests, else the real supervisor SSE
  // subscriber when gc is present and fixtures are off. No subscriber => the
  // aggregator stays inert and pendingAlerts() returns []. The store holds NO
  // persisted state (R13) and is reconciled to the active-session set on each
  // read, so a gone session's pending cannot linger.
  const pendingStore = new PendingStore();
  const pendingListeners = new Set<() => void>();
  const notifyPending = (): void => {
    for (const listener of pendingListeners) listener();
  };
  const pendingSubscriber =
    options.pendingSubscriber ??
    (options.gc !== undefined && !options.config.useFixtures
      ? createSupervisorPendingSubscriber({
          streamUrl: (sessionId, after) => options.gc!.sessionStreamUrl(sessionId, after),
        })
      : undefined);
  const pendingManager =
    pendingSubscriber !== undefined
      ? new PendingSubscriptionManager({
          subscriber: pendingSubscriber,
          store: pendingStore,
          now,
          onChange: notifyPending,
        })
      : undefined;
  // Lazy activation: the aggregator only fans out per-session SSE while at least
  // one consumer is streaming (Layer 3), so a backend with no home viewer opens
  // no connections. Snapshot reads reconcile the active set only while active.
  let pendingConsumers = 0;
  const pendingActive = (): boolean => pendingConsumers > 0;
  const activatePending = (): void => {
    if (pendingManager === undefined) return;
    // Kick an immediate sessions read + sync so a new consumer needn't wait for
    // the next snapshot poll. Best-effort; a sessions failure degrades to quiet.
    void sessionsCache
      .get()
      .then((state) => {
        if (pendingActive() && sourceIsAvailable(state)) {
          pendingManager.syncActiveSessions(activeSessionIds(state.data.items));
        }
      })
      .catch(() => {});
  };
  const deactivatePending = (): void => {
    pendingManager?.closeAll();
    pendingStore.retainActive([]); // drop stale pending so re-activation starts clean
  };

  let lastSnapshotAt: string | null = null;
  let lastSnapshotDurationMs: number | null = null;
  let lastRefreshAt: string | null = null;
  let lastRefreshDurationMs: number | null = null;

  const enrichRuns = (
    sources: DashboardSources,
    sessionsState: SourceState<GcSessionList>,
  ): DashboardSources => {
    const wf = sources.runs;
    if (!sourceIsAvailable(wf)) return sources;
    const sessionsAvailable = sourceIsAvailable(sessionsState);

    // A sessions read failure degrades confidence (all lanes inferred, no
    // maroon — R2 fail-safe); it never blanks the lanes.
    //
    // Advance the monotonicity marks ONLY when this build's runs generation is
    // STRICTLY NEWER than the one the marks already reflect (gascity-dashboard-7u5a).
    // An identity compare (`!== marksFetchedAt`) was insufficient: two reads
    // straddling a generation boundary — an ambient GET poll capturing T1 and a
    // POST /refresh capturing T2 — can enrich out of order, and a late older
    // read (T1 !== T2) would re-run advanceProgressMarks with the OLDER lanes,
    // resetting/double-counting the thrashStreak hysteresis (R8) the client
    // cannot recompute (R1). With a strictly-newer compare a late older-or-equal
    // read is a no-op for the marks. It still derives its own (older) lanes
    // against the newer streak, which is fail-safe: thrashStreak is keyed by
    // lane.id, and a lane absent from the newer generation reads 0 — so the skew
    // can never fabricate a maroon One Mark (R2). The `=== null` arm seeds the
    // cold start; Date.parse(null) is NaN and `x > NaN` is always false, which
    // would otherwise silently disable thrash detection entirely.
    const generationMs = Date.parse(wf.fetchedAt);
    if (marksFetchedAt === null || generationMs > Date.parse(marksFetchedAt)) {
      progressMarks = advanceProgressMarks(progressMarks, wf.data.lanes);
      marksFetchedAt = wf.fetchedAt;
    }

    const { lanes, census } = deriveRunHealth({
      lanes: wf.data.lanes,
      sessions: sessionsAvailable ? sessionsState.data.items : [],
      sessionsAvailable,
      marks: progressMarks,
    });

    return {
      ...sources,
      runs: {
        ...wf,
        data: { ...wf.data, lanes, census: { status: 'available', data: census } },
      },
    };
  };

  const readSnapshot = async (
    refreshSources?: ReadonlySet<SourceName>,
  ): Promise<DashboardSnapshot> => {
    const startedAt = Date.now();
    // Read sessions in the SAME mode as runs so the bead×session join
    // samples one instant — a TTL desync would cross two clocks (R2).
    const [sources, sessionsState] = await Promise.all([
      readSources(caches, refreshSources),
      readSessions(sessionsCache, refreshSources),
    ]);
    // Reconcile the pending aggregator to the active-session set (R3). This is
    // synchronous and runs OUTSIDE enrichRuns, preserving that function's
    // load-bearing no-`await` invariant. A sessions read failure leaves the
    // current subscriptions untouched (degrade-to-quiet, not blank).
    if (pendingManager !== undefined && pendingActive() && sourceIsAvailable(sessionsState)) {
      pendingManager.syncActiveSessions(activeSessionIds(sessionsState.data.items));
    }
    const snapshot = buildSnapshot(
      options.config,
      enrichRuns(sources, sessionsState),
      now(),
    );
    const durationMs = Date.now() - startedAt;

    lastSnapshotAt = snapshot.generatedAt;
    lastSnapshotDurationMs = durationMs;
    if (refreshSources !== undefined) {
      lastRefreshAt = snapshot.generatedAt;
      lastRefreshDurationMs = durationMs;
    }

    return snapshot;
  };

  return {
    getSnapshot: () => readSnapshot(),
    refresh: (sources) => {
      const selected =
        sources && sources.length > 0
          ? SOURCE_NAMES.filter((name) => sources.includes(name))
          : SOURCE_NAMES;
      return readSnapshot(new Set(selected));
    },
    health: () => ({
      ok: true,
      uptimeSeconds: uptimeSeconds(),
      lastSnapshotAt,
      lastSnapshotDurationMs,
      lastRefreshAt,
      lastRefreshDurationMs,
      sources: sourceStatuses(caches),
    }),
    // 'fresh' provenance for now: the aggregator keeps last-known pending and
    // reconciles every read. A liveness-aware provenance (degraded when the
    // dashboard stream / subscriptions are dark) is Layer 3's job (26zl, R16).
    pendingAlerts: () => pendingStore.alerts('fresh'),
    streamPending: (listener) => {
      pendingListeners.add(listener);
      pendingConsumers += 1;
      if (pendingConsumers === 1) activatePending();
      return () => {
        if (!pendingListeners.delete(listener)) return;
        pendingConsumers -= 1;
        if (pendingConsumers === 0) deactivatePending();
      };
    },
    closePending: () => {
      pendingListeners.clear();
      pendingConsumers = 0;
      pendingManager?.closeAll();
    },
  };
}

export function isSourceName(value: unknown): value is SourceName {
  return typeof value === 'string' && sourceNameSet.has(value);
}

export function buildSnapshot(
  config: DashboardRuntimeConfig,
  sources: DashboardSources,
  generatedAt: Date,
): DashboardSnapshot {
  return {
    generatedAt: generatedAt.toISOString(),
    config,
    headline: buildHeadline(sources),
    sources,
    alerts: deriveRunAlerts(sources.runs),
  };
}

/**
 * Shared sessions cache (gascity-dashboard-3ax). Labeled with the 'city'
 * SourceName because it IS the city's session list — but it is held privately
 * by the service and never placed in DashboardSources, so raw sessions stay
 * off the /api/snapshot wire. sanitizeErrorMessage:null mirrors the city/
 * runs posture: GcClient already throws operator-safe messages.
 *
 * Without a live `gc` (test injection of `caches` only), returns an
 * empty-sessions cache so the health engine degrades every lane to
 * unresolved/inferred — the same fail-safe as a live sessions failure.
 */
function buildSessionsCache(options: CreateSnapshotServiceOptions): SourceCache<GcSessionList> {
  const { gc, now } = options;
  const useFixture = options.config.useFixtures;

  if (!gc) {
    return new SourceCache<GcSessionList>({
      source: 'city',
      ttlMs: SESSIONS_CACHE_TTL_MS,
      now,
      sanitizeErrorMessage: null,
      load: () => ({ items: [], total: 0 }),
    });
  }

  return new SourceCache<GcSessionList>({
    source: 'city',
    ttlMs: SESSIONS_CACHE_TTL_MS,
    now,
    sanitizeErrorMessage: null,
    load: () => gc.listSessions(),
    useFixture,
    loadFixture: useFixture ? () => fixtureSessions : undefined,
  });
}

function buildDefaultCaches(
  options: CreateSnapshotServiceOptions,
  sessionsCache: SourceCache<GcSessionList>,
): SourceCacheMap {
  if (!options.gc) {
    throw new Error(
      'createSnapshotService requires either { gc } (to build default caches) or { caches } (pre-built).',
    );
  }
  const { gc, config, now } = options;
  const useFixture = config.useFixtures;

  return {
    city: createCityStatusSourceCache({
      gc,
      now,
      useFixture,
      loadFixture: useFixture ? fixtureSourceLoader('city') : undefined,
      // Read sessions from the shared cache (gascity-dashboard-3ax) instead
      // of calling gc.listSessions() directly, so the city aggregate and the
      // run-health join share ONE underlying fetch per TTL window (R2).
      // Throw on a sessions failure so the city source surfaces status='error'
      // exactly as it did when it owned the fetch — preserving failure
      // isolation rather than silently aggregating an empty list.
      listSessions: async () => {
        const state = await sessionsCache.get();
        if (!sourceIsAvailable(state)) {
          throw new Error(state.error);
        }
        return state.data;
      },
    }),
    resources: createResourcesSourceCache({
      now,
      useFixture,
      loadFixture: useFixture ? fixtureSourceLoader('resources') : undefined,
    }),
    runs: createRunsSourceCache({
      gc,
      now,
      useFixture,
      loadFixture: useFixture ? fixtureSourceLoader('runs') : undefined,
    }),
    work: createWorkSourceCache({
      gc,
      now,
      useFixture,
      loadFixture: useFixture ? fixtureSourceLoader('work') : undefined,
    }),
  };
}

async function readSources(
  caches: SourceCacheMap,
  refreshSources?: ReadonlySet<SourceName>,
): Promise<DashboardSources> {
  // Three call modes per source:
  //   - refreshSources includes it → cache.refresh() (force re-fetch)
  //   - refreshSources is set but excludes it → cache.snapshot() (read-only)
  //   - refreshSources is undefined → cache.get() (normal TTL-driven path)
  const useSnapshotOnly = refreshSources !== undefined;
  const pick = <T>(name: SourceName, cache: SourceCache<T>) => {
    if (refreshSources?.has(name)) return cache.refresh();
    if (useSnapshotOnly) return Promise.resolve(cache.snapshot());
    return cache.get();
  };

  // settle wraps pick() so a rejection from any single cache becomes a
  // wire-shape SourceState envelope with status='error' instead of
  // propagating. This is the snapshot route's failure-isolation
  // guarantee, owned at the composition layer rather than SourceCache's
  // internal try/catch. If a future collector wrapper escapes the
  // cache's catch (sync throw before refreshUnshared's try, returned
  // rejected promise, etc.), the dashboard still serves a partial
  // envelope — never 500s the whole route. Regression-guarded by
  // backend/test/snapshot-failure-isolation.test.ts (gascity-dashboard-9tv).
  //
  // The caught error is routed through cache.sanitize() before landing
  // on the wire: the very scenario this wrapper protects against (an
  // escape from refreshUnshared's internal catch) is also the scenario
  // where SourceCache.sanitize never ran. Without delegating here, the
  // settle wrapper would silently leak the raw error.message — defeating
  // the default-on sanitization contract added in gascity-dashboard-4r5.
  const settle = async <T>(
    name: SourceName,
    cache: SourceCache<T>,
  ): Promise<SourceState<T>> => {
    try {
      return await pick(name, cache);
    } catch (error) {
      return errorState(cache, error);
    }
  };

  const [city, resources, runs, work] = await Promise.all([
    settle('city', caches.city),
    settle('resources', caches.resources),
    settle('runs', caches.runs),
    settle('work', caches.work),
  ]);

  return { city, resources, runs, work };
}

/**
 * Read the shared sessions cache in the SAME mode the runs source is
 * read (gascity-dashboard-3ax), so the bead×session join samples one instant:
 *   - normal GET (refreshSources undefined) → get() (TTL-driven)
 *   - POST /refresh including 'runs' → refresh() (force same-instant)
 *   - POST /refresh excluding 'runs' → snapshot() (read-only)
 * A failure surfaces as a SourceState with status='error'; the health engine
 * then degrades every lane to unresolved/inferred (R2 fail-safe) — it never
 * throws here, so a sessions outage can't 500 the snapshot.
 */
async function readSessions(
  cache: SourceCache<GcSessionList>,
  refreshSources?: ReadonlySet<SourceName>,
): Promise<SourceState<GcSessionList>> {
  try {
    if (refreshSources === undefined) return await cache.get();
    if (refreshSources.has('runs')) return await cache.refresh();
    return cache.snapshot();
  } catch (error) {
    return errorState(cache, error);
  }
}

/**
 * Wire-shape failure envelope shared by readSources' settle wrapper and
 * readSessions: a thrown error becomes a SourceState with status='error',
 * and the message routed through cache.sanitize() (so the escape scenarios
 * these wrappers guard against still get the default-on sanitization from
 * gascity-dashboard-4r5).
 */
function errorState<T>(cache: SourceCache<T>, error: unknown): SourceState<T> {
  const current = cache.snapshot();
  return {
    source: current.source,
    status: 'error',
    error: cache.sanitize(error),
  };
}

function buildHeadline(sources: DashboardSources): DashboardHeadline {
  return {
    activeAgents: cityMetric(sources.city, 'activeAgents'),
    maxAgents: cityMetricState(sources.city, (city) => city.maxSessions),
    activeSessions: cityMetric(sources.city, 'activeSessions'),
    activeRuns: sourceMetric(
      sources.runs,
      activeRunCount,
      'active run count',
    ),
    workInProgress: sourceMetric(
      sources.work,
      (work) => work.inProgress,
      'in-progress work count',
    ),
  };
}

function activeRunCount(runs: RunSummary): number {
  if (runs.census.status === 'available') {
    return runs.census.data.totalInFlight;
  }
  // yh5i: `runs.lanes` is the active subset (the collector splits
  // complete lanes into `historicalLanes` before serving). The previous
  // explicit phase filter was a defense against an older invariant
  // where `lanes` held every phase; it's a no-op now.
  return runs.lanes.length;
}

function cityMetric(
  state: SourceState<CityStatusSummary>,
  key: keyof Pick<CityStatusSummary, 'activeAgents' | 'activeSessions'>,
): DashboardMetric {
  return sourceMetric(state, (city) => city[key], key);
}

function cityMetricState(
  state: SourceState<CityStatusSummary>,
  readMetric: (data: CityStatusSummary) => DashboardMetric,
): DashboardMetric {
  if (!sourceIsAvailable(state)) {
    return {
      status: 'unavailable',
      source: state.source,
      error: state.error,
    };
  }

  return readMetric(state.data);
}

function sourceMetric<T>(
  state: SourceState<T>,
  readValue: (data: T) => number,
  label: string,
): DashboardMetric {
  if (!sourceIsAvailable(state)) {
    return {
      status: 'unavailable',
      source: state.source,
      error: state.error,
    };
  }

  const value = readValue(state.data);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { status: 'available', value };
  }

  return {
    status: 'unavailable',
    source: state.source,
    error: `${label} missing from ${state.source} source`,
  };
}

function sourceIsAvailable<T>(state: SourceState<T>): state is SourceAvailableState<T> {
  return state.status !== 'error';
}

function sourceStatuses(caches: SourceCacheMap): Record<SourceName, SourceStatus> {
  return {
    city: caches.city.snapshot().status,
    resources: caches.resources.snapshot().status,
    runs: caches.runs.snapshot().status,
    work: caches.work.snapshot().status,
  };
}
