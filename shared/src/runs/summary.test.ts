import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunHistory,
  buildRunSummary,
  emptyRunSummary,
  runLane,
  statusCounts,
  MAX_HISTORICAL_LANES,
  MAX_VISIBLE_ACTIVE_LANES,
} from './summary.js';
import type { RunFeedScope } from './summary.js';
import type { RunIssue } from './phaseMapping.js';

// Active-classification regression coverage (gascity-dashboard-4xcv §2).
// Operator repro gc-1920: a long-stale formula latch with status=blocked
// (city-level, no live session) was counted and shown in the ACTIVE lane.
// A blocked run still needs operator attention, but it is not progressing:
// it belongs in its own blocked bucket, never in the Active set or count.

function latch(overrides: Partial<RunIssue> = {}): RunIssue {
  // Shape mirrors a real mol-focus-review latch root (gc-1920-class bead):
  // a single graph.v2 root task with no step children.
  return {
    id: 'gc-1920',
    title: 'mol-focus-review',
    description: 'Focus + in-session review formula. Approval gate, review.',
    status: 'blocked',
    issue_type: 'task',
    updated_at: '2026-04-01T00:00:00Z',
    metadata: {
      'gc.formula_contract': 'graph.v2',
      'gc.kind': 'workflow',
    },
    ...overrides,
  };
}

function activeRun(id: string): RunIssue[] {
  return [
    latch({
      id,
      title: 'Adopt PR #42',
      description: 'implementation work',
      status: 'open',
      updated_at: '2026-06-01T00:00:00Z',
      metadata: { 'gc.formula_contract': 'graph.v2', 'gc.kind': 'run' },
    }),
    {
      id: `${id}-step-1`,
      title: 'Implementation patch',
      status: 'in_progress',
      issue_type: 'task',
      updated_at: '2026-06-01T00:05:00Z',
      metadata: {
        'gc.kind': 'step',
        'gc.root_bead_id': id,
        'gc.step_id': 'implementation.patch',
      },
    },
  ];
}

function completedRun(id: string): RunIssue[] {
  return [
    latch({
      id,
      title: 'Done run',
      description: 'merge finalize',
      status: 'closed',
      updated_at: '2026-05-01T00:00:00Z',
      metadata: { 'gc.formula_contract': 'graph.v2', 'gc.kind': 'run' },
    }),
  ];
}

describe('buildRunSummary — blocked lanes are not Active (gascity-dashboard-4xcv)', () => {
  test('a blocked formula latch lands in blockedLanes, not lanes or totalActive', () => {
    const summary = buildRunSummary([latch(), ...activeRun('run-1')]);

    assert.equal(summary.totalActive, 1);
    assert.deepEqual(
      summary.lanes.map((lane) => lane.id),
      ['run-1'],
    );
    assert.deepEqual(
      summary.blockedLanes.map((lane) => lane.id),
      ['gc-1920'],
    );
    assert.equal(summary.runCounts.total, 1);
    assert.equal(summary.runCounts.blocked, 1);
  });

  test('completed lanes are dropped from the summary, blocked lanes stay (header-first)', () => {
    // Header-first restructure: the summary carries the live (active + blocked)
    // sets only; completed runs are the lazy history read's payload
    // (buildRunHistory), so the default refresh never pays the closed-history
    // fan-out for lanes hidden behind ?history=1.
    const summary = buildRunSummary([latch(), ...completedRun('run-done')]);

    assert.equal(summary.totalActive, 0);
    assert.deepEqual(summary.lanes, []);
    assert.deepEqual(
      summary.blockedLanes.map((lane) => lane.id),
      ['gc-1920'],
    );
  });

  test('with no blocked lanes, blockedLanes is empty and blocked count is zero', () => {
    const summary = buildRunSummary(activeRun('run-1'));

    assert.deepEqual(summary.blockedLanes, []);
    assert.equal(summary.runCounts.blocked, 0);
  });

  test('emptyRunSummary carries an empty blockedLanes array', () => {
    assert.deepEqual(emptyRunSummary().blockedLanes, []);
  });
});

