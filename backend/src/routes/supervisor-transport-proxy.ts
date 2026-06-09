import { Router, type Request, type Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { HTTP_STATUS } from '../lib/http-status.js';
import { createTtlSingleFlightCache, type CachedResponse } from '../lib/ttl-single-flight-cache.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../logging.js';
import { isAllowedReadPath } from './supervisor-read-allowlist.js';

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

// In read-only mode every forwarded request is a GET/HEAD read, so the
// supervisor's write-authorizing `x-gc-request` header is removed unconditionally
// (never depend on its absence) along with a body `content-type` that can no
// longer apply.
const READONLY_STRIPPED_REQUEST_HEADERS = new Set([
  ...STRIPPED_REQUEST_HEADERS,
  'x-gc-request',
  'content-type',
]);

// gascity-dashboard: short-TTL + single-flight cache for the two expensive
// city-wide GET reads (the always-mounted run-summary subscription re-fires both
// on every SSE bead-event burst). The molecule(all=true) history scan (~7s,
// 340k-row) and the city formula feed (~10s) are city-wide, carry no
// auth-varying headers, and are pure GETs — safe to coalesce + briefly cache so
// the browser connection pool stays free for the run-detail's fast workflowRun
// read. NOTHING scoped/per-rig/per-run/mutating is cached: the active-bead list
// (no all=true), per-rig task reads (type=task&rig=...), and any query carrying
// an extra param (rig/status/label/assignee/cursor/...) all fail the EXACT
// param-set match below and go straight upstream.
const CACHEABLE_CITY_WIDE_READS: readonly RegExp[] = [
  /^\/v0\/city\/[^/]+\/formulas\/feed$/,
  /^\/v0\/city\/[^/]+\/beads$/,
];

// The exact param sets the run-summary subscription sends for the two cacheable
// reads (frontend/src/supervisor/runSummary.ts + discoverFromFeed). The match is
// EXACT: any param outside the expected set (a scoped/per-rig/filtered read)
// disqualifies the request, so a broader query can never be served a cached
// city-wide body.
const MOLECULE_HISTORY_FETCH_LIMIT = '500';
const MOLECULE_HISTORY_PARAMS: ReadonlyArray<readonly [string, string]> = [
  ['type', 'molecule'],
  ['all', 'true'],
  ['limit', MOLECULE_HISTORY_FETCH_LIMIT],
];

function paramsMatchExactly(
  q: URLSearchParams,
  expected: ReadonlyArray<readonly [string, string]>,
): boolean {
  if ([...q.keys()].length !== expected.length) return false;
  return expected.every(([key, value]) => q.get(key) === value);
}

// 45s (gascity-dashboard-i60u): a CONSCIOUS reversal of the former "do not
// exceed 5s" cap. That cap assumed gastownhall/gascity#3253 would make the
// server-side molecule+feed build cheap (~80ms→22ms); #3253 is blocked, so the
// cold read stays 7-11s and a 3s TTL almost never survives long enough to serve
// a warm hit — every fresh detail load paid the full cold scan and queued the
// page's own fast reads behind it (the browser's ~6-conn/host cap). At 45s a
// single cold scan amortizes across the operator's whole detail-viewing session.
// SAFETY: only the two city-wide, auth-invariant HISTORICAL reads
// (molecule(all=true) history + city formula feed) are cached — cacheableCityWideRead
// pins their exact param sets — while the active/live lanes are SSE-driven and
// UNCACHED, so a longer TTL only lets an already-closed run root lag up to the
// TTL before it surfaces in History (acceptable). The longer TTL changes only
// HOW LONG the same set is cached, never WHAT is cached.
export const CITY_WIDE_READ_TTL_MS = 45_000;

export function cacheableCityWideRead(target: URL): boolean {
  if (!CACHEABLE_CITY_WIDE_READS.some((p) => p.test(target.pathname))) return false;
  const q = target.searchParams;
  if (target.pathname.endsWith('/formulas/feed')) {
    // The city feed sends EXACTLY scope_kind=city + scope_ref=<city>. scope_ref
    // is the (dynamic) city name, so only its presence + the fixed scope_kind
    // are matched; any extra param disqualifies the read.
    return [...q.keys()].length === 2 && q.get('scope_kind') === 'city' && q.has('scope_ref');
  }
  // beads: ONLY the wide molecule history scan with its exact param set — a read
  // carrying any extra param (rig/status/label/assignee/cursor) is a different,
  // narrower query and must go straight upstream, never served a city-wide body.
  return paramsMatchExactly(q, MOLECULE_HISTORY_PARAMS);
}

// searchParams.toString() PRESERVES insertion order (it does not sort), so two
// requests with the same params in a different order would key differently. In
// practice that never happens: each cacheable read is built from a fixed object
// literal (runSummary.ts), so its param order is stable — a hypothetical reorder
// is only a cache miss (a redundant upstream read), never a correctness or
// security issue, because cacheableCityWideRead already pins the exact param set
// and a different scope_ref / type / all value is a distinct key.
function cacheKey(target: URL): string {
  return `${target.pathname}?${target.searchParams.toString()}`;
}

// A non-2xx upstream must surface to the caller but NOT be pinned in the cache.
// The cache loader throws this so getOrFetch deletes the inflight entry; the
// proxy catch re-materializes the response from it.
class UpstreamNon2xx extends Error {
  constructor(private readonly cached: CachedResponse) {
    super(`upstream responded ${cached.status}`);
    this.name = 'UpstreamNon2xx';
  }
  toCached(): CachedResponse {
    return this.cached;
  }
}

// Headers that must never be captured into a CACHED response: a cached body is
// replayed to every coalesced + every within-TTL caller, so a per-response
// set-cookie from upstream would be broadcast to callers it was never issued
// for. The cacheable reads are city-wide, auth-invariant GETs that should carry
// no set-cookie at all — strip it defensively so a stray one can't be replayed.
const STRIPPED_CACHED_RESPONSE_HEADERS = new Set([...HOP_BY_HOP_HEADERS, 'set-cookie']);

function headerPairs(upstream: Response): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  upstream.headers.forEach((value, name) => {
    if (!STRIPPED_CACHED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      pairs.push([name, value]);
    }
  });
  return pairs;
}

