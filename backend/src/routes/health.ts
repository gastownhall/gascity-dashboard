import { Router } from 'express';
import os from 'node:os';
import type { LocalToolVersion, LocalToolVersions, SystemHealth } from 'gas-city-dashboard-shared';
import { recordAudit } from '../audit.js';
import {
  probeBeadsVersion,
  probeDoltVersion,
  probeGcVersion,
  type VersionProbe,
  type VersionProbeResult,
} from './version-probe.js';

export interface HealthRouterOptions {
  doltProbe?: VersionProbe;
  beadsProbe?: VersionProbe;
  gcProbe?: VersionProbe;
}

/** Dashboard-local admin process and host health. GC supervisor health is
 * fetched directly by the browser through the generated supervisor client. */
export function healthRouter(options: HealthRouterOptions = {}): Router {
  const router = Router();
  const doltProbe = options.doltProbe ?? probeDoltVersion;
  const beadsProbe = options.beadsProbe ?? probeBeadsVersion;
  const gcProbe = options.gcProbe ?? probeGcVersion;

  router.get('/system', async (_req, res) => {
    const mem = process.memoryUsage();
    const load = os.loadavg();
    const payload: SystemHealth = {
      admin: {
        pid: process.pid,
        uptime_sec: Math.round(process.uptime()),
        rss_bytes: mem.rss,
        heap_used_bytes: mem.heapUsed,
        node_version: process.version,
      },
      host: {
        load_avg_1: load[0] ?? 0,
        load_avg_5: load[1] ?? 0,
        load_avg_15: load[2] ?? 0,
        total_mem_bytes: os.totalmem(),
        free_mem_bytes: os.freemem(),
        cpu_count: os.cpus().length,
        uptime_sec: Math.round(os.uptime()),
      },
    };
    await recordAudit({
      type: 'dashboard.fetch',
      endpoint: 'GET /api/health/system',
      duration_ms: 0,
    });
    res.json(payload);
  });

  router.get('/local-tools', async (_req, res) => {
    const [dolt, beads, gc] = await Promise.all([doltProbe(), beadsProbe(), gcProbe()]);
    const payload: LocalToolVersions = {
      dolt: localToolVersion(dolt, 'local probe: dolt version'),
      beads: localToolVersion(beads, 'local probe: bd version'),
      gc: localToolVersion(gc, 'local probe: gc version'),
    };
    await recordAudit({
      type: 'dashboard.fetch',
      endpoint: 'GET /api/health/local-tools',
      duration_ms: 0,
    });
    res.json(payload);
  });

  return router;
}

function localToolVersion(result: VersionProbeResult, source: string): LocalToolVersion {
  return result.kind === 'ok'
    ? { status: 'available', version: result.version, source }
    : { status: 'unavailable', reason: result.reason };
}
