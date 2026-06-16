import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedReadPath } from '../src/routes/supervisor-read-allowlist.js';

describe('supervisor read allowlist', () => {
  test('allows the supervisor reads the dashboard SPA performs', () => {
    for (const path of [
      '/health',
      '/v0/cities',
      '/v0/city/test-city/agents',
      '/v0/city/test-city/beads',
      '/v0/city/test-city/beads/graph/gascity-0001',
      '/v0/city/test-city/bead/gascity-0001',
      '/v0/city/test-city/events',
      '/v0/city/test-city/events/stream',
      '/v0/city/test-city/formulas/feed',
      '/v0/city/test-city/formulas/my-formula',
      '/v0/city/test-city/health',
      '/v0/city/test-city/mail',
      '/v0/city/test-city/mail/thread/m1',
      '/v0/city/test-city/sessions',
      '/v0/city/test-city/session/s1/pending',
      '/v0/city/test-city/session/s1/stream',
      '/v0/city/test-city/session/s1/transcript',
      '/v0/city/test-city/status',
      '/v0/city/test-city/workflow/w1',
    ]) {
      assert.equal(isAllowedReadPath(path), true, `expected allow: ${path}`);
    }
  });

  test('denies side-effecting GETs and write/admin paths', () => {
    for (const path of [
      // agent prime is a state-changing GET — excluded on purpose.
      '/v0/city/test-city/agent/mayor/prime',
      '/v0/city/test-city/agent/pool/worker/prime',
      // mutations that happen to be reachable by GET shape must not slip in.
      '/v0/city/test-city/sling',
      '/v0/city/test-city/bead/gascity-0001/close',
      '/v0/city/test-city/agent/mayor/nudge',
      // unknown / out-of-surface paths.
      '/v0/city/test-city/agent/mayor',
      '/admin',
      '/v0/internal/secrets',
    ]) {
      assert.equal(isAllowedReadPath(path), false, `expected deny: ${path}`);
    }
  });

  test('anchors templates so a longer action suffix never matches a shorter read', () => {
    // `agent/{base}/prime` must not satisfy a generic two-segment agent read,
    // and trailing segments past a known read are rejected.
    assert.equal(isAllowedReadPath('/v0/city/test-city/beads/extra'), false);
    assert.equal(isAllowedReadPath('/v0/city/test-city/status/now'), false);
  });

  test('rejects `..` traversal that would resolve to a cross-city upstream', () => {
    // `{cityName}` ([^/]+) matches `..`, so without the traversal guard these
    // pass the allowlist, yet `new URL(req.url, base)` resolves them to the
    // GLOBAL `/v0/events` + `/v0/events/stream` cross-city reads — the exact
    // bypass read-only mode must prevent in a multi-city deployment.
    assert.equal(isAllowedReadPath('/v0/city/../events/stream'), false);
    assert.equal(isAllowedReadPath('/v0/city/../events'), false);
    // A bare `.` segment is normalized away by `new URL` too — fail closed.
    assert.equal(isAllowedReadPath('/v0/city/./events/stream'), false);
    // Backslash is converted to `/` for http URLs, so `..\events` collapses the
    // same way — fail closed on any backslash too.
    assert.equal(isAllowedReadPath('/v0/city/..\\events/stream'), false);
    // Matrix-parameter notation: `..;` is inert against the current Express
    // supervisor (it doesn't strip `;`-suffixes) but would resolve to a global
    // traversal under a `;`-stripping framework — fail closed on the bare `..`
    // prefix now rather than ship the latent gap.
    assert.equal(isAllowedReadPath('/v0/city/..;/events/stream'), false);
    assert.equal(isAllowedReadPath('/v0/city/..;param=1/events/stream'), false);
    assert.equal(isAllowedReadPath('/v0/city/.;/events/stream'), false);
  });

  test('rejects percent-encoded `..` that `new URL` would decode into a traversal', () => {
    // Express 4 leaves `%2e` undecoded in `req.path`, so a guard that only looks
    // for a literal `..` misses these — yet `new URL` decodes `%2e` → `.` and
    // resolves the same cross-city escape. Fail closed on any encoded dot,
    // regardless of case.
    for (const path of [
      '/v0/city/%2e%2e/events/stream',
      '/v0/city/%2E%2E/events/stream',
      '/v0/city/.%2e/events/stream',
      '/v0/city/%2e./events/stream',
    ]) {
      assert.equal(isAllowedReadPath(path), false, `expected deny: ${path}`);
    }
  });

  test('fails closed on a trailing slash rather than normalizing it', () => {
    // Supervisor read paths the SPA emits never carry a trailing slash; an
    // unexpected one is denied (404 upstream) instead of being silently
    // normalized into a match.
    assert.equal(isAllowedReadPath('/v0/city/test-city/beads/'), false);
    assert.equal(isAllowedReadPath('/v0/cities/'), false);
  });
});
