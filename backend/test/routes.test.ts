import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { healthRouter } from '../src/routes/health.js';

function buildApp(): { app: express.Express } {
  const app = express();
  app.use(express.json());
  app.use('/api/system', healthRouter({
    doltProbe: async () => ({ kind: 'ok', version: '2.0.7' }),
    beadsProbe: async () => ({ kind: 'error', reason: 'bd missing' }),
  }));
  return { app };
}

async function startApp(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

describe('dashboard-local routes', () => {
  test('GET /api/system/system returns dashboard-local health without calling supervisor', async () => {
    const { app } = buildApp();
    const { url, close } = await startApp(app);
    try {
      const res = await fetch(`${url}/api/system/system`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        admin?: unknown;
        host?: unknown;
        supervisor?: unknown;
        diagnostics?: unknown;
      };
      assert.equal(typeof body.admin, 'object');
      assert.equal(typeof body.host, 'object');
      assert.equal(body.supervisor, undefined);
      assert.equal(body.diagnostics, undefined);
    } finally {
      await close();
    }
  });

  test('GET /api/system/local-tools returns dashboard-local tool probes only', async () => {
    const { app } = buildApp();
    const { url, close } = await startApp(app);
    try {
      const res = await fetch(`${url}/api/system/local-tools`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        dolt: {
          status: 'available',
          version: '2.0.7',
          source: 'local probe: dolt version',
        },
        beads: {
          status: 'unavailable',
          reason: 'bd missing',
        },
      });
    } finally {
      await close();
    }
  });
});
