import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { ExecError } from '../src/exec.js';
import { gitRouter } from '../src/routes/git.js';
import type { GitRouterOptions } from '../src/routes/git.js';
import { setAuditLogPath } from '../src/audit.js';
import { assertWireDetails } from './helpers/wire.js';

// Regression coverage for GET /api/git/commits catch-arm err.message
// redaction (gascity-dashboard-big).
//
// The wave-473 redaction work landed toWireExecError / toWireInternal500
// in git.ts but left both catch arms untested because gitRouter() had no
// DI harness. A future regression (reverting a catch arm to raw
// err.message, or dropping the kind==='spawn' branch) would silently
// re-leak the operator's binary layout / OS detail to the browser.
//
// Mirrors the DI harness shape used in maintainer-sling.test.ts /
// agents-prime.test.ts: the route accepts execGitLog via DI so tests can
// stub a throwing runner without module mocking.

// Derived from the route's exported option type so a signature drift in
// gitRouter's injected runner becomes a compile error here (the whole
// point of this regression harness).
type GitLogStub = NonNullable<GitRouterOptions['execGitLog']>;

interface AppHandle {
  url: string;
  close: () => Promise<void>;
  auditPath: string;
}

interface BuildOpts {
  execGitLog?: GitLogStub;
}

async function buildApp(opts: BuildOpts = {}): Promise<AppHandle> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-commits-test-'));
  const auditPath = path.join(tmpDir, 'events.jsonl');
  setAuditLogPath(auditPath);

  const app = express();
  const routerOptions = opts.execGitLog === undefined ? {} : { execGitLog: opts.execGitLog };
  app.use('/api/git', gitRouter(routerOptions));

  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        auditPath,
        close: () =>
          new Promise<void>((r) =>
            srv.close(async () => {
              await fs.rm(tmpDir, { recursive: true, force: true });
              r();
            }),
          ),
      });
    });
  });
}

async function getJson(
  url: string,
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const res = await fetch(url);
  const text = await res.text();
  const data = JSON.parse(text) as Record<string, unknown>;
  return { status: res.status, body: data, text };
}

describe('GET /api/git/commits — catch-arm err.message redaction', { concurrency: false }, () => {
  let h: AppHandle | undefined;

  afterEach(async () => {
    if (h) {
      await h.close();
      h = undefined;
    }
  });

  test('ExecError spawn arm redacts host path and returns fixed message', async () => {
    // The 'spawn' kind wraps node's "spawn <abs-path-to-git> ENOENT",
    // exposing the operator's binary layout. The redaction contract:
    // wire body carries the fixed 'subprocess could not be started'
    // string, never the raw spawn message.
    h = await buildApp({
      execGitLog: async () => {
        throw new ExecError(
          'spawn failed: spawn /home/ds/.local/bin/git ENOENT',
          'spawn',
        );
      },
    });
    const res = await getJson(`${h.url}/api/git/commits?view=recent-main`);
    // ExecError non-timeout kind maps to 500 in /commits' status table.
    assert.equal(res.status, 500);
    assert.equal(res.body.kind, 'spawn');
    assert.equal(
      res.body.error,
      'subprocess could not be started',
      'spawn arm must return the fixed redacted message',
    );
    assert.ok(!res.text.includes('/home/ds'), `response leaks operator home: ${res.text}`);
    assert.ok(!res.text.includes('.local/bin'), `response leaks binary path: ${res.text}`);
    assert.ok(!res.text.includes('ENOENT'), `response leaks OS errno: ${res.text}`);
  });

  test('ExecError timeout arm surfaces 504 with safe pre-authored message', async () => {
    // timeout carries a pre-authored safe string by ExecError
    // construction — it passes through unchanged but must map to 504.
    h = await buildApp({
      execGitLog: async () => {
        throw new ExecError('git log timed out', 'timeout');
      },
    });
    const res = await getJson(`${h.url}/api/git/commits?view=recent-main`);
    assert.equal(res.status, 504);
    assert.equal(res.body.kind, 'timeout');
  });

  test('non-ExecError 500 fallback redacts raw err.message', async () => {
    // An unexpected throw (e.g. a parse/IO error wrapping a network
    // failure) must not echo its raw message. details.name (Error class)
    // is the only safe channel; the OS detail stays in journalctl.
    const leakyErr = new Error(
      'connect ECONNREFUSED 127.0.0.1:1 (interface lo) at /var/run/sock',
    );
    leakyErr.name = 'NetworkError';
    h = await buildApp({
      execGitLog: async () => {
        throw leakyErr;
      },
    });
    const res = await getJson(`${h.url}/api/git/commits`);
    assert.equal(res.status, 500);
    assert.equal(res.body.kind, 'internal');
    assertWireDetails(res.body.details);
    assert.equal(res.body.details.message, undefined, 'details.message must be redacted');
    assert.equal(
      res.body.details.name,
      'NetworkError',
      'details.name must carry the Error class discriminator',
    );
    assert.ok(!res.text.includes('ECONNREFUSED'), `response leaks ECONNREFUSED: ${res.text}`);
    assert.ok(!res.text.includes('127.0.0.1'), `response leaks host:port: ${res.text}`);
    assert.ok(!res.text.includes('/var/run/sock'), `response leaks socket path: ${res.text}`);
  });
});
