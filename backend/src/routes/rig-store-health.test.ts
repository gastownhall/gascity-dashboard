import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecResult } from '../exec.js';
import {
  createRigStoreHealthSampler,
  issueCountFromChecks,
  parseDoctorChecks,
  probeRigStore,
  resolveBeadsPath,
  rollupFor,
  storeProblems,
  type RigStoreProbeDeps,
  type SamplerRuntime,
  type SamplerTimer,
  type SupervisorRigDescriptor,
} from './rig-store-health.js';

function execOk(stdout: string): ExecResult {
  return { exitCode: 0, stdout, stderr: '', truncated: false, durationMs: 1 };
}

const HEALTHY_DOCTOR = JSON.stringify({
  checks: [
    { category: 'Core System', name: 'Installation', status: 'ok', message: '.beads/ found' },
    { category: 'Core System', name: 'Dolt Connection', status: 'ok', message: 'Connected' },
    { category: 'Data & Config', name: 'Dolt Issue Count', status: 'ok', message: '129 issues' },
    { category: 'Git Integration', name: 'Git Hooks', status: 'warning', message: 'no hooks' },
    {
      category: 'Integrations',
      name: 'Claude Plugin',
      status: 'warning',
      message: 'not installed',
    },
  ],
});

describe('parseDoctorChecks', () => {
  test('parses well-formed doctor JSON', () => {
    const checks = parseDoctorChecks(HEALTHY_DOCTOR);
    assert.ok(checks);
    assert.equal(checks.length, 5);
    assert.equal(checks[0].name, 'Installation');
    assert.equal(checks[0].status, 'ok');
  });

  test('returns null on the embedded-mode fallback (non-JSON)', () => {
    assert.equal(
      parseDoctorChecks("Note: 'bd doctor' is not yet supported in embedded mode."),
      null,
    );
  });

  test('returns null on empty output', () => {
    assert.equal(parseDoctorChecks('   '), null);
  });

  test('normalizes failure statuses to error and unknown to warning', () => {
    const checks = parseDoctorChecks(
      JSON.stringify({
        checks: [
          { category: 'X', name: 'A', status: 'fail', message: '' },
          { category: 'X', name: 'B', status: 'mystery', message: '' },
        ],
      }),
    );
    assert.ok(checks);
    assert.equal(checks[0].status, 'error');
    assert.equal(checks[1].status, 'warning');
  });
});

describe('storeProblems', () => {
  test('drops ok checks and benign hygiene categories', () => {
    const checks = parseDoctorChecks(HEALTHY_DOCTOR);
    assert.ok(checks);
    // The two warnings are Git Integration + Integrations — both benign.
    assert.deepEqual(storeProblems(checks), []);
  });

  test('keeps non-ok store/dolt checks', () => {
    const checks = parseDoctorChecks(
      JSON.stringify({
        checks: [
          { category: 'Core System', name: 'Dolt Schema', status: 'error', message: 'drift' },
          { category: 'Git Integration', name: 'Git Hooks', status: 'warning', message: 'x' },
        ],
      }),
    );
    assert.ok(checks);
    const problems = storeProblems(checks);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, 'Dolt Schema');
  });
});

describe('issueCountFromChecks', () => {
  test('extracts the row count from the Issue Count check', () => {
    const checks = parseDoctorChecks(HEALTHY_DOCTOR);
    assert.ok(checks);
    assert.equal(issueCountFromChecks(checks), 129);
  });

  test('parses thousands separators', () => {
    const checks = parseDoctorChecks(
      JSON.stringify({
        checks: [
          { category: 'X', name: 'Dolt Issue Count', status: 'ok', message: '1,204 issues' },
        ],
      }),
    );
    assert.ok(checks);
    assert.equal(issueCountFromChecks(checks), 1204);
  });

  test('returns null when absent', () => {
    assert.equal(issueCountFromChecks([]), null);
  });
});

describe('rollupFor', () => {
  test('down when unreachable', () => {
    assert.equal(
      rollupFor({ reachable: false, doltConnected: null, problems: [], incomplete: false }),
      'down',
    );
  });

  test('down when the dolt server is not connected', () => {
    assert.equal(
      rollupFor({ reachable: true, doltConnected: false, problems: [], incomplete: false }),
      'down',
    );
  });

  test('down on an error-tier problem even if the server is up', () => {
    assert.equal(
      rollupFor({
        reachable: true,
        doltConnected: true,
        problems: [{ category: 'Core System', name: 'Dolt Schema', status: 'error', message: '' }],
        incomplete: false,
      }),
      'down',
    );
  });

  test('warn on a warning-tier problem', () => {
    assert.equal(
      rollupFor({
        reachable: true,
        doltConnected: true,
        problems: [{ category: 'Core System', name: 'Sync', status: 'warning', message: '' }],
        incomplete: false,
      }),
      'warn',
    );
  });

  test('warn when the probe is incomplete', () => {
    assert.equal(
      rollupFor({ reachable: true, doltConnected: true, problems: [], incomplete: true }),
      'warn',
    );
  });

  test('ok when healthy and complete', () => {
    assert.equal(
      rollupFor({ reachable: true, doltConnected: true, problems: [], incomplete: false }),
      'ok',
    );
  });
});

