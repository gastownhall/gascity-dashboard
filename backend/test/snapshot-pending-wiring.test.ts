import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type {
  CityStatusSummary,
  GcSession,
  GcSessionList,
  PendingInteraction,
  ResourceSummary,
  RunSummary,
  WorkSummary,
} from 'gas-city-dashboard-shared';

import { SourceCache } from '../src/snapshot/cache.js';
import {
  createSnapshotService,
  type CreateSnapshotServiceOptions,
  type SourceCacheMap,
} from '../src/snapshot/service.js';
import type {
  SessionPendingHandlers,
  SessionStreamSubscriber,
} from '../src/snapshot/pending-subscriptions.js';

// Aggregator wiring (gascity-dashboard-mbcy, R3): the snapshot read path drives
// the pending aggregator off its active-session set, and the service exposes
// the resulting pending-decision alerts. The aggregator internals are covered
// by pending-store / pending-subscriptions / pending-subscriber tests; this
// pins only the service-level wiring.

const CITY: CityStatusSummary = {
  activeAgents: 1, totalAgents: 1, activeSessions: 1, suspendedSessions: 0,
  maxSessions: { status: 'available', value: 10 }, sessionsByProvider: [], rigs: [],
};
const RESOURCES: ResourceSummary = {
  vcpuCount: 1, loadAverage: [0, 0, 0], loadPerVcpu: 0,
  memory: { totalBytes: 1, usedBytes: 0, availableBytes: 1, utilization: 0 },
  uptimeSeconds: 1, samples: [],
};
const RUNS: RunSummary = {
  totalActive: 0, totalHistorical: 0,
  runCounts: { total: 0, visible: 0, prReview: 0, designReview: 0, bugfix: 0, blocked: 0, other: 0 },
  lanes: [], historicalLanes: [], recentChanges: [],
  census: { status: 'unavailable', error: 'derived in read path' },
};
const WORK: WorkSummary = { open: 0, ready: 0, inProgress: 0 };

function caches(): SourceCacheMap {
  return {
    city: new SourceCache({ source: 'city', ttlMs: 45_000, load: async () => CITY }),
    resources: new SourceCache({ source: 'resources', ttlMs: 30_000, load: async () => RESOURCES }),
    runs: new SourceCache({ source: 'runs', ttlMs: 60_000, load: async () => RUNS }),
    work: new SourceCache({ source: 'work', ttlMs: 45_000, load: async () => WORK }),
  };
}

function session(id: string, state: GcSession['state']): GcSession {
  return {
    id, template: 't', session_name: id, title: id, state,
    created_at: '2026-06-02T12:00:00.000Z', attached: false, running: state === 'active',
    provider: 'codex',
  } as GcSession;
}

function sessionsCacheOf(items: GcSession[]): SourceCache<GcSessionList> {
  return new SourceCache<GcSessionList>({
    source: 'city', ttlMs: 45_000, load: async () => ({ items, total: items.length }),
  });
}

class FakeSubscriber implements SessionStreamSubscriber {
  readonly handlers = new Map<string, SessionPendingHandlers>();
  readonly subscribeCalls: string[] = [];
  subscribe(sessionId: string, handlers: SessionPendingHandlers) {
    this.subscribeCalls.push(sessionId);
    this.handlers.set(sessionId, handlers);
    return { close: () => {} };
  }
  pending(sessionId: string, p: PendingInteraction): void {
    this.handlers.get(sessionId)!.onPending(p);
  }
}

function baseOptions(): CreateSnapshotServiceOptions {
  return {
    caches: caches(),
    config: { cityName: 'c', cityRoot: '/tmp/c', useFixtures: false, enabledModules: null, defaultView: null },
  };
}

describe('snapshot service — pending aggregator wiring', () => {
  test('does NOT subscribe while no consumer is streaming (lazy activation)', async () => {
    const subscriber = new FakeSubscriber();
    const service = createSnapshotService({
      ...baseOptions(),
      sessions: sessionsCacheOf([session('s1', 'active')]),
      pendingSubscriber: subscriber,
    });
    await service.getSnapshot();
    assert.deepEqual(subscriber.subscribeCalls, []); // inert until a consumer streams
  });

  test('a streaming consumer activates subscription of active sessions and sees their pending', async () => {
    const subscriber = new FakeSubscriber();
    const service = createSnapshotService({
      ...baseOptions(),
      sessions: sessionsCacheOf([session('s1', 'active'), session('s2', 'active'), session('s3', 'asleep')]),
      pendingSubscriber: subscriber,
    });

    let changes = 0;
    service.streamPending(() => { changes += 1; });
    await service.getSnapshot();
    assert.deepEqual(subscriber.subscribeCalls.sort(), ['s1', 's2']); // 'asleep' is not observed
    assert.deepEqual(service.pendingAlerts(), []);

    subscriber.pending('s1', { request_id: 'req-1', kind: 'tool_approval' });
    assert.ok(changes >= 1); // listener fired on change (push, not poll)
    const alerts = service.pendingAlerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.dedupKey, 'pending-decision:req-1');
    assert.equal(alerts[0]!.ref.sessionId, 's1');
  });

  test('the last consumer leaving tears down subscriptions and clears pending', async () => {
    const subscriber = new FakeSubscriber();
    const service = createSnapshotService({
      ...baseOptions(),
      sessions: sessionsCacheOf([session('s1', 'active')]),
      pendingSubscriber: subscriber,
    });
    const stop = service.streamPending(() => {});
    await service.getSnapshot();
    subscriber.pending('s1', { request_id: 'req-1', kind: 'tool_approval' });
    assert.equal(service.pendingAlerts().length, 1);

    stop();
    assert.deepEqual(service.pendingAlerts(), []); // store cleared on deactivate
  });

  test('the snapshot envelope still builds (alerts field present) alongside the aggregator', async () => {
    const service = createSnapshotService({
      ...baseOptions(),
      sessions: sessionsCacheOf([session('s1', 'active')]),
      pendingSubscriber: new FakeSubscriber(),
    });
    const snap = await service.getSnapshot();
    assert.ok(Array.isArray(snap.alerts)); // run-sourced alerts on the envelope (R2)
  });

  test('with no subscriber and no gc the aggregator is inert (no pending, snapshot works)', async () => {
    const service = createSnapshotService(baseOptions());
    const snap = await service.getSnapshot();
    const stop = service.streamPending(() => {});
    await service.getSnapshot();
    assert.deepEqual(service.pendingAlerts(), []);
    assert.ok(Array.isArray(snap.alerts));
    stop();
    service.closePending(); // must not throw
  });
});
