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
import { sessionsRouter } from '../routes/sessions.js';
import { sessionStreamRouter } from '../routes/session-stream.js';
import { agentsRouter } from '../routes/agents.js';
import { beadsRouter } from '../routes/beads.js';
import { runsRouter } from '../routes/runs.js';
import { linksRouter } from '../routes/links.js';
import { mailRouter } from '../routes/mail.js';
import { mailSendRouter } from '../routes/mail-send.js';
import { createDoltNomsSampler, doltRouter, type DoltNomsSampler } from '../routes/dolt.js';
import { eventsRouter } from '../routes/events.js';
import { homePendingRouter } from '../routes/home-pending.js';
import { snapshotRouter } from '../routes/snapshot.js';
import { createSnapshotService } from '../snapshot/service.js';
import { ALL_MODULES } from '../views/registry.js';
import { resolveEnabledFirstPartyIds } from '../views/enabled.js';
import { bind, type CityContext } from '../views/types.js';

/**
 * One city's worth of dashboard runtime (gascity-dashboard-ucc). Each
 * CityRuntime owns its OWN GcClient + CityContext + SnapshotService + module
 * workers + doltNomsSampler, so two cities can never bleed GcClient inflight
 * coalescing (operationKey carries no cityName) or SnapshotService
 * progressMarks (per-service closure state). The runtime exposes a single
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
 * registry passes the supervisor's CityInfo... but CityInfo deliberately
 * omits the host path on the wire, so the registry sources cityPath from the
 * raw supervisor list at build time and hands it here host-side only.
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
    // what an unset env meant. Core-only default (PR-D) surfaces as `[]`.
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
  router.use('/sessions', sessionsRouter(gc));
  // gascity-dashboard-a9yi: do NOT pass cityPath as the execution-path rigRoot
  // fallback. cityPath is the city config/runtime dir, never a per-run worktree
  // and not a git repo — injecting it made runs with no worktree metadata render
  // the misleading "Execution folder is not a git work tree" instead of the
  // honest "Execution folder is unknown for this run."
  // gascity-dashboard-k2b8: pass the configured cwd allowlist so the run-diff
  // git reads are confined to sanctioned roots. Empty (default) keeps the
  // prior shape-only validation. cityPath is deliberately NOT a member of this
  // allowlist (a9yi: it's the city config dir, not a run worktree).
  router.use('/runs', runsRouter(gc, { runCwdAllowedRoots: config.runCwdAllowedRoots }));
  router.use('/links', linksRouter(gc));
  router.use('/agents', agentsRouter({ cityPath, gc }));
  router.use('/beads', beadsRouter(gc, cityPath));
  router.use('/mail', mailRouter(gc));
  router.use(
    '/mail-send',
    mailSendRouter({
      sendMail: (to, subject, body) =>
        gc.sendMail({ to, subject, body, from: 'human' }),
    }),
  );

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

  const snapshotService = createSnapshotService({ gc, config: dashboardConfig });
  router.use('/snapshot', snapshotRouter(snapshotService));
  // Home-view pending-decision SSE (gascity-dashboard-26zl). Streams this
  // runtime's pending aggregator; the consumer count lazily activates the
  // aggregator's per-session fan-out.
  router.use('/home/pending', homePendingRouter(snapshotService));

  // SSE routes. session-stream + events proxy the supervisor's city-scoped
  // streams; both read this runtime's gc. Mounted on the per-city router so
  // they ride the /api/city/:cityName/ prefix.
  //
  // The session SSE stream lives under its OWN `/session-stream` prefix
  // rather than re-using `/sessions` (sessionsRouter above). Two routers on
  // one prefix made the surface ambiguous — a reader could not tell from the
  // mount which router owned `/sessions/:id/stream`. A distinct prefix makes
  // the stream endpoint's owner explicit; the frontend's
  // `api.sessionStreamUrl` targets `/session-stream/:id/stream` to match.
  router.use('/session-stream', sessionStreamRouter({ gc }));
  router.use('/events', eventsRouter({ gc }));

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
