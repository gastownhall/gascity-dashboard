import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GcClient } from '../src/gc-client.js';
import { LOG_COMPONENT } from '../src/logging.js';
import {
  routeInternalError,
  routeUpstreamError,
  routeValidationError,
  writeRouteError,
} from '../src/route-errors.js';

describe('route error adapter', () => {
  test('maps validation errors to a stable 400 response', () => {
    assert.deepEqual(routeValidationError('invalid bead id'), {
      status: 400,
      body: { error: 'invalid bead id', kind: 'validation' },
    });
  });

  test('maps supervisor timeouts to the shared 504 upstream-timeout response', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';

    assert.deepEqual(
      routeUpstreamError(err, {
        component: LOG_COMPONENT.sessions,
        operation: 'session stream failed',
        responseError: 'failed to list sessions',
        isTimeout: GcClient.isTimeoutError,
      }),
      {
        status: 504,
        body: {
          error: 'gc supervisor did not respond in time',
          kind: 'upstream-timeout',
        },
      },
    );
  });

  test('redacts unexpected upstream messages but keeps error class name', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8372 at /secret/socket');
    err.name = 'SupervisorPayloadError';

    const wire = routeUpstreamError(err, {
      component: LOG_COMPONENT.mail,
      operation: '/api/mail failed',
      responseError: 'failed to list mail',
      isTimeout: GcClient.isTimeoutError,
      log: () => undefined,
    });

    assert.equal(wire.status, 502);
    assert.deepEqual(wire.body, {
      error: 'failed to list mail',
      kind: 'upstream',
      details: { name: 'SupervisorPayloadError' },
    });
    assert.doesNotMatch(JSON.stringify(wire.body), /127\.0\.0\.1|secret|socket/);
  });

  test('supports route-owned not-found mapping before generic upstream redaction', () => {
    const wire = routeUpstreamError(new Error('gc supervisor returned 404'), {
      component: LOG_COMPONENT.runs,
      operation: 'failed to fetch run',
      responseError: 'failed to fetch run',
      isTimeout: GcClient.isTimeoutError,
      notFound: { error: 'run not found', kind: 'not_found' },
    });

    assert.deepEqual(wire, {
      status: 404,
      body: { error: 'run not found', kind: 'not_found' },
    });
  });

  test('maps internal failures to redacted 500 responses and logs the cause', () => {
    const logs: string[] = [];
    const err = new TypeError('secret path /Users/operator/app.ts');

    const wire = routeInternalError(err, {
      component: LOG_COMPONENT.snapshot,
      operation: 'failed to build snapshot',
      responseError: 'failed to build snapshot',
      log: (component, message) => logs.push(`${component}:${message}`),
    });

    assert.deepEqual(wire, {
      status: 500,
      body: {
        error: 'failed to build snapshot',
        kind: 'internal',
        details: { name: 'TypeError' },
      },
    });
    assert.doesNotMatch(JSON.stringify(wire.body), /Users|operator|app\.ts/);
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? '', /secret path/);
  });

  test('write helper writes the computed status and body', () => {
    const writes: Array<{ status: number; body: unknown }> = [];
    const res = {
      status(status: number) {
        return {
          json(body: unknown) {
            writes.push({ status, body });
          },
        };
      },
    };

    writeRouteError(res, routeValidationError('invalid scope ref'));

    assert.deepEqual(writes, [
      {
        status: 400,
        body: { error: 'invalid scope ref', kind: 'validation' },
      },
    ]);
  });
});
