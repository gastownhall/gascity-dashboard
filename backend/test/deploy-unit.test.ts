import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for the shipped systemd unit and its runbook. An earlier copy
// hard-coded `~/gas-city-dashboard`, which exists on no host — the unit silently
// never started and every documented redeploy was a no-op.
//
// These files are deploy config, not compiled code, so nothing else in the build
// catches drift back to a unit that cannot start. This test is the guard.
// Rationale for each assertion lives next to the directive in the unit itself.

const unit = readFileSync(
  new URL('../../deploy/gas-city-dashboard.service', import.meta.url),
  'utf8',
);
const readme = readFileSync(new URL('../../deploy/README.md', import.meta.url), 'utf8');

const EXEC_START_PRE = unit.split('\n').filter((line) => line.startsWith('ExecStartPre='));

// The hyphenated string is legitimate as the product name and the unit's own
// filename ("gas-city-dashboard.service"), so match only its use as a
// filesystem *path* segment — `%h/gas-city-dashboard`, `~/gas-city-dashboard`,
// or `/gas-city-dashboard/`.
const HYPHENATED_PATH_TOKENS = [
  '%h/gas-city-dashboard',
  '~/gas-city-dashboard',
  '/gas-city-dashboard/',
];

// Switches that read like free hardening but leave the unit unable to start.
// Each was bisected through its own probe unit; the value is the failure.
const UNSTARTABLE_SWITCHES: Record<string, string> = {
  PrivateDevices:
    'implies a CapabilityBoundingSet drop needing CAP_SETPCAP, which a --user manager lacks: 218/CAPABILITIES before ExecStart',
  ProtectKernelModules:
    'implies a CapabilityBoundingSet drop needing CAP_SETPCAP, which a --user manager lacks: 218/CAPABILITIES before ExecStart',
  MemoryDenyWriteExecute:
    "blocks the mprotect() V8's JIT needs; node SIGTRAPs at startup before running a line of the server",
};

describe('deploy: systemd unit path is the real checkout', () => {
  test('unit contains no reference to the non-existent ~/gas-city-dashboard path', () => {
    for (const token of HYPHENATED_PATH_TOKENS) {
      assert.ok(!unit.includes(token), `unit still references the broken path token "${token}"`);
    }
  });

  test('unit runs the server from the real ~/gascity-dashboard checkout', () => {
    assert.match(unit, /ExecStart=\S+ node %h\/gascity-dashboard\/backend\/dist\/server\.js/);
    assert.match(unit, /WorkingDirectory=%h\/gascity-dashboard$/m);
    assert.match(unit, /ADMIN_FRONTEND_DIST=%h\/gascity-dashboard\/frontend\/dist/);
  });

  test('unit resolves node via PATH rather than a hard-coded interpreter path', () => {
    // `/usr/bin/node` is the same defect class as the old `%h/gas-city-dashboard`
    // path — an absolute path that simply does not exist on hosts where Node was
    // installed per-user (nvm/fnm/asdf, ~/.local/bin).
    assert.ok(
      !/ExecStart=\/usr\/bin\/node\b/.test(unit),
      'ExecStart hard-codes /usr/bin/node, which is absent on per-user Node installs',
    );
    assert.match(unit, /ExecStart=\/usr\/bin\/env node\b/);

    // env resolves `node` off PATH, and a systemd user service does not inherit
    // the login shell's PATH — so the unit must state one that can find it.
    const unitPath = unit.match(/^Environment=PATH=(.+)$/m)?.[1];
    assert.ok(unitPath, 'unit must set Environment=PATH for /usr/bin/env to resolve node');
    assert.ok(
      unitPath.split(':').includes('%h/.local/bin'),
      `Environment=PATH must include %h/.local/bin; got "${unitPath}"`,
    );
  });

  test('unit names the unit line to edit when node is not on PATH', () => {
    assert.ok(
      EXEC_START_PRE.some((line) => /command -v node/.test(line)),
      'expected an ExecStartPre asserting node resolves before start',
    );
  });

  test('unit names the missing build step when the build output is absent', () => {
    // The redeploy-that-skipped-`npm run build` case. (A wrong repo path never
    // reaches here — systemd aborts on WorkingDirectory at 200/CHDIR first.)
    assert.ok(
      EXEC_START_PRE.some(
        (line) =>
          line.includes('%h/gascity-dashboard/backend/dist/server.js') &&
          /test\s+-[a-z]*[fe]/.test(line),
      ),
      'expected an ExecStartPre asserting server.js exists before start',
    );
  });

  test('unit sets no hardening switch that prevents it from starting', () => {
    for (const [opt, why] of Object.entries(UNSTARTABLE_SWITCHES)) {
      assert.ok(!new RegExp(`^${opt}=(true|yes|1)$`, 'm').test(unit), `${opt} ${why}`);
    }
  });

  test('bind and port are unchanged', () => {
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
    // The old "edit it yourself if the path differs" note was not backed by any
    // check, and was the trap. It must be gone or replaced.
    assert.ok(
      !/edit the unit's `WorkingDirectory`/.test(readme),
      'README still tells operators to hand-edit the path without enforcement',
    );
  });
});
