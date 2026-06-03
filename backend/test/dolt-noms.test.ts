import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sampleDoltNomsSize, STORE_HEALTH_SOURCE } from '../src/routes/dolt.js';
import type { StatusBody } from '../src/generated/gc-supervisor-client/types.gen.js';

// gascity-dashboard-x82: the dolt-noms sampler reads the supervisor's
// already-exposed store_health.size_bytes (GET /v0/city/{name}/status)
// instead of walking the host filesystem's .dolt/noms directory.
describe('sampleDoltNomsSize', () => {
  test('reads store_health.size_bytes from the injected status fetch', async () => {
    const status = statusBody({
      store_health: storeHealth({ size_bytes: 987_654, live_rows: 42 }),
    });
    const result = await sampleDoltNomsSize(() => Promise.resolve(status));
    assert.deepEqual(result, {
      kind: 'available',
      sample: { bytes: 987_654, source: STORE_HEALTH_SOURCE },
    });
  });

  test('returns unavailable (store_health_absent) when store_health is absent — no fake zero', async () => {
    const result = await sampleDoltNomsSize(() => Promise.resolve(statusBody()));
    assert.deepEqual(result, {
      kind: 'unavailable',
      reason: 'store_health_absent',
    });
  });

  // Trust-boundary validation: a malformed or degraded supervisor could
  // return Infinity / NaN / negative size_bytes. JSON.stringify turns
  // Infinity/NaN into "null" (silent corruption) and a negative byte count
  // is meaningless. Treat all of them as absent.
  test('returns unavailable for non-finite or negative size_bytes (Infinity / -Infinity / NaN / -1)', async () => {
    for (const bad of [Infinity, -Infinity, NaN, -1]) {
      const result = await sampleDoltNomsSize(() =>
        Promise.resolve(statusBody({ store_health: storeHealth({ size_bytes: bad }) })),
      );
      assert.deepEqual(
        result,
        { kind: 'unavailable', reason: 'store_health_absent' },
        `expected store_health_absent for size_bytes=${bad}`,
      );
    }
  });

  test('propagates a status-fetch error instead of swallowing it', async () => {
    await assert.rejects(
      () =>
        sampleDoltNomsSize(() =>
          Promise.reject(new Error('gc supervisor returned 503')),
        ),
      /gc supervisor returned 503/,
    );
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
