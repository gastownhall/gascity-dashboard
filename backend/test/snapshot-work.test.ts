import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { WorkSummary } from 'gas-city-dashboard-shared';

import {
  collectWork,
  createWorkSourceCache,
  type WorkStatus,
  WORK_CACHE_TTL_MS,
} from '../src/snapshot/collectors/work.js';

// work collector coverage for gascity-dashboard-aw75.
//
// The collector reads the supervisor's `status.work` block from
// GET /v0/city/{name}/status (already fetched via GcClient.getStatus) and
// translates the wire's snake_case `in_progress` into the dashboard DTO's
// camelCase `inProgress` at the edge. `status.work` is optional on the wire;
// an absent block is an upstream degradation and must surface as a source
// error (status='error'), never a fabricated zero — per "Don't Swallow Errors".

function status(work: WorkStatus['work']): WorkStatus {
  return { version: 'test', ...(work !== undefined ? { work } : {}) };
}

describe('collectWork', () => {
  test('maps status.work to WorkSummary, translating in_progress to inProgress', async () => {
    const summary = await collectWork({
      getStatus: async () => status({ open: 1091, ready: 0, in_progress: 1 }),
    });

    const expected: WorkSummary = { open: 1091, ready: 0, inProgress: 1 };
    assert.deepEqual(summary, expected);
  });

  test('throws when status.work is absent (degraded supervisor, not a fake zero)', async () => {
    await assert.rejects(
      () => collectWork({ getStatus: async () => status(undefined) }),
      /work counts/i,
    );
  });

  test('propagates an upstream getStatus failure', async () => {
    await assert.rejects(
      () =>
        collectWork({
          getStatus: async () => {
            throw new Error('gc supervisor returned 503');
          },
        }),
      /503/,
    );
  });
});

describe('createWorkSourceCache', () => {
  test('serves live status.work via the getStatus seam', async () => {
    const cache = createWorkSourceCache({
      getStatus: async () => status({ open: 5, ready: 2, in_progress: 3 }),
    });

    const state = await cache.get();
    assert.equal(state.status === 'error', false);
    if (state.status === 'error') return;
    assert.equal(state.source, 'work');
    assert.deepEqual(state.data, { open: 5, ready: 2, inProgress: 3 });
  });

  test('an absent work block surfaces as a source error, not a thrown route', async () => {
    const cache = createWorkSourceCache({
      getStatus: async () => status(undefined),
    });

    const state = await cache.get();
    assert.equal(state.status, 'error');
  });

  test('falls back to committed fixture data when the live load fails', async () => {
    // SourceCache always attempts load() first and only serves the fixture on
    // failure (degraded-mode fallback, never a persistent shadow store). A
    // throwing getStatus simulates an unreachable supervisor under
    // SNAPSHOT_USE_FIXTURES=1.
    const fixture: WorkSummary = { open: 7, ready: 1, inProgress: 4 };
    const cache = createWorkSourceCache({
      useFixture: true,
      loadFixture: () => fixture,
      getStatus: async () => {
        throw new Error('supervisor unreachable');
      },
    });

    const state = await cache.get();
    assert.equal(state.status === 'error', false);
    if (state.status === 'error') return;
    assert.equal(state.status, 'fixture');
    assert.deepEqual(state.data, fixture);
  });

  test('uses a 45s TTL to match the city clock the headline reads alongside', () => {
    assert.equal(WORK_CACHE_TTL_MS, 45 * 1000);
  });
});
