import { useCallback } from 'react';
import type {
  DoltNomsTrend,
  LocalToolVersions,
  RigStoreHealthReport,
  SupervisorStatusReport,
  SystemHealth,
} from 'gas-city-dashboard-shared';
import type { HealthOutputBody, StatusBody } from 'gas-city-dashboard-shared/gc-supervisor';
import { api, formatApiError } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { useCachedData } from '../hooks/useCachedData';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';
import { supervisorApiForRequestBudget } from '../supervisor/client';

const HEALTH_SUPERVISOR_REQUEST_TIMEOUT_MS = 2_500;

export type SupervisorHealthState =
  | { status: 'available'; data: HealthOutputBody }
  | { status: 'unavailable'; error: string };

export type SystemHealthState =
  | { status: 'available'; data: SystemHealth }
  | { status: 'unavailable'; error: string };

export type SupervisorStatusState =
  // `staleReason` is set when the data is the last good snapshot served after a
  // later sample failed (degraded, not blank) — drives the "showing last sample"
  // marker on the diagnostics widgets. null means the data is fresh.
  | {
      status: 'available';
      data: StatusBody;
      staleReason: Extract<SupervisorStatusReport, { available: false }>['reason'] | null;
    }
  | { status: 'unavailable'; error: string };

export type LocalToolVersionsState =
  | { status: 'available'; data: LocalToolVersions }
  | { status: 'unavailable'; error: string };

async function fetchSystemHealth(): Promise<SystemHealthState> {
  try {
    return {
      status: 'available',
      data: await api.systemHealth(),
    };
  } catch (err) {
    return {
      status: 'unavailable',
      error: formatApiError(err, 'dashboard host health unavailable'),
    };
  }
}

async function fetchSupervisorHealth(): Promise<SupervisorHealthState> {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error('Health page loaded before an active city was resolved');
  }
  try {
    return {
      status: 'available',
      data: await supervisorApiForRequestBudget(HEALTH_SUPERVISOR_REQUEST_TIMEOUT_MS).cityHealth(
        cityName,
      ),
    };
  } catch {
    return {
      status: 'unavailable',
      error: 'supervisor health unavailable',
    };
  }
}

function supervisorStatusUnavailableCopy(
  reason: Extract<SupervisorStatusReport, { available: false }>['reason'],
): string {
  switch (reason) {
    case 'not_sampled_yet':
      return 'supervisor status sample is warming up; data appears after the next backend sample';
    case 'status_read_failed':
      return 'latest supervisor status read failed; check the backend log';
  }
}

// Stale marker shown above cached diagnostics, mirroring the rig-store-health
// "Showing the last sample" affordance so a degraded snapshot is never mistaken
// for a fresh read.
export function supervisorStatusStaleCopy(
  reason: Extract<SupervisorStatusReport, { available: false }>['reason'],
): string {
  return `Showing the last sample; refresh failed: ${supervisorStatusUnavailableCopy(reason)}.`;
}

// gascity-dashboard-4bol: read the dashboard backend's cached /status snapshot
// (sampled on the background ceiling) instead of racing the slow supervisor on a
// short interactive budget — live /status runs 10–38s (gastownhall/gascity-dashboard#88).
// A degraded report still carries the last good status, so the store-thresholds /
// dolt-usage / beads-usage widgets show real (cached) data with a "stale" marker
// rather than "supervisor status unavailable".
async function fetchSupervisorStatus(): Promise<SupervisorStatusState> {
  try {
    const report = await api.supervisorStatus();
    if (report.available) {
      return { status: 'available', data: report.status, staleReason: null };
    }
    if (report.status !== null) {
      return { status: 'available', data: report.status, staleReason: report.reason };
    }
    return {
      status: 'unavailable',
      error: supervisorStatusUnavailableCopy(report.reason),
    };
  } catch (err) {
    return {
      status: 'unavailable',
      error: formatApiError(err, 'supervisor status unavailable'),
    };
  }
}

async function fetchLocalToolVersions(): Promise<LocalToolVersionsState> {
  try {
    return {
      status: 'available',
      data: await api.localToolVersions(),
    };
  } catch {
    return {
      status: 'unavailable',
      error: 'local tool versions unavailable',
    };
  }
}

