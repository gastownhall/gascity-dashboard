import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AdminConfig } from './config.js';
import {
  hostHeaderAllowlistFactory,
  originCheck,
  securityHeaders,
} from './middleware/security.js';
import { csrfIssueCookie, csrfValidate, getCsrfToken } from './middleware/csrf.js';
import { apiErrorHandler } from './middleware/api-error-handler.js';
import { GcClient } from './gc-client.js';
import { gitRouter } from './routes/git.js';
import { buildsRouter } from './routes/builds.js';
import { clientErrorsRouter } from './routes/client-errors.js';
import { healthRouter } from './routes/health.js';
import { supervisorTransportProxy } from './routes/supervisor-transport-proxy.js';
import {
  createCityRegistry,
  supervisorCityLister,
  type CityRegistry,
} from './city/registry.js';
import { cityDispatch } from './middleware/city-dispatch.js';
import {
  LOG_COMPONENT,
  errorMessage,
  logInfo,
  logWarn,
} from './logging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardRuntime {
  start(): void;
  /** Stop all live per-city runtimes. Returns a Promise so workers that
   *  drain in-flight work can await cleanly. */
  stop(): Promise<void>;
}

export interface DashboardApp {
  app: Express;
  runtime: DashboardRuntime;
}

export function createDashboardApp(config: AdminConfig): DashboardApp {
  const app = express();
  app.disable('x-powered-by');

  app.use(hostHeaderAllowlistFactory(config.extraAllowedHosts));
  app.use(originCheck(config.port, config.extraAllowedHosts));
  app.use(securityHeaders());
  app.use(csrfIssueCookie);

  // A single GcClient pointed at the supervisor's NON-city endpoints (the
  // cities registry). Per-city GcClients live inside each CityRuntime; this
  // one only ever calls /v0/cities, which is identical across cities.
  const supervisorGc = new GcClient({
    baseUrl: config.gcSupervisorUrl,
    cityName: config.cityName,
  });

  const registry: CityRegistry = createCityRegistry({
    config,
    listCities: supervisorCityLister(supervisorGc),
  });

  app.use('/gc-supervisor', supervisorTransportProxy(config.gcSupervisorUrl));
  app.use(express.json({ limit: '64kb' }));

  // ── Top-level (non-city) routes ─────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });
  app.use('/api/health', healthRouter());

  app.get('/api/csrf', (_req, res) => {
    res.json({ token: getCsrfToken() });
  });

  // Host-global write routes (git/builds/client-errors) are NOT city-scoped:
  // git reads the dashboard host cwd, builds reads a host deploy log, and
  // client-error reports are infrastructure telemetry. They stay top-level
  // behind csrfValidate (client-errors is a POST).
  const globalRouter = express.Router();
  globalRouter.use(csrfValidate);
  globalRouter.use('/git', gitRouter());
  globalRouter.use('/builds', buildsRouter());
  globalRouter.use('/client-errors', clientErrorsRouter());
  app.use('/api', globalRouter);

  // ── Per-city request plane ──────────────────────────────────────────────
  // Every city-scoped read/write/stream rides /api/city/:cityName/*. The
  // dispatch middleware validates :cityName, resolves the runtime, and
  // delegates to its router (which owns gc/service/cityPath).
  app.use('/api/city/:cityName', cityDispatch(registry), (req, res, next) => {
    const runtime = req.cityRuntime;
    if (runtime === undefined) {
      // cityDispatch already wrote an error response for every non-ok case.
      next();
      return;
    }
    runtime.router(req, res, next);
  });

  logInfo(
    LOG_COMPONENT.admin,
    `multi-city request plane mounted at /api/city/:cityName/* ` +
      `(supervisor=${config.gcSupervisorUrl}, default city=${config.cityName})`,
  );

  // Global API error boundary (from #61): last-resort handler so an
  // unhandled throw in any /api route returns a structured JSON error
  // instead of Express's default HTML 500.
  app.use(apiErrorHandler());

  mountFrontend(app, config.frontendDistPath);

  return {
    app,
    runtime: {
      start() {
        // Runtimes are built lazily on first request and started then; there
        // is no eager per-city boot (RISKS: no eager boot instantiation).
      },
      async stop() {
        try {
          await registry.stopAll();
        } catch (err) {
          logWarn(
            LOG_COMPONENT.admin,
            `city registry stopAll: ${errorMessage(err)}`,
          );
        }
      },
    },
  };
}

function mountFrontend(app: Express, frontendDistPath: string): void {
  const distDir = path.resolve(__dirname, '..', frontendDistPath);
  if (!fs.existsSync(distDir)) {
    logInfo(LOG_COMPONENT.admin, `frontend dist not found at ${distDir} — API-only mode`);
    return;
  }

  app.use(
    express.static(distDir, {
      index: 'index.html',
      dotfiles: 'deny',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}
