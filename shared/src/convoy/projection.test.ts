import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { DashboardBead } from '../dashboard-beads.js';
import { projectConvoyView } from './projection.js';

function bead(id: string, overrides: Partial<DashboardBead> = {}): DashboardBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    priority: null,
    created_at: '2026-06-12T00:00:00Z',
    ...overrides,
  };
}

describe('projectConvoyView', () => {
  test('exposes ordered step children with derived progress when the graph is materialized', () => {
    const root = bead('root', {
      title: 'mol-focus-review',
      status: 'in_progress',
      metadata: { 'gc.session_name': 'claude-1-gc-1' },
    });
    const children = [
      bead('s2', { status: 'open', created_at: '2026-06-12T00:00:02Z' }),
      bead('s1', { status: 'closed', created_at: '2026-06-12T00:00:01Z' }),
    ];

    const view = projectConvoyView(root, children, null);

    assert.equal(view.rootBeadId, 'root');
    assert.equal(view.sessionName, 'claude-1-gc-1');
    assert.equal(view.exposure.kind, 'exposed');
    if (view.exposure.kind !== 'exposed') throw new Error('expected exposed');
    // Ordered by created_at ascending.
    assert.deepEqual(
      view.exposure.steps.map((s) => s.bead.id),
      ['s1', 's2'],
    );
    // Derived progress over children: one of two closed.
    assert.deepEqual(view.progress, { closed: 1, total: 2 });
  });

  test('prefers supervisor convoy progress over the derived count', () => {
    const view = projectConvoyView(bead('root'), [bead('s1', { status: 'closed' })], {
      closed: 4,
      total: 9,
    });
    assert.deepEqual(view.progress, { closed: 4, total: 9 });
  });

  test('marks a step blocked by its open needs that are present in the graph', () => {
    const root = bead('root', { status: 'in_progress' });
    const children = [
      bead('a', { status: 'closed' }),
      bead('b', { status: 'open', needs: ['a', 'c', 'absent'] }),
      bead('c', { status: 'in_progress' }),
    ];

    const view = projectConvoyView(root, children, null);
    if (view.exposure.kind !== 'exposed') throw new Error('expected exposed');
    const stepB = view.exposure.steps.find((s) => s.bead.id === 'b');
    // 'a' is closed (not blocking), 'absent' is not in the graph (unknown,
    // excluded), only the open in-graph need 'c' blocks.
    assert.deepEqual(stepB?.blockedBy, ['c']);
  });

  test('surfaces gc.step_ref on materialized formula steps', () => {
    const view = projectConvoyView(
      bead('root'),
      [bead('s1', { metadata: { 'gc.step_ref': 'review.1' } })],
      null,
    );
    if (view.exposure.kind !== 'exposed') throw new Error('expected exposed');
    assert.equal(view.exposure.steps[0]?.stepRef, 'review.1');
  });

  test('degrades honestly to graph_v2_root_only when a graph.v2 root has no exposed children', () => {
    const root = bead('root', {
      status: 'in_progress',
      metadata: { 'gc.formula_contract': 'graph.v2', 'gc.run_target': 'city/claude-1' },
      title: 'mol-focus-review',
    });

    const view = projectConvoyView(root, [], { closed: 0, total: 1 });

    assert.deepEqual(view.exposure, { kind: 'collapsed', reason: 'graph_v2_root_only' });
    // Supervisor progress still shows through the collapse.
    assert.deepEqual(view.progress, { closed: 0, total: 1 });
  });

  test('degrades to graph_v2_root_only for a current-era root keyed by gc.routed_to (no gc.run_target)', () => {
    // The supervisor retired gc.run_target in favor of gc.routed_to (gascity
    // #2763); current roots carry only gc.routed_to. The gate must accept it,
    // or the primary real-world case misclassifies as no_children.
    const root = bead('root', {
      status: 'in_progress',
      metadata: { 'gc.formula_contract': 'graph.v2', 'gc.routed_to': 'city/claude-1' },
      title: 'mol-focus-review',
    });

    const view = projectConvoyView(root, [], { closed: 0, total: 1 });

    assert.deepEqual(view.exposure, { kind: 'collapsed', reason: 'graph_v2_root_only' });
  });

  test('reports no_children for a genuine leaf bead with no graph.v2 contract', () => {
    const view = projectConvoyView(bead('leaf', { status: 'closed' }), [], null);
    assert.deepEqual(view.exposure, { kind: 'collapsed', reason: 'no_children' });
    // No supervisor progress and nothing to derive.
    assert.equal(view.progress, null);
  });

  test('reports no_children for a graph.v2-labelled root that lacks gc.run_target', () => {
    // Same gate as resolveRunFormulaName (formula-name.ts): the contract label
    // without a target is not a runnable root (e.g. an operator-retitled closed
    // root), so a childless one is a genuine leaf — not the misleading
    // "supervisor does not expose this run's step graph" collapse.
    const root = bead('root', {
      status: 'closed',
      title: 'investigation: some bug',
      metadata: { 'gc.formula_contract': 'graph.v2' },
    });
    const view = projectConvoyView(root, [], null);
    assert.deepEqual(view.exposure, { kind: 'collapsed', reason: 'no_children' });
  });

  test('resolves the formula name and its provenance from the root', () => {
    const view = projectConvoyView(
      bead('root', { metadata: { 'gc.formula': 'mol-pr-start' } }),
      [],
      null,
    );
    assert.equal(view.formulaName, 'mol-pr-start');
    assert.equal(view.formulaNameProvenance, 'metadata');
  });
});
