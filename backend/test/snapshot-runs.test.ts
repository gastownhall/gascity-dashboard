import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { GcBead } from 'gas-city-dashboard-shared';

import {
  buildRunSummary,
  createRunsSourceCache,
  fromGcBead,
  MAX_VISIBLE_ACTIVE_LANES,
  RECENT_RUN_FETCH_LIMIT,
  runBeadFilter,
} from '../src/snapshot/collectors/runs.js';
import type { RunIssue } from '../src/snapshot/collectors/phaseMapping.js';
import type { GcClient } from '../src/gc-client.js';

// mfb9.1: the cache's `gc` input is GcClient, but tests only need to
// stub a subset of the surface the collector actually calls
// (listBeads, listFormulaRuns, cityName). A bare `as never` cast
// suppressed ALL signature checking on the mock object and hid the
// mfb9 H1 finding. Picking the used methods (and Partial-ing so each
// test can omit ones its code path doesn't exercise) restores
// compile-time signature checking on every property a mock DOES set,
// while keeping the final widen-to-GcClient explicit at the call site.
type GcClientMock = Partial<Pick<GcClient, 'listBeads' | 'listFormulaRuns' | 'cityName'>>;

// mfb9.1.1: type the mock's listBeads second-arg via the real client's
// own parameter type so a future shape change to GcClient.listBeads breaks
// the mocks at compile time instead of silently widening to `unknown` (which
// `satisfies` accepts contravariantly). Drop the in-body `as { ... }` cast
// at every mock site — params is now narrowly typed at the boundary.
type ListBeadsParams = Parameters<GcClient['listBeads']>[1];

// Lane builder + filter + cache tests for the workflows collector
// (gascity-dashboard-0t6). Ported from demo-dash's workflows.test.ts
// where applicable; gascity-specific additions cover the filter rules
// (C1 in plan review) and the error pass-through contract (H5).

// 6bv7 F16: OpenAPI Bead exposes no updated_at — fixtures use created_at
// for time-based ordering instead.
const baseGcBead = {
  description: '',
  status: 'open',
  issue_type: 'task',
  priority: 2,
  created_at: '2026-05-10T19:00:00Z',
  metadata: {},
} satisfies Partial<GcBead>;

function gcBead(
  overrides: Partial<GcBead> & Pick<GcBead, 'id' | 'title'>,
): GcBead {
  return {
    ...baseGcBead,
    ...overrides,
    metadata: overrides.metadata ?? {},
  };
}

const baseIssue = {
  description: '',
  status: 'open',
  issue_type: 'task',
  updated_at: '2026-05-10T20:00:00Z',
  metadata: {},
} satisfies Partial<RunIssue>;

function issue(
  overrides: Partial<RunIssue> & Pick<RunIssue, 'id' | 'title'>,
): RunIssue {
  return {
    ...baseIssue,
    ...overrides,
    metadata: overrides.metadata ?? {},
    status: overrides.status ?? 'open',
    issue_type: overrides.issue_type ?? 'task',
    updated_at: overrides.updated_at ?? '2026-05-10T20:00:00Z',
  };
}

function graphRunMetadata(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    'gc.kind': 'run',
    'gc.formula_contract': 'graph.v2',
    ...overrides,
  };
}

// ── runBeadFilter ────────────────────────────────────────────────────

describe('runBeadFilter', () => {
  test('admits engineering issue types (feature, bug, task, docs)', () => {
    for (const t of ['feature', 'bug', 'task', 'docs']) {
      assert.equal(
        runBeadFilter(gcBead({ id: 'a', title: 't', issue_type: t })),
        true,
        `expected ${t} admitted`,
      );
    }
  });

  test('admits molecule beads (the lane roots — C1 fix)', () => {
    assert.equal(
      runBeadFilter(
        gcBead({ id: 'a', title: 'mol-adopt-pr-v2', issue_type: 'molecule' }),
      ),
      true,
    );
  });

  test('admits beads with metadata.gc.kind === "run" regardless of issue_type', () => {
    assert.equal(
      runBeadFilter(
        gcBead({
          id: 'a',
          title: 'workflow root',
          issue_type: 'convoy',
          metadata: { 'gc.kind': 'run' },
        }),
      ),
      true,
    );
  });

  test('excludes beads with labels starting "gc:" (session / message noise)', () => {
    assert.equal(
      runBeadFilter(
        gcBead({
          id: 'a',
          title: 'session',
          issue_type: 'task',
          labels: ['gc:session'],
        }),
      ),
      false,
    );
  });

  test('excludes convoy-only beads with no workflow metadata', () => {
    assert.equal(
      runBeadFilter(
        gcBead({ id: 'a', title: 'convoy', issue_type: 'convoy' }),
      ),
      false,
    );
  });
});

// ── fromGcBead adapter ────────────────────────────────────────────────────

describe('fromGcBead', () => {
  test('maps standard fields verbatim, sourcing updated_at from created_at', () => {
    // 6bv7 F16: OpenAPI Bead has no updated_at field; the adapter sources
    // its RunIssue.updated_at slot from created_at directly now.
    const source = gcBead({
      id: 'a',
      title: 'Implement',
      assignee: 'alice',
      metadata: { foo: 'bar' },
    });

    const adapted = fromGcBead(source);
    assert.equal(adapted.id, 'a');
    assert.equal(adapted.title, 'Implement');
    assert.equal(adapted.assignee, 'alice');
    assert.equal(adapted.updated_at, '2026-05-10T19:00:00Z');
    assert.deepEqual(adapted.metadata, { foo: 'bar' });
  });

  test('populates parent from metadata["gc.parent_bead_id"] when present', () => {
    const adapted = fromGcBead(
      gcBead({
        id: 'a',
        title: 'step',
        metadata: { 'gc.parent_bead_id': 'parent-id' },
      }),
    );
    assert.equal(adapted.parent, 'parent-id');
  });

  test('leaves parent undefined when metadata key is absent', () => {
    const adapted = fromGcBead(gcBead({ id: 'a', title: 'step' }));
    assert.equal(adapted.parent, undefined);
  });
});

// ── buildRunSummary ──────────────────────────────────────────────────

