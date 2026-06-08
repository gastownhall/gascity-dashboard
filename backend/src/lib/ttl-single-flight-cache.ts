// Short-TTL + single-flight cache for a tiny, fixed key space (gascity-dashboard).
//
// The supervisor transport proxy fans every request straight upstream and
// streams the body, so N concurrent identical city-wide reads (the
// molecule(all=true) history scan and the city formula feed) become N upstream
// calls — each a multi-second full-store scan that saturates the browser
// connection pool. This collapses concurrent identical reads into ONE upstream
// call (single-flight) and serves a short-TTL ready value for the closely-spaced
// re-fires that arrive just after the first resolves.
//
// Failures and non-2xx upstreams are NEVER cached: the loader throws, the entry
// is deleted, and the rejection propagates to every coalesced caller — a
// transient upstream failure must not be pinned and served for the TTL. The next
// request retries upstream.

export interface CachedResponse {
  status: number;
  headers: ReadonlyArray<readonly [string, string]>;
  body: Buffer;
}

type Entry =
  | { state: 'inflight'; promise: Promise<CachedResponse> }
  | { state: 'ready'; value: CachedResponse; expiresAt: number };

export interface TtlSingleFlightCacheOptions {
  ttlMs: number;
  now?: () => number;
}

export interface TtlSingleFlightCache {
  getOrFetch(key: string, loader: () => Promise<CachedResponse>): Promise<CachedResponse>;
}

export function createTtlSingleFlightCache(
  options: TtlSingleFlightCacheOptions,
): TtlSingleFlightCache {
  const { ttlMs } = options;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  // Lazy expiry sweep: a ready entry is only refreshed when ITS key is touched,
  // so distinct expired variants (different param sets / cities) would otherwise
  // accumulate forever. On each getOrFetch, drop every ready entry whose TTL has
  // passed. Inflight entries are left alone — they self-resolve or self-delete.
  function sweepExpired(): void {
    const t = now();
    for (const [key, entry] of entries) {
      if (entry.state === 'ready' && t >= entry.expiresAt) {
        entries.delete(key);
      }
    }
  }

  return {
    async getOrFetch(key, loader) {
      sweepExpired();
      const existing = entries.get(key);
      if (existing !== undefined) {
        if (existing.state === 'ready' && now() < existing.expiresAt) {
          return existing.value;
        }
        if (existing.state === 'inflight') {
          return existing.promise;
        }
      }

      const promise = (async () => {
        const value = await loader();
        entries.set(key, { state: 'ready', value, expiresAt: now() + ttlMs });
        return value;
      })();
      entries.set(key, { state: 'inflight', promise });

      try {
        return await promise;
      } catch (err) {
        // Never cache a failure: drop the inflight entry so the next caller
        // retries upstream instead of being served the rejection for the TTL.
        if (entries.get(key)?.state === 'inflight') {
          entries.delete(key);
        }
        throw err;
      }
    },
  };
}
