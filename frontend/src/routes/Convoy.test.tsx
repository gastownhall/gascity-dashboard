import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardBead } from 'gas-city-dashboard-shared';
import { projectConvoyView } from 'gas-city-dashboard-shared';
import { NowProvider } from '../contexts/NowContext';
import type { ConvoyLoad } from '../supervisor/convoyReads';
import { ConvoyPage } from './Convoy';
import { SupervisorApiError } from '../supervisor/client';

const mockLoadConvoyView = vi.hoisted(() => vi.fn());

vi.mock('../supervisor/convoyReads', () => ({
  loadConvoyView: mockLoadConvoyView,
}));

vi.mock('../hooks/useEntityLinks', () => ({
  useEntityLinks: () => ({ view: null, loading: false, error: null }),
}));

// Isolate the convoy page from the related-entity index and bead modal — both
// are exercised by their own suites; here we assert the convoy composition.
vi.mock('../components/RelatedEntities', () => ({ RelatedEntities: () => null }));
vi.mock('../components/BeadDetailModal', () => ({ BeadDetailModal: () => null }));

vi.mock('../api/client', () => ({
  formatApiError: (err: unknown, fallback = 'request failed') =>
    err instanceof Error ? err.message : fallback,
}));

vi.mock('../supervisor/client', () => ({
  SupervisorApiError: class extends Error {
    constructor(
      public readonly status: number | undefined,
      message: string,
      public readonly requestId?: string,
    ) {
      super(message);
    }
  },
}));

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

function loadFixture(
  root: DashboardBead,
  children: readonly DashboardBead[],
  partial = false,
): ConvoyLoad {
  return {
    view: projectConvoyView(root, children, null),
    partial,
  };
}

function renderConvoy(rootBeadId = 'root') {
  return render(
    <NowProvider>
      <MemoryRouter
        initialEntries={[`/convoy/${rootBeadId}`]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/convoy/:rootBead" element={<ConvoyPage />} />
        </Routes>
      </MemoryRouter>
    </NowProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ConvoyPage', () => {
  it('shows a loading state before the convoy resolves', () => {
    mockLoadConvoyView.mockReturnValue(new Promise(() => {}));
    renderConvoy();
    expect(screen.getByText('Loading convoy.')).toBeTruthy();
  });

  it('renders the step timeline with glyph+word status and the waiting-on set', async () => {
    const root = bead('root', {
      status: 'in_progress',
      metadata: { 'gc.formula': 'mol-pr-start' },
    });
    const children = [
      bead('a', { title: 'plan', status: 'closed', created_at: '2026-06-12T00:00:01Z' }),
      bead('b', {
        title: 'execute',
        status: 'open',
        needs: ['a', 'c'],
        created_at: '2026-06-12T00:00:02Z',
      }),
      bead('c', { title: 'review', status: 'in_progress', created_at: '2026-06-12T00:00:03Z' }),
    ];
    mockLoadConvoyView.mockResolvedValue(loadFixture(root, children));

    renderConvoy();

    expect(await screen.findByText('plan')).toBeTruthy();
    expect(screen.getByText('execute')).toBeTruthy();
    expect(screen.getByText('review')).toBeTruthy();
    expect(screen.getByText('closed')).toBeTruthy();
    // 'b' needs 'a' (closed → not blocking) and 'c' (in_progress → blocking).
    expect(screen.getByText('waiting on c')).toBeTruthy();
    // Formula name surfaces from metadata (page title + formula meta cell).
    expect(screen.getAllByText('mol-pr-start').length).toBeGreaterThan(0);
    expect(screen.getByText('1 of 3 steps closed.', { exact: false })).toBeTruthy();
  });

  it('degrades honestly when the supervisor collapses a graph.v2 run to its root', async () => {
    const root = bead('root', {
      status: 'in_progress',
      title: 'mol-focus-review',
      metadata: { 'gc.formula_contract': 'graph.v2', 'gc.run_target': 'city/claude-1' },
    });
    mockLoadConvoyView.mockResolvedValue(loadFixture(root, []));

    renderConvoy();

    expect(await screen.findByText(/does not expose this run/i)).toBeTruthy();
    expect(screen.getByText(/gascity-dashboard-jl3c/)).toBeTruthy();
  });

  it('warns when the formula name is a title fallback, not canonical metadata', async () => {
    const root = bead('root', {
      status: 'in_progress',
      title: 'mol-focus-review',
      metadata: { 'gc.formula_contract': 'graph.v2', 'gc.run_target': 'city/claude-1' },
    });
    mockLoadConvoyView.mockResolvedValue(loadFixture(root, [bead('a', { parent: 'root' })]));

    renderConvoy();

    expect(await screen.findByText('inferred from bead title')).toBeTruthy();
  });

  it('shows the partial-convoy notice when the bounded city read was truncated', async () => {
    const root = bead('root', {
      status: 'in_progress',
      metadata: { 'gc.formula': 'mol-pr-start' },
    });
    const children = [bead('a', { title: 'plan', status: 'closed', parent: 'root' })];
    mockLoadConvoyView.mockResolvedValue(loadFixture(root, children, true));

    renderConvoy();

    // Steps still render; the notice warns coverage may be incomplete rather
    // than implying the truncated read is the whole graph.
    expect(await screen.findByText('plan')).toBeTruthy();
    expect(screen.getByText(/Partial convoy: the city bead read was truncated/i)).toBeTruthy();
  });

  it('omits the partial notice when the read was complete', async () => {
    const root = bead('root', { metadata: { 'gc.formula': 'mol-pr-start' } });
    mockLoadConvoyView.mockResolvedValue(
      loadFixture(root, [bead('a', { title: 'plan', parent: 'root' })], false),
    );

    renderConvoy();

    expect(await screen.findByText('plan')).toBeTruthy();
    expect(screen.queryByText(/Partial convoy/i)).toBeNull();
  });

  it('renders an honest not-found state for a missing root bead', async () => {
    mockLoadConvoyView.mockRejectedValue(new SupervisorApiError(404, 'not found', undefined));
    renderConvoy('ghost');

    expect(await screen.findByText(/No bead with id/i)).toBeTruthy();
    expect(screen.getByText('ghost')).toBeTruthy();
  });

  it('surfaces a generic load failure as an alert', async () => {
    mockLoadConvoyView.mockRejectedValue(new Error('city offline'));
    renderConvoy();

    expect(await screen.findByText('city offline')).toBeTruthy();
  });
});
