import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import type { Express } from 'express';
import type { AdminConfig } from '../src/config.js';
import { createDashboardApp } from '../src/app.js';

function makeConfig(overrides: Partial<AdminConfig> = {}): AdminConfig {
  return {
    port: 8081,
    bindHost: '127.0.0.1',
    extraAllowedHosts: [],
    // Unroutable supervisor so city dispatch fails fast.
    gcSupervisorUrl: 'http://127.0.0.1:1',
    cityName: 'test-city',
    cityPath: '',
    runCwdAllowedRoots: [],
    auditLogPath: '.gc/events.jsonl',
    frontendDistPath: '../frontend/dist-does-not-exist',
    disabled: false,
    modules: {
      maintainer: {
        githubRepo: 'gastownhall/gascity',
        slingTarget: 'mayor',
        triageTarget: 'chief-of-staff',
        refreshIntervalMs: 0,
        cachePath: '.gascity-dashboard/maintainer-cache.json',
      },
    },
    useFixtures: false,
    enabledModules: null,
    defaultView: null,
    ...overrides,
  };
}

async function withApp<T>(app: Express, fn: (url: string) => Promise<T>): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withSupervisorRegistry<T>(
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const listening = http.createServer((req, res) => {
      if (req.url === '/v0/cities') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          items: [{ name: 'test-city', path: '/srv/gc/test-city', running: true }],
          total: 1,
        }));
        return;
      }
      if (req.url === '/v0/city/test-city/beads?limit=1000') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          items: [
            {
              id: 'td-bead-abc123',
              title: 'old mirror should not serve this',
              status: 'open',
              issue_type: 'task',
              created_at: '2026-06-01T00:00:00Z',
              priority: null,
            },
          ],
          total: 1,
        }));
        return;
      }
      if (req.url === '/v0/city/test-city/bead/td-bead-abc123') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'td-bead-abc123',
          title: 'old detail mirror should not serve this',
          status: 'open',
          issue_type: 'task',
          created_at: '2026-06-01T00:00:00Z',
          priority: null,
        }));
        return;
      }
      if (req.url === '/v0/city/test-city/mail?limit=1000') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          items: [
            {
              id: 'mail-1',
              from: 'mayor',
              to: 'human',
              subject: 'old mail mirror should not serve this',
              body: 'body',
              created_at: '2026-06-01T00:00:00Z',
              read: false,
              thread_id: 'thread-1',
            },
          ],
          total: 1,
        }));
        return;
      }
      if (req.url === '/v0/city/test-city/mail/thread/thread-1') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          items: [
            {
              id: 'mail-1',
              from: 'mayor',
              to: 'human',
              subject: 'old thread mirror should not serve this',
              body: 'body',
              created_at: '2026-06-01T00:00:00Z',
              read: false,
              thread_id: 'thread-1',
            },
          ],
          total: 1,
        }));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('createDashboardApp', () => {
  test('serves the top-level health endpoint independent of any city', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const health = await fetch(`${url}/api/health`);
        assert.equal(health.status, 200);
        const body = (await health.json()) as { ok: boolean; ts: string };
        assert.equal(body.ok, true);
        assert.equal(typeof body.ts, 'string');
      });
    } finally {
      await runtime.stop();
    }
  });

  test('serves dashboard-local system health independent of supervisor city dispatch', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const health = await fetch(`${url}/api/health/system`);
        assert.equal(health.status, 200);
        const body = (await health.json()) as {
          admin?: unknown;
          host?: unknown;
          supervisor?: unknown;
          diagnostics?: unknown;
        };
        assert.equal(typeof body.admin, 'object');
        assert.equal(typeof body.host, 'object');
        assert.equal(body.supervisor, undefined);
        assert.equal(body.diagnostics, undefined);
      });
    } finally {
      await runtime.stop();
    }
  });

  test('rejects a path-traversal :cityName at the dispatch boundary (400)', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const res = await fetch(`${url}/api/city/%2e%2e%2fetc/config`);
        assert.equal(res.status, 400);
        const body = (await res.json()) as { kind?: string };
        assert.equal(body.kind, 'validation');
      });
    } finally {
      await runtime.stop();
    }
  });

  test('city dispatch surfaces an upstream error when the supervisor registry is unreachable', async () => {
    const { app, runtime } = createDashboardApp(makeConfig());
    runtime.start();
    try {
      await withApp(app, async (url) => {
        const res = await fetch(`${url}/api/city/test-city/config`);
        // Unroutable supervisor -> the /v0/cities lookup fails, mapped to a
        // 502/504 upstream error. NEVER a silent fallback / 200.
        assert.ok(
          res.status === 502 || res.status === 504,
          `expected upstream error status, got ${res.status}`,
        );
      });
    } finally {
      await runtime.stop();
    }
  });

  test('does not mount the dashboard sessions mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const res = await fetch(`${url}/api/city/test-city/sessions`);
          assert.equal(res.status, 404);

          const stream = await fetch(`${url}/api/city/test-city/session-stream/gc-session-b/stream`);
          assert.equal(stream.status, 404);
          await stream.body?.cancel();
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard agents roster mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const res = await fetch(`${url}/api/city/test-city/agents`);
          assert.equal(res.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('mounts only the city-scoped dashboard run diff route', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const oldDetailMirror = await fetch(`${url}/api/city/test-city/runs/gc-root`);
          assert.equal(oldDetailMirror.status, 404);

          const csrf = await fetch(`${url}/api/csrf`);
          const csrfBody = (await csrf.json()) as { token: string };
          const diff = await fetch(`${url}/api/city/test-city/runs/gc-root/diff`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:8081',
              'x-csrf-token': csrfBody.token,
            },
            body: JSON.stringify({
              executionPath: {
                kind: 'unavailable',
                reason: 'missing_cwd_and_rig_root',
              },
            }),
          });
          assert.equal(diff.status, 200);
          const body = (await diff.json()) as { kind?: string };
          assert.equal(body.kind, 'path_unknown');
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard beads read mirrors under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const list = await fetch(`${url}/api/city/test-city/beads`);
          assert.equal(list.status, 404);

          const detail = await fetch(`${url}/api/city/test-city/beads/td-bead-abc123`);
          assert.equal(detail.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard mail read mirrors under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const list = await fetch(`${url}/api/city/test-city/mail?alias=stephanie&box=inbox`);
          assert.equal(list.status, 404);

          const thread = await fetch(`${url}/api/city/test-city/mail/threads/thread-1?alias=stephanie`);
          assert.equal(thread.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard mail send mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const csrf = await fetch(`${url}/api/csrf`);
          const csrfBody = (await csrf.json()) as { token: string };
          const res = await fetch(`${url}/api/city/test-city/mail-send`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:8081',
              'x-csrf-token': csrfBody.token,
            },
            body: JSON.stringify({
              to: 'mayor',
              subject: 'status',
              body: 'all green',
            }),
          });
          assert.equal(res.status, 404);
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount the dashboard city events stream mirror under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const stream = await fetch(`${url}/api/city/test-city/events/stream`);
          assert.equal(stream.status, 404);
          await stream.body?.cancel();
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  test('does not mount dashboard links, snapshot, or home-pending mirrors under the city request plane', async () => {
    await withSupervisorRegistry(async (gcSupervisorUrl) => {
      const { app, runtime } = createDashboardApp(makeConfig({ gcSupervisorUrl }));
      runtime.start();
      try {
        await withApp(app, async (url) => {
          const links = await fetch(`${url}/api/city/test-city/links/td-bead-abc123`);
          assert.equal(links.status, 404);

          const snapshot = await fetch(`${url}/api/city/test-city/snapshot`);
          assert.equal(snapshot.status, 404);

          const csrf = await fetch(`${url}/api/csrf`);
          const csrfBody = (await csrf.json()) as { token: string };
          const refresh = await fetch(`${url}/api/city/test-city/snapshot/refresh`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:8081',
              'x-csrf-token': csrfBody.token,
            },
            body: JSON.stringify({ sources: ['runs'] }),
          });
          assert.equal(refresh.status, 404);

          const pending = await fetch(`${url}/api/city/test-city/home/pending/stream`);
          assert.equal(pending.status, 404);
          await pending.body?.cancel();
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
