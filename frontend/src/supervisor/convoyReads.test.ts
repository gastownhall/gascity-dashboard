import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import type { SupervisorBeadList } from './beadReads';
import { loadConvoyView } from './convoyReads';

const mockFetchSupervisorBead = vi.hoisted(() => vi.fn());
const mockListSupervisorBeads = vi.hoisted(() => vi.fn());

vi.mock('./beadReads', () => ({
  fetchSupervisorBead: mockFetchSupervisorBead,
  listSupervisorBeads: mockListSupervisorBeads,
}));

function bead(id: string, overrides: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    priority: null,
    created_at: '2026-06-12T00:00:00Z',
    ...overrides,
  } as Bead;
}

function list(items: Bead[], extra: Partial<SupervisorBeadList> = {}): SupervisorBeadList {
  return {
    items,
    total: items.length,
    upstream_fetched: items.length,
    fetch_limit: 1000,
    partial: false,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadConvoyView', () => {
  it('derives the transitive parent-chain steps below the root and excludes the root', async () => {
    mockFetchSupervisorBead.mockResolvedValue(bead('root', { status: 'in_progress' }));
    mockListSupervisorBeads.mockResolvedValue(
      list([
        bead('root', { status: 'in_progress' }),
        bead('a', { parent: 'root', status: 'closed', created_at: '2026-06-12T00:00:01Z' }),
        bead('b', { parent: 'a', status: 'open', created_at: '2026-06-12T00:00:02Z' }),
        bead('unrelated', { parent: 'other', status: 'open' }),
      ]),
    );

    const load = await loadConvoyView('root');

    expect(load.view.rootBeadId).toBe('root');
    expect(load.view.exposure.kind).toBe('exposed');
    if (load.view.exposure.kind !== 'exposed') throw new Error('expected exposed');
    expect(load.view.exposure.steps.map((s) => s.bead.id)).toEqual(['a', 'b']);
    // Derived progress over the two descendants: one closed.
    expect(load.view.progress).toEqual({ closed: 1, total: 2 });
    expect(load.partial).toBe(false);
  });

  it('passes includeClosed + includeBookkeeping so closed/bookkeeping step beads are read', async () => {
    mockFetchSupervisorBead.mockResolvedValue(bead('root'));
    mockListSupervisorBeads.mockResolvedValue(list([bead('root')]));

    await loadConvoyView('root');

    expect(mockListSupervisorBeads).toHaveBeenCalledWith(
      expect.objectContaining({ includeClosed: true, includeBookkeeping: true }),
    );
  });

  it('collapses honestly to graph_v2_root_only for a graph.v2 root with no children', async () => {
    const root = bead('root', {
      status: 'in_progress',
      metadata: { 'gc.formula_contract': 'graph.v2', 'gc.run_target': 'city/claude-1' },
      title: 'mol-focus-review',
    });
    mockFetchSupervisorBead.mockResolvedValue(root);
    mockListSupervisorBeads.mockResolvedValue(list([root]));

    const load = await loadConvoyView('root');

    expect(load.view.exposure).toEqual({ kind: 'collapsed', reason: 'graph_v2_root_only' });
  });

  it('propagates the list read partial flag (cursor- or total-based truncation)', async () => {
    mockFetchSupervisorBead.mockResolvedValue(bead('root'));
    // listSupervisorBeads folds next_cursor / partial / total>fetched into one
    // `partial` flag (listIsIncomplete); the loader trusts it rather than
    // re-deriving from upstream_total, so cursor truncation is not missed.
    mockListSupervisorBeads.mockResolvedValue(list([bead('root')], { partial: true }));

    const load = await loadConvoyView('root');

    expect(load.partial).toBe(true);
  });

  it('does not treat a self-parent bead as its own child', async () => {
    mockFetchSupervisorBead.mockResolvedValue(bead('root'));
    mockListSupervisorBeads.mockResolvedValue(list([bead('root', { parent: 'root' })]));

    const load = await loadConvoyView('root');

    expect(load.view.exposure).toEqual({ kind: 'collapsed', reason: 'no_children' });
  });
});