async function fetchDoltNomsTrend(): Promise<DoltNomsTrend> {
  try {
    return await api.doltTrend();
  } catch {
    return {
      available: false,
      reason: 'sample_failed',
      samples: [],
    };
  }
}

async function fetchRigStoreHealth(): Promise<RigStoreHealthReport> {
  try {
    return await api.rigStoreHealth();
  } catch {
    // Transport-level failure (backend unreachable / 5xx / decode) — a
    // distinct root cause from the backend's own 'rig_list_failed', so it must
    // not borrow that reason and point the operator at the supervisor.
    return { available: false, reason: 'fetch_failed', rigs: [] };
  }
}

/** The six independently-degradable data sources the Health page renders. */
export interface HealthSources {
  systemHealth: SystemHealthState | null;
  supervisor: SupervisorHealthState | null;
  status: SupervisorStatusState | null;
  localTools: LocalToolVersionsState | null;
  trend: DoltNomsTrend | null;
  rigStores: RigStoreHealthReport | null;
}

export interface UseHealthSourcesResult {
  sources: HealthSources;
  /** True until the first sample of every source has settled at least once. */
  loading: boolean;
  /** Aggregated fetcher-level failures (not per-source degradation), or null. */
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Owns the Health page's six-source fetch orchestration: each source loads and
 * degrades independently (a stale-while-revalidate cache read per source), the
 * combined loading/error is reduced across them, and a single refresh() fans
 * out to all six. Foreground polling is wired here (30s) so the page component
 * stays render-only. Each source degrades to its own `unavailable` state rather
 * than blanking the page, so one slow/failed source never hides the rest.
 */
export function useHealthSources(): UseHealthSourcesResult {
  const cityName = getActiveCity();
  const systemHealth = useCachedData('health:system', fetchSystemHealth);
  const supervisorHealth = useCachedData(
    `health:supervisor:${cityName ?? 'no-city'}`,
    fetchSupervisorHealth,
  );
  const supervisorStatusCache = useCachedData(
    `health:status:${cityName ?? 'no-city'}`,
    fetchSupervisorStatus,
  );
  const localToolVersions = useCachedData('health:local-tools', fetchLocalToolVersions);
  const doltNomsTrend = useCachedData(
    `health:dolt-noms-trend:${cityName ?? 'no-city'}`,
    fetchDoltNomsTrend,
  );
  const rigStoreHealth = useCachedData(
    `health:rig-store:${cityName ?? 'no-city'}`,
    fetchRigStoreHealth,
  );
  const refreshSystemHealth = systemHealth.refresh;
  const refreshSupervisorHealth = supervisorHealth.refresh;
  const refreshSupervisorStatus = supervisorStatusCache.refresh;
  const refreshLocalToolVersions = localToolVersions.refresh;
  const refreshDoltNomsTrend = doltNomsTrend.refresh;
  const refreshRigStoreHealth = rigStoreHealth.refresh;
  const loading =
    systemHealth.loading ||
    supervisorHealth.loading ||
    supervisorStatusCache.loading ||
    localToolVersions.loading ||
    doltNomsTrend.loading ||
    rigStoreHealth.loading;
  const error =
    [
      systemHealth.error,
      supervisorHealth.error,
      supervisorStatusCache.error,
      localToolVersions.error,
      doltNomsTrend.error,
      rigStoreHealth.error,
    ]
      .filter((value): value is string => value !== null)
      .join('; ') || null;
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshSystemHealth(),
      refreshSupervisorHealth(),
      refreshSupervisorStatus(),
      refreshLocalToolVersions(),
      refreshDoltNomsTrend(),
      refreshRigStoreHealth(),
    ]);
  }, [
    refreshDoltNomsTrend,
    refreshLocalToolVersions,
    refreshRigStoreHealth,
    refreshSupervisorHealth,
    refreshSupervisorStatus,
    refreshSystemHealth,
  ]);

  useVisibleRefresh(refresh, 30_000);

  const sources: HealthSources = {
    systemHealth: systemHealth.data ?? null,
    supervisor: supervisorHealth.data ?? null,
    status: supervisorStatusCache.data ?? null,
    localTools: localToolVersions.data ?? null,
    trend: doltNomsTrend.data ?? null,
    rigStores: rigStoreHealth.data ?? null,
  };

  return { sources, loading, error, refresh };
}
