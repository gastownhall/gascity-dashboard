import type { AdminConfig } from '../config.js';
import type { GcClient } from '../gc-client.js';
import { isValidCityName } from '../lib/cityName.js';
import { createCityRuntime, type CityRuntime } from './runtime.js';

/**
 * Raw supervisor city descriptor including the untrusted host `path`. This
 * is host-side only. The browser reads generated supervisor CityInfo
 * directly and uses only the fields it needs.
 */
export interface SupervisorCityDescriptor {
  name: string;
  path: string;
  running: boolean;
}

/** Lists the supervisor's cities WITH the host path (registry-internal). */
export type ListSupervisorCities = (
  signal?: AbortSignal,
) => Promise<readonly SupervisorCityDescriptor[]>;

export interface CityRegistryOptions {
  config: AdminConfig;
  /** Lists cities (name+path+running) from the supervisor. Injectable for tests. */
  listCities: ListSupervisorCities;
  /** Builds a runtime for a known-valid, known-existing city. Injectable for tests. */
  createRuntime?: (descriptor: SupervisorCityDescriptor) => CityRuntime;
}

/** Discriminated outcome of a runtime lookup so the middleware can map each
 *  case to the correct HTTP status WITHOUT a silent fallback to another city. */
export type ResolveResult =
  | { kind: 'ok'; runtime: CityRuntime }
  | { kind: 'invalid' } // cityName failed CITY_NAME_RE (caller already guards, defensive)
  | { kind: 'unknown' } // valid name, but not a managed city
  | { kind: 'upstream-error'; error: unknown }; // /v0/cities call failed

export interface CityRegistry {
  /** Get-or-create the runtime for `cityName`. Concurrent first-requests for
   *  the same city share ONE in-flight construction (memoized promise) so
   *  exactly one CityRuntime is ever built per city. Deliberately takes no
   *  AbortSignal: the build is shared, so a single caller's cancellation
   *  must never tear construction down for the other waiters. */
  resolve(cityName: string): Promise<ResolveResult>;
  /** Stop every live runtime (process shutdown). */
  stopAll(): Promise<void>;
}

/**
 * Lazy per-city runtime registry (gascity-dashboard-ucc). Keyed off the
 * supervisor's `GET /v0/cities`. A runtime is built on first request for a
 * city and kept until process exit (lifecycle v1: no eager boot, no LRU
 * eviction — the RISKS note recommends keep-until-process-exit).
 */
export function createCityRegistry(opts: CityRegistryOptions): CityRegistry {
  const { config, listCities } = opts;
  const createRuntime =
    opts.createRuntime ??
    ((d) =>
      createCityRuntime({
        cityName: d.name,
        cityPath: d.path,
        config,
      }));

  // Live runtimes, and the in-flight construction promises that prevent a
  // double-build race (mirrors cache.ts:122-132 single-flight). A slot stays
  // in `building` only while construction is pending; on success it migrates
  // to `runtimes`, on failure it is cleared so the next request retries.
  const runtimes = new Map<string, CityRuntime>();
  const building = new Map<string, Promise<ResolveResult>>();

  async function build(cityName: string): Promise<ResolveResult> {
    // No AbortSignal is threaded here ON PURPOSE. The build is memoized and
    // SHARED across all concurrent first-requesters for this city (see
    // resolve()). Honoring the first caller's signal would let that one
    // requester's abort cancel the build out from under every other waiter
    // riding the same promise. The build is a single fast /v0/cities lookup;
    // it runs to completion and the result is shared. Per-request
    // cancellation lives at the HTTP layer, not in the shared construction.
    let cities: readonly SupervisorCityDescriptor[];
    try {
      cities = await listCities();
    } catch (error) {
      return { kind: 'upstream-error', error };
    }
    const descriptor = cities.find((c) => c.name === cityName);
    if (descriptor === undefined) {
      return { kind: 'unknown' };
    }
    const runtime = createRuntime(descriptor);
    // Register BEFORE start() so a throwing start leaves a runtime that
    // stopAll() can still tear down (workers that DID start, the dolt
    // sampler, etc). If we started first and start() threw, the half-started
    // runtime would be unreachable and leak. The map entry is the live one;
    // resolve() returns it on success, and a start() throw propagates to the
    // caller (city-dispatch maps it to 500).
    runtimes.set(cityName, runtime);
    runtime.start();
    return { kind: 'ok', runtime };
  }

  return {
    async resolve(cityName): Promise<ResolveResult> {
      // Defensive: the dispatch middleware already rejects invalid names
      // BEFORE calling resolve (so no listCities call happens for a traversal
      // attempt). This guard makes the registry safe to call directly too.
      if (!isValidCityName(cityName)) {
        return { kind: 'invalid' };
      }

      const live = runtimes.get(cityName);
      if (live !== undefined) {
        return { kind: 'ok', runtime: live };
      }

      // Memoize the in-flight construction so concurrent first-requests for
      // the same city collapse to ONE build (exactly one CityRuntime). The
      // caller's `signal` is intentionally NOT threaded into the shared build:
      // a single requester's abort must not cancel construction out from under
      // the other waiters riding the same promise. A build failure clears the
      // slot so the next request retries.
      const existing = building.get(cityName);
      if (existing !== undefined) {
        return await existing;
      }
      const promise = build(cityName);
      building.set(cityName, promise);
      try {
        return await promise;
      } finally {
        building.delete(cityName);
      }
    },

    async stopAll(): Promise<void> {
      await Promise.all([...runtimes.values()].map((r) => r.stop()));
      runtimes.clear();
    },
  };
}

/**
 * Adapter from a GcClient to the registry's host-side lister. The wire
 * `listSupervisorCities()` retains the untrusted host path so each
 * CityRuntime's local filesystem routes get their city root.
 */
export function supervisorCityLister(gc: GcClient): ListSupervisorCities {
  return async (signal) => gc.listSupervisorCities(signal);
}

export { CityRuntime };
