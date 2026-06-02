import express from 'express';
import type { GcBead, GcRunSnapshot } from 'gas-city-dashboard-shared';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { GcClient } from '../src/gc-client.js';
import { runsRouter } from '../src/routes/runs.js';

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void;

interface FakeSupervisor {
  baseUrl: string;
  requests: string[];
  setHandler(h: Handler): void;
  liveConnections(): number;
  close(): Promise<void>;
}

function startFakeSupervisor(): Promise<FakeSupervisor> {
  return new Promise((resolve) => {
    let handler: Handler = (_req, res) => {
      res.statusCode = 404;
      res.end('not found');
    };
    const requests: string[] = [];
    const sockets = new Set<import('node:net').Socket>();
    let live = 0;
    const server = http.createServer((req, res) => {
      requests.push(req.url ?? '');
      live++;
      res.on('close', () => {
        live--;
      });
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
        requests,
        setHandler(h: Handler) {
          handler = h;
        },
        liveConnections() {
          return live;
        },
        close() {
          for (const sock of sockets) sock.destroy();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
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

function buildApp(fakeUrl: string, rigRoot = ''): express.Express {
  const gc = new GcClient({
    baseUrl: fakeUrl,
    cityName: 'racoon-city',
    defaultTimeoutMs: 500,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/runs', runsRouter(gc, { rigRoot }));
  return app;
}

function graphV2Snapshot(workDir?: string): GcRunSnapshot {
  return {
    run_id: 'gc-root',
    root_bead_id: 'gc-root',
    root_store_ref: 'city:racoon-city',
    resolved_root_store: 'city:racoon-city',
    scope_kind: 'city',
    scope_ref: 'racoon-city',
    snapshot_version: 7,
    snapshot_event_seq: 42,
    partial: false,
    stores_scanned: ['city:racoon-city'],
    logical_nodes: [],
    logical_edges: [],
    scope_groups: [],
    beads: [
      {
        id: 'gc-root',
        title: 'Adopt PR #42',
        status: 'in_progress',
        kind: 'run',
        metadata: {
          'gc.kind': 'run',
          'gc.formula_contract': 'graph.v2',
          'gc.formula': 'mol-adopt-pr-v2',
          'gc.scope_kind': 'city',
          'gc.scope_ref': 'racoon-city',
          'gc.root_store_ref': 'city:racoon-city',
          'gc.run_target': 'racoon-city/codex',
          ...(workDir ? { 'gc.work_dir': workDir } : {}),
        },
      },
      {
        id: 'gc-loop-1',
        title: 'Review Loop',
        status: 'in_progress',
        kind: 'ralph',
        step_ref: 'mol-adopt-pr-v2.review-loop',
        metadata: {
          'gc.kind': 'ralph',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop',
          'gc.max_attempts': '3',
        },
      },
      {
        id: 'gc-codex-iter1',
        title: 'Codex Review',
        status: 'closed',
        assignee: 'gc-session-a',
        kind: 'task',
        step_ref: 'mol-adopt-pr-v2.review-loop.iteration.1.review-codex',
        attempt: 1,
        logical_bead_id: 'review-codex',
        metadata: {
          'gc.kind': 'task',
          'gc.step_id': 'review-codex',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop.iteration.1.review-codex',
          'gc.attempt': '1',
          session_name: 'codex-review-1',
        },
      },
      {
        id: 'gc-codex-iter2',
        title: 'Codex Review',
        status: 'in_progress',
        assignee: 'gc-session-b',
        kind: 'task',
        step_ref: 'mol-adopt-pr-v2.review-loop.iteration.2.review-codex',
        attempt: 2,
        logical_bead_id: 'review-codex',
        metadata: {
          'gc.kind': 'task',
          'gc.step_id': 'review-codex',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop.iteration.2.review-codex',
          'gc.attempt': '2',
          session_name: 'codex-review-2',
        },
      },
      {
        id: 'gc-scope-check',
        title: 'Review scope check',
        status: 'closed',
        kind: 'scope-check',
        step_ref: 'mol-adopt-pr-v2.review-loop.iteration.2.review-codex-scope-check',
        metadata: {
          'gc.kind': 'scope-check',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop.iteration.2.review-codex-scope-check',
        },
      },
    ],
    deps: [
      { from: 'gc-loop-1', to: 'gc-codex-iter2', kind: 'execution' },
    ],
  };
}

function runtimeBead(
  id: string,
  status: string,
  assignee?: string,
  metadata: Record<string, string> = {},
): GcBead {
  const bead: GcBead = {
    id,
    title: id,
    status,
    issue_type: 'task',
    priority: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    metadata,
  };
  if (assignee) bead.assignee = assignee;
  return bead;
}

function respondJson(
  res: http.ServerResponse,
  body: unknown,
  statusCode = 200,
): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(supervisorWireBody(body)));
}

function supervisorWireBody(body: unknown): unknown {
  if (!isRunSnapshotBody(body)) return body;
  const { run_id: runId, ...rest } = body;
  return { ...rest, workflow_id: runId };
}

function isRunSnapshotBody(body: unknown): body is GcRunSnapshot {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as { run_id?: unknown }).run_id === 'string' &&
    typeof (body as { root_bead_id?: unknown }).root_bead_id === 'string'
  );
}

function respondMissingFormulaDetail(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  if (!req.url?.startsWith('/v0/city/racoon-city/formulas/')) return false;
  respondJson(res, { error: 'not found' }, 404);
  return true;
}

function respondFormulaDetail(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  if (!req.url?.startsWith('/v0/city/racoon-city/formulas/mol-adopt-pr-v2?')) return false;
  respondJson(res, {
    name: 'mol-adopt-pr-v2',
    description: 'Adopt PR',
    version: 'test',
    var_defs: [],
    steps: [],
    deps: [],
    preview: { nodes: [], edges: [] },
  });
  return true;
}

describe('runs detail route', () => {
  let fake: FakeSupervisor;

  beforeEach(async () => {
    fake = await startFakeSupervisor();
  });

  afterEach(async () => {
    await fake.close();
  });

  test('returns graph.v2 display nodes without exposing internal ralph terminology', async () => {
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (respondFormulaDetail(req, res)) return;
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(graphV2Snapshot())));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.runId, 'gc-root');
      assert.deepEqual(body.formula, { kind: 'known', name: 'mol-adopt-pr-v2', source: 'metadata' });
      assert.equal(body.snapshotVersion, 7);
      assert.ok(
        fake.requests.includes('/v0/city/racoon-city/workflow/gc-root?scope_kind=city&scope_ref=racoon-city'),
        `unexpected upstream requests: ${fake.requests.join(', ')}`,
      );

      const wire = JSON.stringify(body).toLowerCase();
      assert.equal(wire.includes('ralph'), false);

      const loopNode = body.nodes.find((node: { constructKind?: string }) => node.constructKind === 'check-loop');
      assert.ok(loopNode, 'expected check-loop display node');

      const codexNode = body.nodes.find((node: { semanticNodeId?: string }) => node.semanticNodeId === 'review-codex');
      assert.ok(codexNode, 'expected semantic review-codex node');
      assert.deepEqual(codexNode.iterationSummary, {
        kind: 'stacked',
        visibleIteration: 2,
        iterationCount: 2,
        control: { kind: 'known', id: 'review-loop' },
      });
      assert.equal(codexNode.executionInstances.length, 2);
      assert.equal(codexNode.executionInstances[0].historical, true);
      assert.equal(codexNode.executionInstances[1].currentIteration, true);
      assert.equal(codexNode.executionInstances[1].session.kind, 'attached');
      assert.equal(codexNode.executionInstances[1].session.streamable, true);
      assert.equal(codexNode.executionInstances[1].session.link.sessionId, 'gc-session-b');
      assert.ok(
        codexNode.controlBadges.some((badge: { label?: string }) => badge.label === 'scope check'),
        'expected scope-check to collapse into a badge',
      );
    } finally {
      await close();
    }
  });

  test('rejects invalid run ids before calling supervisor', async () => {
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/../../etc/passwd`);
      assert.equal(res.status, 404);
      assert.equal(fake.requests.length, 0);
    } finally {
      await close();
    }
  });

  test('rejects invalid run ids and scope params before calling supervisor', async () => {
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      for (const path of [
        '/api/runs/bad$id',
        '/api/runs/gc-root?scope_kind=workspace&scope_ref=racoon-city',
        '/api/runs/gc-root?scope_kind=city&scope_ref=../racoon-city',
        '/api/runs/gc-root?scope_kind=city',
        '/api/runs/gc-root?scope_ref=racoon-city',
        '/api/runs/gc-root?scope_kind=city&scope_kind=rig&scope_ref=racoon-city',
        '/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city&scope_ref=other',
        '/api/runs/gc-root?scope_kind=city&scope_kind=rig&scope_ref=racoon-city&scope_ref=other',
      ]) {
        const res = await fetch(`${url}${path}`);
        assert.equal(res.status, 400, path);
        const body = await res.json();
        assert.equal(body.kind, 'validation', path);
      }
      assert.equal(fake.requests.length, 0);
    } finally {
      await close();
    }
  });

  test('defaults unscoped detail requests to the dashboard city scope', async () => {
    fake.setHandler((req, res) => {
      if (respondMissingFormulaDetail(req, res)) return;
      if (req.url?.startsWith('/v0/city/racoon-city/bead/')) {
        res.setHeader('content-type', 'application/json');
        const id = req.url.split('/').pop() ?? 'gc-root';
        res.end(JSON.stringify(runtimeBead(id, 'pending')));
        return;
      }
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      assert.equal(req.url, '/v0/city/racoon-city/workflow/gc-root?scope_kind=city&scope_ref=racoon-city');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(supervisorWireBody(graphV2Snapshot())));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root`);
      assert.equal(res.status, 200);
      assert.ok(fake.requests.includes('/v0/city/racoon-city/workflow/gc-root?scope_kind=city&scope_ref=racoon-city'));
      assert.ok(fake.requests.some((request) => request === '/v0/city/racoon-city/bead/gc-root'));
    } finally {
      await close();
    }
  });

  test('orders detail nodes by supervisor formula preview when the run exposes its formula', async () => {
    const snapshot = graphV2Snapshot();
    snapshot.beads = [
      snapshot.beads?.[0],
      {
        id: 'review-attempt-1',
        title: 'Review plan iteration 1',
        status: 'pending',
        kind: 'task',
        step_ref: 'mol-demo-plan-review.plan-cycle.iter1.review.iteration.1',
        logical_bead_id: 'review-control-1',
        metadata: {
          'gc.logical_bead_id': 'review-control-1',
          'gc.step_ref': 'mol-demo-plan-review.plan-cycle.iter1.review.iteration.1',
        },
      },
      {
        id: 'inspect-bead',
        title: 'Inspect scaffold',
        status: 'pending',
        kind: 'task',
        step_ref: 'mol-demo-plan-review.inspect',
        metadata: {
          'gc.step_ref': 'mol-demo-plan-review.inspect',
        },
      },
      {
        id: 'review-control-1',
        title: 'Review plan iteration 1',
        status: 'pending',
        kind: 'ralph',
        step_ref: 'mol-demo-plan-review.plan-cycle.iter1.review',
        metadata: {
          'gc.kind': 'ralph',
          'gc.step_ref': 'mol-demo-plan-review.plan-cycle.iter1.review',
        },
      },
      {
        id: 'draft-bead',
        title: 'Draft plan iteration 1',
        status: 'pending',
        kind: 'task',
        step_ref: 'mol-demo-plan-review.plan-cycle.iter1.draft',
        metadata: {
          'gc.step_ref': 'mol-demo-plan-review.plan-cycle.iter1.draft',
        },
      },
    ].filter((bead): bead is NonNullable<typeof bead> => bead !== undefined);
    const root = snapshot.beads[0];
    assert.ok(root);
    root.title = 'Plan demo';
    root.metadata = {
      ...root.metadata,
      'gc.formula': 'mol-demo-plan-review',
      'gc.run_target': 'racoon-city/codex',
    };
    snapshot.deps = [];
    const beadById = new Map(snapshot.beads.map((bead) => [bead.id, bead]));

    fake.setHandler((req, res) => {
      if (req.url === '/v0/city/racoon-city/sessions') {
        respondJson(res, { items: [], total: 0 });
        return;
      }
      if (req.url?.startsWith('/v0/city/racoon-city/bead/')) {
        const id = req.url.split('/').pop() ?? '';
        respondJson(res, beadById.get(id) ?? runtimeBead(id, 'pending'));
        return;
      }
      if (
        req.url ===
        '/v0/city/racoon-city/formulas/mol-demo-plan-review?scope_kind=city&scope_ref=racoon-city&target=racoon-city%2Fcodex'
      ) {
        respondJson(res, {
          name: 'mol-demo-plan-review',
          description: 'Plan demo',
          version: 'test',
          var_defs: [],
          steps: [],
          deps: [],
          preview: {
            nodes: [
              { id: 'mol-demo-plan-review.inspect', title: 'Inspect scaffold', kind: 'task' },
              { id: 'mol-demo-plan-review.plan-cycle.iter1.draft', title: 'Draft plan iteration 1', kind: 'task' },
              { id: 'mol-demo-plan-review.plan-cycle.iter1.review.iteration.1', title: 'Review plan iteration 1', kind: 'task' },
              { id: 'mol-demo-plan-review.plan-cycle.iter1.review', title: 'Review plan iteration 1', kind: 'ralph' },
            ],
            edges: [],
          },
        });
        return;
      }
      assert.equal(req.url, '/v0/city/racoon-city/workflow/gc-root?scope_kind=city&scope_ref=racoon-city');
      respondJson(res, snapshot);
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(
        body.nodes.map((node: { semanticNodeId?: string }) => node.semanticNodeId),
        ['gc-root', 'inspect', 'draft', 'review-control-1'],
      );
    } finally {
      await close();
    }
  });

  test('overlays stale run snapshot statuses with live supervisor bead state', async () => {
    const staleSnapshot = graphV2Snapshot();
    staleSnapshot.beads = staleSnapshot.beads?.map((bead) => ({
      ...bead,
      status: 'pending',
    })) ?? [];
    const runtimeById = new Map([
      ['gc-root', runtimeBead('gc-root', 'in_progress')],
      [
        'gc-codex-iter1',
        runtimeBead('gc-codex-iter1', 'closed', 'gc-session-a', {
          session_name: 'codex-review-1',
        }),
      ],
      [
        'gc-codex-iter2',
        runtimeBead('gc-codex-iter2', 'in_progress', 'gc-session-b', {
          session_name: 'codex-review-2',
          'gc.step_ref': 'runtime.metadata.must.not.replace.graph.shape',
        }),
      ],
    ]);
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/v0/city/racoon-city/bead/')) {
        const id = req.url.split('/').pop() ?? '';
        res.end(JSON.stringify(runtimeById.get(id) ?? runtimeBead(id, 'pending')));
        return;
      }
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(staleSnapshot)));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(res.status, 200);
      const body = await res.json();

      const rootNode = body.nodes.find((node: { id?: string }) => node.id === 'gc-root');
      assert.equal(rootNode?.status, 'active');
      assert.deepEqual(rootNode?.executionInstances[0].session, {
        kind: 'none',
        reason: 'session_unresolved',
      });

      const codexNode = body.nodes.find((node: { semanticNodeId?: string }) => node.semanticNodeId === 'review-codex');
      assert.equal(codexNode?.status, 'active');
      assert.equal(codexNode?.executionInstances[0].status, 'completed');
      assert.equal(codexNode?.executionInstances[1].status, 'active');
      assert.equal(codexNode?.executionInstances[1].session.kind, 'attached');
      assert.equal(codexNode?.executionInstances[1].session.streamable, true);
      assert.equal(codexNode?.executionInstances[1].session.link.sessionId, 'gc-session-b');
    } finally {
      await close();
    }
  });

  test('marks an unassigned active run root as unresolved without attaching a dispatcher transcript', async () => {
    const snapshot = graphV2Snapshot();
    snapshot.scope_kind = 'rig';
    snapshot.scope_ref = 'tic-tac-toe-app';
    // rig SCOPE with a city STORE: the run is resolved under the rig scope
    // but its beads live in the city store, so they remain refreshable via
    // /v0/city/{city}/bead/{id}. Scope and store are independent dimensions
    // (gascity-dashboard-sd9). This test exercises rig-scope session resolution
    // over the live per-bead refresh path; the non-city-store skip is covered
    // by its own dedicated tests below.
    snapshot.root_store_ref = 'city:racoon-city';
    snapshot.resolved_root_store = 'city:racoon-city';
    snapshot.stores_scanned = ['city:racoon-city'];
    snapshot.beads = snapshot.beads?.map((bead) =>
      bead.id === 'gc-root'
        ? {
          ...bead,
          status: 'pending',
          metadata: {
            ...bead.metadata,
            'gc.scope_kind': 'rig',
            'gc.scope_ref': 'tic-tac-toe-app',
            'gc.root_store_ref': 'city:racoon-city',
            'gc.run_target': 'tic-tac-toe-app/codex',
          },
        }
        : bead,
    ) ?? [];
    const runtimeById = new Map([
      [
        'gc-root',
        runtimeBead('gc-root', 'in_progress', undefined, {
          'gc.scope_kind': 'rig',
          'gc.scope_ref': 'tic-tac-toe-app',
          'gc.root_store_ref': 'rig:tic-tac-toe-app',
          'gc.run_target': 'tic-tac-toe-app/codex',
        }),
      ],
    ]);
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({
          items: [
            {
              id: 'fddc-g3v',
              template: 'tic-tac-toe-app/codex',
              provider: 'codex',
              alias: 'tic-tac-toe-app/codex-1',
              title: 'tic-tac-toe-app/codex-1',
              state: 'active',
              session_name: 'codex-fddc-g3v',
              created_at: '2026-05-26T02:50:29Z',
              attached: false,
              rig: 'tic-tac-toe-app',
              pool: 'codex',
              agent_kind: 'pool',
              running: true,
            },
            {
              id: 'fddc-pe6',
              template: 'tic-tac-toe-app/control-dispatcher',
              provider: 'claude',
              alias: 'tic-tac-toe-app/control-dispatcher',
              title: 'tic-tac-toe-app/control-dispatcher',
              state: 'active',
              session_name: 'tic-tac-toe-app--control-dispatcher',
              created_at: '2026-05-26T02:47:19Z',
              attached: false,
              rig: 'tic-tac-toe-app',
              agent_kind: 'role',
              running: true,
            },
          ],
          total: 2,
        }));
        return;
      }
      if (req.url?.startsWith('/v0/city/racoon-city/bead/')) {
        const id = req.url.split('/').pop() ?? '';
        res.end(JSON.stringify(runtimeById.get(id) ?? runtimeBead(id, 'pending')));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(snapshot)));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root?scope_kind=rig&scope_ref=tic-tac-toe-app`);
      assert.equal(res.status, 200);
      const body = await res.json();
      const rootNode = body.nodes.find((node: { id?: string }) => node.id === 'gc-root');
      assert.equal(rootNode?.status, 'active');
      assert.deepEqual(rootNode?.executionInstances[0].session, {
        kind: 'none',
        reason: 'session_unresolved',
      });
    } finally {
      await close();
    }
  });

  test('resolves a running node assignee to the concrete supervisor session id', async () => {
    const snapshot = graphV2Snapshot();
    snapshot.scope_kind = 'rig';
    snapshot.scope_ref = 'tic-tac-toe-app';
    // rig SCOPE, city STORE — beads stay refreshable (see the note above).
    snapshot.root_store_ref = 'city:racoon-city';
    snapshot.resolved_root_store = 'city:racoon-city';
    snapshot.stores_scanned = ['city:racoon-city'];
    snapshot.beads = snapshot.beads?.map((bead) => {
      if (bead.id !== 'gc-codex-iter2') return bead;
      const { assignee: _assignee, metadata: beadMetadata, ...rest } = bead;
      const { session_name: _sessionName, ...metadata } = beadMetadata;
      return {
        ...rest,
        status: 'pending',
        metadata: {
          ...metadata,
          'gc.run_target': 'tic-tac-toe-app/codex',
        },
      };
    }) ?? [];
    const runtimeById = new Map([
      [
        'gc-codex-iter2',
        runtimeBead('gc-codex-iter2', 'in_progress', 'tic-tac-toe-app/codex-1', {
          'gc.run_target': 'tic-tac-toe-app/codex',
        }),
      ],
    ]);
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({
          items: [
            {
              id: 'fddc-g3v',
              template: 'tic-tac-toe-app/codex',
              provider: 'codex',
              alias: 'tic-tac-toe-app/codex-1',
              title: 'tic-tac-toe-app/codex-1',
              state: 'active',
              session_name: 'tic-tac-toe-app/codex-1',
              created_at: '2026-05-26T02:50:29Z',
              attached: false,
              rig: 'tic-tac-toe-app',
              pool: 'codex',
              agent_kind: 'pool',
              running: true,
            },
          ],
          total: 1,
        }));
        return;
      }
      if (req.url?.startsWith('/v0/city/racoon-city/bead/')) {
        const id = req.url.split('/').pop() ?? '';
        res.end(JSON.stringify(runtimeById.get(id) ?? runtimeBead(id, 'pending')));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(snapshot)));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root?scope_kind=rig&scope_ref=tic-tac-toe-app`);
      assert.equal(res.status, 200);
      const body = await res.json();
      const codexNode = body.nodes.find((node: { semanticNodeId?: string }) => node.semanticNodeId === 'review-codex');
      const currentInstance = codexNode?.executionInstances.find(
        (instance: { currentIteration?: boolean }) => instance.currentIteration,
      );
      assert.equal(currentInstance?.status, 'active');
      assert.deepEqual(currentInstance?.session, {
        kind: 'attached',
        streamable: true,
        link: {
          sessionId: 'fddc-g3v',
          sessionName: 'tic-tac-toe-app/codex-1',
          assignee: 'tic-tac-toe-app/codex-1',
        },
      });
      assert.deepEqual(body.progress, {
        snapshotVersion: 7,
        snapshotEventSeq: { kind: 'known', seq: 42 },
        snapshotPartial: false,
        totalNodeCount: 3,
        visibleNodeCount: 3,
        edgeCount: 1,
        executionInstanceCount: 4,
        sessionLinkCount: 1,
        streamableSessionCount: 1,
        streamableSessionIds: ['fddc-g3v'],
        statusCounts: {
          active: 1,
          ready: 2,
        },
        allStatusCounts: {
          active: 1,
          ready: 2,
        },
      });
    } finally {
      await close();
    }
  });

  test('skips per-bead refresh for a non-city-store run and does not flag partial', async () => {
    // Regression for gascity-dashboard-6zz: a rig-store-backed run's beads
    // are NOT addressable via /v0/city/{city}/bead/{id} (the supervisor exposes
    // no rig bead endpoint), so the old code fired N /bead reads that all 404'd
    // and flagged the run permanently 'partial'. The fix treats the embedded
    // snapshot rows as authoritative and skips the refresh entirely.
    const snapshot = graphV2Snapshot();
    snapshot.scope_kind = 'city';
    snapshot.scope_ref = 'racoon-city';
    snapshot.root_store_ref = 'rig:codeprobe';
    snapshot.resolved_root_store = 'rig:codeprobe';
    snapshot.stores_scanned = ['rig:codeprobe'];
    snapshot.beads = snapshot.beads?.map((bead) =>
      bead.id === 'gc-root'
        ? { ...bead, metadata: { ...bead.metadata, 'gc.root_store_ref': 'rig:codeprobe' } }
        : bead,
    ) ?? [];
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (respondFormulaDetail(req, res)) return;
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      if (req.url?.startsWith('/v0/city/racoon-city/bead/')) {
        // No rig bead endpoint exists upstream; the supervisor 404s these.
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: 'bead not found' }));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(snapshot)));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root`);
      assert.equal(res.status, 200);
      const body = await res.json();
      // Not degraded: the embedded rows are the intended source for a
      // non-city-store run, so the route must not raise the partial badge
      // (the snapshot's own partial:false flows through unchanged).
      assert.equal(body.completeness?.kind, 'complete');
      // Crucially, the route must not have attempted ANY /bead read.
      assert.equal(
        fake.requests.some((request) => request.startsWith('/v0/city/racoon-city/bead/')),
        false,
        `expected no /bead reads, got: ${fake.requests.join(', ')}`,
      );
      // Embedded status still drives the view: gc-codex-iter2 carries
      // status=in_progress + assignee in the snapshot, so its node is active
      // even though no /bead refresh ran.
      const codexNode = body.nodes.find(
        (node: { semanticNodeId?: string }) => node.semanticNodeId === 'review-codex',
      );
      assert.equal(codexNode?.status, 'active');
    } finally {
      await close();
    }
  });

  test('still refreshes per-bead and flags partial when a city-store bead read fails', async () => {
    // Counterpart to the skip above: genuine city runs keep the
    // allSettled refresh, so a transient subset failure still surfaces partial.
    const snapshot = graphV2Snapshot();
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (respondMissingFormulaDetail(req, res)) return;
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      if (req.url?.startsWith('/v0/city/racoon-city/bead/')) {
        const id = req.url.split('/').pop() ?? '';
        if (id === 'gc-codex-iter2') {
          res.statusCode = 500;
          res.end(JSON.stringify({ detail: 'transient' }));
          return;
        }
        res.end(JSON.stringify(runtimeBead(id, 'pending')));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(snapshot)));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.completeness, {
        kind: 'partial',
        reasons: ['runtime_bead_read_failed', 'formula_detail_fetch_failed'],
      });
      // The refresh was attempted for city-store beads.
      assert.ok(
        fake.requests.some((request) => request.startsWith('/v0/city/racoon-city/bead/')),
        `expected /bead reads, got: ${fake.requests.join(', ')}`,
      );
    } finally {
      await close();
    }
  });

  test('returns unsupported for non graph.v2 run snapshots', async () => {
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      res.end(JSON.stringify({
        workflow_id: 'gc-root',
        root_bead_id: 'gc-root',
        root_store_ref: 'city:racoon-city',
        resolved_root_store: 'city:racoon-city',
        scope_kind: 'city',
        scope_ref: 'racoon-city',
        snapshot_version: 1,
        partial: false,
        stores_scanned: ['city:racoon-city'],
        beads: [{
          id: 'gc-root',
          title: 'Legacy run',
          status: 'in_progress',
          kind: 'run',
          metadata: { 'gc.formula_contract': 'legacy' },
        }],
        deps: [],
        logical_nodes: [],
        logical_edges: [],
        scope_groups: [],
      }));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root`);
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.equal(body.kind, 'unsupported');
      assert.match(body.error, /graph\.v2/);
    } finally {
      await close();
    }
  });

  test('maps supervisor 404 without leaking supervisor topology', async () => {
    fake.setHandler((_req, res) => {
      res.statusCode = 404;
      res.end('not found');
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-missing`);
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.kind, 'not_found');
      assert.equal(body.error, 'run not found');
      assert.doesNotMatch(JSON.stringify(body), /127\.0\.0\.1|racoon-city/);
    } finally {
      await close();
    }
  });

  test('maps unknown supervisor failures to generic upstream errors', async () => {
    fake.setHandler((_req, res) => {
      res.statusCode = 500;
      res.end('database path /Users/csells/racoon-city/.beads failed');
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/runs/gc-root`);
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.kind, 'upstream');
      assert.equal(body.error, 'failed to fetch run');
      assert.deepEqual(body.details, { name: 'Error' });
      assert.doesNotMatch(JSON.stringify(body), /127\.0\.0\.1|\/Users\/csells|racoon-city/);
    } finally {
      await close();
    }
  });

  test('caches the assembled detail so repeat loads hit the supervisor once', async () => {
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (respondFormulaDetail(req, res)) return;
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(graphV2Snapshot())));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    const workflowReqs = () =>
      fake.requests.filter((u) => u.startsWith('/v0/city/racoon-city/workflow/gc-root')).length;
    try {
      const first = await fetch(`${url}/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(first.status, 200);
      assert.equal(workflowReqs(), 1);
      const second = await fetch(`${url}/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(second.status, 200);
      assert.equal((await second.json()).runId, 'gc-root');
      // Within TTL the second load is served from cache — no extra scan.
      assert.equal(workflowReqs(), 1, `unexpected upstream requests: ${fake.requests.join(', ')}`);
    } finally {
      await close();
    }
  });

  test('the diff endpoint shares the detail cache: detail then diff hits the supervisor once', async () => {
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (respondFormulaDetail(req, res)) return;
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(graphV2Snapshot())));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    const workflowReqs = () =>
      fake.requests.filter((u) => u.startsWith('/v0/city/racoon-city/workflow/gc-root')).length;
    try {
      const detail = await fetch(`${url}/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(detail.status, 200);
      assert.equal(workflowReqs(), 1);
      // The diff endpoint reuses the cached detail (it only needs
      // executionPath) instead of re-scanning every store.
      const diff = await fetch(`${url}/api/runs/gc-root/diff?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(diff.status, 200);
      assert.equal(workflowReqs(), 1, `unexpected upstream requests: ${fake.requests.join(', ')}`);
    } finally {
      await close();
    }
  });

  test('?refresh=1 bypasses the cache and re-fetches from the supervisor', async () => {
    fake.setHandler((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (respondFormulaDetail(req, res)) return;
      if (req.url === '/v0/city/racoon-city/sessions') {
        res.end(JSON.stringify({ items: [], total: 0 }));
        return;
      }
      res.end(JSON.stringify(supervisorWireBody(graphV2Snapshot())));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    const workflowReqs = () =>
      fake.requests.filter((u) => u.startsWith('/v0/city/racoon-city/workflow/gc-root')).length;
    try {
      await fetch(`${url}/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(workflowReqs(), 1);
      const forced = await fetch(
        `${url}/api/runs/gc-root?scope_kind=city&scope_ref=racoon-city&refresh=1`,
      );
      assert.equal(forced.status, 200);
      assert.equal(workflowReqs(), 2);
    } finally {
      await close();
    }
  });

});
