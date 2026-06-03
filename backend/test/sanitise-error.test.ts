import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ExecError } from '../src/exec.js';
import { toWireExecError, toWireInternal500, writeExecError } from '../src/lib/sanitise-error.js';
import { LOG_COMPONENT } from '../src/logging.js';

// gascity-dashboard-uza: pure-function coverage for the two redaction
// helpers extracted from the ~12 inline sites across the route files.
// The wire contract under test:
//   - spawn ExecError => fixed "subprocess could not be started", never
//     the raw message (which embeds host PATH / abs binary paths).
//   - validation/timeout ExecError => message passes through (pre-authored
//     safe strings by ExecError construction).
//   - non-ExecError 500/502 => details.name only; raw message NEVER on the
//     body, only host-safe Error class name.

describe('toWireExecError — spawn redaction', () => {
  test('spawn kind redacts raw message to fixed string', () => {
    const err = new ExecError('spawn /usr/local/opt/gc/bin/gc ENOENT', 'spawn');
    const { status, body } = toWireExecError(err, 500);
    assert.equal(status, 500);
    assert.equal(body.error, 'subprocess could not be started');
    assert.equal(body.kind, 'spawn');
    // The host path must never reach the wire.
    assert.equal(/usr\/local\/opt\/gc\/bin/.test(JSON.stringify(body)), false);
    assert.equal(/ENOENT/.test(body.error), false);
  });

  test('spawn kind redacts the exact exec.ts wrapper format (spawn failed: …)', () => {
    // Mirror what exec.ts:170 actually constructs: `spawn failed: ${err.message}`
    // where node's child_process message for an abs-path binary is
    // `spawn <abs-path> ENOENT`. The wire must show neither the wrapper
    // nor the leaked binary path.
    const err = new ExecError(
      'spawn failed: spawn /usr/local/opt/gc/bin/gc ENOENT',
      'spawn',
    );
    const { status, body } = toWireExecError(err, 500);
    assert.equal(status, 500);
    assert.equal(body.error, 'subprocess could not be started');
    assert.equal(body.kind, 'spawn');
    assert.equal(/usr\/local\/opt\/gc\/bin/.test(JSON.stringify(body)), false);
    assert.equal(/spawn failed/.test(JSON.stringify(body)), false);
  });

  test('validation kind passes the (safe, pre-authored) message through', () => {
    const err = new ExecError('invalid agent alias', 'validation');
    const { status, body } = toWireExecError(err, 400);
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid agent alias');
    assert.equal(body.kind, 'validation');
  });

  test('timeout kind passes the (safe, pre-authored) message through', () => {
    const err = new ExecError('gc timed out after 5000ms', 'timeout');
    const { status, body } = toWireExecError(err, 504);
    assert.equal(status, 504);
    assert.equal(body.error, 'gc timed out after 5000ms');
    assert.equal(body.kind, 'timeout');
  });

  test('caller controls the status (502 upstream variant)', () => {
    const err = new ExecError('gc timed out', 'timeout');
    const { status } = toWireExecError(err, 502);
    assert.equal(status, 502);
  });

  test('body carries no `details` field (matches existing wire shape)', () => {
    const err = new ExecError('spawn /x ENOENT', 'spawn');
    const { body } = toWireExecError(err, 500);
    assert.equal('details' in body, false);
  });
});

describe('writeExecError — Express response adapter', () => {
  test('maps ExecError kinds, logs spawn details, and writes the redacted body', () => {
    const writes: Array<{ status: number; body: unknown }> = [];
    const logs: string[] = [];
    const res = {
      status(status: number) {
        return {
          json(body: unknown) {
            writes.push({ status, body });
          },
        };
      },
    };

    writeExecError(
      res,
      new ExecError('spawn failed: spawn /private/bin/git ENOENT', 'spawn'),
      LOG_COMPONENT.git,
      '/api/git/commits',
      { log: (component, message) => logs.push(`${component}:${message}`) },
    );

    assert.deepEqual(writes, [
      {
        status: 500,
        body: {
          error: 'subprocess could not be started',
          kind: 'spawn',
        },
      },
    ]);
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? '', /spawn failed/);
  });

  test('lets upstream routes preserve their non-timeout fallback status', () => {
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

    writeExecError(
      res,
      new ExecError('spawn failed: spawn /private/bin/gh ENOENT', 'spawn'),
      LOG_COMPONENT.maintainer,
      '/api/maintainer/refresh',
      { fallbackStatus: 502, log: () => undefined },
    );

    assert.deepEqual(writes, [
      {
        status: 502,
        body: {
          error: 'subprocess could not be started',
          kind: 'spawn',
        },
      },
    ]);
  });
});

describe('toWireInternal500 — details.name redaction', () => {
  test('default internal-error shape carries only Error class name', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8723');
    const { status, body } = toWireInternal500(err, {
      status: 500,
      error: 'internal error',
      kind: 'internal',
    });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal error');
    assert.equal(body.kind, 'internal');
    assert.deepEqual(body.details, { name: 'Error' });
    // The raw message — with host:port — must NOT be on the wire.
    assert.equal(/ECONNREFUSED/.test(JSON.stringify(body)), false);
    assert.equal(/127\.0\.0\.1/.test(JSON.stringify(body)), false);
  });

  test('upstream variant preserves caller-supplied error string + kind + status', () => {
    const err = new TypeError('fetch failed: getaddrinfo /etc/hosts ENOTFOUND');
    const { status, body } = toWireInternal500(err, {
      status: 502,
      error: 'failed to list beads',
      kind: 'upstream',
    });
    assert.equal(status, 502);
    assert.equal(body.error, 'failed to list beads');
    assert.equal(body.kind, 'upstream');
    assert.deepEqual(body.details, { name: 'TypeError' });
    assert.equal(/ENOTFOUND/.test(JSON.stringify(body)), false);
  });

  test('falls back to "Error" when the thrown value has no usable name', () => {
    // Preserve the verbatim `(err as Error).name ?? 'Error'` behaviour:
    // a plain object thrown with no name property degrades to 'Error'.
    const { body } = toWireInternal500(
      {} as unknown,
      { status: 500, error: 'internal error', kind: 'internal' },
    );
    assert.deepEqual(body.details, { name: 'Error' });
  });

  test('a thrown non-object value degrades to "Error" without throwing', () => {
    const { body } = toWireInternal500('boom' as unknown, {
      status: 500,
      error: 'internal error',
      kind: 'internal',
    });
    assert.deepEqual(body.details, { name: 'Error' });
  });

  test('a real Error with an empty name degrades to "Error" (no empty string on the wire)', () => {
    // Regression: the older `(err as Error).name ?? 'Error'` only coalesced
    // null/undefined, so an Error whose name was set to '' shipped an empty
    // string as details.name. Empty name must fall back to 'Error'.
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8723');
    err.name = '';
    const { body } = toWireInternal500(err, {
      status: 500,
      error: 'internal error',
      kind: 'internal',
    });
    assert.deepEqual(body.details, { name: 'Error' });
  });
});
