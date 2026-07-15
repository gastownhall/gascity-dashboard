import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for gascity-dashboard-8wcj: the shipped systemd unit and its
// runbook must point at the repo's real checkout path. The repo clones to
// `~/gascity-dashboard` (no hyphen between "gas" and "city"); an earlier copy
// hard-coded the non-existent `~/gas-city-dashboard`, so the unit silently
// never started and every documented redeploy was a no-op.
//
// These files are deploy config, not compiled code, so nothing else in the
// build catches drift back to the broken path — this test is the guard.

const unit = readFileSync(
  new URL('../../deploy/gas-city-dashboard.service', import.meta.url),
  'utf8',
);
const readme = readFileSync(new URL('../../deploy/README.md', import.meta.url), 'utf8');

// The hyphenated string is legitimate as the product name and the unit's own
// filename ("gas-city-dashboard.service"), so match only its use as a
// filesystem *path* segment — `%h/gas-city-dashboard`, `~/gas-city-dashboard`,
// or `/gas-city-dashboard/`.
const HYPHENATED_PATH_TOKENS = [
  '%h/gas-city-dashboard',
  '~/gas-city-dashboard',
  '/gas-city-dashboard/',
];

describe('deploy: systemd unit path is the real checkout', () => {
  test('unit contains no reference to the non-existent ~/gas-city-dashboard path', () => {
    for (const token of HYPHENATED_PATH_TOKENS) {
      assert.ok(!unit.includes(token), `unit still references the broken path token "${token}"`);
    }
  });

  test('unit runs the server from the real ~/gascity-dashboard checkout', () => {
    assert.match(
      unit,
      /ExecStart=\/usr\/bin\/node %h\/gascity-dashboard\/backend\/dist\/server\.js/,
    );
    assert.match(unit, /WorkingDirectory=%h\/gascity-dashboard$/m);
    assert.match(unit, /ADMIN_FRONTEND_DIST=%h\/gascity-dashboard\/frontend\/dist/);
  });

  test('unit fails loudly (ExecStartPre) when the build output is missing', () => {
    // Criterion 2: a wrong/missing repo path must fail at start with an
    // actionable message, not yield a permanently inactive unit + empty journal.
    const execStartPre = unit.split('\n').filter((line) => line.startsWith('ExecStartPre='));
    assert.ok(
      execStartPre.some(
        (line) =>
          line.includes('%h/gascity-dashboard/backend/dist/server.js') &&
          /test\s+-[a-z]*[fe]/.test(line),
      ),
      'expected an ExecStartPre asserting server.js exists before start',
    );
  });

  test('bind and port are unchanged (path fix only)', () => {
    // Criterion 5: this is a path fix, not a bind/exposure change.
    assert.match(unit, /Environment=PORT=8082/);
    assert.ok(!unit.includes('0.0.0.0'), 'unit must not widen the bind');
    assert.ok(!unit.includes('8081'), 'stale port 8081 must not reappear');
  });
});

describe('deploy: README matches the unit', () => {
  test('README references no non-existent ~/gas-city-dashboard path', () => {
    for (const token of HYPHENATED_PATH_TOKENS) {
      assert.ok(
        !readme.includes(token),
        `README still references the broken path token "${token}"`,
      );
    }
  });

  test('README drops the unenforced "hand-edit the path" instruction', () => {
    // Criterion 3: the old "edit it yourself if the path differs" note is not
    // backed by any check and was the trap. It must be gone or replaced.
    assert.ok(
      !/edit the unit's `WorkingDirectory`/.test(readme),
      'README still tells operators to hand-edit the path without enforcement',
    );
  });
});