describe('buildRunSummary', () => {
  test('groups by metadata root and surfaces review round labels', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'Adopt PR workflow',
        issue_type: 'molecule',
        status: 'open',
        updated_at: '2026-05-10T20:00:00Z',
        metadata: graphRunMetadata(),
      }),
      issue({
        id: 'ga-review',
        title: 'Run review loop',
        status: 'in_progress',
        assignee: 'workflows.codex-max',
        updated_at: '2026-05-10T21:00:00Z',
        metadata: {
          'gc.root_bead_id': 'ga-root',
          'review-loop.iteration.3': 'active',
        },
      }),
    ]);

    assert.equal(summary.totalActive, 1);
    assert.deepEqual(summary.census, {
      status: 'unavailable',
      error: 'run health has not been derived',
    });
    assert.deepEqual(summary.lanes[0]?.health, {
      status: 'unavailable',
      error: 'run health has not been derived',
    });
    assert.equal(summary.lanes.length, 1);
    const lane = summary.lanes[0]!;
    assert.equal(lane.id, 'ga-root');
    assert.equal(lane.title, 'Adopt PR workflow');
    assert.deepEqual(lane.formula, {
      status: 'unavailable',
      error: 'run formula unavailable',
    });
    assert.equal(lane.phase, 'review');
    assert.deepEqual(lane.activeAssignees, ['workflows.codex-max']);
    assert.deepEqual(lane.statusCounts, { open: 1, in_progress: 1 });
    assert.deepEqual(lane.updatedAt, {
      status: 'available',
      at: '2026-05-10T21:00:00Z',
    });
    assert.deepEqual(lane.progress, {
      status: 'stage_only',
      stage: {
        status: 'available',
        index: 2,
        key: 'review',
        label: 'Review round 3',
      },
      error: 'active run step unavailable',
    });
  });

  test('carries run formula as an explicit known state', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'Adopt PR workflow',
        issue_type: 'molecule',
        status: 'open',
        metadata: graphRunMetadata({
          'gc.formula': 'mol-adopt-pr-v2',
        }),
      }),
    ]);

    assert.deepEqual(summary.lanes[0]!.formula, {
      status: 'known',
      name: 'mol-adopt-pr-v2',
    });
    assert.equal(summary.runCounts.prReview, 1);
  });

  // gascity-dashboard-3vaz (follow-up to e7hj): the lane-builder's
  // workflowFormula() title fallback used to fire on ANY title starting
  // with 'mol-', even on graph.v2 roots that had no gc.run_target —
  // exactly the false-positive condition the run-detail page now flags
  // with the e7hj warn tone. Match the resolveWorkflowFormulaName guard:
  // title fallback only when root has graph.v2 contract AND gc.run_target.
  test('3vaz: lane formula stays unavailable for graph.v2 root with mol-* title but no gc.run_target', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'mol-foo',
        issue_type: 'molecule',
        status: 'open',
        // graph.v2 contract (so it enters the lane builder) but no
        // gc.run_target — an operator-edited descriptive title on a
        // closed root, not a runnable formula name.
        metadata: graphRunMetadata(),
      }),
    ]);

    assert.equal(summary.lanes.length, 1);
    assert.deepEqual(summary.lanes[0]!.formula, {
      status: 'unavailable',
      error: 'run formula unavailable',
    });
  });

  test('3vaz: lane formula uses title fallback when graph.v2 root has both contract and gc.run_target', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'mol-focus-review',
        issue_type: 'molecule',
        status: 'open',
        metadata: graphRunMetadata({
          'gc.run_target': '/home/ds/gascity/polecat',
        }),
      }),
    ]);

    assert.deepEqual(summary.lanes[0]!.formula, {
      status: 'known',
      name: 'mol-focus-review',
    });
  });

  test('3vaz: explicit gc.formula wins over the gated title fallback', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'mol-misleading-title',
        issue_type: 'molecule',
        status: 'open',
        metadata: graphRunMetadata({
          'gc.formula': 'mol-adopt-pr-v2',
          'gc.run_target': '/home/ds/gascity/polecat',
        }),
      }),
    ]);

    assert.deepEqual(summary.lanes[0]!.formula, {
      status: 'known',
      name: 'mol-adopt-pr-v2',
    });
  });

  // Phase 4 regression: pre-fix workflowFormula scanned every issue title
  // for a 'mol-*' prefix, so a child task with a 'mol-' title would silently
  // displace the root's identity. After the Phase 4 fix the title fallback
  // sources from the root bead's own title only, matching where
  // resolveWorkflowFormulaName reads from.
  test('3vaz: child bead with mol-* title does NOT displace root identity on lane card', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'PR adoption plan',
        issue_type: 'molecule',
        status: 'in_progress',
        metadata: graphRunMetadata({
          'gc.run_target': '/home/ds/gascity/polecat',
        }),
      }),
      issue({
        id: 'ga-child',
        title: 'mol-child-impostor',
        status: 'in_progress',
        metadata: { 'gc.root_bead_id': 'ga-root' },
      }),
    ]);

    // Root title does not start with 'mol-' → fallback does not fire.
    // Pre-fix this would have surfaced 'mol-child-impostor' from the child.
    assert.deepEqual(summary.lanes[0]!.formula, {
      status: 'unavailable',
      error: 'run formula unavailable',
    });
  });

  test('xfb7: lane formula stays unavailable for CLOSED graph.v2 root with title fallback', () => {
    // gascity-dashboard-xfb7: closed graph.v2 roots are the realistic
    // false-positive surface — operators retitle them post-run. Even when
    // the root retains its 'mol-*' title and gc.run_target the lane card
    // must NOT surface the title as the canonical formula; defer instead.
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'mol-stale-after-rename',
        issue_type: 'molecule',
        status: 'closed',
        metadata: graphRunMetadata({
          'gc.run_target': '/home/ds/gascity/polecat',
        }),
      }),
    ]);

    assert.equal(summary.lanes.length, 0);
    assert.equal(summary.historicalLanes.length, 1);
    assert.deepEqual(summary.historicalLanes[0]!.formula, {
      status: 'unavailable',
      error: 'run formula unavailable',
    });
  });

  test('xfb7: explicit gc.formula on CLOSED root still wins (closed-status guard only gates the fallback)', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'investigation: foo bug',
        issue_type: 'molecule',
        status: 'closed',
        metadata: graphRunMetadata({
          'gc.formula': 'mol-adopt-pr-v2',
          'gc.run_target': '/home/ds/gascity/polecat',
        }),
      }),
    ]);

    assert.equal(summary.historicalLanes.length, 1);
    assert.deepEqual(summary.historicalLanes[0]!.formula, {
      status: 'known',
      name: 'mol-adopt-pr-v2',
    });
  });

  test('3vaz: root with mol-* title is used directly (root title, not first-found)', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'mol-canonical-name',
        issue_type: 'molecule',
        status: 'in_progress',
        metadata: graphRunMetadata({
          'gc.run_target': '/home/ds/gascity/polecat',
        }),
      }),
      issue({
        id: 'ga-child',
        title: 'mol-decoy',
        status: 'in_progress',
        metadata: { 'gc.root_bead_id': 'ga-root' },
      }),
    ]);

    assert.deepEqual(summary.lanes[0]!.formula, {
      status: 'known',
      name: 'mol-canonical-name',
    });
  });

  test('carries active run progress as an explicit state', () => {
    const summary = buildRunSummary([
      issue({
        id: 'pr-root',
        title: 'Adopt PR workflow',
        issue_type: 'molecule',
        status: 'open',
        metadata: graphRunMetadata({
          'gc.formula': 'mol-adopt-pr-v2',
        }),
      }),
      issue({
        id: 'pr-review',
        title: 'Review loop',
        status: 'in_progress',
        assignee: 'workflows.codex-max',
        updated_at: '2026-05-10T21:00:00Z',
        metadata: {
          'gc.root_bead_id': 'pr-root',
          'gc.step_id': 'review-loop',
          'review-loop.iteration.2': 'active',
        },
      }),
    ]);

    const lane = summary.lanes[0]!;
    assert.deepEqual(lane.progress, {
      status: 'active_step',
      stepId: 'review-loop',
      stage: {
        status: 'available',
        index: 2,
        key: 'review',
        label: 'Review loop',
      },
      attempt: {
        status: 'available',
        value: 2,
      },
    });
    assert.equal(lane.formulaStageResolved, true);
  });

  test('carries run scope metadata onto lanes for supervisor detail links', () => {
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'Scoped graph workflow',
        issue_type: 'molecule',
        status: 'open',
        metadata: {
          ...graphRunMetadata(),
          'gc.scope_kind': 'rig',
          'gc.scope_ref': 'worktree',
          'gc.root_store_ref': 'rig:worktree',
        },
      }),
      issue({
        id: 'ga-child',
        title: 'Child scoped to body',
        status: 'in_progress',
        metadata: {
          'gc.root_bead_id': 'ga-root',
          'gc.scope_ref': 'body',
        },
      }),
    ]);

    const lane = summary.lanes[0]!;
    assert.deepEqual(lane.scope, {
      status: 'available',
      kind: 'rig',
      ref: 'worktree',
      rootStoreRef: 'rig:worktree',
    });
  });

  test('omits query scope when explicit scope fields are absent, even with a root_store_ref (gascity-dashboard-sd9)', () => {
    // root_store_ref is a STORAGE location, not a query scope. With no explicit
    // gc.scope_kind/gc.scope_ref, the lane must carry NO query scope so the
    // deep-link resolves the workflow by id under the city. Deriving the scope
    // from root_store_ref produced a deep-link the supervisor 404s for
    // rig-store-backed workflows.
    const summary = buildRunSummary([
      issue({
        id: 'ga-root',
        title: 'Rig-store graph workflow with no explicit scope',
        issue_type: 'molecule',
        status: 'open',
        metadata: {
          ...graphRunMetadata(),
          'gc.root_store_ref': 'rig:codeprobe',
        },
      }),
      issue({
        id: 'ga-child',
        title: 'Body-scoped child',
        status: 'in_progress',
        metadata: {
          'gc.root_bead_id': 'ga-root',
          'gc.scope_ref': 'body',
        },
      }),
    ]);

    const lane = summary.lanes[0]!;
    assert.deepEqual(lane.scope, {
      status: 'unavailable',
      error: 'run scope metadata unavailable',
    });
  });

  // gascity-dashboard-d3xp: rig-stored workflow roots surfaced by the
  // /formulas/feed discovery path (ej9y) typically do NOT carry
  // gc.scope_kind / gc.scope_ref in their bead metadata. Before d3xp the
  // lane fell back to scope=unavailable, the frontend deep-link dropped
  // its scope qs, and the backend route silently filled in
  // defaultWorkflowScope(cityName) — masking a 404 for any non-city
  // run. The feed's own scope_kind/scope_ref is the authoritative
  // supervisor query scope for the run, so plumb it through the lane
  // builder when bead metadata is absent.
  test('d3xp: enriches lane scope from feed when rig-discovered bead has no explicit scope metadata', () => {
    const summary = buildRunSummary(
      [
        issue({
          id: 'rig-root',
          title: 'mol-focus-review',
          issue_type: 'task',
          status: 'in_progress',
          metadata: {
            ...graphRunMetadata(),
            // Note: NO gc.scope_kind / gc.scope_ref — this is the
            // ej9y-surfaced shape on real ds-research rig stores.
            'gc.root_store_ref': 'rig:gascity',
          },
        }),
      ],
      new Map([
        [
          'rig-root',
          { scopeKind: 'rig', scopeRef: 'gascity', rootStoreRef: 'rig:gascity' },
        ],
      ]),
    );

    const lane = summary.lanes[0]!;
    assert.deepEqual(lane.scope, {
      status: 'available',
      kind: 'rig',
      ref: 'gascity',
      rootStoreRef: 'rig:gascity',
    });
  });

  test('d3xp: bead metadata wins over feed scope when both are present (sd9 invariant)', () => {
    // Bead-supplied gc.scope_kind/gc.scope_ref is the strongest signal —
    // the supervisor stamped it on the bead at workflow-root creation.
    // If the feed disagrees, the bead is authoritative. (Mostly defensive:
    // we expect feed + bead to agree in practice.)
    const summary = buildRunSummary(
      [
        issue({
          id: 'conflict-root',
          title: 'mol-with-conflicting-feed',
          issue_type: 'task',
          status: 'in_progress',
          metadata: {
            ...graphRunMetadata(),
            'gc.scope_kind': 'city',
            'gc.scope_ref': 'racoon-city',
            'gc.root_store_ref': 'city:racoon-city',
          },
        }),
      ],
      new Map([
        [
          'conflict-root',
          { scopeKind: 'rig', scopeRef: 'wrong-rig', rootStoreRef: 'rig:wrong-rig' },
        ],
      ]),
    );

    const lane = summary.lanes[0]!;
    assert.deepEqual(lane.scope, {
      status: 'available',
      kind: 'city',
      ref: 'racoon-city',
      rootStoreRef: 'city:racoon-city',
    });
  });

  test('d3xp: lane scope stays unavailable when bead metadata AND feed map both lack scope', () => {
    // No silent fallback — if neither source has scope, the lane carries
    // 'unavailable' so the deep-link drops the qs and the route falls
    // through to defaultWorkflowScope. (This is the pre-d3xp behavior;
    // d3xp only adds the FEED source, it does not weaken the rule.)
    const summary = buildRunSummary(
      [
        issue({
          id: 'ghost-root',
          title: 'mol-ghost',
          issue_type: 'task',
          status: 'in_progress',
          metadata: {
            ...graphRunMetadata(),
            'gc.root_store_ref': 'rig:ghost',
          },
        }),
      ],
      new Map(),
    );

    const lane = summary.lanes[0]!;
    assert.deepEqual(lane.scope, {
      status: 'unavailable',
      error: 'run scope metadata unavailable',
    });
  });

  test('groups workflow roots and molecule children (M4-c)', () => {
    // Multi-step bead group keyed on molecule id → exactly one lane.
    const summary = buildRunSummary([
      issue({
        id: 'ga-explicit-root',
        title: 'Explicit root',
        status: 'open',
        metadata: graphRunMetadata(),
      }),
      issue({
        id: 'ga-child-a',
        title: 'Implementation child A',
        status: 'in_progress',
        metadata: { molecule_id: 'ga-explicit-root' },
      }),
      issue({
        id: 'ga-child-b',
        title: 'Implementation child B',
        status: 'in_progress',
        metadata: { 'gc.root_bead_id': 'ga-explicit-root' },
      }),
    ]);

    assert.equal(summary.lanes.length, 1);
    const lane = summary.lanes[0]!;
    assert.equal(lane.id, 'ga-explicit-root');
    assert.equal(lane.title, 'Explicit root');
    assert.equal(lane.phase, 'implementation');
    assert.deepEqual(lane.statusCounts, { open: 1, in_progress: 2 });
  });

  test('runCounts.total equals the number of groups, not the visible slice (H1)', () => {
    const lanes = Array.from({ length: 5 }, (_, idx) =>
      issue({
        id: `lane-${idx}`,
        title: `mol-${idx}`,
        issue_type: 'task',
        metadata: graphRunMetadata(),
        updated_at: `2026-05-10T${String(idx + 10).padStart(2, '0')}:00:00Z`,
      }),
    );
    const summary = buildRunSummary(lanes);
    assert.equal(summary.runCounts.total, summary.lanes.length);
    assert.equal(summary.runCounts.visible, summary.lanes.length);
    assert.equal(summary.totalActive, 5);
  });

  test('caps visible lanes at MAX_VISIBLE_ACTIVE_LANES while preserving totalActive', () => {
    const summary = buildRunSummary(
      Array.from({ length: MAX_VISIBLE_ACTIVE_LANES + 3 }, (_, idx) =>
        issue({
          id: `ga-workflow-${idx}`,
          title: `Workflow ${idx}`,
          issue_type: 'task',
          metadata: graphRunMetadata(),
          updated_at: `2026-05-10T${String(idx + 10).padStart(2, '0')}:00:00Z`,
        }),
      ),
    );

    assert.equal(summary.totalActive, MAX_VISIBLE_ACTIVE_LANES + 3);
    assert.equal(summary.runCounts.total, MAX_VISIBLE_ACTIVE_LANES + 3);
    assert.equal(summary.runCounts.visible, MAX_VISIBLE_ACTIVE_LANES);
    assert.equal(summary.lanes.length, MAX_VISIBLE_ACTIVE_LANES);
    // Most recently updated lane sorts to position 0.
    assert.equal(
      summary.lanes[0]!.id,
      `ga-workflow-${MAX_VISIBLE_ACTIVE_LANES + 2}`,
    );
  });

  test('recentChanges sorted by updatedAt desc, capped at 12', () => {
    const issues = [
      issue({
        id: 'change-root',
        title: 'Graph workflow',
        metadata: graphRunMetadata(),
        updated_at: '2026-05-09T00:00:00Z',
      }),
      ...Array.from({ length: 20 }, (_, idx) =>
        issue({
          id: `change-${idx}`,
          title: `change ${idx}`,
          metadata: { 'gc.root_bead_id': 'change-root' },
          updated_at: `2026-05-10T${String(idx).padStart(2, '0')}:00:00Z`,
        }),
      ),
    ];
    const summary = buildRunSummary(issues);
    assert.equal(summary.recentChanges.length, 12);
    // Most recent change is at index 0.
    assert.equal(summary.recentChanges[0]!.id, 'change-19');
    // Descending order across the entire slice.
    for (let i = 1; i < summary.recentChanges.length; i += 1) {
      const prev = Date.parse(summary.recentChanges[i - 1]!.updatedAt);
      const curr = Date.parse(summary.recentChanges[i]!.updatedAt);
      assert.ok(prev >= curr, `not descending at index ${i}`);
    }
  });

  test('runCounts.prReview counts mol-adopt-pr-v2 lanes', () => {
    const summary = buildRunSummary([
      issue({
        id: 'pr-root',
        title: 'mol-adopt-pr-v2',
        issue_type: 'molecule',
        metadata: graphRunMetadata({ 'gc.formula': 'mol-adopt-pr-v2' }),
      }),
    ]);
    assert.equal(summary.runCounts.prReview, 1);
    assert.equal(summary.runCounts.designReview, 0);
    assert.equal(summary.runCounts.bugfix, 0);
  });

  test('runCounts.blocked counts lanes whose phase is blocked', () => {
    const summary = buildRunSummary([
      issue({
        id: 'a',
        title: 'workflow root',
        status: 'blocked',
        issue_type: 'task',
        metadata: graphRunMetadata(),
      }),
    ]);
    assert.equal(summary.runCounts.blocked, 1);
  });

  test('keeps recently completed graph.v2 workflow runs visible in historicalLanes', () => {
    // gascity-dashboard-yh5i: completed runs now land in historicalLanes
    // (toggled visible via ?history=1 on the frontend) rather than the
    // default-visible `lanes`. The intent of this test — "completed
    // graph.v2 runs remain reachable, not silently dropped" — is
    // preserved; the assertion just moves to the new shape.
    const summary = buildRunSummary([
      issue({
        id: 'done-root',
        title: 'Completed formula run',
        status: 'closed',
        issue_type: 'molecule',
        updated_at: '2026-05-27T22:00:00Z',
        metadata: graphRunMetadata({
          'gc.formula': 'mol-adopt-pr-v2',
        }),
      }),
      issue({
        id: 'done-review',
        title: 'Review completed',
        status: 'closed',
        updated_at: '2026-05-27T22:01:00Z',
        metadata: {
          'gc.root_bead_id': 'done-root',
          'gc.step_id': 'review-pr',
        },
      }),
    ]);

    assert.equal(summary.lanes.length, 0, 'completed run is not in default-visible lanes');
    assert.equal(summary.historicalLanes.length, 1);
    assert.equal(summary.historicalLanes[0]!.id, 'done-root');
    assert.equal(summary.historicalLanes[0]!.phase, 'complete');
    assert.deepEqual(summary.historicalLanes[0]!.statusCounts, { closed: 2 });
    assert.equal(summary.totalActive, 0);
    assert.equal(summary.totalHistorical, 1);
  });

  test('excludes non-graph.v2 molecule groups that cannot open in workflow detail', () => {
    const summary = buildRunSummary([
      issue({
        id: 'legacy-root',
        title: 'mol-dog-stale-db',
        issue_type: 'molecule',
      }),
      issue({
        id: 'graph-root',
        title: 'Plan Todo App demo',
        issue_type: 'task',
        metadata: graphRunMetadata({
          'gc.root_store_ref': 'rig:todo-app',
        }),
      }),
    ]);

    assert.equal(summary.totalActive, 1);
    assert.deepEqual(summary.lanes.map((lane) => lane.id), ['graph-root']);
  });

  // gascity-dashboard-4x3 — defense-in-depth: only http(s) URLs reach the
  // frontend as clickable hrefs. Supervisor bead metadata is the trust
  // boundary; a stored `javascript:` URI would otherwise render as a live
  // link in LaneCard.
  test('external link rejects non-http(s) protocols without hiding the label', () => {
    for (const malicious of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '/relative/path',
      'example.com/no-protocol',
    ]) {
      const summary = buildRunSummary([
        issue({
          id: 'evil-root',
          title: 'malicious url',
          issue_type: 'molecule',
          metadata: graphRunMetadata({
            'pr_review.pr_number': '1',
            'pr_review.pr_url': malicious,
          }),
        }),
      ]);
      assert.deepEqual(summary.lanes[0]!.external, {
        status: 'label_only',
        label: 'PR #1',
      }, `expected ${malicious} rejected`);
    }
  });

  test('external link preserves http(s) URLs from pr_review.pr_url', () => {
    const summary = buildRunSummary([
      issue({
        id: 'pr-root',
        title: 'safe pr url',
        issue_type: 'molecule',
        metadata: graphRunMetadata({
          'pr_review.pr_number': '1',
          'pr_review.pr_url': 'https://github.com/o/r/pull/1',
        }),
      }),
    ]);
    assert.deepEqual(summary.lanes[0]!.external, {
      status: 'available',
      label: 'PR #1',
      url: 'https://github.com/o/r/pull/1',
    });
  });

  test('external link preserves http(s) URLs from bugflow.github_issue_url', () => {
    const summary = buildRunSummary([
      issue({
        id: 'bug-root',
        title: 'safe issue url',
        issue_type: 'molecule',
        metadata: graphRunMetadata({
          'bugflow.github_issue_number': '2',
          'bugflow.github_issue_url': 'http://github.com/o/r/issues/2',
        }),
      }),
    ]);
    assert.deepEqual(summary.lanes[0]!.external, {
      status: 'available',
      label: 'Issue #2',
      url: 'http://github.com/o/r/issues/2',
    });
  });

  // gascity-dashboard-yh5i: /workflows defaults to active; toggle reveals
  // historical (phase === 'complete'). The collector splits the sorted
  // lane list into two arrays, each respecting its own cap, so complete
  // lanes can never crowd active out of the 8-lane visible window.
  // Active is `phase !== 'complete'`. Both `totalActive` and
  // `WorkflowCensus.totalInFlight` include blocked lanes — a blocked
  // lane still needs operator attention and is not "done". The split is
  // active (default visible) vs historical (complete, behind toggle),
  // not in-flight vs everything.

  test('yh5i: splits sorted lanes into active and historical by phase', () => {
    const summary = buildRunSummary([
      // Active lane #1 — in review
      issue({
        id: 'active-review-root',
        title: 'Active review',
        issue_type: 'molecule',
        status: 'open',
        updated_at: '2026-05-28T20:00:00Z',
        metadata: graphRunMetadata(),
      }),
      issue({
        id: 'active-review-step',
        title: 'review loop',
        status: 'in_progress',
        updated_at: '2026-05-28T20:00:00Z',
        metadata: {
          'gc.root_bead_id': 'active-review-root',
          'review-loop.iteration.1': 'active',
        },
      }),
      // Historical lane — complete (all steps closed)
      issue({
        id: 'historical-root',
        title: 'Historical run',
        issue_type: 'molecule',
        status: 'closed',
        updated_at: '2026-04-20T18:30:00Z',
        metadata: graphRunMetadata(),
      }),
      issue({
        id: 'historical-step',
        title: 'finalize',
        status: 'closed',
        updated_at: '2026-04-20T18:30:00Z',
        metadata: {
          'gc.root_bead_id': 'historical-root',
        },
      }),
    ]);

    assert.equal(summary.totalActive, 1, 'one active lane');
    assert.equal(summary.totalHistorical, 1, 'one historical lane');
    assert.deepEqual(
      summary.lanes.map((l) => l.id),
      ['active-review-root'],
      'lanes contains only the active lane',
    );
    assert.deepEqual(
      summary.historicalLanes.map((l) => l.id),
      ['historical-root'],
      'historicalLanes contains only the complete lane',
    );
    assert.equal(summary.lanes[0]?.phase !== 'complete', true, 'active phase is not complete');
    assert.equal(summary.historicalLanes[0]?.phase, 'complete', 'historical phase is complete');
  });

  test('yh5i: blocked lanes go into active (not historical), matching census totalInFlight', () => {
    // The census definition of in-flight excludes blocked, but for the
    // /workflows split UX the blocked lane is operationally still
    // "needs your attention" — keep it visible by default.
    const summary = buildRunSummary([
      issue({
        id: 'blocked-root',
        title: 'Blocked workflow',
        issue_type: 'molecule',
        status: 'blocked',
        metadata: graphRunMetadata(),
      }),
    ]);

    // The lane builder derives phase from constituent issues; a single
    // blocked issue should phase=blocked.
    assert.equal(summary.lanes[0]?.phase, 'blocked');
    assert.equal(summary.totalActive, 1);
    assert.equal(summary.totalHistorical, 0);
    assert.equal(summary.historicalLanes.length, 0);
  });

  test('yh5i: empty input produces empty active + historical sets', () => {
    const summary = buildRunSummary([]);
    assert.equal(summary.totalActive, 0);
    assert.equal(summary.totalHistorical, 0);
    assert.deepEqual(summary.lanes, []);
    assert.deepEqual(summary.historicalLanes, []);
  });

  test('yh5i/l9q9: active stays capped while historical ships uncapped', () => {
    // Build 10 active + 7 historical lanes. Active cap = MAX_VISIBLE_ACTIVE_LANES
    // (8); historical is no longer capped on the wire (l9q9 — the frontend owns
    // the preview/expand). Expect: lanes.length === 8 (cap), historicalLanes
    // carries all 7, totalActive === 10, totalHistorical === 7.
    const issues = [];
    for (let i = 0; i < 10; i += 1) {
      issues.push(issue({
        id: `active-${i}`,
        title: `active ${i}`,
        issue_type: 'molecule',
        status: 'in_progress',
        updated_at: `2026-05-28T${String(i).padStart(2, '0')}:00:00Z`,
        metadata: graphRunMetadata(),
      }));
    }
    for (let i = 0; i < 7; i += 1) {
      issues.push(issue({
        id: `done-${i}`,
        title: `done ${i}`,
        issue_type: 'molecule',
        status: 'closed',
        updated_at: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        metadata: graphRunMetadata(),
      }));
    }

    const summary = buildRunSummary(issues);

    assert.equal(summary.totalActive, 10, 'raw active count');
    assert.equal(summary.totalHistorical, 7, 'raw historical count');
    assert.equal(summary.lanes.length, MAX_VISIBLE_ACTIVE_LANES, 'active cap');
    assert.equal(summary.historicalLanes.length, 7, 'historical uncapped — all sent');
    // Crucially: no historical lane leaks into active and vice versa.
    for (const lane of summary.lanes) {
      assert.notEqual(lane.phase, 'complete', `lane ${lane.id} must not be complete`);
    }
    for (const lane of summary.historicalLanes) {
      assert.equal(lane.phase, 'complete', `historicalLanes ${lane.id} must be complete`);
    }
  });

  test('n6f1: omits lanesPartial by default and sets it only when partial=true', () => {
    const issues = [issue({ id: 'a', title: 'Implement', metadata: graphRunMetadata() })];
    assert.equal(
      buildRunSummary(issues).lanesPartial,
      undefined,
      'clean snapshot must not carry the partial flag',
    );
    assert.equal(
      buildRunSummary(issues, new Map(), true).lanesPartial,
      true,
      'partial=true must surface as lanesPartial',
    );
  });
});

