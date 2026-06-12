import type {
  DashboardBead,
  DashboardSession,
  RunFeedScope,
  RunFeedScopeMap,
  RunHistory,
  RunRegistryObservation,
  RunSummary,
  SourceAvailableState,
  SourceState,
} from 'gas-city-dashboard-shared';
import {
  advanceProgressMarks,
  buildCensus,
  buildRunHistory,
  buildRunSummary,
  deriveRunHealth,
  fromFeedScope,
  fromDashboardBead,
  fromRootMetadataScope,
  fromStoreRef,
  isStaleSessionlessLatch,
  runBeadFilter,
  runCounts,
  SCOPE_REF_RE,
  type LaneProgressMark,
} from 'gas-city-dashboard-shared';
import { activeCityOrThrow } from '../api/cityBase';
import type { FormulaFeedBody, ListBodyBead } from 'gas-city-dashboard-shared/gc-supervisor';
import { supervisorApiForRequestBudget } from './client';
import { fetchCoreRead } from './coreRead';
import { listIsIncomplete, listIsPartial } from './listPartial';
import { normalizeBeads } from './normalizeBead';
import { normalizeSessions } from './sessionReads';

// Pre-exposure load bound (gascity-dashboard-q89b): the primary in-flight
// bead fetch refreshes on SSE bursts (10s debounce floor in the shared
// run-summary subscription) per client. listIsIncomplete keeps truncation
// visible in the lanes-partial signal.
const RUNS_FETCH_LIMIT = 500;
// gascity-dashboard-4xcv: the supervisor's bead list has no sort/recency
// guarantee, so a small `all=true` window can drop run roots and step beads
// arbitrarily — observed live as an empty first paint and a history list
// missing most completed runs (a busy rig store holds hundreds of closed
// task beads). 500 covers the largest observed store with headroom; if a
// store outgrows it the symptom returns as silently missing lanes, so a
// real fix beyond raising the cap means cursor pagination. Used only by the
// lazy history fan-out now (header-first).
const RECENT_RUN_FETCH_LIMIT = 500;
const RUNS_STALE_AFTER_MS = 60 * 1000;
// The CORE active-bead read is the one fetch whose failure blanks the whole runs
// view (everything else degrades to `partial`). The proxy path is ~0.02s
// normally, but the box runs at load avg ~30 under a slung-pipeline burst (the
// supervisor reconciler alone hits ~274% CPU), and during a spike a single core
// read occasionally crosses the old 5s budget → a first load with no last-good
// snapshot blanks to "Run data unavailable". Raise this read's ceiling to absorb
// a burst (the higher bound only costs time when actually slow), and retry once
// on a transient timeout/5xx before giving up. A real outage still surfaces an
// error after the retries are spent — the resilience only hides a brief spike,
// never a sustained failure (upstream gascity-dashboard#88).
const REQUIRED_RUN_SUMMARY_TIMEOUT_MS = 15_000;
// Optional run-summary enrichment (recent-bead / formula-feed / session reads)
// is best-effort: a miss degrades the lanes to "partial" rather than failing the
// load. The budget is split by call site (gascity-dashboard-4bol). The preview
// runs on first paint and blocks it, so it keeps a tight bound and the tab paints
// fast even when the supervisor is slow. The full source runs only as the shared
// run-summary subscription's background refreshFetcher, so it can afford a far
// wider budget matching the 30s
// background status samplers: on the bloated store the supervisor's list/feed
// reads run ~10-38s (upstream gascity-dashboard#88), so a 2.5s interactive bound
// always times out and latches a spurious "runs partial" badge. The wider refresh
// budget lets those slow-but-available reads land and clear it, without the
// first-paint spinner a single global raise would cause.
const PREVIEW_ENRICHMENT_TIMEOUT_MS = 2_500;
const REFRESH_ENRICHMENT_TIMEOUT_MS = 30_000;
// Header-first restructure (supersedes the gascity-dashboard-9rk2 3s molecule
// bound): the closed-history fan-out — the molecule(all=true) scan over the
// ~340k-row history (measured 9.9s live, so it timed out against the old 3s
// bound on EVERY refresh and chronically latched the "runs partial" badge) plus
// the per-rig task(all=true) closed reads (measured 10.9s on a 29.8k-issue rig
// store) — now runs ONLY on the lazy history source, fetched when the operator
// opens the /runs history section. There it IS the payload, so it rides this
// wide budget (matching the refresh budget / the 30s background samplers) and
// the measured reads land instead of degrading. A genuinely slow scan still
// folds to history-partial, never an error.
const HISTORY_ENRICHMENT_TIMEOUT_MS = 30_000;

