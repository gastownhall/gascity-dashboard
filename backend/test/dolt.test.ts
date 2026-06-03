import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDoltNomsSampler,
  STORE_HEALTH_SOURCE,
  type DoltNomsRuntime,
  type DoltNomsTimer,
} from '../src/routes/dolt.js';
import type { StatusBody } from '../src/generated/gc-supervisor-client/types.gen.js';

describe('dolt-noms sampler', () => {
  test('records store_health.size_bytes from the injected status fetch', async () => {
    const sampler = createDoltNomsSampler({
      fetchStatus: () =>
        Promise.resolve(statusBody({ store_health: storeHealth({ size_bytes: 4096 }) })),
    });

    await sampler.sampleOnce();
    const trend = sampler.trend();

    assert.equal(trend.available, true);
    assert.equal(trend.samples.length, 1);
    assert.equal(trend.samples[0]?.bytes, 4096);
    if (trend.available) assert.equal(trend.source, STORE_HEALTH_SOURCE);
  });

  test('reports unavailable (store_health_absent) when the supervisor omits store_health', async () => {
    const sampler = createDoltNomsSampler({
      fetchStatus: () => Promise.resolve(statusBody()),
    });

    await sampler.sampleOnce();
    const trend = sampler.trend();

    assert.equal(trend.available, false);
    assert.deepEqual(trend.samples, []);
    if (!trend.available) assert.equal(trend.reason, 'store_health_absent');
  });

  test('reports sample_failed when the status fetch throws', async () => {
    const sampler = createDoltNomsSampler({
      fetchStatus: () => Promise.reject(new Error('gc supervisor returned 503')),
    });

    await sampler.sampleOnce();
    const trend = sampler.trend();

    assert.equal(trend.available, false);
    if (!trend.available) assert.equal(trend.reason, 'sample_failed');
  });

  test('keeps sample history per sampler instance', async () => {
    const first = createDoltNomsSampler({
      fetchStatus: () =>
        Promise.resolve(statusBody({ store_health: storeHealth({ size_bytes: 42 }) })),
    });
    const second = createDoltNomsSampler({
      fetchStatus: () => Promise.resolve(statusBody()),
    });

    await first.sampleOnce();

    const firstTrend = first.trend();
    assert.equal(firstTrend.available, true);
    assert.equal(firstTrend.samples[0]?.bytes, 42);

    const secondTrend = second.trend();
    assert.equal(secondTrend.available, false);
    assert.deepEqual(secondTrend.samples, []);
  });

  test('starts idempotently and clears its sampling interval on stop', () => {
    const runtime = new FakeDoltNomsRuntime();
    const sampler = createDoltNomsSampler({
      runtime,
      fetchStatus: () =>
        Promise.resolve(statusBody({ store_health: storeHealth({ size_bytes: 1 }) })),
    });

    assert.equal(sampler.running, false);
    sampler.start();
    assert.equal(sampler.running, true);
    assert.equal(runtime.activeIntervalCount(), 1);

    sampler.start();
    assert.equal(runtime.activeIntervalCount(), 1);

    sampler.stop();
    assert.equal(sampler.running, false);
    assert.equal(runtime.activeIntervalCount(), 0);
  });
});

function statusBody(partial: Partial<StatusBody> = {}): StatusBody {
  return {
    agent_count: 0,
    agents: { quarantined: 0, running: 0, suspended: 0, total: 0 },
    mail: { total: 0, unread: 0 },
    name: 'test-city',
    path: '/tmp/test-city',
    rig_count: 0,
    rigs: { suspended: 0, total: 0 },
    running: 0,
    suspended: false,
    uptime_sec: 1,
    work: { in_progress: 0, open: 0, ready: 0 },
    ...partial,
  };
}

function storeHealth(
  partial: Partial<NonNullable<StatusBody['store_health']>> = {},
): NonNullable<StatusBody['store_health']> {
  return {
    live_rows: 0,
    path: '/tmp/test-city/.beads',
    ratio_mb_per_row: 0,
    size_bytes: 0,
    threshold_mb_per_row: 10,
    warning: false,
    ...partial,
  };
}

class FakeDoltNomsRuntime implements DoltNomsRuntime {
  setInterval(callback: () => void, delayMs: number): DoltNomsTimer {
    const timer = new FakeDoltNomsTimer(callback, delayMs);
    this.intervals.push(timer);
    return timer;
  }

  clearInterval(timer: DoltNomsTimer): void {
    (timer as FakeDoltNomsTimer).cleared = true;
  }

  activeIntervalCount(): number {
    return this.intervals.filter((timer) => !timer.cleared).length;
  }

  private readonly intervals: FakeDoltNomsTimer[] = [];
}

class FakeDoltNomsTimer implements DoltNomsTimer {
  cleared = false;
  constructor(
    readonly callback: () => void,
    readonly delayMs: number,
  ) {}

  unref(): void {}
}
