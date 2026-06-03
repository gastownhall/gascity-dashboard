import { Router, type Request, type Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { HTTP_STATUS } from '../lib/http-status.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../logging.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const STRIPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  'cookie',
  'host',
  'origin',
  'referer',
]);

export function supervisorTransportProxy(supervisorBaseUrl: string): Router {
  const router = Router();
  const baseUrl = new URL(supervisorBaseUrl);

  router.use(async (req, res) => {
    if (!isAllowedSupervisorPath(req.path)) {
      res.status(HTTP_STATUS.notFound).type('text/plain').send('not found');
      return;
    }

    const target = new URL(req.url, baseUrl);
    try {
      const upstream = await fetch(target, requestInit(req));
      await writeUpstreamResponse(upstream, res);
    } catch (err) {
      logWarn(
        LOG_COMPONENT.admin,
        `gc supervisor transport proxy failed: ${errorMessage(err)}`,
      );
      if (!res.headersSent) {
        res.status(HTTP_STATUS.badGateway).json({
          error: 'gc supervisor transport failed',
          kind: 'upstream',
        });
      } else {
        res.destroy(err instanceof Error ? err : undefined);
      }
    }
  });

  return router;
}

function isAllowedSupervisorPath(path: string): boolean {
  return path === '/health' || path.startsWith('/v0/');
}

function requestInit(req: Request): RequestInit & { duplex?: 'half' } {
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers: requestHeaders(req),
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req as unknown as BodyInit;
    init.duplex = 'half';
  }
  return init;
}

function requestHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(lower)) continue;
    if (rawValue === undefined) continue;
    headers.set(name, Array.isArray(rawValue) ? rawValue.join(', ') : rawValue);
  }
  return headers;
}

async function writeUpstreamResponse(upstream: Response, res: ExpressResponse): Promise<void> {
  res.status(upstream.status);
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  });
  if (upstream.body === null) {
    res.end();
    return;
  }
  await pipeline(
    Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>),
    res,
  );
}
