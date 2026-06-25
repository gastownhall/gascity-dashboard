import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';

import {
  hostHeaderAllowlistFactory,
  originCheck,
  securityHeaders,
} from '../src/middleware/security.js';
import { withApp, rawRequest } from './helpers/express-harness.js';

// Focused unit coverage for the DNS-rebinding / clickjacking / content-type
// defenses (invariants #2/#3 — the 127.0.0.1-only posture). app.ts wires these
// for real but never asserts their reject branches; this is the guard that a
// future edit cannot silently widen the allowlist or drop the CSP.

/** Terminal 200 handler so a middleware that calls next() is observable. */
function ok(app: Express): void {
  app.use((_req, res) => {
    res.status(200).json({ ok: true });
  });
}

// The configured port is only used to BUILD the allowed-origin strings; it is
// independent of the ephemeral port the test server actually binds.
const ORIGIN_PORT = 8081;

describe('hostHeaderAllowlistFactory — Host allowlist (DNS-rebinding defense)', () => {
  test('allows the always-on localhost floor', async () => {
    await withApp(
      (app) => {
        app.use(hostHeaderAllowlistFactory());
        ok(app);
      },
      async ({ url }) => {
        for (const host of ['127.0.0.1', 'localhost', '127.0.0.1:8081', 'LOCALHOST']) {
          const res = await rawRequest(url, { headers: { Host: host } });
          assert.equal(res.status, 200, `expected allow for Host: ${host}`);
        }
      },
    );
  });

  test('rejects a foreign Host with 421 Misdirected Request', async () => {
    await withApp(
      (app) => {
        app.use(hostHeaderAllowlistFactory());
        ok(app);
      },
      async ({ url }) => {
        const res = await rawRequest(url, { headers: { Host: 'evil.example.com' } });
        assert.equal(res.status, 421);
        assert.equal(res.body, 'Host not allowed');
      },
    );
  });

  test('rejects a request with no Host header at all with 421 (no next)', () => {
    // HTTP/1.1 clients always send a Host, so this `host === null` branch is
    // only reachable by invoking the middleware directly. It is the floor of
    // the defense: a header-less request must never fall through to next().
    const mw = hostHeaderAllowlistFactory();
    let nexted = false;
    let sentStatus = 0;
    let sentBody: unknown;
    const res = {
      status(code: number) {
        sentStatus = code;
        return res;
      },
      type() {
        return res;
      },
      send(body: unknown) {
        sentBody = body;
        return res;
      },
    };
    mw({ headers: {} } as never, res as never, () => {
      nexted = true;
    });
    assert.equal(nexted, false, 'a host-less request must not pass through');
    assert.equal(sentStatus, 421);
    assert.equal(sentBody, 'Host not allowed');
  });

  test('ADMIN_EXTRA_ALLOWED_HOSTS widens the floor, case-insensitively, and nothing else', async () => {
    await withApp(
      (app) => {
        app.use(hostHeaderAllowlistFactory(['my-vm', '192.168.1.58']));
        ok(app);
      },
      async ({ url }) => {
        // The explicitly-added LAN names pass...
        for (const host of ['my-vm', 'MY-VM', '192.168.1.58', 'my-vm:5174']) {
          const res = await rawRequest(url, { headers: { Host: host } });
          assert.equal(res.status, 200, `expected allow for widened Host: ${host}`);
        }
        // ...but an un-listed host still fails closed.
        const denied = await rawRequest(url, { headers: { Host: 'other-vm' } });
        assert.equal(denied.status, 421);
      },
    );
  });
});