function depsFor(overrides: Partial<RigStoreProbeDeps> = {}): RigStoreProbeDeps {
  return {
    statBeads: async () => true,
    readPort: async () => 29620,
    tcpProbe: async () => true,
    runDoctor: async () => execOk(HEALTHY_DOCTOR),
    ...overrides,
  };
}

const RIG: SupervisorRigDescriptor = { name: 'codeprobe', path: '/home/ds/projects/codeprobe' };

describe('resolveBeadsPath', () => {
  test('appends .beads to a rig root', () => {
    assert.equal(
      resolveBeadsPath('/home/ds/projects/codeprobe'),
      '/home/ds/projects/codeprobe/.beads',
    );
  });

  test('accepts a path that already points at the store', () => {
    assert.equal(
      resolveBeadsPath('/home/ds/projects/codeprobe/.beads'),
      '/home/ds/projects/codeprobe/.beads',
    );
  });

  test('strips a trailing separator on a direct-store path (no permanent downgrade)', () => {
    assert.equal(
      resolveBeadsPath('/home/ds/projects/codeprobe/.beads/'),
      '/home/ds/projects/codeprobe/.beads',
    );
  });

  test('strips a trailing separator on a rig root before appending', () => {
    assert.equal(
      resolveBeadsPath('/home/ds/projects/codeprobe/'),
      '/home/ds/projects/codeprobe/.beads',
    );
  });
});

describe('probeRigStore', () => {
  test('healthy server-mode store rolls up ok with endpoint + issue count', async () => {
    const health = await probeRigStore(RIG, depsFor());
    assert.equal(health.rig, 'codeprobe');
    assert.equal(health.beadsPath, '/home/ds/projects/codeprobe/.beads');
    assert.equal(health.reachable, true);
    assert.equal(health.rollup, 'ok');
    assert.equal(health.doltEndpoint, '127.0.0.1:29620');
    assert.equal(health.doltConnected, true);
    assert.equal(health.issueCount, 129);
    assert.deepEqual(health.problems, []);
  });

  test('accepts a rig path that already points at the bead store', async () => {
    const health = await probeRigStore(
      { name: 'codeprobe', path: '/home/ds/projects/codeprobe/.beads' },
      depsFor({
        statBeads: async (beadsPath) => {
          assert.equal(beadsPath, '/home/ds/projects/codeprobe/.beads');
          return true;
        },
      }),
    );
    assert.equal(health.beadsPath, '/home/ds/projects/codeprobe/.beads');
  });

  test('missing .beads is down + unreachable without probing further', async () => {
    let doctorCalled = false;
    const health = await probeRigStore(
      RIG,
      depsFor({
        statBeads: async () => false,
        runDoctor: async () => {
          doctorCalled = true;
          return execOk(HEALTHY_DOCTOR);
        },
      }),
    );
    assert.equal(health.reachable, false);
    assert.equal(health.rollup, 'down');
    assert.equal(doctorCalled, false);
  });

  test('dolt server down (TCP refused) rolls up down regardless of doctor', async () => {
    const health = await probeRigStore(RIG, depsFor({ tcpProbe: async () => false }));
    assert.equal(health.doltConnected, false);
    assert.equal(health.rollup, 'down');
  });

  test('embedded-mode doctor fallback is warn + noted, not a crash', async () => {
    const health = await probeRigStore(
      RIG,
      depsFor({
        readPort: async () => null,
        runDoctor: async () => execOk('Note: not supported in embedded mode.'),
      }),
    );
    assert.equal(health.doltEndpoint, null);
    assert.equal(health.doltConnected, null);
    assert.equal(health.rollup, 'warn');
    assert.ok(health.note);
  });

  test('never throws when a dep rejects (degrades to down)', async () => {
    const health = await probeRigStore(
      RIG,
      depsFor({
        runDoctor: async () => {
          throw new Error('spawn failed');
        },
      }),
    );
    // doctor failure is noted; server still probed up via TCP, so not down on
    // connection — but incomplete makes it warn.
    assert.equal(health.rollup, 'warn');
    assert.ok(health.note?.includes('spawn failed'));
  });
});

