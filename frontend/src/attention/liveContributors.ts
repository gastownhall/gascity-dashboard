import { useCallback, useMemo } from 'react';
import { type RunSummary, type SourceState, type SourceStatus } from 'gas-city-dashboard-shared';
import { api, formatApiError } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { type OperatorConfig } from '../contexts/OperatorConfigContext';
import { useCachedData } from '../hooks/useCachedData';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';
import { listAgentPendingInteractions } from '../supervisor/agentPending';
import { listSupervisorBeads } from '../supervisor/beadReads';
import { supervisorApi, supervisorApiForRequestBudget } from '../supervisor/client';
import { DEFAULT_MAIL_HISTORY_LIMIT, listSupervisorMail } from '../supervisor/mailReads';
import {
  ATTENTION_READ_REFRESH_INTERVAL_MS,
  ATTENTION_READ_STALE_AFTER_MS,
  type AttentionContributor,
} from './compose';
import {
  createAttentionContributors,
  GC_ESCALATION_LABEL,
  type ActivityAttentionFacts,
  type AgentsAttentionFacts,
  type AttentionContributorFacts,
  type BeadsAttentionFacts,
  type HealthAttentionFacts,
  type MailAttentionFacts,
  type MaintainerAttentionFacts,
  type ReadFreshnessFacts,
  type RunsAttentionFacts,
} from './registry';

/**
 * Thread a cached source's read freshness onto its facts (gascity-dashboard-5t0m,
 * Freshness Spine). The runs source carries its own SourceState provenance
 * (runsFactsFromSource); every other domain reads through useCachedData, whose
 * read state is just `fetchedAt` + `error` — so a failed refresh reports `error`,
 * a landed read `fresh`, and the ISO `fetchedAt` carries the real age the
 * per-domain fold ages off. A landed read also gets a `staleAt`
 * (`fetchedAt + ATTENTION_READ_STALE_AFTER_MS`, gascity-dashboard-fchh) so a
 * frozen-but-not-erroring poll flips the board liveness line maroon once it ages
 * past the threshold — these domains re-read on ATTENTION_READ_REFRESH_INTERVAL_MS
 * (see useLiveAttentionContributors), so a healthy board never reaches it.
 * Returns undefined facts untouched (a domain with no data yet has no signal).
 */
export function withReadFreshness<T extends ReadFreshnessFacts>(
  facts: T | undefined,
  fetchedAt: string | undefined,
  error: string | null,
): T | undefined {
  if (facts === undefined) return undefined;
  const provenance: SourceStatus | undefined =
    error !== null ? 'error' : fetchedAt !== undefined ? 'fresh' : undefined;
  // A staleAt only makes sense for a landed read (no error) — a failed refresh
  // is already 'error', the most degraded state, so it never needs to age.
  const staleAt =
    error === null && fetchedAt !== undefined
      ? new Date(Date.parse(fetchedAt) + ATTENTION_READ_STALE_AFTER_MS).toISOString()
      : undefined;
  return {
    ...facts,
    ...(provenance !== undefined && { provenance }),
    ...(fetchedAt !== undefined && { fetchedAt }),
    ...(staleAt !== undefined && { staleAt }),
  };
}

const ATTENTION_LIST_LIMIT = 1000;
const ACTIVITY_EVENT_FETCH_LIMIT = 100;
const ACTIVITY_EVENT_WINDOW = '24h';
const HEALTH_ATTENTION_SUPERVISOR_TIMEOUT_MS = 2_500;

