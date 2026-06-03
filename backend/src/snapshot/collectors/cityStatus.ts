import type {
  CitySessionProvider,
  CityStatusSummary,
  DashboardMetric,
  GcSession,
  GcSessionList,
} from 'gas-city-dashboard-shared';
import type {
  AgentResponse,
  ListBodyAgentResponse,
  ListBodyRigResponse,
} from '../../generated/gc-supervisor-client/types.gen.js';
import { type GcClient } from '../../gc-client.js';
import { LOG_COMPONENT, logWarn, sanitizeForLog } from '../../logging.js';
import { SourceCache } from '../cache.js';

// City status collector — gascity-dashboard-8nj + gascity-dashboard-19w.
// Source of truth for sessions is GcClient.listSessions(); rigs come from
// GcClient.listRigs() (the supervisor's `GET /v0/city/{name}/rigs` HTTP
// API). The legacy on-disk city.toml parse + the host-can-see-city-dir
// assumption are gone (gascity-dashboard-19w). The demo-dash subprocess
// path (`gc status`, `bd list`) is deliberately not ported per
// gascity-dashboard-dkb Q1 (HTTP via GcClient is canonical).
//
// sessionsByProvider aggregation rule (gascity-dashboard-sd4):
// derived from the /agents roster, NOT from /sessions. The supervisor
// does not populate GcSession.provider for every session today, which
// systematically undercounts (see gascity-dashboard-dkb Q4 +
// gastownhall/gascity#2508). The /agents endpoint (gascity-dashboard-ay6)
// is the authoritative source of per-agent provider info — using it here
// removes the undercount completely without ever inferring from titles
// (the rejected ZFC-violating path). The wire field name remains
// `sessionsByProvider` to keep the CityStatusSummary contract stable;
// only the data source changes. The pre-migration session-derived
// implementation was deleted in Phase-4 review per the YAGNI rule
// (no callers; would have been dead exported code). If a future bead
// needs the session-derived behavior back, restore it from git history.
//
// maxSessions degradation (gascity-dashboard-19w): the supervisor's HTTP
// API does NOT expose city-level max_active_sessions today. Verified
// upstream in gastownhall/gascity@main:
//   - internal/api/handler_status.go StatusBody construction omits it.
//   - internal/api/handler_config.go workspaceResponse omits it.
//   - The `MaxActiveSessions` references inside handler_status.go's
//     poolScaleLabel helper render a per-agent string only.
// We therefore surface maxSessions as permanently 'unavailable' until
// upstream exposes it (tracked for a follow-up bead). Frontend
// already handles the unavailable case (AmbientHome, Workflows).

export const CITY_STATUS_CACHE_TTL_MS = 45 * 1000;

const MAX_SESSIONS_UNAVAILABLE_REASON =
  'supervisor HTTP API does not expose city-level max_active_sessions';

export interface CollectCityStatusOptions {
  /** Live upstream loader for sessions. */
  listSessions: () => Promise<GcSessionList>;
  /** Live upstream loader for agents (authoritative provider source). */
  listAgents: () => Promise<ListBodyAgentResponse>;
  /** Live upstream loader for rigs. */
  listRigs: () => Promise<ListBodyRigResponse>;
}

export interface CreateCityStatusSourceCacheOptions {
  gc: GcClient;
  now?: (() => Date) | undefined;
  loadFixture?: (() => Promise<CityStatusSummary> | CityStatusSummary) | undefined;
  useFixture?: boolean | undefined;
  /** Test seam: override the listSessions binding to avoid a real GcClient. */
  listSessions?: (() => Promise<GcSessionList>) | undefined;
  /** Test seam: override the listAgents binding to avoid a real GcClient. */
  listAgents?: (() => Promise<ListBodyAgentResponse>) | undefined;
  /** Test seam: override the listRigs binding to avoid a real GcClient. */
  listRigs?: (() => Promise<ListBodyRigResponse>) | undefined;
}