// gascity-dashboard-s4rp: a run rooted at a bead missing from the store
// (dangling root, gc-1920-class — id ~1920 vs a current store at ~346k) has no
// authoritative root metadata. Its only members are orphan step beads pointing
// at the absent root, so it must never be surfaced as a live lane.
describe('buildRunSummary — dangling-root groups are not surfaced (gascity-dashboard-s4rp)', () => {
  function orphanStep(rootId: string): RunIssue {
    return {
      id: `${rootId}-step-1`,
      title: 'Implementation patch',
      status: 'in_progress',
      issue_type: 'task',
      updated_at: '2026-06-01T00:05:00Z',
      metadata: {
        'gc.kind': 'step',
        'gc.formula_contract': 'graph.v2',
        'gc.root_bead_id': rootId,
        'gc.step_id': 'implementation.patch',
      },
    };
  }

  test('a group whose root bead is absent does not appear anywhere', () => {
    const summary = buildRunSummary([orphanStep('gc-1920'), ...activeRun('run-1')]);

    assert.equal(summary.totalActive, 1);
    assert.deepEqual(
      summary.lanes.map((lane) => lane.id),
      ['run-1'],
    );
    assert.deepEqual(summary.blockedLanes, []);
    assert.equal(summary.runCounts.total, 1);
  });

  // gascity-dashboard-2j8e.2: the Runs badge counts selectBlockedRuns over
  // blockedLanes, so a dangling-root group whose orphan step is BLOCKED must
  // not reach blockedLanes — else the phantom inflates the badge. Pins the
  // #87/#89 intent (suppress phantom roots with no backing bead) for the
  // badge's source, not just the Active set.
  function blockedOrphanStep(rootId: string): RunIssue {
    return {
      id: `${rootId}-step-1`,
      title: 'Blocked patch',
      status: 'blocked',
      issue_type: 'task',
      updated_at: '2026-06-01T00:05:00Z',
      metadata: {
        'gc.kind': 'step',
        'gc.formula_contract': 'graph.v2',
        'gc.root_bead_id': rootId,
        'gc.step_id': 'implementation.patch',
      },
    };
  }

  test('a dangling-root group with a blocked step never reaches blockedLanes', () => {
    const summary = buildRunSummary([blockedOrphanStep('gc-1920'), ...activeRun('run-1')]);

    assert.deepEqual(summary.blockedLanes, []);
    assert.equal(summary.runCounts.blocked, 0);
  });
});

// gascity-dashboard-5e5v: supervisor-controlled rig/scope refs are rendered
// verbatim by run-summary consumers (the web frontend, and any terminal client
// that emits DTO strings into the operator's terminal — Ink tokenises ANSI but
// does not strip escape/OSC). A hostile or malformed `gc.root_store_ref` or a
// feed-scope ref carrying ANSI/OSC/bidi must be stripped at the DTO edge.

function runIssue(overrides: Partial<RunIssue> & Pick<RunIssue, 'id'>): RunIssue {
  return {
    title: 'run',
    status: 'in_progress',
    issue_type: 'task',
    updated_at: '2026-06-06T00:00:00.000Z',
    ...overrides,
  };
}

