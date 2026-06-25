import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rawRequest, withApp } from './helpers/express-harness.js';

describe('rawRequest — fail-fast timeout guard', () => {
  test('rejects with a timeout error when a middleware branch never responds', async () => {
    await withApp(
      (app) => {
        // A stalled branch: it never sends a response and never calls next, so
        // without the guard the request would hang until the whole suite times
        // out. The guard must reject fast with a clear reason instead.
        app.use((_req, _res, _next) => {
          /* intentionally never responds */
        });
      },
      async ({ url }) => {
        await assert.rejects(
          () => rawRequest(url, { timeoutMs: 50 }),
          /rawRequest timed out after 50ms/,
        );
      },
    );
  });

  test('a normal response settles before the timeout and clears the timer', async () => {
    await withApp(
      (app) => {
        app.get('/', (_req, res) => res.status(204).end());
      },
      async ({ url }) => {
        // A short ceiling still resolves cleanly for a fast handler — proving the
        // timer is cleared on success and does not reject a healthy request.
        const res = await rawRequest(url, { timeoutMs: 1_000 });
        assert.equal(res.status, 204);
      },
    );
  });
});
