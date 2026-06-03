import express, { type Router } from 'express';
import os from 'node:os';
import path from 'node:path';
import type {
  BackgroundWorker,
  DashboardRuntimeConfig,
} from 'gas-city-dashboard-shared';

import type { AdminConfig } from '../config.js';
import { GcClient } from '../gc-client.js';
import { csrfValidate } from '../middleware/csrf.js';
import { agentsRouter } from '../routes/agents.js';
import { runsRouter } from '../routes/runs.js';
import { createDoltNomsSampler, doltRouter, type DoltNomsSampler } from '../routes/dolt.js';
import { ALL_MODULES } from '../views/registry.js';
import { resolveEnabledFirstPartyIds } from '../views/enabled.js';
import { bind, type CityContext } from '../views/types.js';

/**
 * One city's worth of dashboard runtime (gascity-dashboard-ucc). Each
 * CityRuntime owns its OWN GcClient + CityContext + module
 * workers + doltNomsSampler, so two cities can never bleed GcClient inflight
 * coalescing (operationKey carries no cityName). The runtime exposes a single
 * `router` that the dispatch middleware mounts under `/api/city/:cityName/`.
 */
export interface CityRuntime {
  readonly cityName: string;
  /** All city-scoped routes for this city, mounted relative (no /city prefix). */
  readonly router: Router;
  /** Wire-shape config served by this city's GET /config. */
  readonly dashboardConfig: DashboardRuntimeConfig;
  start(): void;
  stop(): Promise<void>;
}

/**
 * `cityPath` is the supervisor-reported absolute host directory for the
 * city. It is an EXTERNAL/UNTRUSTED host path (decision: keep it separate
 * from cityDataDir, which derives from the validated cityName segment). The
 * registry sources it from the supervisor city list and hands it here
 * host-side only.
 */
export interface CreateCityRuntimeOptions {
  cityName: string;
  /** Untrusted supervisor-reported host path for CLI-shelling routes. */
  cityPath: string;
  config: AdminConfig;
  /** Injectable for tests; defaults to a real GcClient on the supervisor. */
  gc?: GcClient;
}

export function createCityRuntime(opts: CreateCityRuntimeOptions): CityRuntime {
  const { cityName, cityPath, config } = opts;
  const gc =
    opts.gc ??
    new GcClient({ baseUrl: config.gcSupervisorUrl, cityName });

  // Resolve mounted modules once so /config and the mount loop cannot drift.
  const enabledFirstPartyIds = resolveEnabledFirstPartyIds(
    ALL_MODULES,
    config.enabledModules,
  );
  const mountedModules = ALL_MODULES.filter(
    (m) => m.kind === 'core' || enabledFirstPartyIds.has(m.id),
  );

  const dashboardConfig: DashboardRuntimeConfig = {
    cityName,
    cityRoot: cityPath,
    useFixtures: config.useFixtures,
    // Always emit the explicit resolved firstParty id list (possibly empty)
    // so the wire is unambiguous and the frontend filter never has to guess
    // what an unset env meant. Core-only default surfaces as `[]`.
    enabledModules: [...enabledFirstPartyIds],
    defaultView: config.defaultView,
  };

  // cityDataDir derives from the VALIDATED cityName segment (never from the
  // untrusted supervisor host path). The cityName has already passed
  // CITY_NAME_RE in the dispatch middleware before this runs.
  const cityDataDir = path.join(
    os.homedir(),
    '.gascity-dashboard',
    'cities',
    cityName,
  );
  const cityContext: CityContext = {
    cityName,
    cityPath,
    cityDataDir,
    gc,
    config,
  };

  const router = express.Router();
  router.use(csrfValidate);
  router.get('/config', (_req, res) => {
    res.json(dashboardConfig);
  });
  // gascity-dashboard-a9yi: do NOT pass cityPath as the execution-path rigRoot
  // fallback. cityPath is the city config/runtime dir, never a per-run worktree
  // and not a git repo — injecting it made runs with no worktree metadata render
  // the misleading "Execution folder is not a git work tree" instead of the
  // honest "Execution folder is unknown for this run."
  // gascity-dashboard-k2b8: pass the configured cwd allowlist so the run-diff
  // git reads are confined to sanctioned roots. Empty (default) keeps the
  // prior shape-only validation. cityPath is deliberately NOT a member of this
  // allowlist (a9yi: it's the city config dir, not a run worktree).
  router.use('/runs', runsRouter({ runCwdAllowedRoots: config.runCwdAllowedRoots }));
  router.use('/agents', agentsRouter({ cityPath }));

  const moduleWorkers: BackgroundWorker[] = [];
  for (const mod of mountedModules) {
    const bound = bind(mod, config);
    router.use(`/${bound.id}`, bound.mount(cityContext));
    const w = bound.worker?.(cityContext);
    if (w) moduleWorkers.push(w);
  }

  // gascity-dashboard-x82: dolt-noms trend sources the supervisor's
  // store_health.size_bytes (per-city GcClient.getStatus), not host-FS access.
  const doltNomsSampler: DoltNomsSampler = createDoltNomsSampler({
    fetchStatus: () => gc.getStatus(),
  });
  router.use('/dolt-noms', doltRouter(doltNomsSampler));

  return {
    cityName,
    router,
    dashboardConfig,
    start() {
      doltNomsSampler.start();
      for (const w of moduleWorkers) w.start();
    },
    async stop() {
      await Promise.all(moduleWorkers.map((w) => w.stop()));
      doltNomsSampler.stop();
    },
  };
}