// gascity-dashboard-9w3k: v1 / wisp (non-graph.v2) runs are surfaced as lanes
// using the same lane/stage primitives as graph.v2. The drop used to be at the
// graph.v2-only keep-filter, which silently swallowed the entire v1 history.
// These tests pin (a) a genuine v1 wisp run becomes exactly one lane, (b) a
// lone engineering bead is NOT promoted into a lane (flood guard), and that
// graph.v2 lanes are unchanged.
describe('buildRunSummary — v1 / wisp runs surface as lanes (gascity-dashboard-9w3k)', () => {
  // A real wisp run: a `molecule` root carrying gc.var.* template inputs but no
  // gc.formula_contract, plus a child `task` whose metadata.molecule_id points
  // back at the root. runRootId groups the child under the molecule root.
  function wispRun(id: string): RunIssue[] {
    return [
      runIssue({
        id,
        title: 'mol-do-work',
        status: 'open',
        issue_type: 'molecule',
        updated_at: '2026-06-02T00:00:00Z',
        metadata: { 'gc.var.target': 'demo-app', 'gc.var.prompt': 'fix the thing' },
      }),
      runIssue({
        id: `${id}-child-1`,
        title: 'Implementation work',
        updated_at: '2026-06-02T00:05:00Z',
        metadata: { molecule_id: id, 'gc.step_id': 'do-work' },
      }),
    ];
  }

  test('a v1 wisp molecule run emits exactly one lane with a phase', () => {
    const summary = buildRunSummary(wispRun('wisp-1'));

    assert.deepEqual(
      summary.lanes.map((lane) => lane.id),
      ['wisp-1'],
    );
    assert.equal(summary.totalActive, 1);
    const lane = summary.lanes[0];
    assert.ok(lane !== undefined);
    assert.equal(lane.id, 'wisp-1');
    // mapRunPhase is generic: 'work'/'implementation' text yields a real phase.
    assert.equal(lane.phase, 'implementation');
    // No graph.v2 formula metadata, so the formula resolves to unavailable but
    // the generic run stages still render.
    assert.equal(lane.formula.status, 'unavailable');
    assert.ok(lane.stages.length > 0);
  });

  test('graph.v2 lanes still render unchanged (regression)', () => {
    const summary = buildRunSummary(activeRun('run-1'));

    assert.deepEqual(
      summary.lanes.map((lane) => lane.id),
      ['run-1'],
    );
    assert.equal(summary.totalActive, 1);
  });

  // gascity-dashboard-9w3k: a wisp run's gc.var.* free-text template inputs must
  // NOT drive phase classification. Here gc.var.prompt contains 'review',
  // 'blocked', and 'merge' — phase needles that would mis-bucket the run as
  // blocked/approval/finalization — but the run's actual work (a 'do-work' step)
  // keeps it in implementation/active.
  test('gc.var.* free-text does not mis-classify a wisp run as blocked/approval', () => {
    const summary = buildRunSummary([
      runIssue({
        id: 'wisp-var',
        title: 'mol-do-work',
        status: 'open',
        issue_type: 'molecule',
        updated_at: '2026-06-02T00:00:00Z',
        metadata: {
          'gc.var.prompt': 'review the blocked PR and merge it after approval, then finalize',
        },
      }),
      runIssue({
        id: 'wisp-var-child-1',
        title: 'Do the work',
        updated_at: '2026-06-02T00:05:00Z',
        metadata: { molecule_id: 'wisp-var', 'gc.step_id': 'do-work' },
      }),
    ]);

    const lane = summary.lanes[0];
    assert.ok(lane !== undefined);
    assert.equal(lane.id, 'wisp-var');
    assert.notEqual(lane.phase, 'blocked');
    assert.notEqual(lane.phase, 'approval');
    assert.equal(summary.blockedLanes.length, 0);
    // The 'do-work' step keeps it in the implementation register.
    assert.equal(lane.phase, 'implementation');
  });

  // Flood guard: a lone task/bug/feature bead (root = itself, no molecule /
  // gc.kind=run / gc.formula) must NOT become a run lane — otherwise every
  // engineering bead in the store would render as a phantom run.
  test('a lone engineering bead does not become a lane', () => {
    const loneTask: RunIssue = {
      id: 'task-99',
      title: 'Fix a typo',
      status: 'open',
      issue_type: 'task',
      updated_at: '2026-06-02T00:00:00Z',
    };
    const summary = buildRunSummary([loneTask]);

    assert.deepEqual(summary.lanes, []);
    assert.deepEqual(summary.blockedLanes, []);
    assert.equal(summary.totalActive, 0);
  });
});

