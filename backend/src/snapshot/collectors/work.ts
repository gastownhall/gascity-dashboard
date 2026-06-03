import type { WorkSummary } from 'gas-city-dashboard-shared';

import { type GcClient } from '../../gc-client.js';
import type { StatusBody } from '../../generated/gc-supervisor-client/types.gen.js';
import { SourceCache } from '../cache.js';

// Work-item census collector — gascity-dashboard-aw75. Surfaces the
// supervisor's city-wide `status.work` block (GET /v0/city/{name}/status,
// already fetched via GcClient.getStatus) so in_progress work items reach the
// dashboard. The run-lane census counts formula-run lanes only; an arbitrary
// claimed task bead's in_progress state was previously dropped before the UI.
//
// The wire's snake_case `in_progress` is translated to the dashboard DTO's
// camelCase `inProgress` here, at the edge — raw wire shapes never flow inward.
//
// `status.work` is optional on the wire: a degraded supervisor may omit it.
// We THROW in that case rather than fabricate a zero (Don't Swallow Errors).
// The SourceCache settle wrapper turns the throw into a status='error' source
// state, which degrades the headline `workInProgress` metric to 'unavailable'
// instead of reporting a misleading 0.

/**
 * 45s TTL — matches CITY_STATUS_CACHE_TTL_MS. The headline renders
 * `workInProgress` next to the city-sourced `activeAgents`/`activeSessions`,
 * so both must read from the same ~45s clock or the two counts could be a
 * cache generation apart.
 */
export const WORK_CACHE_TTL_MS = 45 * 1000;

export type WorkStatus = Partial<Pick<StatusBody, 'work' | 'version'>>;

export interface CollectWorkOptions {
  /** Live upstream loader for the supervisor city status. */
  getStatus: () => Promise<WorkStatus>;
}

export interface CreateWorkSourceCacheOptions {
  /**
   * Either/or contract: supply a shared `gc` (production) OR a `getStatus`
   * seam (tests), not necessarily both. resolveGetStatus throws at
   * construction if neither is present — a clear runtime guard the type
   * system cannot express as "at least one of two". buildDefaultCaches
   * always supplies `gc`; the unit tests always supply `getStatus`.
   */
  gc?: GcClient | undefined;
  now?: (() => Date) | undefined;
  loadFixture?: (() => Promise<WorkSummary> | WorkSummary) | undefined;
  useFixture?: boolean | undefined;
  /** Test seam: override the getStatus binding to avoid a real GcClient. */
  getStatus?: (() => Promise<WorkStatus>) | undefined;
}

export function createWorkSourceCache(
  options: CreateWorkSourceCacheOptions,
): SourceCache<WorkSummary> {
  const getStatus = resolveGetStatus(options);

  return new SourceCache<WorkSummary>({
    source: 'work',
    ttlMs: WORK_CACHE_TTL_MS,
    now: options.now,
    load: () => collectWork({ getStatus }),
    loadFixture: options.loadFixture,
    useFixture: options.useFixture,
    // gascity-dashboard-4r5 posture, mirroring the city collector: GcClient
    // already throws operator-safe messages (`gc supervisor returned ${status}`,
    // connection refused, etc.) with no OS paths, so the operator benefits from
    // seeing the actual upstream failure reason on the wire.
    sanitizeErrorMessage: null,
  });
}

export async function collectWork(options: CollectWorkOptions): Promise<WorkSummary> {
  const status = await options.getStatus();
  const work = status.work;
  if (work === undefined) {
    throw new Error(
      'supervisor status response omitted work counts (status.work absent)',
    );
  }

  return {
    open: work.open,
    ready: work.ready,
    inProgress: work.in_progress,
  };
}

function resolveGetStatus(
  options: CreateWorkSourceCacheOptions,
): () => Promise<WorkStatus> {
  if (options.getStatus) return options.getStatus;
  const { gc } = options;
  if (!gc) {
    throw new Error(
      'createWorkSourceCache requires either { gc } or a { getStatus } test seam',
    );
  }
  return () => gc.getStatus();
}
