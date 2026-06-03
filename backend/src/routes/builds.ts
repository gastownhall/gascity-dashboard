import { Router } from 'express';
import fs from 'node:fs/promises';
import type { DeployRecord, DeployStatus } from 'gas-city-dashboard-shared';
import { recordAudit } from '../audit.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../logging.js';

const DEFAULT_LOG_PATH = process.env.HOME ? `${process.env.HOME}/.dev-deploy-log` : '.dev-deploy-log';
const DEFAULT_MARKER_PATH = process.env.HOME ? `${process.env.HOME}/.dev-deploy-FAILED` : '.dev-deploy-FAILED';
// Recent activity only. At typical dev-deploy cadence, 200 records covers
// roughly a month without turning this ambient route into a log browser.
const MAX_RECORDS = 200;

// Format of the lines we parse — written by the deploy script:
//   [ISO-TS] deploy OK (old-sha -> new-sha)
//   [ISO-TS] deploying old-sha -> new-sha
//   [ISO-TS] DEPLOY FAILED at stage: <stage>
//   [ISO-TS] manual recovery for th-X: ... (informational)
// Anything not matching becomes status: 'unknown' with the raw line as detail.

const LINE_RE = /^\[(?<ts>[^\]]+)\]\s+(?<rest>.*)$/;

export interface BuildsConfig {
  logPath?: string;
  markerPath?: string;
}

export function buildsRouter(cfg: BuildsConfig = {}): Router {
  const router = Router();
  const logPath = cfg.logPath ?? DEFAULT_LOG_PATH;
  const markerPath = cfg.markerPath ?? DEFAULT_MARKER_PATH;

  router.get('/', async (_req, res) => {
    const items: DeployRecord[] = [];
    let source: string | null = null;
    try {
      const text = await fs.readFile(logPath, 'utf-8');
      source = logPath;
      const lines = text.split('\n').reverse();
      for (const line of lines) {
        if (items.length >= MAX_RECORDS) break;
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const m = LINE_RE.exec(trimmed);
        if (!m || !m.groups) continue;
        const ts = m.groups.ts;
        const rest = m.groups.rest;
        if (!ts || !rest) continue;
        items.push({
          at: ts,
          status: classify(rest),
          detail: rest,
        });
      }
    } catch (err) {
      if (!isMissingFile(err)) {
        logWarn(LOG_COMPONENT.builds, `failed to read deploy log: ${errorMessage(err)}`);
      }
    }
    let failedMarker = false;
    try {
      await fs.access(markerPath);
      failedMarker = true;
    } catch (err) {
      if (!isMissingFile(err)) {
        logWarn(LOG_COMPONENT.builds, `failed to read deploy failure marker: ${errorMessage(err)}`);
      }
    }
    await recordAudit({
      type: 'dashboard.fetch',
      endpoint: 'GET /api/builds',
      parsed_args: { records: String(items.length), failed_marker: String(failedMarker) },
      duration_ms: 0,
    });
    res.json({ items, source, failed_marker: failedMarker });
  });

  return router;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function classify(rest: string): DeployStatus {
  if (rest.startsWith('deploy OK')) return 'ok';
  if (rest.startsWith('DEPLOY FAILED')) return 'failed';
  if (rest.startsWith('deploying ')) return 'in-progress';
  return 'unknown';
}