// gascity-dashboard: the builder carries the FULL active set on the wire — the
// rendered 8-lane collapse is applied by the consumer (RunMap), mirroring the
// historical section. The builder must NOT pre-cap `lanes`.
describe('buildRunSummary — active lanes carry the full set (component-collapsed)', () => {
  test('lanes carries every active run when there are more than MAX_VISIBLE_ACTIVE_LANES', () => {
    const count = MAX_VISIBLE_ACTIVE_LANES + 3;
    const issues = Array.from({ length: count }, (_, i) => activeRun(`run-${i}`)).flat();
    const summary = buildRunSummary(issues);

    assert.equal(summary.totalActive, count);
    assert.equal(summary.lanes.length, count);
    assert.equal(summary.runCounts.total, count);
    assert.equal(summary.runCounts.visible, count);
  });
});

// Header-first restructure: completed runs are the lazy history read's payload.
// buildRunHistory derives ONLY the completed lanes from the (expensive) closed-
// history fan-out, keeping the 9w3k recency cap and true-total semantics.
describe('buildRunHistory — completed lanes only, recency-bounded (gascity-dashboard-9w3k)', () => {
  test('a completed run lands in history; active and blocked runs do not', () => {
    const history = buildRunHistory([latch(), ...activeRun('run-1'), ...completedRun('run-done')]);

    assert.equal(history.totalHistorical, 1);
    assert.deepEqual(
      history.lanes.map((lane) => lane.id),
      ['run-done'],
    );
    assert.equal(history.lanesPartial, undefined);
  });

  test('marks the history partial when the fan-out was degraded', () => {
    const history = buildRunHistory(completedRun('run-done'), new Map(), true);

    assert.equal(history.lanesPartial, true);
  });

  test('a dangling-root group and a lone engineering bead never become history lanes', () => {
    const orphan: RunIssue = {
      id: 'gc-1920-step-1',
      title: 'Implementation patch',
      status: 'closed',
      issue_type: 'task',
      updated_at: '2026-06-01T00:05:00Z',
      metadata: {
        'gc.kind': 'step',
        'gc.formula_contract': 'graph.v2',
        'gc.root_bead_id': 'gc-1920',
        'gc.step_id': 'implementation.patch',
      },
    };
    const loneTask: RunIssue = {
      id: 'task-99',
      title: 'Fix a typo',
      status: 'closed',
      issue_type: 'task',
      updated_at: '2026-06-02T00:00:00Z',
    };

    const history = buildRunHistory([orphan, loneTask]);

    assert.deepEqual(history.lanes, []);
    assert.equal(history.totalHistorical, 0);
  });

  test('caps lanes at MAX_HISTORICAL_LANES, keeps the most-recent ones, reports true total', () => {
    const total = MAX_HISTORICAL_LANES + 10;
    const issues: RunIssue[] = [];
    // Distinct, monotonically increasing updated_at so newest-first order is
    // unambiguous. id-N has updated_at = base + N minutes; higher N = newer.
    // A closed molecule root is a complete v1 run (one lane each).
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (let n = 0; n < total; n += 1) {
      const at = new Date(base + n * 60_000).toISOString();
      issues.push(
        runIssue({
          id: `hist-${String(n).padStart(3, '0')}`,
          issue_type: 'molecule',
          status: 'closed',
          updated_at: at,
        }),
      );
    }

    const history = buildRunHistory(issues);

    assert.equal(history.lanes.length, MAX_HISTORICAL_LANES);
    assert.equal(history.totalHistorical, total);

    // The retained lanes must be the newest N (highest n), newest first.
    const expected = Array.from({ length: MAX_HISTORICAL_LANES }, (_, i) => {
      const n = total - 1 - i;
      return `hist-${String(n).padStart(3, '0')}`;
    });
    assert.deepEqual(
      history.lanes.map((lane) => lane.id),
      expected,
    );
  });
});