function writeCachedResponse(cached: CachedResponse, res: ExpressResponse): void {
  res.status(cached.status);
  for (const [name, value] of cached.headers) {
    res.setHeader(name, value);
  }
  res.end(cached.body);
}

export function supervisorTransportProxy(supervisorBaseUrl: string, readOnly = false): Router {
  const router = Router();
  const baseUrl = new URL(supervisorBaseUrl);
  const cityWideReadCache = createTtlSingleFlightCache({ ttlMs: CITY_WIDE_READ_TTL_MS });

  router.use(async (req, res) => {
    if (readOnly && req.method !== 'GET' && req.method !== 'HEAD') {
      // RFC 9110 §15.5.6: a 405 MUST carry an Allow header advertising the
      // methods the resource does support.
      res.setHeader('Allow', 'GET, HEAD');
      res.status(HTTP_STATUS.methodNotAllowed).type('text/plain').send('read-only');
      logRejection(req, 'method not allowed');
      return;
    }

    // Resolve the upstream target *first*, then gate on the resolved path. This
    // is the normalize-and-compare invariant: the allowlist check and the
    // forwarded request operate on the SAME string (`target.pathname`), so an
    // encoded `..` (e.g. `%2e%2e`) cannot pass the gate as a `[^/]+` city
    // segment yet resolve upstream to a different, global path — `new URL`
    // decodes and collapses it before either the check or the forward sees it.
    const target = resolveUpstreamTarget(req.url, baseUrl);
    if (target === null || !isAllowedPath(target.pathname, readOnly)) {
      res.status(HTTP_STATUS.notFound).type('text/plain').send('not found');
      logRejection(req, 'not allowed');
      return;
    }

    try {
      if (req.method === 'GET' && cacheableCityWideRead(target)) {
        const cached = await cityWideReadCache.getOrFetch(cacheKey(target), async () => {
          const upstream = await fetch(target, requestInit(req, readOnly));
          const body = Buffer.from(await upstream.arrayBuffer());
          const response: CachedResponse = {
            status: upstream.status,
            headers: headerPairs(upstream),
            body,
          };
          if (upstream.status < 200 || upstream.status >= 300) {
            // Surface non-2xx to the caller but don't pin it: throw so the
            // single-flight cache drops the entry, then re-materialize below.
            throw new UpstreamNon2xx(response);
          }
          return response;
        });
        writeCachedResponse(cached, res);
        return;
      }

      const upstream = await fetch(target, requestInit(req, readOnly));
      await writeUpstreamResponse(upstream, res);
    } catch (err) {
      if (err instanceof UpstreamNon2xx) {
        writeCachedResponse(err.toCached(), res);
        return;
      }
      logWarn(LOG_COMPONENT.admin, `gc supervisor transport proxy failed: ${errorMessage(err)}`);
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

// Build the upstream URL the request will be forwarded to, failing closed
// (`null`) on anything we will not proxy. `new URL` resolves `..`/encoded-dot
// segments and decodes percent-escapes, so this is the canonical normalized
// form to gate on. A malformed target throws, and an authority in `reqUrl`
// (e.g. `//evil.example/v0/x`) retargets the proxy at a foreign host — both are
// rejected so the proxy can only ever reach the configured supervisor origin.
function resolveUpstreamTarget(reqUrl: string, baseUrl: URL): URL | null {
  let target: URL;
  try {
    target = new URL(reqUrl, baseUrl);
  } catch {
    return null;
  }
  if (target.origin !== baseUrl.origin) return null;
  return target;
}

function isAllowedPath(path: string, readOnly: boolean): boolean {
  if (readOnly) return isAllowedReadPath(path);
  return path === '/health' || path.startsWith('/v0/');
}

function logRejection(req: Request, reason: string): void {
  // Surfaces method/path probes (traversal attempts, write attempts) so an
  // externally-fronted instance leaves an audit trail of what it refused.
  logWarn(LOG_COMPONENT.admin, `gc supervisor proxy rejected ${req.method} ${req.path}: ${reason}`);
}

function requestInit(req: Request, readOnly: boolean): RequestInit & { duplex?: 'half' } {
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers: requestHeaders(req, readOnly),
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req as unknown as BodyInit;
    init.duplex = 'half';
  }
  return init;
}

function requestHeaders(req: Request, readOnly: boolean): Headers {
  const stripped = readOnly ? READONLY_STRIPPED_REQUEST_HEADERS : STRIPPED_REQUEST_HEADERS;
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (stripped.has(lower)) continue;
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
  await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>), res);
}