// ── createRunsSourceCache (cache integration) ────────────────────────

describe('createRunsSourceCache', () => {
  test('default loader uses bounded typed queries so completed runs appear without an unbounded all=true scan', async () => {
    const seenParams: Array<{
      limit?: number;
      type?: string;
      rig?: string;
      all?: boolean;
    }> = [];
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          seenParams.push(params);
          if (params.all !== true) {
            return {
              items: [
                gcBead({
                  id: 'open-spec',
                  title: 'Open child that identifies the rig',
                  issue_type: 'spec',
                  metadata: {
                    'gc.root_bead_id': 'done-root',
                    'gc.root_store_ref': 'rig:todo-app',
                  },
                }),
              ],
              total: 1,
            };
          }
          if (params.type === 'task' && params.rig === 'todo-app') {
            return {
              items: [
                gcBead({
                  id: 'done-root',
                  title: 'Completed formula run',
                  status: 'closed',
                  issue_type: 'task',
                  metadata: graphRunMetadata({
                    'gc.root_store_ref': 'rig:todo-app',
                    'gc.scope_kind': 'rig',
                    'gc.scope_ref': 'todo-app',
                  }),
                }),
              ],
              total: 1,
            };
          }
          if (params.type === 'molecule') {
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
      } satisfies GcClientMock as unknown as GcClient,
      limit: 77,
    });

    const result = await cache.get();

    assert.equal(result.status, 'fresh');
    // wbe9: the molecule query rides the first parallel wave with the city
    // discovery query, and the rig query follows once rig names are known — so
    // the three may be observed in any order. Assert the exact set rather than
    // a sequence.
    const byJson = (a: unknown, b: unknown) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b));
    assert.deepEqual(
      [...seenParams].sort(byJson),
      [
        { limit: 77 },
        {
          limit: RECENT_RUN_FETCH_LIMIT,
          type: 'task',
          rig: 'todo-app',
          all: true,
        },
        {
          limit: RECENT_RUN_FETCH_LIMIT,
          type: 'molecule',
          all: true,
        },
      ].sort(byJson),
    );
    assert.equal(
      seenParams.some((params) => params.all === true && params.type === undefined),
      false,
    );
    if (result.status === 'fresh') {
      // yh5i: completed runs now land in historicalLanes (toggle-visible),
      // not the default-visible lanes. The intent — "the completed run
      // is reachable from the snapshot" — is preserved.
      assert.equal(result.data.historicalLanes[0]?.id, 'done-root');
    }
  });

  test('default loader includes recent city-scoped molecule runs without requiring a rig', async () => {
    const seenParams: unknown[] = [];
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          seenParams.push(params);
          if (params.all === true && params.type === 'molecule') {
            return {
              items: [
                gcBead({
                id: 'done-root',
                title: 'Completed formula run',
                status: 'closed',
                issue_type: 'molecule',
                metadata: graphRunMetadata(),
              }),
              ],
              total: 1,
            };
          }
          return { items: [], total: 0 };
        },
      } satisfies GcClientMock as unknown as GcClient,
      limit: 77,
    });

    const result = await cache.get();

    assert.equal(result.status, 'fresh');
    // wbe9: the molecule recent-run query now rides the first parallel wave
    // alongside the city discovery query, so the two may be observed in either
    // order — assert membership, not sequence.
    assert.equal(seenParams.length, 2);
    assert.deepEqual(
      [...seenParams].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
      [
        { limit: 77 },
        {
          limit: RECENT_RUN_FETCH_LIMIT,
          type: 'molecule',
          all: true,
        },
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    if (result.status === 'fresh') {
      // yh5i: completed runs land in historicalLanes (toggle-visible).
      assert.equal(result.data.historicalLanes[0]?.id, 'done-root');
    }
  });

  test('passes injected load() result through unchanged on success', async () => {
    const summary = buildRunSummary([
      issue({ id: 'a', title: 'Implement the fix' }),
    ]);
    const cache = createRunsSourceCache({
      load: () => summary,
    });
    const result = await cache.get();
    assert.equal(result.status, 'fresh');
    assert.deepEqual(result.data, summary);
  });

  test('error messages pass through verbatim (H5 — sanitizeErrorMessage: null)', async () => {
    const cache = createRunsSourceCache({
      load: () => {
        throw new Error('gc supervisor returned 502');
      },
    });
    const result = await cache.get();
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'gc supervisor returned 502');
  });

  test('falls back to fixture when load() throws and useFixture=true', async () => {
    const fixtureSummary = buildRunSummary([]);
    const cache = createRunsSourceCache({
      useFixture: true,
      loadFixture: () => fixtureSummary,
      load: () => {
        throw new Error('upstream fail');
      },
    });
    const result = await cache.get();
    assert.equal(result.status, 'fixture');
    assert.deepEqual(result.data, fixtureSummary);
  });

  // gascity-dashboard-ej9y: when city-scoped listBeads returns NO workflow
  // roots (the supervisor's /v0/city/<city>/beads does not include
  // rig-stored workflow roots), the collector must still discover rigs to
  // query via /v0/city/<city>/formulas/feed. Otherwise every rig-stored
  // workflow (the most common case on real deployments — gascity
  // maintenance, zeldascension, etc.) is invisible to the dashboard.
  test('ej9y: bootstraps rig discovery from listFormulaRuns when city listBeads is empty', async () => {
    const listBeadsCalls: Array<{ rig?: string; type?: string; all?: boolean; limit?: number }> = [];
    let listFormulaRunsCalls = 0;
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          listBeadsCalls.push(params);
          // City-scoped initial query returns NO workflow roots — this is
          // the exact ej9y trigger condition on live ds-research.
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            return { items: [], total: 0 };
          }
          // Per-rig query for the rig that listFormulaRuns surfaced:
          // returns a full graph.v2 workflow root that the collector
          // should now be able to build a lane from.
          if (params.rig === 'gascity' && params.type === 'task' && params.all === true) {
            return {
              items: [
                gcBead({
                  id: 'gc-0ioyjp',
                  title: 'mol-focus-review',
                  status: 'in_progress',
                  issue_type: 'task',
                  metadata: graphRunMetadata({
                    'gc.root_store_ref': 'rig:gascity',
                    'gc.scope_kind': 'city',
                    'gc.scope_ref': 'ds-research',
                    'gc.run_target': '/home/ds/gascity/polecat',
                  }),
                }),
              ],
              total: 1,
            };
          }
          if (params.type === 'molecule' && params.all === true) {
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        listFormulaRuns: async (_scope: unknown) => {
          listFormulaRunsCalls += 1;
          return {
            items: [
              {
                id: 'gc-0ioyjp',
                type: 'formula',
                status: 'pending',
                title: 'mol-focus-review',
                scope_kind: 'city',
                scope_ref: 'ds-research',
                target: '/home/ds/gascity/polecat',
                started_at: '2026-05-28T23:24:42Z',
                updated_at: '2026-05-28T23:24:42Z',
                workflow_id: 'gc-0ioyjp',
                root_bead_id: 'gc-0ioyjp',
                root_store_ref: 'rig:gascity',
                run_detail_available: true,
              },
            ],
            // mfb9: FormulaFeedBody.partial is required upstream. The mock's
            // enclosing `as never` cast masks the type error, so make the
            // fixture honest to match the generated FormulaFeedBody contract.
            partial: false,
          };
        },
        cityName: 'ds-research',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    const result = await cache.get();

    assert.equal(listFormulaRunsCalls, 1, 'collector must call listFormulaRuns once for rig discovery');
    assert.ok(
      listBeadsCalls.some((p) => p.rig === 'gascity'),
      `collector must query rig=gascity after feed-based discovery (saw: ${JSON.stringify(listBeadsCalls)})`,
    );
    assert.equal(result.status, 'fresh');
    if (result.status === 'fresh') {
      const ids = result.data.lanes.map((lane) => lane.id);
      assert.ok(
        ids.includes('gc-0ioyjp'),
        `expected gc-0ioyjp lane in result; got ${JSON.stringify(ids)}`,
      );
    }
  });

  // ej9y resilience: feed discovery is best-effort. A degraded feed
  // (network error, supervisor 500, decode failure) must NOT fail the
  // whole snapshot — the listBeads-only path should still produce its
  // own lane set, so operators don't silently lose every workflow when
  // /formulas/feed flaps.
  test('ej9y: listBeads-only path still works when listFormulaRuns throws', async () => {
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            return {
              items: [
                gcBead({
                  id: 'city-root',
                  title: 'mol-city-only',
                  status: 'in_progress',
                  issue_type: 'task',
                  metadata: graphRunMetadata({
                    'gc.root_store_ref': 'city:test',
                    'gc.scope_kind': 'city',
                    'gc.scope_ref': 'test',
                    'gc.run_target': '/tmp/fixture-target',
                  }),
                }),
              ],
              total: 1,
            };
          }
          if (params.type === 'molecule' && params.all === true) {
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        listFormulaRuns: async () => {
          throw new Error('simulated feed outage');
        },
        cityName: 'test',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    const result = await cache.get();

    assert.equal(result.status, 'fresh', 'snapshot must survive feed failure');
    if (result.status === 'fresh') {
      const ids = result.data.lanes.map((lane) => lane.id);
      assert.deepEqual(ids, ['city-root'], 'listBeads-discovered lane should still surface');
    }
  });

  // gascity-dashboard-n6f1: the per-rig recent-run fan-out is best-effort.
  // One rig's listBeads rejecting (timeout / 404 / transient flake) must
  // NOT collapse the whole runs snapshot to status=error — the fulfilled
  // rigs' lanes must still surface, and the result must flag itself partial
  // so the operator sees a degraded indicator rather than silent loss.
  test('n6f1: a single rig listBeads rejection degrades to a partial snapshot, not a total collapse', async () => {
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          // Base city query surfaces two rigs via discovered children.
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            return {
              items: [
                gcBead({
                  id: 'child-a',
                  title: 'child pointing at rig-a',
                  issue_type: 'spec',
                  metadata: { 'gc.root_bead_id': 'root-a', 'gc.root_store_ref': 'rig:rig-a' },
                }),
                gcBead({
                  id: 'child-b',
                  title: 'child pointing at rig-b',
                  issue_type: 'spec',
                  metadata: { 'gc.root_bead_id': 'root-b', 'gc.root_store_ref': 'rig:rig-b' },
                }),
              ],
              total: 2,
            };
          }
          // rig-a's recent-run query succeeds with a full graph.v2 root.
          if (params.rig === 'rig-a' && params.type === 'task' && params.all === true) {
            return {
              items: [
                gcBead({
                  id: 'root-a',
                  title: 'mol-from-rig-a',
                  status: 'in_progress',
                  issue_type: 'task',
                  metadata: graphRunMetadata({
                    'gc.root_store_ref': 'rig:rig-a',
                    'gc.scope_kind': 'rig',
                    'gc.scope_ref': 'rig-a',
                  }),
                }),
              ],
              total: 1,
            };
          }
          // rig-b's recent-run query rejects — the n6f1 fragility trigger.
          if (params.rig === 'rig-b' && params.type === 'task' && params.all === true) {
            throw new Error('simulated per-rig listBeads timeout');
          }
          if (params.type === 'molecule' && params.all === true) {
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        // Feed discovery is exercised but adds no rigs here; rig-a/rig-b are
        // discovered from active.items. Stubbed explicitly so the collector's
        // listFormulaRuns call resolves rather than throwing a swallowed
        // TypeError inside discoverFromFeed.
        listFormulaRuns: async () => ({ items: [], partial: false }),
        cityName: 'test',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    const result = await cache.get();

    assert.equal(result.status, 'fresh', 'one rig failing must not collapse the snapshot');
    if (result.status === 'fresh') {
      const ids = result.data.lanes.map((lane) => lane.id);
      assert.deepEqual(ids, ['root-a'], "the fulfilled rig's lane must still surface");
      assert.equal(
        result.data.lanesPartial,
        true,
        'a skipped rig must flag the summary partial (degraded, not silently dropped)',
      );
    }
  });

  // n6f1: the city molecule list shares the settle path with the per-rig
  // sources, so its failure must also degrade-to-partial (not collapse).
  test('n6f1: a failing city molecule list also degrades to a partial snapshot', async () => {
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          // Base city query surfaces one rig whose recent-run query succeeds.
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            return {
              items: [
                gcBead({
                  id: 'child-a',
                  title: 'child pointing at rig-a',
                  issue_type: 'spec',
                  metadata: { 'gc.root_bead_id': 'root-a', 'gc.root_store_ref': 'rig:rig-a' },
                }),
              ],
              total: 1,
            };
          }
          if (params.rig === 'rig-a' && params.type === 'task' && params.all === true) {
            return {
              items: [
                gcBead({
                  id: 'root-a',
                  title: 'mol-from-rig-a',
                  status: 'in_progress',
                  issue_type: 'task',
                  metadata: graphRunMetadata({
                    'gc.root_store_ref': 'rig:rig-a',
                    'gc.scope_kind': 'rig',
                    'gc.scope_ref': 'rig-a',
                  }),
                }),
              ],
              total: 1,
            };
          }
          // The city-scoped molecule query rejects — the other settle branch.
          if (params.type === 'molecule' && params.all === true) {
            throw new Error('simulated molecule list timeout');
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        listFormulaRuns: async () => ({ items: [], partial: false }),
        cityName: 'test',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    const result = await cache.get();

    assert.equal(result.status, 'fresh', 'a molecule-list failure must not collapse the snapshot');
    if (result.status === 'fresh') {
      const ids = result.data.lanes.map((lane) => lane.id);
      assert.deepEqual(ids, ['root-a'], "the fulfilled rig's lane must still surface");
      assert.equal(result.data.lanesPartial, true, 'the molecule-list failure must flag partial');
    }
  });

  // ej9y dedup: when a rig appears in BOTH listBeads-derived rigNames
  // AND feed-derived rigNames, the per-rig listBeads loop must fire
  // exactly once for that rig — protects against a future refactor that
  // replaces unionRigNames with naive concatenation.
  test('ej9y: deduplicates rig discovered from both listBeads and listFormulaRuns', async () => {
    const rigQueryCalls: string[] = [];
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            // City-level result that references rig=shared via gc.root_store_ref.
            return {
              items: [
                gcBead({
                  id: 'discovered-child',
                  title: 'open child pointing at rig',
                  issue_type: 'spec',
                  metadata: {
                    'gc.root_bead_id': 'shared-root',
                    'gc.root_store_ref': 'rig:shared',
                  },
                }),
              ],
              total: 1,
            };
          }
          if (params.rig !== undefined) {
            rigQueryCalls.push(params.rig);
            return { items: [], total: 0 };
          }
          if (params.type === 'molecule' && params.all === true) {
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        listFormulaRuns: async () => ({
          // Feed-side ALSO returns rig=shared — exercising the union dedup.
          items: [
            {
              id: 'feed-run',
              type: 'formula',
              status: 'pending',
              title: 'mol-other',
              scope_kind: 'city',
              scope_ref: 'test',
              target: '/tmp/feed-target',
              started_at: '2026-05-28T00:00:00Z',
              updated_at: '2026-05-28T00:00:00Z',
              workflow_id: 'feed-run',
              root_bead_id: 'feed-run',
              root_store_ref: 'rig:shared',
              run_detail_available: true,
            },
          ],
          partial: false,
        }),
        cityName: 'test',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    await cache.get();

    assert.deepEqual(
      rigQueryCalls,
      ['shared'],
      `per-rig listBeads must fire exactly once for shared; saw ${JSON.stringify(rigQueryCalls)}`,
    );
  });

  // gascity-dashboard-d3xp: end-to-end — a rig-stored workflow root bead
  // that the per-rig listBeads sweep brings in WITHOUT gc.scope_kind /
  // gc.scope_ref must still produce a scope=available lane, sourced from
  // the /formulas/feed supervisor fields. Otherwise the lane deep-link
  // drops the qs and the backend silently substitutes
  // defaultWorkflowScope(cityName), 404ing or loading the wrong data for
  // any rig-scoped run.
  test('d3xp: lane gets scope=available from feed when rig-stored bead lacks gc.scope_kind metadata', async () => {
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            return { items: [], total: 0 };
          }
          if (params.rig === 'gascity' && params.type === 'task' && params.all === true) {
            return {
              items: [
                gcBead({
                  id: 'rig-only-root',
                  title: 'mol-focus-review',
                  status: 'in_progress',
                  issue_type: 'task',
                  // The exact ej9y-surfaced shape: graph.v2 root, rig
                  // root_store_ref, but NO gc.scope_kind/gc.scope_ref on
                  // the bead. Before d3xp this produced a scope=unavailable
                  // lane and a 404-or-wrong-data deep-link.
                  metadata: graphRunMetadata({
                    'gc.root_store_ref': 'rig:gascity',
                  }),
                }),
              ],
              total: 1,
            };
          }
          if (params.type === 'molecule' && params.all === true) {
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        listFormulaRuns: async () => ({
          items: [
            {
              id: 'rig-only-root',
              type: 'formula',
              status: 'pending',
              title: 'mol-focus-review',
              // Feed gives us the authoritative supervisor query scope
              // for this run — rig:gascity, NOT city:ds-research.
              scope_kind: 'rig',
              scope_ref: 'gascity',
              target: '/home/ds/gascity/polecat',
              started_at: '2026-05-28T00:00:00Z',
              updated_at: '2026-05-28T00:00:00Z',
              workflow_id: 'rig-only-root',
              root_bead_id: 'rig-only-root',
              root_store_ref: 'rig:gascity',
              run_detail_available: true,
            },
          ],
          partial: false,
        }),
        cityName: 'ds-research',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    const result = await cache.get();
    assert.equal(result.status, 'fresh');
    if (result.status === 'fresh') {
      const lane = result.data.lanes.find((l) => l.id === 'rig-only-root');
      assert.ok(lane, `expected rig-only-root lane; got ${JSON.stringify(result.data.lanes.map((l) => l.id))}`);
      assert.deepEqual(lane.scope, {
        status: 'available',
        kind: 'rig',
        ref: 'gascity',
        rootStoreRef: 'rig:gascity',
      });
    }
  });

  // gascity-dashboard-d3xp Phase-4 security finding M1: the supervisor feed's
  // scope_ref is consumed as authoritative; if the supervisor sends a value
  // that wouldn't pass SCOPE_REF_RE (the same regex the routes layer uses to
  // gate inbound query params), we must drop it rather than propagate a
  // malformed scope that the deep-link would later 400 on. Defends boundary
  // consistency against a misbehaving or compromised supervisor.
  test('d3xp/M1: feed scope_ref failing SCOPE_REF_RE is dropped (lane scope stays unavailable)', async () => {
    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            return { items: [], total: 0 };
          }
          if (params.rig === 'gascity' && params.type === 'task' && params.all === true) {
            return {
              items: [
                gcBead({
                  id: 'malformed-feed-root',
                  title: 'mol-focus-review',
                  status: 'in_progress',
                  issue_type: 'task',
                  metadata: graphRunMetadata({
                    'gc.root_store_ref': 'rig:gascity',
                  }),
                }),
              ],
              total: 1,
            };
          }
          if (params.type === 'molecule' && params.all === true) {
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        listFormulaRuns: async () => ({
          items: [
            {
              id: 'malformed-feed-root',
              type: 'formula',
              status: 'pending',
              title: 'mol-focus-review',
              scope_kind: 'rig',
              // Leading hyphen — SCOPE_REF_RE requires [A-Za-z0-9] first.
              // A real malformed value would also trigger the route's 400.
              scope_ref: '-bad scope ref!',
              target: '/home/ds/gascity/polecat',
              started_at: '2026-05-28T00:00:00Z',
              updated_at: '2026-05-28T00:00:00Z',
              workflow_id: 'malformed-feed-root',
              root_bead_id: 'malformed-feed-root',
              root_store_ref: 'rig:gascity',
              run_detail_available: true,
            },
          ],
          partial: false,
        }),
        cityName: 'ds-research',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    const result = await cache.get();
    assert.equal(result.status, 'fresh');
    if (result.status === 'fresh') {
      const lane = result.data.lanes.find((l) => l.id === 'malformed-feed-root');
      assert.ok(lane, 'lane should still be discoverable; only its scope is dropped');
      assert.deepEqual(lane.scope, {
        status: 'unavailable',
        error: 'run scope metadata unavailable',
      });
    }
  });

  // wbe9: the city-molecule listBeads query has static city-scoped params and
  // no data dependency on feed discovery, so it must NOT be serialized behind
  // listFormulaRuns. Pinning this prevents a regression back to the
  // two-sequential-phase shape that paid an extra serial supervisor round-trip
  // on every uncached runs load. The deferred feed promise stays UNRESOLVED
  // until after we observe the molecule query fire — if the collector awaited
  // the feed before issuing the molecule query, the test would deadlock-time
  // out, not pass.
  test('wbe9: city-molecule listBeads is not serialized behind feed discovery', async () => {
    let moleculeQueried = false;
    let releaseFeed: (() => void) | undefined;
    const feedGate = new Promise<void>((resolve) => {
      releaseFeed = resolve;
    });

    const cache = createRunsSourceCache({
      gc: {
        listBeads: async (_signal: AbortSignal | undefined, params: ListBeadsParams) => {
          assert.ok(params, 'collector must always pass an explicit params arg');
          // Initial city-scoped discovery query.
          if (params.rig === undefined && params.type === undefined && params.all !== true) {
            return { items: [], total: 0 };
          }
          if (params.type === 'molecule' && params.all === true) {
            // The molecule query fired before the feed resolved — release the
            // feed so the load can complete instead of hanging.
            moleculeQueried = true;
            releaseFeed?.();
            return { items: [], total: 0 };
          }
          assert.fail(`unexpected listBeads params: ${JSON.stringify(params)}`);
        },
        listFormulaRuns: async () => {
          // Block feed discovery until the molecule query is observed. If the
          // collector serialized the molecule query after the feed, this never
          // releases and the test times out (a failing RED signal).
          await feedGate;
          return { items: [], partial: false };
        },
        cityName: 'test',
      } satisfies GcClientMock as unknown as GcClient,
      limit: 1000,
    });

    const result = await cache.get();
    assert.equal(result.status, 'fresh');
    assert.ok(
      moleculeQueried,
      'city-molecule listBeads must be issued concurrently with feed discovery, not after it',
    );
  });
});