// gascity-dashboard-km0w: live run-root beads carry gc.root_store_ref
// ("rig:gascity-packs") plus gc.var.rig_name, but NOT gc.scope_kind /
// gc.scope_ref. Before this fix the scope derived to unavailable for EVERY
// run, so runDetailHref omitted the scope query and the detail fetch hit the
// supervisor at the default city scope (12-14s full-store scan then 404).
// The scope must be recovered from gc.root_store_ref when the explicit
// gc.scope_ref pair is absent, while gc.scope_ref stays primary when present.
describe('runLane scope derives from gc.root_store_ref fallback — gascity-dashboard-km0w', () => {
  function rootOnly(id: string, metadata: Record<string, string>): RunIssue[] {
    return [
      runIssue({
        id,
        title: 'mol-focus-review',
        issue_type: 'molecule',
        metadata,
      }),
    ];
  }

  test('derives rig scope from gc.root_store_ref when gc.scope_ref is absent', () => {
    const lane = runLane(
      'gpk-4fyo6',
      rootOnly('gpk-4fyo6', { 'gc.root_store_ref': 'rig:gascity-packs' }),
      new Map(),
    );

    assert.equal(lane.scope.status, 'available');
    if (lane.scope.status !== 'available') return;
    assert.equal(lane.scope.kind, 'rig');
    assert.equal(lane.scope.ref, 'gascity-packs');
    assert.equal(lane.scope.rootStoreRef, 'rig:gascity-packs');
  });

  test('derives city scope from a city: gc.root_store_ref', () => {
    const lane = runLane(
      'city-run',
      rootOnly('city-run', { 'gc.root_store_ref': 'city:ds-research' }),
      new Map(),
    );

    assert.equal(lane.scope.status, 'available');
    if (lane.scope.status !== 'available') return;
    assert.equal(lane.scope.kind, 'city');
    assert.equal(lane.scope.ref, 'ds-research');
  });

  test('explicit gc.scope_ref still wins over gc.root_store_ref', () => {
    const lane = runLane(
      'mixed',
      rootOnly('mixed', {
        'gc.scope_kind': 'rig',
        'gc.scope_ref': 'gascity-dashboard',
        'gc.root_store_ref': 'rig:gascity-packs',
      }),
      new Map(),
    );

    assert.equal(lane.scope.status, 'available');
    if (lane.scope.status !== 'available') return;
    assert.equal(lane.scope.kind, 'rig');
    assert.equal(lane.scope.ref, 'gascity-dashboard');
    // rootStoreRef is still carried through verbatim.
    assert.equal(lane.scope.rootStoreRef, 'rig:gascity-packs');
  });

  test('an unknown-prefix gc.root_store_ref is not guessed — scope unavailable', () => {
    const lane = runLane(
      'bad-prefix',
      rootOnly('bad-prefix', { 'gc.root_store_ref': 'workspace:ds-research' }),
      new Map(),
    );

    assert.equal(lane.scope.status, 'unavailable');
  });

  test('a colon-less gc.root_store_ref is not guessed — scope unavailable', () => {
    const lane = runLane(
      'no-colon',
      rootOnly('no-colon', { 'gc.root_store_ref': 'gascity-packs' }),
      new Map(),
    );

    assert.equal(lane.scope.status, 'unavailable');
  });

  test('a malformed parsed ref (fails SCOPE_REF_RE) is rejected — scope unavailable', () => {
    const lane = runLane(
      'malformed',
      // leading '-' violates SCOPE_REF_RE (must start alnum).
      rootOnly('malformed', { 'gc.root_store_ref': 'rig:-bad ref' }),
      new Map(),
    );

    assert.equal(lane.scope.status, 'unavailable');
  });

  test('a control sequence in the derived ref fails SCOPE_REF_RE — scope unavailable', () => {
    // The fallback validates the parsed ref against SCOPE_REF_RE BEFORE the DTO
    // edge, so an injected ESC byte (which the pattern rejects) yields
    // unavailable rather than a sanitised-but-spoofed ref.
    const lane = runLane(
      'sanitise',
      rootOnly('sanitise', { 'gc.root_store_ref': 'rig:gascity-packs\x1b[31m' }),
      new Map(),
    );

    assert.equal(lane.scope.status, 'unavailable');
  });
});