interface LoadedRunBeads {
  beads: DashboardBead[];
  feedScopes: RunFeedScopeMap;
  /**
   * Root ids the feed listed in THIS load, regardless of the read's
   * completeness — a partial or root-incomplete read cannot prove absence,
   * but it still proves presence for every root it lists. Null when the load
   * never read the feed (the cheap active source).
   */
  feedRootIds: ReadonlySet<string> | null;
  partial: boolean;
}

type RecentFetchOutcome = { ok: true; items: DashboardBead[]; partial: boolean } | { ok: false };

type RunSessionsLookup =
  | { kind: 'available'; sessions: DashboardSession[] }
  | { kind: 'unavailable'; sessions: DashboardSession[] };

interface ProgressState {
  marks: Map<string, LaneProgressMark>;
  fetchedAt: string;
}

const progressStateByCity = new Map<string, ProgressState>();

// gascity-dashboard-uxvk: the last COMPLETE formula-feed observation per city,
// the evidence behind the stranded-run judgment (orphaned molecule with no
// supervisor workflow record). Only the wide sources read the feed; caching the
// observation here lets the cheap SSE-burst source judge lanes off the same
// evidence instead of flapping every stranded lane back to 'unknown' on each
// burst. A partial or failed feed read never updates the cache — the last
// known-good observation keeps serving until a complete read replaces it.
const feedObservationByCity = new Map<string, RunRegistryObservation>();

// The wide-budget run-summary source (gascity-dashboard-4bol): the wide
// enrichment budget lets the slow-but-available city feed (measured 14.3s) land
// and clear the spurious "runs partial" badge (upstream gascity-dashboard#88).
// It is the authoritative refresh snapshot for the shared run-summary
// subscription (runs/runSummarySubscription), which both the /runs page and the
// nav attention badge read — so the badge counts the same genuinely-blocked runs
// the page shows, by construction, off a single fan-out (gascity-dashboard-2j8e.7).
//
// Header-first restructure: this no longer fires the closed-history fan-out
// (molecule all=true scan + per-rig task all=true reads). The active/blocked set
// builds entirely from the cheap core active read (measured ~0.02s; active runs'
// open step beads ride the same read) plus the feed for discovery/scope
// fallback. Historical lanes are the lazy loadSupervisorRunHistorySource
// payload, fetched when the operator opens the /runs history section.
//
// Do NOT use this as a ROUTE first-paint fetcher — it can block a route view for
// up to REFRESH_ENRICHMENT_TIMEOUT_MS; route mount consumers (Home, Formula Run
// Detail) use loadSupervisorRunSummaryMountSource on the tight budget instead.
// The shared subscription is exempt: it is cache-backed and the always-mounted
// header reads its result, so its latency never blocks a route view.
// `forceFresh` flows down to the cacheable city-wide feed read as the proxy
// cache-bypass marker. The shared subscription sets it ONLY for the operator's
// explicit Refresh (gascity-dashboard-i3dz); the one-time preview→full upgrade
// and SSE refreshes leave it false so they keep serving the proxy's amortized
// cache.
export async function loadSupervisorRunSummarySource(options?: {
  forceFresh?: boolean;
}): Promise<SourceState<RunSummary>> {
  return loadRunSummarySource(REFRESH_ENRICHMENT_TIMEOUT_MS, options?.forceFresh === true);
}

// Mount / first-paint full source for Home and Formula Run Detail: the same data
// as the refresh source (lanes + sessions) but on the tight first-paint budget,
// so a cold navigation to those routes never blocks on slow optional enrichment
// reads (gascity-dashboard-4bol).
export async function loadSupervisorRunSummaryMountSource(): Promise<SourceState<RunSummary>> {
  return loadRunSummarySource(PREVIEW_ENRICHMENT_TIMEOUT_MS);
}

