import type {
  GcBead,
  GcSession,
  RunFeedScope,
  RunFeedScopeMap,
  RunSummary,
  SourceAvailableState,
  SourceState,
} from 'gas-city-dashboard-shared';
import {
  advanceProgressMarks,
  buildRunSummary,
  deriveRunHealth,
  fromFeedScope,
  fromGcBead,
  fromRootMetadataScope,
  fromStoreRef,
  runBeadFilter,
  type LaneProgressMark,
} from 'gas-city-dashboard-shared';
import { getActiveCity } from '../api/cityBase';
import type {
  Bead,
  FormulaFeedBody,
  ListBodyBead,
  ListBodySessionResponse,
  SessionResponse,
} from '../generated/gc-supervisor-client/types.gen';
import { supervisorApi } from './client';

const RUNS_FETCH_LIMIT = 1_000;
const RECENT_RUN_FETCH_LIMIT = 80;
const RUNS_STALE_AFTER_MS = 60 * 1000;

interface LoadedRunBeads {
  beads: GcBead[];
  feedScopes: RunFeedScopeMap;
  partial: boolean;
}

type RecentFetchOutcome =
  | { ok: true; items: GcBead[]; partial: boolean }
  | { ok: false };

type RunSessionsLookup =
  | { kind: 'available'; sessions: GcSession[] }
  | { kind: 'unavailable'; sessions: GcSession[] };

interface ProgressState {
  marks: Map<string, LaneProgressMark>;
  fetchedAt: string;
}

const progressStateByCity = new Map<string, ProgressState>();