const ACTIVE_STATES = new Set<string>(['active', 'creating']);

export function createCityStatusSourceCache(
  options: CreateCityStatusSourceCacheOptions,
): SourceCache<CityStatusSummary> {
  const listSessions = options.listSessions ?? (() => options.gc.listSessions());
  const listAgents = options.listAgents ?? (() => options.gc.listAgents());
  const listRigs = options.listRigs ?? (() => options.gc.listRigs());

  return new SourceCache<CityStatusSummary>({
    source: 'city',
    ttlMs: CITY_STATUS_CACHE_TTL_MS,
    now: options.now,
    load: () => collectCityStatus({ listSessions, listAgents, listRigs }),
    loadFixture: options.loadFixture,
    useFixture: options.useFixture,
    // gascity-dashboard-4r5: opt out of default-on sanitization.
    // GcClient already throws sanitized messages
    // (`gc supervisor returned ${status}`, `connection refused`, etc.)
    // with no OS paths, so the operator benefits from seeing the
    // actual upstream failure reason in the wire shape.
    sanitizeErrorMessage: null,
  });
}

export async function collectCityStatus(
  options: CollectCityStatusOptions,
): Promise<CityStatusSummary> {
  // Fetch sessions, agents, and rigs in parallel. Any throw propagates;
  // the SourceCache surfaces them as the city source's status='error',
  // preserving failure isolation per the snapshot service contract.
  // We do NOT catch-and-empty here — silently aggregating an empty
  // list would mask an upstream outage.
  //
  // sd4: listAgents is now part of the city aggregate so
  // sessionsByProvider can derive from the authoritative agent roster
  // instead of from sessions (which undercount because the supervisor
  // doesn't populate GcSession.provider for every session today).
  const [sessionList, agentList, rigList] = await Promise.all([
    options.listSessions(),
    options.listAgents(),
    options.listRigs(),
  ]);

  const sessions = sessionList.items;
  const agents = agentList.items ?? [];
  const sessionsByProvider = aggregateAgentsByProvider(agents);
  const activeSessions = countActiveSessions(sessions);

  const rigs = rigList.items ?? [];

  // gascity-dashboard-19w.1: supervisor-reported wire-partial on a 200
  // response (one or more rig backends failed during aggregation) is a
  // degradation signal, not an outage — propagate it so the operator
  // sees "rigs degraded" rather than an apparent "no rigs configured."
  // Mirrors the convention in direct supervisor entity-link and mail reads.
  // Per CLAUDE.md "Don't Swallow Errors".
  const rigsPartial =
    rigList.partial === true || (rigList.partial_errors?.length ?? 0) > 0;
  if (rigsPartial) {
    const detail = rigList.partial_errors && rigList.partial_errors.length > 0
      ? rigList.partial_errors.map(sanitizeForLog).join(', ')
      : 'no detail';
    logWarn(
      LOG_COMPONENT.snapshot,
      `supervisor reported partial rig list (${detail}); rigs degraded`,
    );
  }

  // sd4.1: same degradation signal for the agent roster. Since sd4 made
  // /agents the authoritative source for sessionsByProvider, a partial
  // agent list silently produces an under-counted breakdown. Surface the
  // signal in lockstep with rigsPartial so the operator sees BOTH dimensions
  // of degradation. Per CLAUDE.md "Don't Swallow Errors".
  const agentsPartial =
    agentList.partial === true || (agentList.partial_errors?.length ?? 0) > 0;
  if (agentsPartial) {
    const detail = agentList.partial_errors && agentList.partial_errors.length > 0
      ? agentList.partial_errors.map(sanitizeForLog).join(', ')
      : 'no detail';
    logWarn(
      LOG_COMPONENT.snapshot,
      `supervisor reported partial agent list (${detail}); sessionsByProvider degraded`,
    );
  }

  const summary: CityStatusSummary = {
    activeAgents: countActiveAgents(sessions),
    totalAgents: sessions.length,
    activeSessions,
    suspendedSessions: Math.max(0, sessions.length - activeSessions),
    maxSessions: unavailableCityMetric(MAX_SESSIONS_UNAVAILABLE_REASON),
    sessionsByProvider,
    // gascity-dashboard-19w.2: inline projection (no toCityRig delegate).
    // Generated RigResponse carries supervisor-only fields such as
    // agent_count/running_count/suspended. The explicit {name, path} pick keeps
    // those out of the CityStatusSummary wire shape.
    rigs: rigs.map(({ name, path }) => ({ name, path })),
  };
  if (rigsPartial) {
    summary.rigsPartial = true;
  }
  if (agentsPartial) {
    summary.agentsPartial = true;
  }
  return summary;
}