export function useLiveAttentionContributors(
  enabledModules: readonly string[] | null,
  operator: OperatorConfig,
  runsSource: SourceState<RunSummary> | undefined,
): readonly AttentionContributor[] {
  const cityName = getActiveCity();
  const cacheSuffix = cityName ?? 'no-city';
  const maintainerEnabled = enabledModules?.includes('maintainer') ?? false;
  // The decision label + operator wire alias come from /config
  // (gascity-dashboard-bhvn). Encode them into the relevant cache keys so a
  // pre-config fallback → real-config transition refetches with the resolved
  // identity (useCachedData only refetches on key change).
  const { decisionLabel, operatorWireAlias } = operator;
  // gascity-dashboard-2j8e.7: the Runs badge reads the SAME shared run-summary
  // subscription the /runs page renders (passed in as runsSource), not its own
  // fan-out — one fetch, by-construction parity, and SSE refresh reach the badge.
  const runs = useMemo(() => runsFactsFromSource(runsSource), [runsSource]);
  const agents = useCachedData<AgentsAttentionFacts>(`attention:agents:${cacheSuffix}`, () =>
    fetchAgentsAttention(cityName),
  );
  const beads = useCachedData<BeadsAttentionFacts>(
    `attention:beads:${cacheSuffix}:${decisionLabel}`,
    () => fetchBeadsAttention(cityName, decisionLabel),
  );
  const mail = useCachedData<MailAttentionFacts>(
    `attention:mail:${cacheSuffix}:${operatorWireAlias}`,
    () => fetchMailAttention(cityName, operator),
  );
  const activity = useCachedData<ActivityAttentionFacts>(`attention:activity:${cacheSuffix}`, () =>
    fetchActivityAttention(cityName),
  );
  const health = useCachedData<HealthAttentionFacts>(`attention:health:${cacheSuffix}`, () =>
    fetchHealthAttention(cityName),
  );
  const maintainer = useCachedData<MaintainerAttentionFacts>(
    `attention:maintainer:${cacheSuffix}:${maintainerEnabled ? 'enabled' : 'disabled'}`,
    () => fetchMaintainerAttention(cityName, maintainerEnabled),
  );

  // gascity-dashboard-fchh (Option B): unlike the runs source (whose own
  // subscription re-reads off the gc event stream), these six domains fetch once
  // through useCachedData and would otherwise freeze at their mount-time read —
  // so their freshness `staleAt` would age out on a perfectly healthy board.
  // Re-read them on a slow visible interval (paused when the tab is hidden) so a
  // live board keeps advancing fetchedAt and only a genuinely wedged refresh ages
  // a domain to the maroon stale state. useCachedData owns the data/error state;
  // this just drives the cadence.
  // Each useCachedData.refresh is stable (keyed on its cache key), so depend on
  // the functions directly — the callback only changes when a cache key shifts.
  const { refresh: refreshAgents } = agents;
  const { refresh: refreshBeads } = beads;
  const { refresh: refreshMail } = mail;
  const { refresh: refreshActivity } = activity;
  const { refresh: refreshHealth } = health;
  const { refresh: refreshMaintainer } = maintainer;
  const refreshPolledReads = useCallback(
    () =>
      Promise.all([
        refreshAgents(),
        refreshBeads(),
        refreshMail(),
        refreshActivity(),
        refreshHealth(),
        refreshMaintainer(),
      ]).then(() => undefined),
    [refreshAgents, refreshBeads, refreshMail, refreshActivity, refreshHealth, refreshMaintainer],
  );
  useVisibleRefresh(refreshPolledReads, ATTENTION_READ_REFRESH_INTERVAL_MS);

  return useMemo(
    () =>
      createAttentionContributors(
        compactFacts({
          // gascity-dashboard-5t0m: thread each cache read's fetchedAt + derived
          // provenance onto the facts so composeAttention can fold a board-wide
          // read-age/liveness signal. runs already carries its SourceState
          // provenance via runsFactsFromSource.
          activity: withReadFreshness(activity.data, activity.fetchedAt, activity.error),
          agents: withReadFreshness(agents.data, agents.fetchedAt, agents.error),
          beads: withReadFreshness(beads.data, beads.fetchedAt, beads.error),
          health: withReadFreshness(health.data, health.fetchedAt, health.error),
          mail: withReadFreshness(mail.data, mail.fetchedAt, mail.error),
          maintainer: withReadFreshness(maintainer.data, maintainer.fetchedAt, maintainer.error),
          runs,
        }),
      ),
    [
      activity.data,
      activity.fetchedAt,
      activity.error,
      agents.data,
      agents.fetchedAt,
      agents.error,
      beads.data,
      beads.fetchedAt,
      beads.error,
      health.data,
      health.fetchedAt,
      health.error,
      mail.data,
      mail.fetchedAt,
      mail.error,
      maintainer.data,
      maintainer.fetchedAt,
      maintainer.error,
      runs,
    ],
  );
}