// Single place the lane summary is built from a bead load, so every source
// (wide refresh, cheap active, preview) derives registration from the same
// per-city feed observation.
function citySummary(cityName: string, loaded: LoadedRunBeads): RunSummary {
  const cached = feedObservationByCity.get(cityName);
  // Presence overlay (review iter 2): the stranded judgment's ABSENCE evidence
  // must come from the cached complete observation, but any feed read — even
  // partial or root-incomplete — proves PRESENCE for the roots it lists. Merge
  // them in so a stranded lane recovers the moment any read shows the
  // supervisor knows its root, instead of waiting for the next complete read.
  // When there is no cached complete observation yet (preview/cheap source
  // before any complete feed read), the overlay is useless without the cached
  // observedAtMs anchor for the absence grace — so we pass `cached` (undefined)
  // and every lane starts 'unknown'. A non-null feedRootIds only RECOVERS a
  // stranded lane (presence), never strands one, so discarding it here is safe.
  const observation =
    cached !== undefined && loaded.feedRootIds !== null && loaded.feedRootIds.size > 0
      ? {
          rootIds: new Set([...cached.rootIds, ...loaded.feedRootIds]),
          observedAtMs: cached.observedAtMs,
        }
      : cached;
  return buildRunSummary(
    loaded.beads.filter(runBeadFilter).map(fromDashboardBead),
    loaded.feedScopes,
    loaded.partial,
    observation,
  );
}

async function loadRunSummarySource(
  enrichmentBudgetMs: number,
  forceFresh = false,
): Promise<SourceState<RunSummary>> {
  const cityName = activeCityOrThrow('load supervisor run summary');
  const fetchedAt = new Date().toISOString();
  try {
    const [loaded, sessions] = await Promise.all([
      loadRunBeads(cityName, RUNS_FETCH_LIMIT, enrichmentBudgetMs, forceFresh),
      loadRunSessions(cityName, enrichmentBudgetMs),
    ]);
    const summary = citySummary(cityName, loaded);
    const source: SourceAvailableState<RunSummary> = {
      source: 'runs',
      status: 'fresh',
      fetchedAt,
      staleAt: new Date(Date.parse(fetchedAt) + RUNS_STALE_AFTER_MS).toISOString(),
      error: { kind: 'none' },
      data: summary,
    };
    return {
      ...source,
      data: enrichRunSummary(cityName, source, sessions),
    };
  } catch (err) {
    return {
      source: 'runs',
      status: 'error',
      error: errorMessage(err, 'formula runs unavailable'),
    };
  }
}

// gascity-dashboard: the CHEAP SSE-refresh source. Even with the closed-history
// fan-out gone from the wide source (header-first), the city feed (measured
// 14.3s) is still too heavy to re-fire on every SSE burst — it would saturate
// the browser ~6-conn/host cap so the run-detail's fast workflowRun read queues
// behind it. The active/blocked set and its scope/health/counts/census do NOT
// need the feed: runScope takes the bead's own gc.root_store_ref/gc.scope_ref
// metadata first (feedScopes is only a fallback). So this fetches only the core
// active read + sessions. A missing feed is not flagged partial here — the lane
// SET is complete from the core read; only a minority scope fallback degrades
// until the next wide refresh repairs it.
export async function loadSupervisorRunSummaryActiveSource(): Promise<SourceState<RunSummary>> {
  const cityName = activeCityOrThrow('load supervisor run summary active');
  const fetchedAt = new Date().toISOString();
  try {
    const [loaded, sessions] = await Promise.all([
      loadActiveRunBeads(cityName, RUNS_FETCH_LIMIT),
      loadRunSessions(cityName, PREVIEW_ENRICHMENT_TIMEOUT_MS),
    ]);
    const summary = citySummary(cityName, loaded);
    const source: SourceAvailableState<RunSummary> = {
      source: 'runs',
      status: 'fresh',
      fetchedAt,
      staleAt: new Date(Date.parse(fetchedAt) + RUNS_STALE_AFTER_MS).toISOString(),
      error: { kind: 'none' },
      data: summary,
    };
    return {
      ...source,
      data: enrichRunSummary(cityName, source, sessions),
    };
  } catch (err) {
    return {
      source: 'runs',
      status: 'error',
      error: errorMessage(err, 'formula runs unavailable'),
    };
  }
}

