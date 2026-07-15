import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// The frontend-bundle guard references only ${ADMIN_FRONTEND_DIST} (no systemd
// %-specifier), so it runs in isolation and we exercise it for real instead of
// pattern-matching it. A line-wide regex previously matched the echo text and
// let an operand mutation through (M4); sh expands ${ADMIN_FRONTEND_DIST} the
// same way systemd would before exec.
function frontendGuardCommand(): string {
  const line = EXEC_START_PRE.find((l) => l.includes('ADMIN_FRONTEND_DIST'));
  assert.ok(line, 'no ExecStartPre references ADMIN_FRONTEND_DIST');
  const match = /^ExecStartPre=\/bin\/sh -c '(.*)'$/.exec(line);
  assert.ok(match, `frontend ExecStartPre is not a /bin/sh -c '...' form: ${line}`);
  const command = match[1];
  assert.ok(command, 'frontend ExecStartPre command is empty');
  return command;
}

function runFrontendGuard(adminFrontendDist: string, cwd?: string): number {
  try {
    execFileSync('/bin/sh', ['-c', frontendGuardCommand()], {
      env: { ...process.env, ADMIN_FRONTEND_DIST: adminFrontendDist },
      cwd,
      stdio: 'ignore',
    });
    return 0;
  } catch (err) {
    const status = (err as { status?: number }).status;
    return typeof status === 'number' ? status : 1;
  }
}

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
    // m5: must LEAD, not merely appear — the stated intent (service comment) is
    // that a per-user node wins over a system one, which only holds if it is first.
    assert.equal(
      unitPath.split(':')[0],
      '%h/.local/bin',
      `Environment=PATH must lead with %h/.local/bin so a per-user node wins; got "${unitPath}"`,
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

  test('frontend guard tests the configured ADMIN_FRONTEND_DIST operand (M4)', () => {
    // Assert the real `test -f` OPERAND, not the whole line: the echo message
    // also contains ${ADMIN_FRONTEND_DIST}, so a line-wide regex passed even
    // when the operand was swapped for a hardcoded path, defeating "the check
    // moves with the var". Behavioral proof in the guard-fires suite below.
    assert.ok(
      unit.includes('test -f "${ADMIN_FRONTEND_DIST}/index.html"'),
      'frontend guard must test -f the configured ${ADMIN_FRONTEND_DIST}/index.html',
    );
  });

  test('unit carries no inert GC_CITY_PATH and no false `gc bd` write claim (M2)', () => {
    // config.cityPath (from GC_CITY_PATH) is read nowhere in backend/src; every
    // city/beads path comes from supervisor discovery, and the only bd subprocess
    // is `bd doctor --readonly`. There is no in-app `gc bd` write path, so the
    // var is inert and the failure mode the old comment described cannot occur.
    assert.ok(!/GC_CITY_PATH/.test(unit), 'GC_CITY_PATH is inert — do not set it in the unit');
    assert.ok(
      !/gc bd/i.test(unit),
      'unit must not claim an in-app `gc bd` write path (only `bd doctor --readonly` runs)',
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

describe('deploy: the frontend-bundle guard actually fires', () => {
  test('passes for an absolute dir that holds index.html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-present-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html>');
      assert.equal(runFrontendGuard(dir), 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails when the absolute bundle is missing — operand tracks the var (M4)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-absent-'));
    try {
      // Empty dir, no index.html. A guard with a hardcoded operand would ignore
      // this var and could pass; the real one must fail.
      assert.notEqual(runFrontendGuard(dir), 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a RELATIVE value even when it resolves to a real bundle (M1)', () => {
    const base = mkdtempSync(join(tmpdir(), 'fd-relative-'));
    try {
      mkdirSync(join(base, 'sub'));
      writeFileSync(join(base, 'sub', 'index.html'), '<!doctype html>');
      // From cwd=base, "sub/index.html" exists, so a guard without the
      // absoluteness gate would pass. mountFrontend resolves "sub" from backend/,
      // not from here, so the gate must reject it up front.
      assert.notEqual(runFrontendGuard('sub', base), 0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
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

  test('README makes no blanket "nothing fails silently" claim (AC3)', () => {
    assert.ok(
      !/none of these fail silently/i.test(readme),
      'README still makes the disproven blanket "nothing fails silently" claim',
    );
  });

  test('README asserts no source-level failure MECHANISM it cannot back (M2/M3)', () => {
    // The prior three rejections each narrated HOW a mis-set var degrades, and
    // each narration was false: there is no in-app `gc bd` write path
    // (config.cityPath is read nowhere), and a missing undecorated ReadWritePaths
    // entry fails the START — it is not "silently skipped". Guard both, plus the
    // now-removed inert GC_CITY_PATH, against reintroduction.
    assert.ok(!/gc bd/i.test(readme), 'README must not claim an in-app `gc bd` failure mode');
    assert.ok(
      !/silently skip/i.test(readme),
      'README must not claim ReadWritePaths silently skips',
    );
    assert.ok(
      !/GC_CITY_PATH/.test(readme),
      'GC_CITY_PATH is inert and removed from the unit; README must not document it',
    );
  });

  test('README still distinguishes the start-checked paths (AC3)', () => {
    assert.ok(
      /asserted at start/i.test(readme),
      'README must state which paths are asserted at start',
    );
  });

  test('README requires ADMIN_FRONTEND_DIST to be absolute (M1)', () => {
    const para = readme.split('\n').find((line) => line.includes('ADMIN_FRONTEND_DIST'));
    assert.ok(para, 'README must mention ADMIN_FRONTEND_DIST');
    assert.ok(/absolute/i.test(para), 'README must state ADMIN_FRONTEND_DIST is an absolute path');
  });
});
