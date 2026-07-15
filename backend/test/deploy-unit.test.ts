import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
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

// ---------------------------------------------------------------------------
// Run guards AT THE LAYER THAT SHIPS.
//
// These guards are `ExecStartPre=` directives. systemd parses that directive
// text itself and performs its OWN ${VAR} substitution INTO the command line
// before /bin/sh ever sees it (systemd.service(5), "Command Lines"). Exercising
// a guard with execFileSync('/bin/sh', ['-c', cmd], {env}) is a DIFFERENT layer:
// that is sh's inherited-environment expansion, which is inert to embedded
// $(...) precisely where systemd's is not. A guard verified that way is green in
// CI and broken in production — a false guard by construction. So: write a real
// unit file, let the shipping systemd parse it, and read the unit's Result.
const UNIT_ENV_VAR = 'ADMIN_FRONTEND_DIST';

function systemdUserUnavailable(): string | false {
  const probe = spawnSync(
    'systemd-run',
    ['--user', '--wait', '--collect', '--quiet', '/bin/true'],
    {
      stdio: 'ignore',
    },
  );
  if (probe.error || probe.status !== 0) {
    // No --user manager (the common CI case: no session, no lingering). The
    // structural tests below still run everywhere and are what actually pins
    // the fix; this suite refuses to fake the behavioral proof at a wrong layer.
    return 'no systemd --user manager on this host';
  }
  return false;
}

const NO_SYSTEMD_USER = systemdUserUnavailable();

/**
 * Install a throwaway unit carrying `execStartPreLines` verbatim, start it, and
 * return systemd's own verdict. `success` means every ExecStartPre passed.
 */