/**
 * Project the shared run-summary subscription's source onto the Runs badge
 * facts. The badge counts genuinely-blocked runs from `summary.blockedLanes` —
 * the same selectBlockedRuns the /runs page renders — so reading the page's exact
 * source object makes the badge and the page agree by construction, not merely by
 * shared selector (gascity-dashboard-2j8e.7). The source's own status flows
 * through as provenance and `fetchedAt` carries the exact read time, so the read
 * can be aged rather than rendered as current truth.
 */
export function runsFactsFromSource(
  source: SourceState<RunSummary> | undefined,
): RunsAttentionFacts | undefined {
  if (source === undefined) return undefined;
  if (source.status === 'error') {
    return { error: source.error, provenance: 'error' };
  }
  return { summary: source.data, provenance: source.status, fetchedAt: source.fetchedAt };
}

async function fetchAgentsAttention(cityName: string | null): Promise<AgentsAttentionFacts> {
  if (cityName === null) return {};
  try {
    const list = await supervisorApi().listAgents(cityName);
    const facts: AgentsAttentionFacts = {
      items: list.items ?? [],
      partial: list.partial === true,
    };
    try {
      const sessions = await supervisorApi().listSessions(cityName);
      facts.pendingInteractions = await listAgentPendingInteractions(
        list.items ?? [],
        sessions.items ?? [],
      );
    } catch (err) {
      facts.pendingError = formatApiError(err, 'agent pending state unavailable');
    }
    return facts;
  } catch (err) {
    return { error: formatApiError(err, 'agent list unavailable') };
  }
}

async function fetchBeadsAttention(
  cityName: string | null,
  decisionLabel: string,
): Promise<BeadsAttentionFacts> {
  if (cityName === null) return { decisionLabel };
  // Three independent reads: the general bead list (capped) and two dedicated
  // label+status-filtered queues — the mayor-decision queue and the escalation
  // queue. Both queues bypass the general list's gc:-label filter and are always
  // complete. Settled separately so one failing does not blank the others — the
  // decision queue, the escalation queue, and generic bead alerts are distinct
  // signals (gascity-dashboard-2j8e.3).
  const [list, decisions, escalations] = await Promise.allSettled([
    listSupervisorBeads({ limit: ATTENTION_LIST_LIMIT }),
    listDecisionBeads(cityName, decisionLabel),
    listEscalationBeads(cityName),
  ]);
  const facts: BeadsAttentionFacts = { nowMs: Date.now(), decisionLabel };
  if (list.status === 'fulfilled') {
    facts.items = list.value.items;
    facts.partial = list.value.partial === true;
  } else {
    facts.error = formatApiError(list.reason, 'bead list unavailable');
  }
  if (decisions.status === 'fulfilled') {
    facts.decisions = decisions.value.items ?? [];
  } else {
    facts.decisionsError = formatApiError(decisions.reason, 'decision queue unavailable');
  }
  if (escalations.status === 'fulfilled') {
    facts.escalations = escalations.value.items ?? [];
  } else {
    facts.escalationsError = formatApiError(escalations.reason, 'escalation queue unavailable');
  }
  return facts;
}

async function listDecisionBeads(cityName: string, decisionLabel: string) {
  return supervisorApi().listBeads(cityName, {
    label: decisionLabel,
    status: 'open',
  });
}