// Core active read only — no molecule history scan, no city formula feed, no
// per-rig task reads. Truncation still reads as partial lanes. feedScopes is
// empty: a run root whose OWN bead carries no scope metadata falls back to
// 'unavailable' scope until the next wide refresh repairs it (minority path —
// runScope prefers per-bead metadata).
async function loadActiveRunBeads(cityName: string, limit: number): Promise<LoadedRunBeads> {
  const activeList = await fetchCoreActiveBeads(cityName, limit);
  const active = normalizeBeads(activeList.items ?? []);
  return {
    beads: active,
    feedScopes: new Map(),
    feedRootIds: null,
    partial: listIsIncomplete(activeList, active.length),
  };
}

export async function loadSupervisorRunSummaryPreviewSource(): Promise<SourceState<RunSummary>> {
  const cityName = activeCityOrThrow('load supervisor run summary preview');
  const fetchedAt = new Date().toISOString();
  try {
    const loaded = await loadRunBeads(cityName, RUNS_FETCH_LIMIT, PREVIEW_ENRICHMENT_TIMEOUT_MS);
    const summary = citySummary(cityName, loaded);
    return {
      source: 'runs',
      status: 'fresh',
      fetchedAt,
      staleAt: new Date(Date.parse(fetchedAt) + RUNS_STALE_AFTER_MS).toISOString(),
      error: { kind: 'none' },
      // First paint has no sessions yet, so no latch demotion. `lanes` carries
      // the full active set; RunMap applies the collapsed window.
      data: summary,
    };
  } catch (err) {
    return {
      source: 'runs',
      status: 'error',
      error: errorMessage(err, 'formula runs unavailable'),
    };
  }
}

// The lazy history source (header-first restructure): the completed-run lanes
// behind the /runs ?history=1 toggle. This is the ONLY caller of the expensive
// closed-history fan-out (molecule all=true scan + per-rig task all=true reads),
// so the default refresh path never pays it for data hidden by default. Fetched
// on demand by the history hook (runs/runHistory) when the operator opens the
// section; `forceFresh` carries the operator's explicit Refresh through to the
// proxy-cached molecule + feed reads (gascity-dashboard-i3dz).
export async function loadSupervisorRunHistorySource(options?: {
  forceFresh?: boolean;
}): Promise<SourceState<RunHistory>> {
  const cityName = activeCityOrThrow('load supervisor run history');
  const fetchedAt = new Date().toISOString();
  try {
    const loaded = await loadHistoryBeads(cityName, options?.forceFresh === true);
    const history = buildRunHistory(
      loaded.beads.filter(runBeadFilter).map(fromDashboardBead),
      loaded.feedScopes,
      loaded.partial,
    );
    return {
      source: 'runs',
      status: 'fresh',
      fetchedAt,
      staleAt: new Date(Date.parse(fetchedAt) + RUNS_STALE_AFTER_MS).toISOString(),
      error: { kind: 'none' },
      data: history,
    };
  } catch (err) {
    return {
      source: 'runs',
      status: 'error',
      error: errorMessage(err, 'formula run history unavailable'),
    };
  }
}

export function resetSupervisorRunSummaryStateForTests(): void {
  progressStateByCity.clear();
  feedObservationByCity.clear();
}

// Exposed for tests: the raised core-read budget that absorbs a CPU-burst spike.
export const CORE_RUN_SUMMARY_TIMEOUT_MS = REQUIRED_RUN_SUMMARY_TIMEOUT_MS;

function requiredRunSummaryApi() {
  return supervisorApiForRequestBudget(REQUIRED_RUN_SUMMARY_TIMEOUT_MS);
}