const manualRuntime = (): SamplerRuntime & { fire(): void } => {
  let cb: (() => void) | null = null;
  return {
    setInterval(callback: () => void): SamplerTimer {
      cb = callback;
      return { unref() {} };
    },
    clearInterval() {
      cb = null;
    },
    fire() {
      cb?.();
    },
  };
};

describe('createRigStoreHealthSampler', () => {
  test('reports not_sampled_yet before the first sample', () => {
    const sampler = createRigStoreHealthSampler({ listRigs: async () => [] });
    const report = sampler.report();
    assert.equal(report.available, false);
    assert.deepEqual(report.rigs, []);
  });

  test('samples all rigs and reports available', async () => {
    const sampler = createRigStoreHealthSampler({
      listRigs: async () => [RIG, { name: 'geo', path: '/home/ds/projects/GEO' }],
      probe: async (rig) => ({
        rig: rig.name,
        beadsPath: `${rig.path}/.beads`,
        rollup: 'ok',
        reachable: true,
        doltEndpoint: '127.0.0.1:29620',
        doltConnected: true,
        issueCount: 1,
        problems: [],
      }),
      now: () => '2026-06-06T00:00:00.000Z',
    });
    await sampler.sampleOnce();
    const report = sampler.report();
    assert.equal(report.available, true);
    assert.equal(report.rigs.length, 2);
    if (report.available) assert.equal(report.sampledAt, '2026-06-06T00:00:00.000Z');
  });

  test('samples a rig that already reports the bead-store path', async () => {
    const sampler = createRigStoreHealthSampler({
      listRigs: async () => [{ name: 'codeprobe', path: '/home/ds/projects/codeprobe/.beads' }],
      probe: async (rig) => ({
        rig: rig.name,
        beadsPath: rig.path,
        rollup: 'ok',
        reachable: true,
        doltEndpoint: '127.0.0.1:29620',
        doltConnected: true,
        issueCount: 1,
        problems: [],
      }),
      now: () => '2026-06-06T00:00:00.000Z',
    });
    await sampler.sampleOnce();
    const report = sampler.report();
    assert.equal(report.available, true);
    if (report.available) {
      assert.equal(report.rigs[0]?.beadsPath, '/home/ds/projects/codeprobe/.beads');
    }
  });

  test('safeProbe error-path resolves the store path for a direct-store rig (no .beads/.beads)', async () => {
    const sampler = createRigStoreHealthSampler({
      listRigs: async () => [{ name: 'codeprobe', path: '/home/ds/projects/codeprobe/.beads' }],
      probe: async () => {
        throw new Error('injected dep blew up');
      },
      now: () => '2026-06-06T00:00:00.000Z',
    });
    await sampler.sampleOnce();
    const report = sampler.report();
    assert.equal(report.available, true);
    const rig = report.rigs[0];
    assert.equal(rig?.beadsPath, '/home/ds/projects/codeprobe/.beads');
    assert.equal(rig?.rollup, 'down');
    assert.equal(rig?.reachable, false);
    assert.match(rig?.note ?? '', /probe failed: injected dep blew up/);
  });

  test('rig_list failure keeps the prior snapshot but flips available=false', async () => {
    let fail = false;
    const sampler = createRigStoreHealthSampler({
      listRigs: async () => {
        if (fail) throw new Error('supervisor down');
        return [RIG];
      },
      probe: async (rig) => ({
        rig: rig.name,
        beadsPath: `${rig.path}/.beads`,
        rollup: 'ok',
        reachable: true,
        doltEndpoint: null,
        doltConnected: true,
        issueCount: 0,
        problems: [],
      }),
    });
    await sampler.sampleOnce();
    fail = true;
    await sampler.sampleOnce();
    const report = sampler.report();
    assert.equal(report.available, false);
    assert.equal(report.rigs.length, 1); // prior snapshot retained
    if (!report.available) assert.equal(report.reason, 'rig_list_failed');
  });

  test('start triggers an immediate sample and schedules the interval', () => {
    const runtime = manualRuntime();
    let calls = 0;
    const sampler = createRigStoreHealthSampler({
      listRigs: async () => {
        calls += 1;
        return [];
      },
      runtime,
    });
    sampler.start();
    assert.equal(sampler.running, true);
    runtime.fire();
    sampler.stop();
    assert.equal(sampler.running, false);
    assert.ok(calls >= 1);
  });
});
