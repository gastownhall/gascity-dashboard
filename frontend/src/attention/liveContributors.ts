import { useMemo } from 'react';
import {
  OPERATOR_DISPLAY_ALIAS,
  OPERATOR_WIRE_ALIAS,
} from 'gas-city-dashboard-shared';
import { api, formatApiError } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { useCachedData } from '../hooks/useCachedData';
import { listAgentPendingInteractions } from '../supervisor/agentPending';
import { supervisorApi } from '../supervisor/client';
import {
  DEFAULT_MAIL_HISTORY_LIMIT,
  listSupervisorMail,
} from '../supervisor/mailReads';
import type { AttentionContributor } from './compose';
import {
  createAttentionContributors,
  type ActivityAttentionFacts,
  type AgentsAttentionFacts,
  type AttentionContributorFacts,
  type BeadsAttentionFacts,
  type HealthAttentionFacts,
  type MailAttentionFacts,
  type MaintainerAttentionFacts,
  type RunsAttentionFacts,
} from './registry';

const FORMULA_FEED_LIMIT = 100;
const ATTENTION_LIST_LIMIT = 1000;
const ACTIVITY_EVENT_FETCH_LIMIT = 100;
const ACTIVITY_EVENT_WINDOW = '24h';

export function useLiveAttentionContributors(
  enabledModules: readonly string[] | null = null,
): readonly AttentionContributor[] {
  const cityName = getActiveCity();
  const cacheSuffix = cityName ?? 'no-city';
  const maintainerEnabled = enabledModules === null || enabledModules.includes('maintainer');
  const runs = useCachedData<RunsAttentionFacts>(
    `attention:runs:${cacheSuffix}`,
    () => fetchRunsAttention(cityName),
  );
  const agents = useCachedData<AgentsAttentionFacts>(
    `attention:agents:${cacheSuffix}`,
    () => fetchAgentsAttention(cityName),
  );
  const beads = useCachedData<BeadsAttentionFacts>(
    `attention:beads:${cacheSuffix}`,
    () => fetchBeadsAttention(cityName),
  );
  const mail = useCachedData<MailAttentionFacts>(
    `attention:mail:${cacheSuffix}`,
    () => fetchMailAttention(cityName),
  );
  const activity = useCachedData<ActivityAttentionFacts>(
    `attention:activity:${cacheSuffix}`,
    () => fetchActivityAttention(cityName),
  );
  const health = useCachedData<HealthAttentionFacts>(
    `attention:health:${cacheSuffix}`,
    () => fetchHealthAttention(cityName),
  );
  const maintainer = useCachedData<MaintainerAttentionFacts>(
    `attention:maintainer:${cacheSuffix}:${maintainerEnabled ? 'enabled' : 'disabled'}`,
    () => fetchMaintainerAttention(cityName, maintainerEnabled),
  );

  return useMemo(
    () => createAttentionContributors(compactFacts({
      activity: activity.data,
      agents: agents.data,
      beads: beads.data,
      health: health.data,
      mail: mail.data,
      maintainer: maintainer.data,
      runs: runs.data,
    })),
    [
      activity.data,
      agents.data,
      beads.data,
      health.data,
      mail.data,
      maintainer.data,
      runs.data,
    ],
  );
}

async function fetchRunsAttention(
  cityName: string | null,
): Promise<RunsAttentionFacts> {
  if (cityName === null) return {};
  try {
    return {
      feed: await supervisorApi().formulaFeed(cityName, {
        limit: FORMULA_FEED_LIMIT,
        scope_kind: 'city',
        scope_ref: cityName,
      }),
    };
  } catch (err) {
    return { error: formatApiError(err, 'formula run feed unavailable') };
  }
}

async function fetchAgentsAttention(
  cityName: string | null,
): Promise<AgentsAttentionFacts> {
  if (cityName === null) return {};
  try {
    const list = await supervisorApi().listAgents(cityName);
    const facts: AgentsAttentionFacts = {
      items: list.items ?? [],
      nowMs: Date.now(),
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
): Promise<BeadsAttentionFacts> {
  if (cityName === null) return {};
  try {
    const list = await supervisorApi().listBeads(cityName, { limit: ATTENTION_LIST_LIMIT });
    return {
      items: list.items ?? [],
      nowMs: Date.now(),
      partial: list.partial === true,
    };
  } catch (err) {
    return { error: formatApiError(err, 'bead list unavailable') };
  }
}

async function fetchMailAttention(
  cityName: string | null,
): Promise<MailAttentionFacts> {
  if (cityName === null) return { operatorAlias: OPERATOR_WIRE_ALIAS };
  try {
    const list = await listSupervisorMail(
      'inbox',
      OPERATOR_DISPLAY_ALIAS,
      DEFAULT_MAIL_HISTORY_LIMIT,
    );
    return {
      items: list.items ?? [],
      nowMs: Date.now(),
      operatorAlias: OPERATOR_WIRE_ALIAS,
      partial: list.partial === true,
    };
  } catch (err) {
    return {
      operatorAlias: OPERATOR_WIRE_ALIAS,
      error: formatApiError(err, 'mail list unavailable'),
    };
  }
}

async function fetchActivityAttention(
  cityName: string | null,
): Promise<ActivityAttentionFacts> {
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

async function fetchHealthAttention(
  cityName: string | null,
): Promise<HealthAttentionFacts> {
  if (cityName === null) return {};
  const [system, supervisor, trend] = await Promise.allSettled([
    api.systemHealth(),
    supervisorApi().cityHealth(cityName),
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