export async function loadSupervisorRunSummarySource(): Promise<SourceState<RunSummary>> {
  const cityName = activeCityOrThrow('load supervisor run summary');
  const fetchedAt = new Date().toISOString();
  try {
    const [loaded, sessions] = await Promise.all([
      loadRunBeads(cityName, RUNS_FETCH_LIMIT),
      loadRunSessions(cityName),
    ]);
    const summary = buildRunSummary(
      loaded.beads.filter(runBeadFilter).map(fromGcBead),
      loaded.feedScopes,
      loaded.partial,
    );
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

export function resetSupervisorRunSummaryStateForTests(): void {
  progressStateByCity.clear();
}

async function loadRunBeads(
  cityName: string,
  limit: number,
): Promise<LoadedRunBeads> {
  const moleculeFetch = settledRecentFetch(cityName, {
    limit: RECENT_RUN_FETCH_LIMIT,
    type: 'molecule',
    all: true,
  });
  const [activeList, feedDiscovery] = await Promise.all([
    supervisorApi().listBeads(cityName, { limit }),
    discoverFromFeed(cityName),
  ]);
  const active = normalizeBeads(activeList.items ?? []);
  const rigNames = unionRigNames(runRigNames(active), feedDiscovery.rigNames);

  const rigFetches = rigNames.map((rig) =>
    settledRecentFetch(cityName, {
      limit: RECENT_RUN_FETCH_LIMIT,
      type: 'task',
      rig,
      all: true,
    }),
  );

  const settled = await Promise.all([moleculeFetch, ...rigFetches]);
  const recentItems: GcBead[] = [];
  let partial = feedDiscovery.partial || listIsPartial(activeList);

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
    partial,
  };
}

async function settledRecentFetch(
  cityName: string,
  query: { limit: number; type: string; all: true; rig?: string },
): Promise<RecentFetchOutcome> {
  try {
    const list = await supervisorApi().listBeads(cityName, query);
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
  partial: boolean;
}

async function discoverFromFeed(cityName: string): Promise<FeedDiscovery> {
  try {
    const runs = await supervisorApi().formulaFeed(cityName, {
      scope_kind: 'city',
      scope_ref: cityName,
    });
    const rigNames = new Set<string>();
    const scopes = new Map<string, RunFeedScope>();
    for (const run of runs.items ?? []) {
      if (run.type !== 'formula') continue;
      const storeScope = fromStoreRef(run.root_store_ref ?? null);
      if (storeScope?.scopeKind === 'rig') {
        rigNames.add(storeScope.scopeRef);
      }
      const rootId = run.root_bead_id ?? run.workflow_id ?? null;
      const scope = fromFeedScope(run);
      if (rootId !== null && scope !== null) {
        scopes.set(rootId, {
          scopeKind: scope.scopeKind,
          scopeRef: scope.scopeRef,
          rootStoreRef: scope.rootStoreRef,
        });
      }
    }
    return { rigNames: [...rigNames], scopes, partial: feedIsPartial(runs) };
  } catch {
    return { rigNames: [], scopes: new Map(), partial: true };
  }
}

async function loadRunSessions(cityName: string): Promise<RunSessionsLookup> {
  try {
    const list = await supervisorApi().listSessions(cityName);
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
  const state = progressStateByCity.get(cityName);
  const generationMs = Date.parse(source.fetchedAt);
  let marks = state?.marks ?? new Map<string, LaneProgressMark>();
  if (state === undefined || generationMs > Date.parse(state.fetchedAt)) {
    marks = advanceProgressMarks(marks, source.data.lanes);
    progressStateByCity.set(cityName, { marks, fetchedAt: source.fetchedAt });
  }

  const { lanes, census } = deriveRunHealth({
    lanes: source.data.lanes,
    sessions: sessionsLookup.sessions,
    sessionsAvailable: sessionsLookup.kind === 'available',
    marks,
  });

  return {
    ...source.data,
    lanes,
    census: { status: 'available', data: census },
  };
}

function runRigNames(beads: readonly GcBead[]): string[] {
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

function uniqueBeads(beads: readonly GcBead[]): GcBead[] {
  const byId = new Map<string, GcBead>();
  for (const bead of beads) {
    if (!byId.has(bead.id)) byId.set(bead.id, bead);
  }
  return Array.from(byId.values());
}

function normalizeBeads(beads: readonly Bead[]): GcBead[] {
  return beads.map(normalizeBead);
}

function normalizeBead(bead: Bead): GcBead {
  const normalized: GcBead = {
    id: bead.id,
    title: bead.title,
    status: bead.status,
    issue_type: bead.issue_type,
    priority: bead.priority ?? null,
    created_at: bead.created_at,
  };
  if (bead.description !== undefined) normalized.description = bead.description;
  if (bead.assignee !== undefined) normalized.assignee = bead.assignee;
  if (Array.isArray(bead.labels)) normalized.labels = bead.labels;
  if (bead.metadata !== undefined) normalized.metadata = bead.metadata;
  if (bead.ref !== undefined) normalized.ref = bead.ref;
  if (bead.parent !== undefined) normalized.parent = bead.parent;
  if (bead.from !== undefined) normalized.from = bead.from;
  if (bead.ephemeral !== undefined) normalized.ephemeral = bead.ephemeral;
  if (bead.needs !== undefined) normalized.needs = bead.needs;
  if (bead.dependencies !== undefined) normalized.dependencies = bead.dependencies;
  if (bead.updated_at !== undefined) normalized.updated_at = bead.updated_at;
  return normalized;
}

function normalizeSessions(list: ListBodySessionResponse): GcSession[] {
  return (list.items ?? []).map(normalizeSession);
}

function normalizeSession(session: SessionResponse): GcSession {
  const normalized: GcSession = {
    id: session.id,
    template: session.template,
    session_name: session.session_name,
    title: session.title,
    state: session.state,
    created_at: session.created_at,
    attached: session.attached,
    running: session.running,
    provider: session.provider,
  };
  if (session.alias !== undefined) normalized.alias = session.alias;
  if (session.reason !== undefined) normalized.reason = session.reason;
  if (session.display_name !== undefined) normalized.display_name = session.display_name;
  if (session.last_active !== undefined) normalized.last_active = session.last_active;
  if (session.rig !== undefined) normalized.rig = session.rig;
  if (session.pool !== undefined) normalized.pool = session.pool;
  if (session.agent_kind !== undefined) normalized.agent_kind = session.agent_kind;
  if (session.model !== undefined) normalized.model = session.model;
  if (session.context_pct !== undefined) normalized.context_pct = session.context_pct;
  if (session.context_window !== undefined) normalized.context_window = session.context_window;
  if (session.activity !== undefined) normalized.activity = session.activity;
  return normalized;
}

function listIsPartial(list: ListBodyBead): boolean {
  return list.partial === true || (list.partial_errors?.length ?? 0) > 0;
}

function feedIsPartial(feed: FormulaFeedBody): boolean {
  return feed.partial === true || (feed.partial_errors?.length ?? 0) > 0;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim().length > 0 ? err.message : fallback;
}

function activeCityOrThrow(operation: string): string {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error(`${operation} called before an active city was resolved`);
  }
  return cityName;
}
