import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';

import { supervisorTransportProxy } from '../src/routes/supervisor-transport-proxy.js';

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void;

interface RunningServer {
  url: string;
  close(): Promise<void>;
}

describe('supervisor transport proxy', () => {
  let upstreamRequests: string[];
  let upstream: RunningServer;

  beforeEach(async () => {
    upstreamRequests = [];
    upstream = await startServer((req, res) => {
      upstreamRequests.push(req.url ?? '');
      res.statusCode = 207;
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-gc-request-id', 'req-123');
      res.end('{"transport":"only","items":null}');
    });
  });

  afterEach(async () => {
    await upstream.close();
  });

  test('forwards supervisor v0 traffic byte-for-byte without owning DTO shape', async () => {
    const app = express();
    app.use('/gc-supervisor', supervisorTransportProxy(upstream.url));
    const dashboard = await startExpress(app);
    try {
      const res = await fetch(`${dashboard.url}/gc-supervisor/v0/cities?limit=1`, {
        headers: { accept: 'application/json' },
      });

      assert.equal(res.status, 207);
      assert.equal(res.headers.get('x-gc-request-id'), 'req-123');
      assert.equal(await res.text(), '{"transport":"only","items":null}');
      assert.deepEqual(upstreamRequests, ['/v0/cities?limit=1']);
    } finally {
      await dashboard.close();
    }
  });

  test('forwards supervisor health without colliding with the dashboard /health route', async () => {
    const app = express();
    app.use('/gc-supervisor', supervisorTransportProxy(upstream.url));
    const dashboard = await startExpress(app);
    try {
      const res = await fetch(`${dashboard.url}/gc-supervisor/health`);

      assert.equal(res.status, 207);
      assert.deepEqual(upstreamRequests, ['/health']);
    } finally {
      await dashboard.close();
    }
  });

  test('rejects paths outside the supervisor HTTP API surface', async () => {
    const app = express();
    app.use('/gc-supervisor', supervisorTransportProxy(upstream.url));
    const dashboard = await startExpress(app);
    try {
      const res = await fetch(`${dashboard.url}/gc-supervisor/admin`);

      assert.equal(res.status, 404);
      assert.deepEqual(upstreamRequests, []);
    } finally {
      await dashboard.close();
    }
  });
});

test('direct supervisor boundary keeps city discovery out of dashboard /api routes', async () => {
  const appSource = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(appSource, /app\.get\(['"`]\/api\/cities['"`]/);
  assert.match(appSource, /supervisorTransportProxy/);
  assert.match(appSource, /\/gc-supervisor/);
});

function startServer(handler: Handler): Promise<RunningServer> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve(serverHandle(server)));
  });
}

function startExpress(app: express.Express): Promise<RunningServer> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(serverHandle(server)));
  });
}

function serverHandle(server: Server): RunningServer {
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
