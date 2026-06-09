import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

import {
  CITY_WIDE_READ_TTL_MS,
  cacheableCityWideRead,
  supervisorTransportProxy,
} from './supervisor-transport-proxy.js';

describe('cacheableCityWideRead — only the two expensive city-wide reads match', () => {
  const base = 'http://127.0.0.1:9999';
  const matches = (path: string) => cacheableCityWideRead(new URL(base + path));

  test('matches the city formula feed (scope_kind=city)', () => {
    assert.equal(
      matches('/v0/city/ds-research/formulas/feed?scope_kind=city&scope_ref=ds-research'),
      true,
    );
  });

  test('matches the molecule history scan (type=molecule&all=true)', () => {
    assert.equal(matches('/v0/city/ds-research/beads?type=molecule&all=true&limit=500'), true);
  });

  test('does NOT match a scoped (non-city) feed', () => {
    assert.equal(
      matches('/v0/city/ds-research/formulas/feed?scope_kind=rig&scope_ref=demo'),
      false,
    );
  });

  test('does NOT match the core active-bead list (no all=true)', () => {
    assert.equal(matches('/v0/city/ds-research/beads?limit=500'), false);
  });

  test('does NOT match a per-rig task read', () => {
    assert.equal(matches('/v0/city/ds-research/beads?type=task&rig=demo&all=true'), false);
  });

  test('does NOT match a molecule read carrying an EXTRA param (overmatch guard)', () => {
    // The exact-param-set match rejects a molecule(all=true) read with any extra
    // param (here &rig=foo): it is a narrower query, not the city-wide scan, and
    // must never be served the cached city-wide body.
    assert.equal(
      matches('/v0/city/ds-research/beads?type=molecule&all=true&limit=500&rig=foo'),
      false,
    );
  });

  test('does NOT match a molecule read missing the expected limit', () => {
    assert.equal(matches('/v0/city/ds-research/beads?type=molecule&all=true'), false);
  });

  test('does NOT match a feed carrying an EXTRA param', () => {
    assert.equal(
      matches('/v0/city/ds-research/formulas/feed?scope_kind=city&scope_ref=ds-research&rig=foo'),
      false,
    );
  });

  test('does NOT match an unrelated path', () => {
    assert.equal(matches('/v0/city/ds-research/sessions'), false);
  });
});

describe('CITY_WIDE_READ_TTL_MS — the i60u cold-load stopgap band', () => {
  test('sits in the 30-60s stopgap band, well above the 7-11s cold scan', () => {
    // gascity-dashboard-i60u: the TTL must outlast a cold molecule+feed scan
    // (7-11s) so a fresh detail load can actually serve a warm hit, and stay
    // capped so an already-closed run root never lags more than ~a minute before
    // it surfaces in History. A drift back toward the retired "do not exceed 5s"
    // cap would silently reinstate the contention this stopgap fixes.
    assert.ok(
      CITY_WIDE_READ_TTL_MS >= 30_000 && CITY_WIDE_READ_TTL_MS <= 60_000,
      `expected the city-wide read TTL in the 30-60s band, got ${CITY_WIDE_READ_TTL_MS}ms`,
    );
  });
});

describe('supervisorTransportProxy — single-flight coalescing for the cacheable read', () => {
  let upstream: Server;
  let upstreamUrl: string;
  let proxy: Server;
  let proxyUrl: string;
  let upstreamCalls = 0;

  before(async () => {
    const upstreamApp = express();
    upstreamApp.get('/v0/city/:city/beads', (_req, res) => {
      upstreamCalls += 1;
      // Slow enough that two near-simultaneous proxy requests overlap.
      setTimeout(() => {
        // A stray upstream set-cookie must NOT be captured into the cached body
        // (it would be replayed to every coalesced/within-TTL caller).
        res
          .status(200)
          .type('application/json')
          .setHeader('set-cookie', 'gc_session=secret; Path=/')
          .send(JSON.stringify({ items: [], call: upstreamCalls }));
      }, 50);
    });
    upstream = upstreamApp.listen(0);
    await new Promise((r) => upstream.once('listening', r));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    const proxyApp = express();
    proxyApp.use('/gc-supervisor', supervisorTransportProxy(upstreamUrl, true));
    proxy = proxyApp.listen(0);
    await new Promise((r) => proxy.once('listening', r));
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => upstream.close(r));
  });

  test('two concurrent identical molecule reads hit upstream once', async () => {
    upstreamCalls = 0;
    const path = '/gc-supervisor/v0/city/ds-research/beads?type=molecule&all=true&limit=500';
    const [a, b] = await Promise.all([
      fetch(proxyUrl + path).then((r) => r.json()),
      fetch(proxyUrl + path).then((r) => r.json()),
    ]);
    assert.equal(upstreamCalls, 1, 'single-flight collapses the duplicate into one upstream call');
    assert.deepEqual(a, b);
  });

  test('strips upstream set-cookie from the cached response', async () => {
    upstreamCalls = 0;
    const path = '/gc-supervisor/v0/city/ds-research/beads?type=molecule&all=true&limit=500';
    const res = await fetch(proxyUrl + path);
    await res.text();
    assert.equal(
      res.headers.get('set-cookie'),
      null,
      'cached response must not replay a set-cookie',
    );
  });

  test('serves a SEQUENTIAL within-TTL re-read from cache without re-hitting upstream', async () => {
    // gascity-dashboard-i60u: the long TTL (45s) must let a SECOND, fully
    // sequential read — fired after the first has already resolved, i.e. NOT
    // coalesced by single-flight — be served from cache. Under the retired 3s
    // cap a fresh detail load almost always missed; this asserts the warm-hit
    // window the stopgap depends on.
    upstreamCalls = 0;
    // A city key the other tests in this block never touch: the proxy (and its
    // cache) is created once in before(), and the 45s TTL outlives the whole
    // suite, so reusing a warmed key would read 0 upstream calls and prove
    // nothing. A fresh key gives a true cold-then-warm sequence.
    const path = '/gc-supervisor/v0/city/ttl-probe-city/beads?type=molecule&all=true&limit=500';
    const first = await fetch(proxyUrl + path).then((r) => r.json());
    const second = await fetch(proxyUrl + path).then((r) => r.json());
    assert.equal(upstreamCalls, 1, 'the within-TTL re-read is served from cache, not upstream');
    assert.deepEqual(first, second);
  });
});
