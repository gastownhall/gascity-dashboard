import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { selectStrandedRuns, strandedRunReason, strandedRunRemedy } from './stranded.js';
import type { RunLane } from '../snapshot/types.js';

// gascity-dashboard-pxvb: the single stranded-runs selector, the analogue of
// selectBlockedRuns. Both the Runs nav badge and the /runs page read it, so the
// badge count and the page count cannot disagree. Input is buildRunSummary's
// strandedLanes — already dangling-root suppressed and asserted stranded only
// from a complete feed observation upstream (isStrandedRun).

function lane(overrides: Partial<RunLane> = {}): RunLane {
  return {
    id: 'gc-100',
    title: 'mol-pr-start: gascity issue #3192',
    formula: { status: 'known', name: 'mol-pr-start' },
    scope: { status: 'available', kind: 'rig', ref: 'app', rootStoreRef: 'rig:app' },
    external: { status: 'unavailable', error: 'external reference unavailable' },
    phase: 'intake',
    phaseLabel: 'intake',
    statusCounts: { open: 3 },
    activeAssignees: [],
    updatedAt: { status: 'available', at: '2026-06-01T00:00:00.000Z' },
    stages: [],
    progress: { status: 'unavailable', error: 'run progress unavailable' },
    formulaStageResolved: false,
    registration: 'stranded',
    health: { status: 'unavailable', error: 'run health has not been derived' },
    ...overrides,
  };
}

describe('selectStrandedRuns — gascity-dashboard-pxvb', () => {
  test('projects one StrandedRun per stranded lane, preserving id/title/scope', () => {
    const scope = {
      status: 'available',
      kind: 'rig',
      ref: 'app',
      rootStoreRef: 'rig:app',
    } as const;
    const runs = selectStrandedRuns([
      lane({ id: 'gc-1', title: 'Run one', scope }),
      lane({ id: 'gc-2', title: 'Run two', scope }),
    ]);
    assert.equal(runs.length, 2);
    assert.deepEqual(
      runs.map((r) => r.id),
      ['gc-1', 'gc-2'],
    );
    assert.equal(runs[0]?.title, 'Run one');
    assert.deepEqual(runs[0]?.scope, scope);
  });

  test('selects only stranded lanes — registered and unknown are excluded', () => {
    const runs = selectStrandedRuns([
      lane({ id: 'registered', registration: 'registered' }),
      lane({ id: 'unknown', registration: 'unknown' }),
      lane({ id: 'stranded', registration: 'stranded' }),
    ]);
    assert.deepEqual(
      runs.map((r) => r.id),
      ['stranded'],
    );
  });

  test('every stranded row carries an actionable reason and remedy', () => {
    const [run] = selectStrandedRuns([lane()]);
    assert.ok(run);
    assert.equal(run.reason, strandedRunReason());
    assert.equal(run.remedy, strandedRunRemedy());
    assert.match(run.reason, /never executed/i);
    assert.match(run.remedy, /re-dispatch|clean up/i);
  });

  test('empty input yields no stranded runs', () => {
    assert.deepEqual(selectStrandedRuns([]), []);
  });
});