// The core active-bead read, with a bounded retry on a transient failure
// (fetchCoreRead). This is the one read whose rejection blanks the whole runs
// view, so a brief CPU burst that times out the first attempt should not lose
// the load; a sustained failure still propagates after the retry is spent.
// Optional enrichment reads keep their own degrade-to-partial handling and are
// NOT routed here.
async function fetchCoreActiveBeads(cityName: string, limit: number): Promise<ListBodyBead> {
  return fetchCoreRead(() => requiredRunSummaryApi().listBeads(cityName, { limit }));
}

function optionalRunSummaryApi(budgetMs: number) {
  return supervisorApiForRequestBudget(budgetMs);
}

// Header-first: the default run-summary fan-out is the cheap core active read
// (required) plus the city feed (optional discovery/scope fallback, degrade-to-
// partial). The closed-history reads live in loadHistoryBeads, paid only by the
// lazy history source.
async function loadRunBeads(
  cityName: string,
  limit: number,
  enrichmentBudgetMs: number,
  forceFresh = false,
): Promise<LoadedRunBeads> {
  // forceFresh rides the proxy-cached feed read so an explicit Refresh re-scans
  // upstream within the TTL window (gascity-dashboard-i3dz).
  const [activeList, feedDiscovery] = await Promise.all([
    fetchCoreActiveBeads(cityName, limit),
    discoverFromFeed(cityName, enrichmentBudgetMs, forceFresh),
  ]);
  // gascity-dashboard-uxvk: the default header-first fan-out reads the feed too,
  // so a COMPLETE read here is registration evidence — cache it (anchored to the
  // observation time) exactly as the lazy history fan-out does, or the common
  // /runs path would never strand an orphaned molecule.
  if (!feedDiscovery.partial && feedDiscovery.rootIdsComplete) {
    feedObservationByCity.set(cityName, {
      rootIds: feedDiscovery.rootIds,
      observedAtMs: Date.now(),
    });
  }
  const active = normalizeBeads(activeList.items ?? []);
  // Truncation at the bounded fetch reads as partial lanes, not complete
  // (gascity-dashboard-q89b). A failed/slow feed also reads as partial: the lane
  // set itself is complete from the core read, but lanes whose beads carry no
  // scope metadata lose their feed fallback, so the snapshot is honestly flagged
  // (gascity-dashboard-n6f1).
  return {
    beads: active,
    feedScopes: feedDiscovery.scopes,
    // The default fan-out reads the feed, so its root-id presence observation is
    // available for the stranded/recovery overlay (gascity-dashboard-uxvk); only
    // the feed-less cheap source carries a null (no observation) here.
    feedRootIds: feedDiscovery.presenceRootIds,
    partial: feedDiscovery.partial || listIsIncomplete(activeList, active.length),
  };
}

// The lazy closed-history fan-out (header-first): core active read (grouping
// context + rig discovery), city feed (scope fallback + rig discovery), the
// molecule(all=true) history scan, and per-rig task(all=true) closed reads.
// Everything except the core read degrades to `partial`.
async function loadHistoryBeads(cityName: string, forceFresh: boolean): Promise<LoadedRunBeads> {
  const budgetMs = HISTORY_ENRICHMENT_TIMEOUT_MS;
  // forceFresh rides the two proxy-cached city-wide reads (molecule + feed) so
  // an explicit Refresh re-scans upstream within the TTL window
  // (gascity-dashboard-i3dz). The per-rig task reads are not proxy-cached, so
  // they need no bypass.
  const moleculeFetch = settledRecentFetch(
    cityName,
    {
      limit: RECENT_RUN_FETCH_LIMIT,
      type: 'molecule',
      all: true,
    },
    budgetMs,
    forceFresh,
  );
  const [activeList, feedDiscovery] = await Promise.all([
    fetchCoreActiveBeads(cityName, RUNS_FETCH_LIMIT),
    discoverFromFeed(cityName, budgetMs, forceFresh),
  ]);
  // gascity-dashboard-uxvk: a COMPLETE feed read is the registration evidence;
  // record when it was taken so the stranded judgment's dispatch grace is
  // anchored to the observation, never to a later clock read.
  if (!feedDiscovery.partial && feedDiscovery.rootIdsComplete) {
    feedObservationByCity.set(cityName, {
      rootIds: feedDiscovery.rootIds,
      observedAtMs: Date.now(),
    });
  }
  const active = normalizeBeads(activeList.items ?? []);
  const rigNames = unionRigNames(runRigNames(active), feedDiscovery.rigNames);

  const rigFetches = rigNames.map((rig) =>
    settledRecentFetch(
      cityName,
      {
        limit: RECENT_RUN_FETCH_LIMIT,
        type: 'task',
        rig,
        all: true,
      },
      budgetMs,
    ),
  );

  const settled = await Promise.all([moleculeFetch, ...rigFetches]);
  const recentItems: DashboardBead[] = [];
  let partial = feedDiscovery.partial || listIsIncomplete(activeList, active.length);

  for (const outcome of settled) {
    if (outcome.ok) {
      recentItems.push(...outcome.items);
      partial ||= outcome.partial;
      continue;
    }
    partial = true;
  }

  return {
    beads: uniqueBeads([...active, ...recentItems]),
    feedScopes: feedDiscovery.scopes,
    feedRootIds: feedDiscovery.presenceRootIds,
    partial,
  };
}