function runGuardViaRealUnit(execStartPreLines: string[]): string {
  const name = `gcd-guard-probe-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  const unitPath = join(unitDir, `${name}.service`);
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(
    unitPath,
    [
      '[Unit]',
      'Description=gascity-dashboard guard probe (test-generated, disposable)',
      '[Service]',
      'Type=oneshot',
      ...execStartPreLines,
      'ExecStart=/bin/true',
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    spawnSync('systemctl', ['--user', 'start', `${name}.service`], { stdio: 'ignore' });
    const shown = spawnSync(
      'systemctl',
      ['--user', 'show', `${name}.service`, '-p', 'Result', '--value'],
      {
        encoding: 'utf8',
      },
    );
    return (shown.stdout ?? '').trim();
  } finally {
    spawnSync('systemctl', ['--user', 'reset-failed', `${name}.service`], { stdio: 'ignore' });
    rmSync(unitPath, { force: true });
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  }
}

function frontendGuardLine(): string {
  const line = EXEC_START_PRE.find((l) => l.includes(UNIT_ENV_VAR));
  assert.ok(line, `no ExecStartPre references ${UNIT_ENV_VAR}`);
  return line;
}

/**
 * systemd's Result for the shipped frontend guard when the var holds `value`.
 *
 * The value goes in through the MANAGER environment, not through a unit-file
 * `Environment=` line, and that distinction is the whole test. A unit-file
 * `Environment=` value is escaped and word-split by systemd's unit parser
 * (a `$(...)` payload arrives at the service as the literal `\$(...`), so a
 * probe built that way cannot see this bug — it passes against the vulnerable
 * guard and against the fixed one alike. `set-environment` does no such
 * escaping, and it is one of the surfaces the runbook itself points operators
 * at (alongside `.d/` drop-ins), so it is where the guard has to hold.
 *
 * Safe against the live service: a unit's own `Environment=` overrides the
 * manager environment, and the shipped unit pins ADMIN_FRONTEND_DIST itself.
 */
function runFrontendGuard(value: string): string {
  execFileSync('systemctl', ['--user', 'set-environment', `${UNIT_ENV_VAR}=${value}`], {
    stdio: 'ignore',
  });
  try {
    return runGuardViaRealUnit([frontendGuardLine()]);
  } finally {
    spawnSync('systemctl', ['--user', 'unset-environment', UNIT_ENV_VAR], { stdio: 'ignore' });
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

  test('server.js guard tests the SAME path ExecStart runs (B2)', () => {
    // Operand equality, not line containment. This line embeds its path twice —
    // as the `test -f` operand and again in the echo message — so an assertion
    // that only greps the line is satisfied by the echo text alone: swapping the
    // real operand for /tmp/some/other/path left the whole suite green. Same
    // defect class as M4, on M4's sibling. Pin the operand to ExecStart's path so
    // the guard cannot drift off the binary it is guarding.
    const execStart = /^ExecStart=\S+ node (\S+)$/m.exec(unit);
    assert.ok(execStart, 'ExecStart must run an explicit server.js path');
    const serverJs = execStart[1];

    const line = EXEC_START_PRE.find((l) => /test\s+-f/.test(l) && l.includes('server.js'));
    assert.ok(line, 'expected an ExecStartPre asserting server.js exists before start');
    const operand = /test\s+-f\s+"?([^"\s|;]+)"?/.exec(line);
    assert.ok(operand, `server.js guard has no parseable \`test -f\` operand: ${line}`);
    assert.equal(
      operand[1],
      serverJs,
      'the server.js guard must `test -f` exactly the path ExecStart runs',
    );
  });

  test('frontend guard never splices the var into shell program text (B1)', () => {
    // The structural half of the B1 fix, and the half that runs everywhere —
    // including CI, where no --user manager exists to run the behavioral proof.
    //
    // systemd substitutes ${ADMIN_FRONTEND_DIST} into the ExecStartPre command
    // line BEFORE sh parses it. Written inside the `sh -c` script, the value is
    // re-parsed as shell PROGRAM TEXT and $(...) in it EXECUTES as the service
    // user at start (proven on a real transient unit). Passed positionally, sh
    // sees opaque data. Assert the shape, so the vulnerable form cannot return.
    const line = frontendGuardLine();
    const match = /^ExecStartPre=\/bin\/sh -c '(.*)' _ "\$\{ADMIN_FRONTEND_DIST\}"$/.exec(line);
    assert.ok(
      match,
      `frontend guard must pass the value positionally as: /bin/sh -c '...' _ "\${ADMIN_FRONTEND_DIST}" — got: ${line}`,
    );
    const script = match[1];
    assert.ok(script, 'frontend guard has an empty sh -c script');
    assert.ok(
      !/\$\{?ADMIN_FRONTEND_DIST\}?/.test(script),
      'frontend guard must not expand ${ADMIN_FRONTEND_DIST} inside the sh -c script — systemd splices it into program text, making $(...) live syntax',
    );
    assert.ok(
      /test\s+-f\s+"\$1\/index\.html"/.test(script),
      'frontend guard must `test -f "$1/index.html"` — the positionally passed value',
    );
  });

  test('port guard scopes to the loopback address the unit binds (AC1)', () => {
    // `sport = :8082` matches the port on EVERY interface. `tailscale serve`
    // holds <tailnet-ip>:8082 to proxy INTO 127.0.0.1:8082, so the wide filter
    // false-positives on tailscale's own listener and refuses to start the very
    // backend tailscale proxies to. Behavioral proof in the port-guard suite.
    const line = EXEC_START_PRE.find((l) => l.includes('ss -tln'));
    assert.ok(line, 'expected an ExecStartPre port guard using ss');
    assert.ok(
      !/sport\s*=\s*:8082/.test(line),
      'port guard must not use `sport = :8082` — it matches 8082 on every interface and aborts on unrelated listeners',
    );
    assert.ok(
      line.includes('src 127.0.0.1:8082'),
      'port guard must scope to `src 127.0.0.1:8082`, the address the unit actually binds',
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

// Every test below drives a REAL systemd unit, so it can only run where a
// --user manager exists. The skip is loud rather than silent: a wrong-layer
// stand-in is what made the last three rounds read green while broken.
describe(
  'deploy: the frontend-bundle guard actually fires (real unit)',
  { skip: NO_SYSTEMD_USER },
  () => {
    test('passes for an absolute dir that holds index.html', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fd-present-'));
      try {
        writeFileSync(join(dir, 'index.html'), '<!doctype html>');
        assert.equal(runFrontendGuard(dir), 'success');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('fails when the absolute bundle is missing — operand tracks the var (M4)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fd-absent-'));
      try {
        // Empty dir, no index.html. A guard with a hardcoded operand would ignore
        // this var and could pass; the real one must fail.
        assert.notEqual(runFrontendGuard(dir), 'success');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('rejects a RELATIVE value even when it resolves to a real bundle (M1)', () => {
      const base = mkdtempSync(join(tmpdir(), 'fd-relative-'));
      try {
        mkdirSync(join(base, 'sub'));
        writeFileSync(join(base, 'sub', 'index.html'), '<!doctype html>');
        // mountFrontend resolves "sub" from backend/, a different directory than
        // this check's cwd, so a relative value must be rejected up front.
        assert.notEqual(runFrontendGuard('sub'), 'success');
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });

    test('does not EXECUTE command substitution embedded in the var (B1)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fd-cmdsub-'));
      try {
        const marker = join(dir, 'EXECUTED');
        // Against the pre-fix guard this created `marker` — arbitrary command
        // execution as the service user at start, before ExecStart. Reachable via
        // `systemctl --user set-environment`, a .d/ drop-in, or a unit edit: every
        // operator surface the runbook itself points at.
        const result = runFrontendGuard(`${dir}/$(touch ${marker})x`);
        assert.equal(
          existsSync(marker),
          false,
          'the guard EXECUTED $(...) from ADMIN_FRONTEND_DIST — systemd spliced the value into shell program text',
        );
        assert.notEqual(result, 'success', 'a bogus path must not pass the guard');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('does not silently pass a path node will never resolve (B1)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fd-bypass-'));
      try {
        mkdirSync(join(dir, 'bundle'));
        writeFileSync(join(dir, 'bundle', 'index.html'), '<!doctype html>');
        // Pre-fix, sh evaluated $(printf bundle) and inspected the REAL bundle, so
        // the guard passed — while node received the literal string and 404'd. The
        // exact failure this guard exists to prevent, waved through by the guard.
        assert.notEqual(
          runFrontendGuard(`${dir}/$(printf bundle)`),
          'success',
          'guard passed on a literal path containing $(...) that node cannot resolve',
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);

describe(
  'deploy: the port guard ignores other interfaces (AC1, real unit)',
  { skip: NO_SYSTEMD_USER },
  () => {
    // The unit hard-codes :8082, which is the live operator port — binding it in a
    // test would fight the running dashboard. The defect is in the ss FILTER, not
    // the number, so run the shipped guard verbatim with the port substituted for
    // one the OS hands us. The listener owns that port for the test's lifetime, so
    // there is no allocation race.
    function portGuardLineFor(port: number): string {
      const line = EXEC_START_PRE.find((l) => l.includes('ss -tln'));
      assert.ok(line, 'expected an ExecStartPre port guard using ss');
      return line.replaceAll('8082', String(port));
    }

    function listen(host: string): Promise<Server> {
      return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.once('error', reject);
        srv.listen(0, host, () => resolve(srv));
      });
    }

    const nonLoopback = Object.values(networkInterfaces())
      .flat()
      .find((ni) => ni && ni.family === 'IPv4' && !ni.internal)?.address;

    test(
      'starts when another interface holds the port but loopback is free',
      { skip: nonLoopback ? false : 'no non-loopback IPv4 interface' },
      async () => {
        // The tailscale-serve shape, and the reason :8082 stayed dark: something
        // else holds the port on a different interface while 127.0.0.1 is free.
        const srv = await listen(nonLoopback as string);
        try {
          const port = (srv.address() as { port: number }).port;
          assert.equal(
            runGuardViaRealUnit([portGuardLineFor(port)]),
            'success',
            'port guard aborted the start over a listener on a non-loopback interface',
          );
        } finally {
          srv.close();
        }
      },
    );

    test('still refuses when loopback itself is held', async () => {
      // The narrowed filter must not have simply become permissive.
      const srv = await listen('127.0.0.1');
      try {
        const port = (srv.address() as { port: number }).port;
        assert.notEqual(
          runGuardViaRealUnit([portGuardLineFor(port)]),
          'success',
          'port guard let the unit start while 127.0.0.1 was already bound',
        );
      } finally {
        srv.close();
      }
    });
  },
);

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

  test('README asserts no source-level failure MECHANISM it cannot back (M2)', () => {
    // Every round so far narrated HOW a mis-set var degrades, and every
    // narration was false — including one the REVIEWERS supplied ("a missing
    // ReadWritePaths entry fails the START at 226/NAMESPACE"), which a live
    // --user matrix on systemd 255 then falsified. The standing rule is the
    // outcome: the README states only what a test proves, so there is nothing
    // here to correct — the sentences are simply gone. Guard the removals.
    assert.ok(!/gc bd/i.test(readme), 'README must not claim an in-app `gc bd` failure mode');
    assert.ok(
      !/GC_CITY_PATH/.test(readme),
      'GC_CITY_PATH is inert and removed from the unit; README must not document it',
    );
    // Naming ReadWritePaths as a directive holding a path to repoint is fine.
    // Describing how it BEHAVES when an entry is missing is what keeps coming
    // out false, in both directions ("silently skips" and "fails at
    // 226/NAMESPACE" are each disproven on the shipping build). Ban the
    // vocabulary of that narration, not the directive's name.
    for (const claim of [/silently skip/i, /226/, /NAMESPACE/i]) {
      assert.ok(
        !claim.test(readme),
        `README must not narrate ReadWritePaths degradation (${claim}): the man page and the shipping build disagree, and no test here pins it`,
      );
    }
  });

  test('README documents no kill switch that does not work (B3)', () => {
    // `ADMIN_DASHBOARD_DISABLED=1 systemctl --user start ...` sets the var for
    // the systemctl CLIENT, not the manager's service environment: the service
    // never sees it and starts normally (probed on a real --user unit — the
    // documented form reported UNSET, `set-environment` reported 1). The claim
    // is deleted rather than reworded; this pins it out.
    assert.ok(
      !/ADMIN_DASHBOARD_DISABLED=\S*\s+systemctl/.test(readme),
      'README documents `ADMIN_DASHBOARD_DISABLED=1 systemctl ... start`, which does not reach the service — use `systemctl --user stop`',
    );
  });

  test('README counts the ExecStartPre-checked paths correctly (B5)', () => {
    // The README said FOUR paths are asserted by ExecStartPre and included the
    // checkout. The checkout is enforced earlier and differently — systemd
    // applies WorkingDirectory and fails 200/CHDIR before any Exec* line runs
    // (verified on a real unit: no ExecStartPre output at all). Three paths are
    // ExecStartPre-checked: node, backend output, frontend bundle.
    assert.ok(
      !/Four of those are asserted/.test(readme),
      'README miscounts the ExecStartPre-checked paths (the checkout is a WorkingDirectory failure, not an ExecStartPre one)',
    );
    const pathGuards = EXEC_START_PRE.filter((l) => !l.includes('ss -tln'));
    assert.equal(
      pathGuards.length,
      3,
      'expected exactly three path-checking ExecStartPre guards (node, backend output, frontend bundle); update the README count if this changes',
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
