import { Router, type Request, type Response } from 'express';

import type { SnapshotService } from '../snapshot/service.js';

// Layer 3 dashboard SSE for the home-view pending-decision feed
// (gascity-dashboard-26zl, R3/R16, Option A). Unlike events.ts/session-stream
// this is NOT an upstream proxy — it streams the backend's own pending
// aggregator (service.streamPending / pendingAlerts). The browser opens ONE
// EventSource here (the revised-R13 path); registering a consumer is what lazily
// activates the aggregator's per-session fan-out, so no consumer ⇒ no fan-out.

const DEFAULT_HEARTBEAT_MS = 15_000;

function openSse(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/** Core handler, exported for direct unit testing with fake req/res. */
export function handleHomePendingStream(
  service: SnapshotService,
  req: Request,
  res: Response,
  opts: { heartbeatMs?: number } = {},
): void {
  openSse(res);

  const send = (): void => {
    if (res.writableEnded) return;
    const payload = JSON.stringify({ alerts: service.pendingAlerts() });
    res.write(`event: pending\ndata: ${payload}\n\n`);
  };

  // Initial frame so a fresh consumer has the current pending set immediately;
  // then push on every aggregator change (async over poll).
  send();
  const unsubscribe = service.streamPending(send);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(':\n\n');
  }, opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  // The heartbeat must not, on its own, keep the process alive — it is purely a
  // keep-alive for an otherwise-idle connection.
  heartbeat.unref();

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.writableEnded) res.end();
  });
}

export function homePendingRouter(service: SnapshotService): Router {
  const router = Router();
  router.get('/stream', (req, res) => {
    handleHomePendingStream(service, req, res);
  });
  return router;
}