async function listEscalationBeads(cityName: string) {
  return supervisorApi().listBeads(cityName, {
    label: GC_ESCALATION_LABEL,
    status: 'open',
  });
}

async function fetchMailAttention(
  cityName: string | null,
  operator: OperatorConfig,
): Promise<MailAttentionFacts> {
  if (cityName === null) return {};
  try {
    // The operator inbox (to:operator). selectOperatorActionableUnread then
    // folds the pool-worker firehose, so the badge counts only needs-you mail
    // (gascity-dashboard-2j8e.5).
    const list = await listSupervisorMail(
      'inbox',
      operator.operatorAlias,
      operator,
      DEFAULT_MAIL_HISTORY_LIMIT,
    );
    return {
      items: list.items ?? [],
      nowMs: Date.now(),
      partial: list.partial === true,
    };
  } catch (err) {
    return {
      error: formatApiError(err, 'mail list unavailable'),
    };
  }
}

async function fetchActivityAttention(cityName: string | null): Promise<ActivityAttentionFacts> {
  const [deploys, events] = await Promise.allSettled([
    api.listBuilds(),
    cityName === null
      ? Promise.resolve(null)
      : supervisorApi().listEvents(cityName, {
          limit: ACTIVITY_EVENT_FETCH_LIMIT,
          since: ACTIVITY_EVENT_WINDOW,
        }),
  ]);
  const facts: ActivityAttentionFacts = {};

  if (deploys.status === 'fulfilled') {
    facts.deploys = deploys.value;
  } else {
    facts.deploysError = formatApiError(deploys.reason, 'deploy activity unavailable');
  }

  if (events.status === 'fulfilled') {
    if (events.value !== null) {
      facts.events = events.value.items ?? [];
      facts.eventsPartial = events.value.partial === true;
      if (events.value.partial_errors !== null && events.value.partial_errors !== undefined) {
        facts.eventsDegraded = events.value.partial_errors.join('; ');
      }
    }
  } else {
    facts.eventsError = formatApiError(events.reason, 'event history unavailable');
  }

  return facts;
}

async function fetchHealthAttention(cityName: string | null): Promise<HealthAttentionFacts> {
  if (cityName === null) return {};
  const [system, supervisor, trend] = await Promise.allSettled([
    api.systemHealth(),
    supervisorApiForRequestBudget(HEALTH_ATTENTION_SUPERVISOR_TIMEOUT_MS).cityHealth(cityName),
    api.doltTrend(),
  ]);
  const facts: HealthAttentionFacts = {};
  const dashboardErrors: string[] = [];

  if (system.status === 'fulfilled') {
    facts.system = system.value;
  } else {
    dashboardErrors.push(formatApiError(system.reason, 'dashboard health unavailable'));
  }

  if (supervisor.status === 'fulfilled') {
    facts.supervisor = { status: 'available', data: supervisor.value };
  } else {
    facts.supervisor = {
      status: 'unavailable',
      error: formatApiError(supervisor.reason, 'supervisor health unavailable'),
    };
  }

  if (trend.status === 'fulfilled') {
    facts.trend = trend.value;
  } else {
    dashboardErrors.push(formatApiError(trend.reason, 'dolt-noms trend unavailable'));
  }

  if (dashboardErrors.length > 0) {
    facts.dashboardError = dashboardErrors.join('; ');
  }
  return facts;
}

async function fetchMaintainerAttention(
  cityName: string | null,
  enabled: boolean,
): Promise<MaintainerAttentionFacts> {
  if (!enabled || cityName === null) return { enabled: false };
  try {
    return {
      enabled: true,
      nowMs: Date.now(),
      triage: await api.maintainerTriage(),
    };
  } catch (err) {
    return {
      enabled: true,
      error: formatApiError(err, 'maintainer triage unavailable'),
    };
  }
}

function compactFacts(facts: {
  [K in keyof AttentionContributorFacts]: AttentionContributorFacts[K] | undefined;
}): AttentionContributorFacts {
  const out: AttentionContributorFacts = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
