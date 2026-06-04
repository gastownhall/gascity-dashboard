import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { GcClient } from '../src/gc-client.js';
import type {
  StatusBody,
  SupervisorCitiesOutputBody,
} from 'gas-city-dashboard-shared/gc-supervisor';
import { REQUEST_ID_HEADER, runWithLogContext } from '../src/logging.js';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

interface Fake {
  readonly baseUrl: string;
  readonly hits: number;
  setHandler(h: Handler): void;
  close(): Promise<void>;
}

function startFake(): Promise<Fake> {
  return new Promise((resolve) => {
    let handler: Handler = (_req, res) => {
      json(res, validStatusBody());
    };
    let hits = 0;
    const sockets = new Set<import('node:net').Socket>();
    const server = http.createServer((req, res) => {
      hits += 1;
      handler(req, res);
    });
    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        get hits() {
          return hits;
        },
        setHandler(h: Handler) {
          handler = h;
        },
        close() {
          for (const socket of sockets) socket.destroy();
          return new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

describe('GcClient host-local supervisor reads', () => {
  let fake: Fake;

  beforeEach(async () => {
    fake = await startFake();
  });

  afterEach(async () => {
    await fake.close();
  });

  test('passes through generated status responses', async () => {
    fake.setHandler((req, res) => {
      assert.equal(req.url, '/v0/city/test/status');
      json(res, validStatusBody('test'));
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    const out = await gc.getStatus();

    assert.equal(out.name, 'test');
    assert.equal(out.work.ready, 1);
  });

  test('forwards the active request id to supervisor reads', async () => {
    fake.setHandler((req, res) => {
      assert.equal(req.headers[REQUEST_ID_HEADER.toLowerCase()], 'req-supervisor-1');
      json(res, validStatusBody('test'));
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    const out = await runWithLogContext({ requestId: 'req-supervisor-1' }, () => gc.getStatus());

    assert.equal(out.name, 'test');
  });

  test('maps generated city registry results to the host-local descriptor', async () => {
    fake.setHandler((req, res) => {
      assert.equal(req.url, '/v0/cities');
      json(res, {
        items: [
          { name: 'alpha', path: '/cities/alpha', running: true },
          { name: 'beta', path: '/cities/beta', running: false },
        ],
        total: 2,
      } satisfies SupervisorCitiesOutputBody);
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'unused',
      defaultTimeoutMs: 5_000,
    });

    await assert.deepEqual(await gc.listSupervisorCities(), [
      { name: 'alpha', path: '/cities/alpha', running: true },
      { name: 'beta', path: '/cities/beta', running: false },
    ]);
  });

  test('rejects malformed generated status payloads at the edge', async () => {
    fake.setHandler((_req, res) => {
      json(res, { ...validStatusBody(), work: undefined });
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    await assert.rejects(
      () => gc.getStatus(),
      /invalid gc supervisor getStatus payload: payload\.work must be/i,
    );
  });

  test('rejects malformed generated city registry payloads at the edge', async () => {
    fake.setHandler((_req, res) => {
      json(res, {
        items: [{ path: '/cities/alpha', running: true }],
        total: 1,
      });
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    await assert.rejects(
      () => gc.listSupervisorCities(),
      /invalid gc supervisor listSupervisorCities payload: payload\.items\[0\]\.name must be/i,
    );
  });

  test('normalizes nullable city registry items to an empty list', async () => {
    fake.setHandler((_req, res) => {
      json(res, { items: null, total: 0 } satisfies SupervisorCitiesOutputBody);
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    await assert.deepEqual(await gc.listSupervisorCities(), []);
  });

  test('redacts non-2xx supervisor responses', async () => {
    fake.setHandler((_req, res) => {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'secret supervisor topology' }));
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    await assert.rejects(
      () => gc.getStatus(),
      (err: unknown) => {
        assert.equal((err as Error).message, 'gc supervisor returned 503');
        return true;
      },
    );
  });

  test('rejects 200 responses with no JSON body at the transport boundary', async () => {
    fake.setHandler((_req, res) => {
      res.statusCode = 200;
      res.end();
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    await assert.rejects(() => gc.getStatus(), /gc supervisor returned an empty response body/);
  });
});

describe('GcClient timeout and single-flight behavior', () => {
  let fake: Fake;

  beforeEach(async () => {
    fake = await startFake();
  });

  afterEach(async () => {
    await fake.close();
  });

  test('aborts upstream calls that exceed the default timeout', async () => {
    fake.setHandler(() => {
      /* leave the request open */
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 150,
    });

    const start = Date.now();
    let err: unknown;
    try {
      await gc.getStatus();
    } catch (caught) {
      err = caught;
    }
    const elapsed = Date.now() - start;

    assert.ok(err, 'expected a rejection');
    assert.ok(elapsed < 1_000, `expected fast abort, got ${elapsed}ms`);
    assert.equal(GcClient.isTimeoutError(err), true);
  });

  test('distinguishes caller aborts from upstream timeouts', async () => {
    fake.setHandler(() => {
      /* leave the request open */
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 60_000,
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    let err: unknown;
    try {
      await gc.getStatus(controller.signal);
    } catch (caught) {
      err = caught;
    }

    assert.ok(err, 'expected a rejection');
    assert.equal((err as Error).name, 'AbortError');
    assert.equal(GcClient.isTimeoutError(err), false);
  });

  test('collapses concurrent identical status requests into one upstream call', async () => {
    fake.setHandler((_req, res) => {
      setTimeout(() => {
        json(res, validStatusBody());
      }, 50);
    });
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    const [one, two, three] = await Promise.all([gc.getStatus(), gc.getStatus(), gc.getStatus()]);

    assert.equal(one.name, 'test-city');
    assert.equal(two.name, 'test-city');
    assert.equal(three.name, 'test-city');
    assert.equal(fake.hits, 1);
  });

  test('starts a new upstream call after a completed in-flight request', async () => {
    const gc = new GcClient({
      baseUrl: fake.baseUrl,
      cityName: 'test',
      defaultTimeoutMs: 5_000,
    });

    await gc.getStatus();
    await gc.getStatus();

    assert.equal(fake.hits, 2);
  });
});

function json(res: http.ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function validStatusBody(name = 'test-city'): StatusBody {
  return {
    agent_count: 0,
    agents: {
      quarantined: 0,
      running: 0,
      suspended: 0,
      total: 0,
    },
    mail: {
      total: 0,
      unread: 0,
    },
    name,
    path: `/tmp/${name}`,
    rig_count: 0,
    rigs: {
      suspended: 0,
      total: 0,
    },
    running: 0,
    suspended: false,
    uptime_sec: 12,
    work: {
      in_progress: 2,
      open: 3,
      ready: 1,
    },
  };
}