async function settledRecentFetch(
  cityName: string,
  query: { limit: number; type: string; all: true; rig?: string },
  budgetMs: number,
  cacheBypass = false,
): Promise<RecentFetchOutcome> {
  try {
    // Attach the read options only to force a bypass: an unmarked read makes the
    // same call as before (no options object, no bypass header), so the proxy
    // keeps serving its amortized city-wide cache for it.
    const readOptions = cacheBypass ? ([{ cacheBypass: true }] as const) : ([] as const);
    const list = await withOptionalReadBudget(
      optionalRunSummaryApi(budgetMs).listBeads(cityName, query, ...readOptions),
      `recent ${query.type} beads`,
      budgetMs,
    );
    return {
      ok: true,
      items: normalizeBeads(list.items ?? []),
      partial: listIsPartial(list),
    };
  } catch {
    return { ok: false };
  }
}

interface FeedDiscovery {
  rigNames: string[];
  scopes: RunFeedScopeMap;
  /**
   * Every run root id the feed listed, regardless of scope resolvability —
   * the registration evidence (gascity-dashboard-uxvk). Deliberately a
   * superset of `scopes` keys: a feed item whose scope cannot be resolved
   * still proves the supervisor knows the run.
   */
  rootIds: ReadonlySet<string>;
  /**
   * Only the authoritative run.root_bead_id values — no workflow_id fallback.
   * This is the set that may prove a bead root's PRESENCE (the overlay in
   * citySummary); the broader `rootIds` set above is only ever conservative
   * (extra ids prevent stranding) and stays confined to the absence evidence.
   */
  presenceRootIds: ReadonlySet<string>;
  /**
   * False when any feed item lacked root_bead_id: such an item may cover a
   * root under a key the bead store never sees (workflow_id), so this read can
   * prove a root's presence but no longer prove any root's ABSENCE. A stranded
   * judgment must not be cached from an incomplete root-id set.
   */
  rootIdsComplete: boolean;
  partial: boolean;
}

