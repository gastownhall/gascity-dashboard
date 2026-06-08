import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createTtlSingleFlightCache, type CachedResponse } from './ttl-single-flight-cache.js';

function response(status = 200, bodyText = 'ok'): CachedResponse {
  return { status, headers: [['content-type', 'application/json']], body: Buffer.from(bodyText) };
}

describe('createTtlSingleFlightCache', () => {
  test('coalesces concurrent identical reads into a single loader call', async () => {
    const cache = createTtlSingleFlightCache({ ttlMs: 1_000, now: () => 0 });
    let calls = 0;
    let resolveLoader: (value: CachedResponse) => void = () => {};
    const loader = () =>
      new Promise<CachedResponse>((resolve) => {
        calls += 1;
        resolveLoader = resolve;
      });

    const a = cache.getOrFetch('k', loader);
    const b = cache.getOrFetch('k', loader);
    resolveLoader(response());

    assert.deepEqual(await a, await b);
    assert.equal(calls, 1, 'N concurrent getOrFetch share one upstream call');
  });

  test('serves the ready value within the TTL, then refetches after expiry', async () => {
    let nowMs = 0;
    const cache = createTtlSingleFlightCache({ ttlMs: 1_000, now: () => nowMs });
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return response(200, `body-${calls}`);
    };

    const first = await cache.getOrFetch('k', loader);
    assert.equal(calls, 1);

    nowMs = 999; // still within TTL
    const cached = await cache.getOrFetch('k', loader);
    assert.equal(calls, 1, 'a ready entry inside the TTL is a cache hit');
    assert.deepEqual(cached, first);

    nowMs = 1_001; // past TTL
    const refetched = await cache.getOrFetch('k', loader);
    assert.equal(calls, 2, 'expiry triggers a refetch');
    assert.equal(refetched.body.toString(), 'body-2');
  });

  test('does not cache a rejected loader — next call retries', async () => {
    const cache = createTtlSingleFlightCache({ ttlMs: 1_000, now: () => 0 });
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error('upstream boom');
      return response();
    };

    await assert.rejects(cache.getOrFetch('k', loader), /upstream boom/);
    const second = await cache.getOrFetch('k', loader);
    assert.equal(calls, 2, 'a failed load is dropped, not pinned for the TTL');
    assert.equal(second.status, 200);
  });

  test('lazily evicts expired entries for keys that are never touched again', async () => {
    // A ready entry is only refreshed when ITS key is touched. Without a sweep,
    // distinct expired variants accumulate forever. Touching ANY key after
    // expiry must drop the stale ones — proven by a fresh loader call for the
    // expired key (no stale hit) once it is re-requested.
    let nowMs = 0;
    const cache = createTtlSingleFlightCache({ ttlMs: 1_000, now: () => nowMs });
    const calls = new Map<string, number>();
    const loader = (key: string) => async () => {
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return response(200, `${key}-${calls.get(key)}`);
    };

    await cache.getOrFetch('variant-a', loader('variant-a'));
    await cache.getOrFetch('variant-b', loader('variant-b'));

    // Both entries expire, and a DIFFERENT key is touched — the sweep runs.
    nowMs = 2_000;
    await cache.getOrFetch('variant-c', loader('variant-c'));

    // The expired entries were evicted, so re-requesting variant-a refetches
    // rather than serving the swept-away stale value.
    const reloaded = await cache.getOrFetch('variant-a', loader('variant-a'));
    assert.equal(calls.get('variant-a'), 2, 'an evicted expired entry refetches on next request');
    assert.equal(reloaded.body.toString(), 'variant-a-2');
  });

  test('both concurrent callers receive the rejection when the loader fails (neither hangs)', async () => {
    const cache = createTtlSingleFlightCache({ ttlMs: 1_000, now: () => 0 });
    let resolveReject: (err: Error) => void = () => {};
    const loader = () =>
      new Promise<CachedResponse>((_resolve, reject) => {
        resolveReject = reject;
      });

    const a = cache.getOrFetch('k', loader);
    const b = cache.getOrFetch('k', loader);
    resolveReject(new Error('shared boom'));

    await assert.rejects(a, /shared boom/);
    await assert.rejects(b, /shared boom/);
  });

  test('a thrown non-2xx (loader-side) is not cached', async () => {
    const cache = createTtlSingleFlightCache({ ttlMs: 1_000, now: () => 0 });
    let calls = 0;
    const loader = async () => {
      calls += 1;
      throw new Error(`non-2xx-${calls}`);
    };

    await assert.rejects(cache.getOrFetch('k', loader), /non-2xx-1/);
    await assert.rejects(cache.getOrFetch('k', loader), /non-2xx-2/);
    assert.equal(calls, 2, 'each request retries upstream; the error is never served from cache');
  });
});
