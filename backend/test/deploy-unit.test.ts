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
    assert.match(unit, /ExecStart=\S+ node %h\/gascity-dashboard\/backend\/dist\/server\.js/);
    assert.match(unit, /WorkingDirectory=%h\/gascity-dashboard$/m);
    assert.match(unit, /ADMIN_FRONTEND_DIST=%h\/gascity-dashboard\/frontend\/dist/);
  });

  test('unit resolves node via PATH rather than a hard-coded interpreter path', () => {
    // Criterion 1: the unit must start without a hand-edit. `/usr/bin/node` is
    // the same defect class as the old `%h/gas-city-dashboard` path — an
    // absolute path that simply does not exist on hosts where Node was
    // installed per-user (nvm/fnm/asdf, ~/.local/bin), yielding status=203/EXEC.
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

  test('unit fails loudly (ExecStartPre) when node is not on PATH', () => {
    // Criterion 2, applied to the interpreter: a bare 203/EXEC names no binary.
    const execStartPre = unit.split('\n').filter((line) => line.startsWith('ExecStartPre='));
    assert.ok(
      execStartPre.some((line) => /command -v node/.test(line)),
      'expected an ExecStartPre asserting node resolves before start',
    );
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

  test('unit sets no hardening switch a --user manager cannot apply', () => {
    // Criterion 1: these imply a CapabilityBoundingSet drop, which needs
    // CAP_SETPCAP effective. A `systemctl --user` manager does not have it, so
    // systemd rejects the unit at 218/CAPABILITIES *before* ExecStart — an
    // unstartable unit, not hardening. Verified by bisecting each property
    // through a probe unit on this host (systemd 255).
    for (const opt of ['PrivateDevices', 'ProtectKernelModules']) {
      assert.ok(
        !new RegExp(`^${opt}=(true|yes|1)$`, 'm').test(unit),
        `${opt} cannot be applied by a --user manager; the unit fails at 218/CAPABILITIES`,
      );
    }
  });

  test('unit sets no hardening switch that stops node from starting', () => {
    // Criterion 1, again: MemoryDenyWriteExecute=true reads like free
    // hardening but is fatal to a V8 process — it blocks the mprotect() the
    // JIT needs, so node SIGTRAPs at startup and the unit never runs. Verified
    // empirically via `systemd-run --user --property=MemoryDenyWriteExecute=true
    // node -e ...` => code=dumped/status=TRAP (and status=0 without it).
    assert.ok(
      !/^MemoryDenyWriteExecute=(true|yes|1)$/m.test(unit),
      'MemoryDenyWriteExecute is incompatible with V8 JIT; the unit will core-dump at start',
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
