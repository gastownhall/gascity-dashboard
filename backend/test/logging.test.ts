import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LOG_COMPONENT, LOG_COMPONENTS, sanitizeForLog } from '../src/logging.js';

describe('logging component vocabulary', () => {
  test('centralizes every backend log component name', () => {
    assert.deepEqual([...LOG_COMPONENTS].sort(), [
      LOG_COMPONENT.admin,
      LOG_COMPONENT.adminAudit,
      LOG_COMPONENT.agents,
      LOG_COMPONENT.beads,
      LOG_COMPONENT.builds,
      LOG_COMPONENT.client,
      LOG_COMPONENT.doltNoms,
      LOG_COMPONENT.git,
      LOG_COMPONENT.health,
      LOG_COMPONENT.links,
      LOG_COMPONENT.mail,
      LOG_COMPONENT.maintainer,
      LOG_COMPONENT.sessions,
      LOG_COMPONENT.snapshot,
      LOG_COMPONENT.sse,
      LOG_COMPONENT.runs,
    ].sort());
  });
});

describe('sanitizeForLog', () => {
  // izgc Phase 4 security-reviewer finding: supervisor-controlled
  // `partial_errors[]` strings interpolated into operator log lines must
  // not be able to inject forged `[component] message` lines via embedded
  // newlines. Defensive even though the supervisor is loopback-trusted.
  test('replaces LF with space', () => {
    assert.equal(sanitizeForLog('foo\nbar'), 'foo bar');
  });
  test('replaces CR with space', () => {
    assert.equal(sanitizeForLog('foo\rbar'), 'foo bar');
  });
  test('replaces CRLF with two spaces', () => {
    assert.equal(sanitizeForLog('foo\r\nbar'), 'foo  bar');
  });
  test('handles a forged-log-line attempt', () => {
    const hostile = 'rig/foo down\n[admin] CRITICAL auth bypass at 2026-05-28';
    const out = sanitizeForLog(hostile);
    assert.doesNotMatch(out, /\n/);
    assert.match(out, /\[admin\] CRITICAL/);  // content preserved, line break removed
  });
  test('passes through clean strings', () => {
    assert.equal(sanitizeForLog('rig/foo down'), 'rig/foo down');
  });
});