describe('runLane scope sanitisation — gascity-dashboard-5e5v', () => {
  test('strips ANSI/OSC from rootStoreRef on the metadata path', () => {
    const lane = runLane(
      'root-1',
      [
        runIssue({
          id: 'root-1',
          metadata: {
            'gc.scope_kind': 'rig',
            'gc.scope_ref': 'demo-app',
            'gc.root_store_ref': 'rig:demo-app\x1b]0;evil-title\x07\x1b[31m',
          },
        }),
      ],
      new Map(),
    );

    assert.equal(lane.scope.status, 'available');
    if (lane.scope.status !== 'available') return;
    assert.equal(lane.scope.rootStoreRef, 'rig:demo-app');
    assert.ok(!lane.scope.rootStoreRef.includes('\x1b'), 'no ESC byte may survive');
    assert.equal(lane.scope.ref, 'demo-app');
  });

  test('strips ANSI/bidi from both ref and rootStoreRef on the feed-scope path', () => {
    const feedScope: RunFeedScope = {
      scopeKind: 'rig',
      scopeRef: 'demo\x1b[1m‮app',
      rootStoreRef: 'rig:demo\x1b[1mapp',
    };
    const lane = runLane('root-2', [runIssue({ id: 'root-2' })], new Map([['root-2', feedScope]]));

    assert.equal(lane.scope.status, 'available');
    if (lane.scope.status !== 'available') return;
    assert.equal(lane.scope.ref, 'demoapp');
    assert.equal(lane.scope.rootStoreRef, 'rig:demoapp');
    assert.ok(!lane.scope.ref.includes('\x1b'), 'no ESC byte may survive in ref');
    assert.ok(!lane.scope.rootStoreRef.includes('\x1b'), 'no ESC byte may survive in rootStoreRef');
  });
});

// M2 audit propagation: the lane's active-step filter must accept the full
// in-flight status vocabulary (in_progress/active/running), exactly like
// structuredPhase. With a raw 'in_progress'-only filter, a supervisor wire
// 'active' primary step left activeStepId null and degraded progress to
// stage_only ('active run step unavailable') while the stage ladder showed an
// active stage.
describe('runLane — wire in-flight statuses resolve the active step (M2)', () => {
  function wireRun(stepStatus: string): RunIssue[] {
    return [
      runIssue({
        id: 'run-wire',
        title: 'Adopt PR #124',
        status: 'pending',
        updated_at: '',
        metadata: { 'gc.formula_contract': 'graph.v2', 'gc.kind': 'run' },
      }),
      runIssue({
        id: 'run-wire-step-1',
        title: 'Implementation patch',
        status: stepStatus,
        updated_at: '',
        metadata: {
          'gc.kind': 'step',
          'gc.root_bead_id': 'run-wire',
          'gc.step_id': 'implementation.patch',
        },
      }),
    ];
  }

  for (const status of ['active', 'running'] as const) {
    test(`a wire '${status}' primary step produces progress.status === 'active_step'`, () => {
      const lane = runLane('run-wire', wireRun(status), new Map());

      assert.equal(lane.phase, 'implementation');
      assert.equal(lane.progress.status, 'active_step');
      if (lane.progress.status !== 'active_step') return;
      assert.equal(lane.progress.stepId, 'implementation.patch');
    });
  }
});