/**
 * Aggregate sessions into a per-provider active/total breakdown. Sessions
 * without GcSession.provider are EXCLUDED (no title-parsing fallback —
 * see gascity-dashboard-dkb Q4). Result is sorted by active desc, then
 * provider name asc for stable display.
 *
 * gascity-dashboard-6bv7.2: empty-string providers are still skipped
 * (the wire contract is `string`, not "non-empty string", so a degenerate
 * supervisor sending `provider: ""` for all sessions would otherwise
 * silently produce zero buckets). The skip is no longer silent — a single
 * warn is emitted per call with the count when any are dropped. Per-call
 * (not per-session) keeps the log volume bounded by the SourceCache TTL
 * (~45s) instead of scaling with session count.
 */

/**
 * sd4: Aggregate AGENTS into a per-provider active/total breakdown.
 * Authoritative source for CityStatusSummary.sessionsByProvider — the
 * wire field is still named for sessions (contract stability), but the
 * count is over the agent roster because /agents reliably carries
 * `provider` while /sessions does not.
 *
 * Active rule mirrors `countActiveAgents(sessions)`:
 * `running === true || state === 'active'`. An agent counts as active if
 * the process is up OR gc's lifecycle state is 'active' — either signal
 * is sufficient for "currently doing work."
 *
 * Agents without provider (undefined or empty string) are skipped with
 * a single per-call warn (matches aggregateSessionsByProvider's contract).
 */
export function aggregateAgentsByProvider(
  agents: ReadonlyArray<AgentResponse>,
): CitySessionProvider[] {
  const buckets = new Map<string, { active: number; total: number }>();
  let emptyProviderCount = 0;

  for (const agent of agents) {
    const provider = agent.provider;
    if (!provider) {
      emptyProviderCount += 1;
      continue;
    }

    const bucket = buckets.get(provider) ?? { active: 0, total: 0 };
    bucket.total += 1;
    if (isAgentActive(agent)) {
      bucket.active += 1;
    }
    buckets.set(provider, bucket);
  }

  if (emptyProviderCount > 0) {
    logWarn(
      LOG_COMPONENT.snapshot,
      `aggregateAgentsByProvider: ${emptyProviderCount} agents skipped due to empty provider`,
    );
  }

  return Array.from(buckets.entries())
    .map(([provider, counts]) => ({ provider, ...counts }))
    .sort((a, b) => b.active - a.active || a.provider.localeCompare(b.provider));
}

function isAgentActive(agent: AgentResponse): boolean {
  return agent.running === true || isActive(agent.state);
}

function countActiveAgents(sessions: ReadonlyArray<GcSession>): number {
  return sessions.filter((s) => s.running === true || isActive(s.state)).length;
}

function countActiveSessions(sessions: ReadonlyArray<GcSession>): number {
  return sessions.filter((s) => isActive(s.state)).length;
}

function isActive(state: string): boolean {
  return ACTIVE_STATES.has(state);
}

function unavailableCityMetric(error: string): DashboardMetric {
  return { status: 'unavailable', source: 'city', error };
}
