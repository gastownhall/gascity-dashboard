import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';

import { csrfIssueCookie, csrfValidate, getCsrfToken } from '../src/middleware/csrf.js';
import { withApp, rawRequest } from './helpers/express-harness.js';

// Focused unit coverage for the double-submit CSRF belt (the third defense
// behind the Host allowlist + Origin check). app.ts mounts csrfValidate on the
// write router but never asserts its reject branches; this guards that a future
// edit cannot weaken the timing-safe compare or drop the missing/mismatch
// rejections.

const TOKEN_HEADER = 'x-csrf-token';

/** Terminal 200 handler so a request that passes validation is observable. */
function ok(app: Express): void {
  app.use((_req, res) => {
    res.status(200).json({ ok: true });
  });
}

describe('csrfValidate — double-submit token check on writes', () => {
  function mount(app: Express): void {
    app.use(csrfValidate);
    ok(app);
  }

  test('exempts safe methods without requiring a token', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        for (const method of ['GET', 'HEAD', 'OPTIONS']) {
          const res = await rawRequest(url, { method });
          assert.equal(res.status, 200, `expected ${method} to be exempt`);
        }
      },
    );
  });

  test('accepts a write whose header token matches the boot token', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        const res = await rawRequest(url, {
          method: 'POST',
          headers: { [TOKEN_HEADER]: getCsrfToken() },
        });
        assert.equal(res.status, 200);
      },
    );
  });

  test('rejects a write with no CSRF header (403, kind "csrf")', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        const res = await rawRequest(url, { method: 'POST' });
        assert.equal(res.status, 403);
        assert.deepEqual(JSON.parse(res.body), { error: 'Missing CSRF token', kind: 'csrf' });
      },
    );
  });

  test('rejects a write with an empty CSRF header as missing, not mismatched', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        const res = await rawRequest(url, {
          method: 'POST',
          headers: { [TOKEN_HEADER]: '' },
        });
        assert.equal(res.status, 403);
        assert.deepEqual(JSON.parse(res.body), { error: 'Missing CSRF token', kind: 'csrf' });
      },
    );
  });

  test('rejects a same-length but different token via the timing-safe compare', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        const expected = getCsrfToken();
        // Same length so the fast length short-circuit cannot fire — this drives
        // the crypto.timingSafeEqual mismatch branch specifically.
        const forged = expected.slice(0, -1) + (expected.endsWith('A') ? 'B' : 'A');
        assert.equal(forged.length, expected.length);
        assert.notEqual(forged, expected);
        const res = await rawRequest(url, {
          method: 'POST',
          headers: { [TOKEN_HEADER]: forged },
        });
        assert.equal(res.status, 403);
        assert.deepEqual(JSON.parse(res.body), { error: 'Invalid CSRF token', kind: 'csrf' });
      },
    );
  });

  test('rejects a wrong-length token without throwing (length short-circuit)', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        // A token of a different byte length must be rejected as invalid, not
        // crash crypto.timingSafeEqual (which requires equal-length buffers).
        const res = await rawRequest(url, {
          method: 'POST',
          headers: { [TOKEN_HEADER]: 'too-short' },
        });
        assert.equal(res.status, 403);
        assert.deepEqual(JSON.parse(res.body), { error: 'Invalid CSRF token', kind: 'csrf' });
      },
    );
  });
});

describe('csrfIssueCookie — hands the token to the browser on reads', () => {
  test('sets a JS-readable, SameSite=Strict cookie carrying the boot token on GET', async () => {
    await withApp(
      (app) => {
        app.use(csrfIssueCookie);
        ok(app);
      },
      async ({ url }) => {
        const res = await rawRequest(url);
        const cookie = res.headers['set-cookie'];
        assert.ok(Array.isArray(cookie) && cookie.length === 1, 'one Set-Cookie header');
        const value = cookie[0];
        if (value === undefined) throw new Error('Set-Cookie header had no value');
        assert.ok(value.startsWith(`gascity_admin_csrf=${getCsrfToken()}`));
        assert.ok(value.includes('Path=/'));
        assert.ok(value.includes('SameSite=Strict'));
        assert.ok(value.includes('Max-Age=86400'));
        // Double-submit requires the cookie be JS-readable, so it is NOT HttpOnly.
        assert.ok(!/HttpOnly/i.test(value));
      },
    );
  });

  test('also issues the cookie on HEAD (csrf.ts treats HEAD like GET)', async () => {
    await withApp(
      (app) => {
        app.use(csrfIssueCookie);
        ok(app);
      },
      async ({ url }) => {
        // HEAD shares the read path in csrfIssueCookie, so a SPA that probes
        // with HEAD before its first GET must still receive the token. A HEAD
        // response carries no body but the Set-Cookie header is still present.
        const res = await rawRequest(url, { method: 'HEAD' });
        const cookie = res.headers['set-cookie'];
        assert.ok(Array.isArray(cookie) && cookie.length === 1, 'one Set-Cookie header on HEAD');
        const value = cookie[0];
        if (value === undefined) throw new Error('Set-Cookie header had no value');
        assert.ok(value.startsWith(`gascity_admin_csrf=${getCsrfToken()}`));
        assert.ok(value.includes('SameSite=Strict'));
        assert.ok(!/HttpOnly/i.test(value));
      },
    );
  });

  test('does NOT issue the cookie on a write method', async () => {
    await withApp(
      (app) => {
        app.use(csrfIssueCookie);
        ok(app);
      },
      async ({ url }) => {
        const res = await rawRequest(url, { method: 'POST' });
        assert.equal(res.headers['set-cookie'], undefined);
      },
    );
  });
});

describe('getCsrfToken — stable per-process boot token', () => {
  test('returns the same token across calls', () => {
    assert.equal(getCsrfToken(), getCsrfToken());
    assert.ok(getCsrfToken().length > 0);
  });
});