// PR #124 review fix (attempt-2 blocker): runLane broadened the active-STEP
// filter to the supervisor wire in-flight vocabulary, but activeAssignees still
// filtered status !== 'closed'. So the assignee of a wire completed/done/failed/
// skipped step surfaced as an ACTIVE assignee on the lane — and that lane field
// feeds blockedRunRemedy (no-worker vs open-detail) and health session matching.
// activeAssignees must reuse the same resolved-status vocabulary the rest of the
// builder does.
describe('runLane — activeAssignees excludes resolved wire statuses (PR #124)', () => {
  function mixedRun(resolvedStatus: string): RunIssue[] {
    return [
      runIssue({
        id: 'run-mixed',
        title: 'Adopt PR #124',
        status: 'pending',
        updated_at: '',
        metadata: { 'gc.formula_contract': 'graph.v2', 'gc.kind': 'run' },
      }),
      runIssue({
        id: 'run-mixed-resolved',
        title: 'Implementation patch',
        status: resolvedStatus,
        assignee: 'app/resolved-worker',
        updated_at: '',
        metadata: {
          'gc.kind': 'step',
          'gc.root_bead_id': 'run-mixed',
          'gc.step_id': 'implement-change',
        },
      }),
      runIssue({
        id: 'run-mixed-active',
        title: 'Review',
        status: 'active',
        assignee: 'app/active-worker',
        updated_at: '',
        metadata: {
          'gc.kind': 'step',
          'gc.root_bead_id': 'run-mixed',
          'gc.step_id': 'review-pipeline.synthesize',
        },
      }),
    ];
  }

  // 'closed' already worked under the old filter — it is the regression guard
  // that the fix does not change well-formed ledger behavior. The wire spellings
  // are the ones the old `!== 'closed'` filter wrongly reported as active.
  for (const resolved of ['closed', 'completed', 'done', 'failed', 'skipped'] as const) {
    test(`a '${resolved}' assigned step is excluded; the active step's assignee remains`, () => {
      const lane = runLane('run-mixed', mixedRun(resolved), new Map());
      assert.deepEqual(lane.activeAssignees, ['app/active-worker']);
    });
  }
});

// PR #124 review fix: stageProgress maps an attempt-suffixed retry work bead
// (apply-fixes.attempt.1) to its base formula stage by stripping `.attempt.N`,
// but formulaStageResolved compared the raw suffixed progress.stepId against the
// base formula step ids, so a known retry step read as unresolved and downgraded
// the lane health phaseConfidence to 'inferred'. The resolution must normalize
// the step id the same way stage cohorting does.
describe('runLane — formulaStageResolved normalizes attempt-suffixed retry steps (PR #124)', () => {
  function retryRun(): RunIssue[] {
    return [
      runIssue({
        id: 'run-retry',
        title: 'Adopt PR #124',
        status: 'pending',
        updated_at: '',
        metadata: {
          'gc.formula_contract': 'graph.v2',
          'gc.kind': 'run',
          'gc.formula': 'mol-adopt-pr-v2',
        },
      }),
      runIssue({
        id: 'run-retry-apply-fixes',
        title: 'Apply review fixes',
        status: 'active',
        assignee: 'app/fixer',
        updated_at: '',
        metadata: {
          'gc.kind': 'work',
          'gc.root_bead_id': 'run-retry',
          'gc.step_id': 'apply-fixes.attempt.1',
        },
      }),
    ];
  }

  test('an active apply-fixes.attempt.1 step resolves to a known formula stage', () => {
    const lane = runLane('run-retry', retryRun(), new Map());
    assert.equal(lane.progress.status, 'active_step');
    if (lane.progress.status === 'active_step') {
      assert.equal(lane.progress.stepId, 'apply-fixes.attempt.1');
    }
    assert.equal(lane.formulaStageResolved, true);
  });
});

// PR #124 review fix (F2): statusCounts keys feed blocked-run consumers that
// look them up by canonical lowercase spelling (blocked.ts reads
// statusCounts['blocked']). The wire status is not enum-typed, so a cased or
// padded spelling must aggregate under the same canonical key it would render
// as, never silently fall into a raw key the consumer never reads.
describe('statusCounts — canonical key normalization (PR #124)', () => {
  test('cased and padded spellings collapse onto the canonical lowercase key', () => {
    const counts = statusCounts([
      runIssue({ id: 'a', status: 'blocked' }),
      runIssue({ id: 'b', status: 'Blocked' }),
      runIssue({ id: 'c', status: ' blocked ' }),
    ]);
    assert.equal(counts['blocked'], 3);
    assert.equal(counts['Blocked'], undefined);
  });
});