async function discoverFromFeed(
  cityName: string,
  budgetMs: number,
  cacheBypass = false,
): Promise<FeedDiscovery> {
  try {
    // Attach the read options only to force a bypass: an unmarked read makes the
    // same call as before (no options object, no bypass header), so the proxy
    // keeps serving its amortized city-wide cache for it.
    const readOptions = cacheBypass ? ([{ cacheBypass: true }] as const) : ([] as const);
    const runs = await withOptionalReadBudget(
      optionalRunSummaryApi(budgetMs).formulaFeed(
        cityName,
        {
          scope_kind: 'city',
          scope_ref: cityName,
        },
        ...readOptions,
      ),
      'formula feed',
      budgetMs,
    );
    const rigNames = new Set<string>();
    const scopes = new Map<string, RunFeedScope>();
    const rootIds = new Set<string>();
    const presenceRootIds = new Set<string>();
    let rootIdsComplete = true;
    for (const run of runs.items ?? []) {
      const rootId = run.root_bead_id ?? run.workflow_id ?? null;
      if (rootId !== null) rootIds.add(rootId);
      if (run.root_bead_id == null) rootIdsComplete = false;
      else presenceRootIds.add(run.root_bead_id);
      if (run.type !== 'formula') continue;
      const storeScope = fromStoreRef(run.root_store_ref ?? null);
      if (storeScope?.scopeKind === 'rig') {
        rigNames.add(storeScope.scopeRef);
      }
      // gascity-dashboard-q89b (detail scope leak): the feed's top-level
      // scope_kind is always 'city', so fromFeedScope alone makes a rig lane's
      // detail href drop to city scope — and a city-scoped workflow fetch hits
      // the supervisor's full-store scan (~12-14s, upstream #88) instead of the
      // sub-second single-store rig fetch. Recover the rig from root_store_ref
      // first (store-ref-first — deliberately the inverse of
      // fromRootMetadataScope's pair-first rule: the metadata edge trusts its
      // explicit pair, but the feed's pair is unreliable here, always 'city').
      // Fall back to the feed (city) scope only when the store ref names no rig.
      // The store ref is validated against SCOPE_REF_RE before it is emitted as
      // a lane scope: unlike fromFeedScope/fromRootMetadataScope, fromStoreRef
      // does not validate, so a malformed root_store_ref must fall back rather
      // than emit a scope_ref the detail route would reject.
      const scope =
        storeScope?.scopeKind === 'rig' && SCOPE_REF_RE.test(storeScope.scopeRef)
          ? storeScope
          : fromFeedScope(run);
      if (rootId !== null && scope !== null) {
        scopes.set(rootId, {
          scopeKind: scope.scopeKind,
          scopeRef: scope.scopeRef,
          rootStoreRef: run.root_store_ref ?? `${scope.scopeKind}:${scope.scopeRef}`,
        });
      }
    }
    return {
      rigNames: [...rigNames],
      scopes,
      rootIds,
      presenceRootIds,
      rootIdsComplete,
      partial: feedIsPartial(runs),
    };
  } catch {
    return {
      rigNames: [],
      scopes: new Map(),
      rootIds: new Set(),
      presenceRootIds: new Set(),
      rootIdsComplete: false,
      partial: true,
    };
  }
}

async function loadRunSessions(cityName: string, budgetMs: number): Promise<RunSessionsLookup> {
  try {
    const list = await withOptionalReadBudget(
      optionalRunSummaryApi(budgetMs).listSessions(cityName),
      'run sessions',
      budgetMs,
    );
    return {
      kind: 'available',
      sessions: normalizeSessions(list),
    };
  } catch {
    return { kind: 'unavailable', sessions: [] };
  }
}