describe('originCheck — Origin guard on state-changing methods', () => {
  function mount(app: Express, extra: ReadonlyArray<string> = []): void {
    app.use(originCheck(ORIGIN_PORT, extra));
    ok(app);
  }

  test('exempts safe methods regardless of Origin', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        for (const method of ['GET', 'HEAD', 'OPTIONS']) {
          const res = await rawRequest(url, {
            method,
            headers: { Origin: 'http://evil.example.com' },
          });
          // HEAD has no body but still reports the status; all must pass.
          assert.equal(res.status, 200, `expected ${method} to be exempt`);
        }
      },
    );
  });

  test('allows a same-origin write (127.0.0.1 and localhost forms)', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        for (const origin of [
          `http://127.0.0.1:${ORIGIN_PORT}`,
          `http://localhost:${ORIGIN_PORT}`,
        ]) {
          const res = await rawRequest(url, { method: 'POST', headers: { Origin: origin } });
          assert.equal(res.status, 200, `expected allow for Origin: ${origin}`);
        }
      },
    );
  });

  test('rejects a foreign Origin on a write with 403 + kind "origin"', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        const res = await rawRequest(url, {
          method: 'POST',
          headers: { Origin: 'http://evil.example.com' },
        });
        assert.equal(res.status, 403);
        assert.deepEqual(JSON.parse(res.body), { error: 'Origin not allowed', kind: 'origin' });
      },
    );
  });

  test('rejects a write with NO Origin header (non-browser / forged) with 403', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        const res = await rawRequest(url, { method: 'POST' });
        assert.equal(res.status, 403);
        assert.deepEqual(JSON.parse(res.body), { error: 'Origin not allowed', kind: 'origin' });
      },
    );
  });

  test('rejects a write whose Origin matches an allowed host but the WRONG port', async () => {
    await withApp(
      (app) => mount(app),
      async ({ url }) => {
        const res = await rawRequest(url, {
          method: 'POST',
          headers: { Origin: `http://127.0.0.1:${ORIGIN_PORT + 1}` },
        });
        assert.equal(res.status, 403);
      },
    );
  });

  test('extra allowed hosts widen the Origin allowlist on the configured port', async () => {
    await withApp(
      (app) => mount(app, ['my-vm']),
      async ({ url }) => {
        const allowed = await rawRequest(url, {
          method: 'POST',
          headers: { Origin: `http://my-vm:${ORIGIN_PORT}` },
        });
        assert.equal(allowed.status, 200);
        // Same host on a different port is still rejected.
        const wrongPort = await rawRequest(url, {
          method: 'POST',
          headers: { Origin: `http://my-vm:${ORIGIN_PORT + 1}` },
        });
        assert.equal(wrongPort.status, 403);
      },
    );
  });
});

describe('securityHeaders — CSP + clickjacking + sniff lockdown', () => {
  test('sets the fixed defense headers and a locked-down CSP', async () => {
    await withApp(
      (app) => {
        app.use(securityHeaders());
        ok(app);
      },
      async ({ url }) => {
        const res = await rawRequest(url);
        assert.equal(res.headers['x-frame-options'], 'DENY');
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        assert.equal(res.headers['referrer-policy'], 'no-referrer');
        const csp = res.headers['content-security-policy'];
        assert.equal(typeof csp, 'string');
        const directives = (csp as string).split('; ');
        // The invariants the CSP exists to hold: no foreign script/connect, no
        // framing, no base-tag hijack, same-origin forms only.
        assert.ok(directives.includes("default-src 'self'"));
        assert.ok(directives.includes("object-src 'none'"));
        assert.ok(directives.includes("frame-ancestors 'none'"));
        assert.ok(directives.includes("base-uri 'none'"));
        assert.ok(directives.includes("form-action 'self'"));
        assert.ok(directives.includes("connect-src 'self'"));
        // style-src/img-src are part of the lockdown too: inline styles are
        // allowed (Tailwind/theme), images only same-origin + data: URIs. Pin
        // them so a directive drop is caught, not silently widened.
        assert.ok(directives.includes("style-src 'self' 'unsafe-inline'"));
        assert.ok(directives.includes("img-src 'self' data:"));
        // The theme-boot inline script is pinned by EXACT hash, not 'unsafe-inline'.
        // Matching the full directive (not just the 'sha256-' prefix) catches both
        // a hash drift and a widening — an added 'unsafe-inline' or extra source
        // changes the string, so it would no longer be an exact element here.
        assert.ok(
          directives.includes(
            "script-src 'self' 'sha256-UwUdbc/TSVCB3Er6sM8M1BP5Fk3RrQVkswCUvEjf08g='",
          ),
        );
      },
    );
  });

  test('extra connect-src values are appended to self, never replacing it', async () => {
    await withApp(
      (app) => {
        app.use(securityHeaders(['https://supervisor.example:9000']));
        ok(app);
      },
      async ({ url }) => {
        const res = await rawRequest(url);
        const csp = res.headers['content-security-policy'] as string;
        const directives = csp.split('; ');
        assert.ok(directives.includes("connect-src 'self' https://supervisor.example:9000"));
      },
    );
  });
});