// gascity-dashboard-uxvk: the Runs view builds rows from rig-store molecule
// root beads, so an orphaned molecule (bead graph persisted, supervisor
// workflow registry has NO entry, zero step progress — the gc-odssky repro)
// rendered as a LIVE run with a stage and a relative time. The lane builder now
// carries an explicit registration fact derived from the last COMPLETE
// supervisor formula-feed observation, so the UI can render the stranded state
// instead of a live stage.
describe('buildRunSummary — orphaned molecules carry a stranded registration (gascity-dashboard-uxvk)', () => {
  const OBSERVED_AT_MS = Date.parse('2026-06-12T08:20:00.000Z');
  const DISPATCHED_AT = '2026-06-12T01:20:05.000Z';

  function orphanGroup(id: string): RunIssue[] {
    return [
      {
        id,
        title: 'mol-pr-start: gascity issue #3192',
        status: 'open',
        issue_type: 'molecule',
        updated_at: DISPATCHED_AT,
        metadata: { 'gc.formula_contract': 'graph.v2', 'gc.kind': 'run' },
      },
      {
        id: `${id}-s1`,
        title: 'read issue',
        status: 'open',
        issue_type: 'task',
        updated_at: DISPATCHED_AT,
        metadata: { 'gc.kind': 'step', 'gc.root_bead_id': id, 'gc.step_id': 'read-issue' },
      },
      {
        id: `${id}-s2`,
        title: 'plan implementation',
        status: 'open',
        issue_type: 'task',
        updated_at: DISPATCHED_AT,
        metadata: {
          'gc.kind': 'step',
          'gc.root_bead_id': id,
          'gc.step_id': 'plan-implementation',
        },
      },
    ];
  }

  function observation(rootIds: string[]) {
    return { rootIds: new Set(rootIds), observedAtMs: OBSERVED_AT_MS };
  }

  test('absent from a complete feed observation → registration stranded', () => {
    const summary = buildRunSummary(orphanGroup('gc-odssky'), new Map(), false, observation([]));
    // gascity-dashboard-pxvb: a stranded lane is partitioned out of Active into
    // its own bucket — it must NOT appear in `lanes` or count as live work.
    const lane = summary.strandedLanes.find((l) => l.id === 'gc-odssky');
    assert.ok(lane);
    assert.equal(lane.registration, 'stranded');
    assert.equal(
      summary.lanes.some((l) => l.id === 'gc-odssky'),
      false,
    );
    // The false-alive part of the repro: the orphan must never read as a
    // mid-run stage.
    assert.equal(lane.phase, 'intake');
    assert.notEqual(lane.phaseLabel.toLowerCase(), 'implementation');
  });

  // gascity-dashboard-pxvb: the orphan never executed, so it must stop counting
  // as live work in the Active set and surface in its own partition + count.
  test('stranded lane is excluded from Active and counted separately', () => {
    const summary = buildRunSummary(
      [...orphanGroup('gc-odssky'), ...activeRun('run-1')],
      new Map(),
      false,
      observation([]),
    );
    assert.equal(summary.totalActive, 1);
    assert.equal(summary.lanes.length, 1);
    assert.equal(summary.lanes[0]?.id, 'run-1');
    assert.equal(summary.strandedLanes.length, 1);
    assert.equal(summary.strandedLanes[0]?.id, 'gc-odssky');
    assert.equal(summary.runCounts.stranded, 1);
    assert.equal(summary.runCounts.total, 1);
  });

  test('present in the feed observation → registered', () => {
    const summary = buildRunSummary(
      orphanGroup('gc-known'),
      new Map(),
      false,
      observation(['gc-known']),
    );
    const lane = summary.lanes.find((l) => l.id === 'gc-known');
    assert.ok(lane);
    assert.equal(lane.registration, 'registered');
  });

  test('no feed observation → registration unknown, lane renders as before', () => {
    const summary = buildRunSummary(orphanGroup('gc-blind'));
    const lane = summary.lanes.find((l) => l.id === 'gc-blind');
    assert.ok(lane);
    assert.equal(lane.registration, 'unknown');
  });

  test('a progressed run absent from the observation is unknown, not stranded', () => {
    const group = orphanGroup('gc-aged');
    group[1] = { ...group[1]!, status: 'closed' };
    const summary = buildRunSummary(group, new Map(), false, observation([]));
    const lane = summary.lanes.find((l) => l.id === 'gc-aged');
    assert.ok(lane);
    assert.equal(lane.registration, 'unknown');
  });
});