function enrichRunSummary(
  cityName: string,
  source: SourceAvailableState<RunSummary>,
  sessionsLookup: RunSessionsLookup,
): RunSummary {
  // gascity-dashboard-4xcv / -pxvb: blocked AND stranded lanes are enriched
  // alongside active ones so they carry derived health (needsOperator,
  // health.status for the attention layer), then split back out — neither is
  // part of the Active set.
  const inFlight = [
    ...source.data.lanes,
    ...source.data.blockedLanes,
    ...source.data.strandedLanes,
  ];
  const state = progressStateByCity.get(cityName);
  const generationMs = Date.parse(source.fetchedAt);
  let marks = state?.marks ?? new Map<string, LaneProgressMark>();
  if (state === undefined || generationMs > Date.parse(state.fetchedAt)) {
    marks = advanceProgressMarks(marks, inFlight);
    progressStateByCity.set(cityName, { marks, fetchedAt: source.fetchedAt });
  }

  const sessionsAvailable = sessionsLookup.kind === 'available';
  const { lanes } = deriveRunHealth({
    lanes: inFlight,
    sessions: sessionsLookup.sessions,
    sessionsAvailable,
    marks,
  });

  // gascity-dashboard-pxvb: re-split with stranded precedence so every lane
  // lands in exactly one partition. Stranded is keyed on `registration`, not
  // `phase` (an orphan's all-open steps map it to phase 'intake'), so it must be
  // filtered out of both the blocked and active sets here.
  const strandedEnriched = lanes.filter(
    (lane) => lane.registration === 'stranded' && lane.phase !== 'complete',
  );
  const blockedLanes = lanes.filter(
    (lane) => lane.phase === 'blocked' && lane.registration !== 'stranded',
  );
  const activeEnriched = lanes.filter(
    (lane) => lane.phase !== 'blocked' && lane.registration !== 'stranded',
  );

  // gascity-dashboard-s4rp: sessions only resolve here at enrichment, so this is
  // the earliest seam with enough information to demote stale session-less
  // latches (the gc-1920 phantom: no live session, no in_progress step, days
  // stale) out of the Active set. buildRunSummary hands us the FULL active set
  // (not the capped window), so totalActive is recomputed exactly from the
  // surviving lanes — a phantom past the 8th slot is demoted too. Staleness is
  // judged against the snapshot generation time, not a live clock, so the result
  // is stable for a snapshot.
  const liveActive = activeEnriched.filter(
    (lane) => !isStaleSessionlessLatch(lane, generationMs, sessionsAvailable),
  );
  // gascity-dashboard-pxvb: a stranded lane is sessionless with no in_progress
  // step, so the same stale-latch demotion applies — documented precedence on
  // isStrandedRun: a day-old orphan leaves the board with the rest of the stale
  // latches rather than accumulating in the Stranded section forever.
  const liveStranded = strandedEnriched.filter(
    (lane) => !isStaleSessionlessLatch(lane, generationMs, sessionsAvailable),
  );
  // Stranded runs never executed and never will, so they are excluded from the
  // in-flight census entirely (byPhase / totalInFlight) — the bug pxvb fixes was
  // exactly the orphan counting as live work. Only liveActive + blocked count.
  const census = buildCensus([...liveActive, ...blockedLanes]);

  // gascity-dashboard: `lanes` carries the FULL active set; RunMap owns the
  // collapsed window (MAX_VISIBLE_ACTIVE_LANES) and its "Show N more runs"
  // expander, mirroring the historical section.
  return {
    ...source.data,
    totalActive: liveActive.length,
    lanes: liveActive,
    blockedLanes,
    strandedLanes: liveStranded,
    runCounts: runCounts(liveActive, liveActive.length, blockedLanes.length, liveStranded.length),
    census: { status: 'available', data: census },
  };
}

function runRigNames(beads: readonly DashboardBead[]): string[] {
  const names = new Set<string>();
  for (const bead of beads) {
    const storeScope = fromStoreRef(bead.metadata?.['gc.root_store_ref']);
    if (storeScope?.scopeKind === 'rig') {
      names.add(storeScope.scopeRef);
      continue;
    }

    const metadataScope = fromRootMetadataScope(bead.metadata);
    if (metadataScope?.scopeKind === 'rig') {
      names.add(metadataScope.scopeRef);
    }
  }
  return Array.from(names).sort();
}

function unionRigNames(a: readonly string[], b: readonly string[]): string[] {
  const all = new Set<string>();
  for (const name of a) all.add(name);
  for (const name of b) all.add(name);
  return [...all];
}

function withOptionalReadBudget<T>(
  promise: Promise<T>,
  label: string,
  budgetMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const budget = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${budgetMs}ms`));
    }, budgetMs);
  });
  return Promise.race([
    promise.finally(() => {
      if (timeout !== null) clearTimeout(timeout);
    }),
    budget,
  ]);
}

function uniqueBeads(beads: readonly DashboardBead[]): DashboardBead[] {
  const byId = new Map<string, DashboardBead>();
  for (const bead of beads) {
    if (!byId.has(bead.id)) byId.set(bead.id, bead);
  }
  return Array.from(byId.values());
}

function feedIsPartial(feed: FormulaFeedBody): boolean {
  return feed.partial === true || (feed.partial_errors?.length ?? 0) > 0;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim().length > 0 ? err.message : fallback;
}
