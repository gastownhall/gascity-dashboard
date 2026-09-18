import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentResponse, Bead, Message } from 'gas-city-dashboard-shared/gc-supervisor';
import { ViewingAsProvider } from '../contexts/ViewingAsContext';
import { QuickJump } from './QuickJump';

const bead: Bead = {
  created_at: '2026-09-01T00:00:00Z',
  id: 'gcd-abc1',
  issue_type: 'bug',
  status: 'open',
  title: 'Fix the reef fleet render glitch',
};

const agent: AgentResponse = {
  available: true,
  display_name: 'Nux',
  name: 'dashboard/gastown.nux',
  running: true,
  state: 'working',
};

const mailItem: Message = {
  body: 'please review',
  created_at: '2026-09-01T00:00:00Z',
  from: 'mayor',
  id: 'msg-1',
  subject: 'Refinery queue update',
  to: 'operator',
};

vi.mock('../supervisor/beadReads', () => ({
  listSupervisorBeads: vi.fn(async () => ({
    fetch_limit: 1000,
    items: [bead],
    partial: false,
    total: 1,
    upstream_fetched: 1,
  })),
}));

vi.mock('../supervisor/agentReads', () => ({
  listSupervisorAgents: vi.fn(async () => ({ items: [agent], total: 1 })),
}));

vi.mock('../supervisor/mailReads', () => ({
  listSupervisorMail: vi.fn(async () => ({ items: [mailItem], total: 1 })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Records the current route so tests can assert QuickJump navigated without
// reaching into its internals.
function PathRecorder({ onPath }: { onPath: (path: string) => void }) {
  const location = useLocation();
  onPath(location.pathname + location.search);
  return null;
}

function renderQuickJump(open = true) {
  const onClose = vi.fn();
  let observedPath = '/';
  render(
    <ViewingAsProvider>
      <MemoryRouter
        initialEntries={['/']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route
            path="*"
            element={
              <>
                <QuickJump open={open} onClose={onClose} />
                <PathRecorder onPath={(p) => (observedPath = p)} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ViewingAsProvider>,
  );
  return { getObservedPath: () => observedPath, onClose };
}

describe('QuickJump', () => {
  it('is not present in the DOM when closed', () => {
    renderQuickJump(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a dialog and focuses the search input', async () => {
    renderQuickJump(true);
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
  });

  it('shows nothing until the operator types a query', async () => {
    renderQuickJump(true);
    await screen.findByRole('dialog');
    expect(screen.getByText(/type to search/i)).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('fuzzy-matches across beads, agents, and mail once loaded', async () => {
    renderQuickJump(true);
    const input = await screen.findByRole('combobox');

    fireEvent.change(input, { target: { value: 'reef' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /reef fleet/i })).toBeTruthy());

    fireEvent.change(input, { target: { value: 'nux' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /nux/i })).toBeTruthy());

    fireEvent.change(input, { target: { value: 'refinery' } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /refinery queue/i })).toBeTruthy(),
    );
  });

  it('moves the active option with ArrowDown/ArrowUp and navigates on Enter', async () => {
    const { getObservedPath, onClose } = renderQuickJump(true);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'e' } }); // matches all three fixtures
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));

    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getObservedPath()).not.toBe('/'));
  });

  it('navigates to the clicked result and closes', async () => {
    const { onClose } = renderQuickJump(true);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'reef' } });
    const option = await screen.findByRole('option', { name: /reef fleet/i });
    fireEvent.click(option);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a "no matches" row for an unmatched query instead of a silent empty list', async () => {
    renderQuickJump(true);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzzzzzz-no-such-thing' } });
    await waitFor(() => expect(screen.getByText(/no matches/i)).toBeTruthy());
  });
});
