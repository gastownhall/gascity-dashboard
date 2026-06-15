import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyRunSummary, MAX_VISIBLE_ACTIVE_LANES } from 'gas-city-dashboard-shared';
import type { RunHistory, RunLane, RunSummary, SourceState } from 'gas-city-dashboard-shared';
import { RunMap } from './RunMap';

afterEach(() => cleanup());

function historicalLane(id: string): RunLane {
  return {
    id,
    title: `Completed run ${id}`,
    formula: { status: 'known', name: 'mol-focus-review' },
    scope: {
      status: 'available',
      kind: 'city',
      ref: 'racoon-city',
      rootStoreRef: 'city:racoon-city',
    },
    external: { status: 'unavailable', error: 'external unavailable in test' },
    phase: 'complete',
    phaseLabel: 'complete',
    statusCounts: { closed: 1 },
    activeAssignees: [],
    updatedAt: { status: 'available', at: '2026-05-24T12:00:00Z' },
    stages: [],
    progress: { status: 'unavailable', error: 'run progress unavailable in test' },
    formulaStageResolved: false,
    registration: 'unknown',
    health: { status: 'unavailable', error: 'run health has not been derived' },
  };
}

function emptySummarySource(): SourceState<RunSummary> {
  return {
    source: 'runs',
    status: 'fresh',
    fetchedAt: '2026-05-24T12:00:00Z',
    staleAt: '2026-05-24T12:01:00Z',
    error: { kind: 'none' },
    data: emptyRunSummary(),
  };
}

// Header-first: history is its own lazy source rendered by RunMap's
// historical section, not a field on the run summary.
function historySource(
  lanes: RunLane[],
  totalHistorical = lanes.length,
  lanesPartial = false,
): SourceState<RunHistory> {
  return {
    source: 'runs',
    status: 'fresh',
    fetchedAt: '2026-05-24T12:00:00Z',
    staleAt: '2026-05-24T12:01:00Z',
    error: { kind: 'none' },
    data: {
      totalHistorical,
      lanes,
      ...(lanesPartial ? { lanesPartial: true } : {}),
    },
  };
}

function makeLanes(count: number): RunLane[] {
  return Array.from({ length: count }, (_, i) => historicalLane(`gc-hist-${i}`));
}

function renderHistory(lanes: RunLane[], totalHistorical?: number) {
  return renderHistorySource(historySource(lanes, totalHistorical));
}

function renderHistorySource(history: SourceState<RunHistory> | undefined, historyLoading = false) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <RunMap
        source={emptySummarySource()}
        now={Date.parse('2026-05-24T12:01:00Z')}
        showHistory={true}
        history={history}
        historyLoading={historyLoading}
      />
    </MemoryRouter>,
  );
}

describe('RunMap historical expand-in-place (gascity-dashboard-l9q9)', () => {
  it('previews 5 lanes with a Show-more toggle instead of a static footnote', () => {
    const lanes = makeLanes(7);
    renderHistory(lanes);

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByText(/more not shown/i)).toBeNull();

    const toggle = within(section).getByRole('button', { name: /show 2 more/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands to all lanes in place and collapses back', () => {
    const lanes = makeLanes(7);
    renderHistory(lanes);

    const section = screen.getByRole('region', { name: /historical runs/i });
    fireEvent.click(within(section).getByRole('button', { name: /show 2 more/i }));

    expect(within(section).getAllByRole('listitem')).toHaveLength(7);
    const collapse = within(section).getByRole('button', { name: /show fewer/i });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
  });

  it('renders no toggle when the historical set fits the preview', () => {
    const lanes = makeLanes(5);
    renderHistory(lanes);

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
    expect(within(section).queryByRole('button')).toBeNull();
  });
});

function activeLane(id: string): RunLane {
  return {
    id,
    title: `Active run ${id}`,
    formula: { status: 'known', name: 'mol-adopt-pr-v2' },
    scope: {
      status: 'available',
      kind: 'city',
      ref: 'racoon-city',
      rootStoreRef: 'city:racoon-city',
    },
    external: { status: 'unavailable', error: 'external unavailable in test' },
    phase: 'implementation',
    phaseLabel: 'implementation',
    statusCounts: { in_progress: 1 },
    activeAssignees: [],
    updatedAt: { status: 'available', at: '2026-05-24T12:00:00Z' },
    stages: [],
    progress: { status: 'unavailable', error: 'run progress unavailable in test' },
    formulaStageResolved: false,
    registration: 'unknown',
    health: { status: 'unavailable', error: 'run health has not been derived' },
  };
}

function blockedLane(id: string): RunLane {
  return { ...activeLane(id), title: `Blocked run ${id}`, phase: 'blocked', phaseLabel: 'blocked' };
}

function strandedLane(id: string): RunLane {
  return {
    ...activeLane(id),
    title: `Stranded run ${id}`,
    phase: 'intake',
    phaseLabel: 'intake',
    registration: 'stranded',
  };
}

function strandedSummarySource(strandedLanes: RunLane[]): SourceState<RunSummary> {
  return {
    source: 'runs',
    status: 'fresh',
    fetchedAt: '2026-05-24T12:00:00Z',
    staleAt: '2026-05-24T12:01:00Z',
    error: { kind: 'none' },
    data: {
      ...emptyRunSummary(),
      strandedLanes,
      runCounts: { ...emptyRunSummary().runCounts, stranded: strandedLanes.length },
    },
  };
}

function makeActiveLanes(count: number): RunLane[] {
  return Array.from({ length: count }, (_, i) => activeLane(`gc-active-${i}`));
}

function summarySource(lanes: RunLane[], blockedLanes: RunLane[] = []): SourceState<RunSummary> {
  return {
    source: 'runs',
    status: 'fresh',
    fetchedAt: '2026-05-24T12:00:00Z',
    staleAt: '2026-05-24T12:01:00Z',
    error: { kind: 'none' },
    data: { ...emptyRunSummary(), totalActive: lanes.length, lanes, blockedLanes },
  };
}

function renderRunMap(
  summary: SourceState<RunSummary>,
  history: SourceState<RunHistory> | undefined,
) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <RunMap
        source={summary}
        now={Date.parse('2026-05-24T12:01:00Z')}
        showHistory={true}
        history={history}
        historyLoading={false}
      />
    </MemoryRouter>,
  );
}

function renderActive(lanes: RunLane[]) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <RunMap
        source={{
          source: 'runs',
          status: 'fresh',
          fetchedAt: '2026-05-24T12:00:00Z',
          staleAt: '2026-05-24T12:01:00Z',
          error: { kind: 'none' },
          data: { ...emptyRunSummary(), totalActive: lanes.length, lanes },
        }}
        now={Date.parse('2026-05-24T12:01:00Z')}
        showHistory={false}
      />
    </MemoryRouter>,
  );
}

describe('RunMap stranded section (gascity-dashboard-pxvb)', () => {
  it('renders stranded lanes in their own labeled section with a count and remedy', () => {
    renderRunMap(strandedSummarySource([strandedLane('gc-odssky')]), undefined);

    const section = screen.getByRole('region', { name: /stranded runs/i });
    expect(within(section).getByText(/Stranded \(1\)/)).toBeTruthy();
    expect(within(section).getByText(/Stranded run gc-odssky/)).toBeTruthy();
    // The operator remedy (selectStrandedRuns) makes the row actionable.
    expect(within(section).getByText(/re-dispatch/i)).toBeTruthy();
  });

  it('shows a Stranded count tile in the header and omits the section when empty', () => {
    const { rerender } = renderRunMap(
      strandedSummarySource([strandedLane('gc-odssky')]),
      undefined,
    );
    expect(screen.getByText('Stranded')).toBeTruthy();

    rerender(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <RunMap
          source={strandedSummarySource([])}
          now={Date.parse('2026-05-24T12:01:00Z')}
          showHistory={true}
          history={undefined}
          historyLoading={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region', { name: /stranded runs/i })).toBeNull();
    expect(screen.queryByText('Stranded')).toBeNull();
  });
});

describe('RunMap active expand-in-place (lane-cap expander)', () => {
  it('collapses to MAX_VISIBLE_ACTIVE_LANES with a Show-more toggle, no static footnote', () => {
    const lanes = makeActiveLanes(MAX_VISIBLE_ACTIVE_LANES + 1);
    renderActive(lanes);

    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_VISIBLE_ACTIVE_LANES);
    expect(screen.queryByText(/more not shown/i)).toBeNull();

    const toggle = screen.getByRole('button', { name: /show 1 more runs/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands to all active lanes in place and collapses back', () => {
    const total = MAX_VISIBLE_ACTIVE_LANES + 1;
    const lanes = makeActiveLanes(total);
    renderActive(lanes);

    fireEvent.click(screen.getByRole('button', { name: /show 1 more runs/i }));
    expect(screen.getAllByRole('listitem')).toHaveLength(total);

    const collapse = screen.getByRole('button', { name: /show fewer/i });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_VISIBLE_ACTIVE_LANES);
  });

  it('renders no toggle when the active set fits the collapsed window', () => {
    renderActive(makeActiveLanes(MAX_VISIBLE_ACTIVE_LANES));

    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_VISIBLE_ACTIVE_LANES);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('drives the expander off the RENDERED lane count, not totalActive', () => {
    // Self-consistency guard (mirrors the Historical section): the toggle's
    // visibility AND its "N more" label both derive from summary.lanes.length —
    // the collection actually rendered — not from totalActive. Feed a totalActive
    // that disagrees with the lane count to prove the dependency is gone.
    const lanes = makeActiveLanes(MAX_VISIBLE_ACTIVE_LANES + 2);
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <RunMap
          source={{
            source: 'runs',
            status: 'fresh',
            fetchedAt: '2026-05-24T12:00:00Z',
            staleAt: '2026-05-24T12:01:00Z',
            error: { kind: 'none' },
            // totalActive deliberately disagrees with lanes.length.
            data: { ...emptyRunSummary(), totalActive: 999, lanes },
          }}
          now={Date.parse('2026-05-24T12:01:00Z')}
          showHistory={false}
        />
      </MemoryRouter>,
    );

    // Label reads lanes.length - MAX_VISIBLE (2), NOT totalActive - MAX_VISIBLE.
    expect(screen.getByRole('button', { name: /show 2 more runs/i })).toBeTruthy();
  });
});

describe('RunMap historical recency-cap disclosure (gascity-dashboard-9w3k)', () => {
  it('discloses the cap when totalHistorical exceeds the rendered lane count', () => {
    // The wire caps historicalLanes at MAX_HISTORICAL_LANES but totalHistorical
    // reports the true completed count, so the section must say it is a window.
    const lanes = makeLanes(50);
    renderHistory(lanes, 60);

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).getByText(/showing 50 most-recent of 60/i)).toBeTruthy();
  });

  it('omits the disclosure when the full history fits the wire', () => {
    const lanes = makeLanes(7);
    renderHistory(lanes);

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).queryByText(/most-recent of/i)).toBeNull();
  });
});

// Header-first: the historical section owns its lazy source's loading /
// unavailable / partial states, so the operator always knows whether an empty
// section means "no completed runs", "still fetching", or "could not read".
describe('RunMap historical lazy-source states (header-first)', () => {
  it('shows a loading state before the first history read lands', () => {
    renderHistorySource(undefined, true);

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).getByText(/Loading completed runs\./i)).toBeTruthy();
    expect(within(section).queryByRole('listitem')).toBeNull();
  });

  it('shows an unavailable state when the history read failed', () => {
    renderHistorySource({
      source: 'runs',
      status: 'error',
      error: 'gc supervisor request timed out after 30000ms',
    });

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(
      within(section).getByText(
        /Completed runs unavailable: gc supervisor request timed out after 30000ms\./i,
      ),
    ).toBeTruthy();
  });

  it('renders the loading state while a retry is in flight after an error', () => {
    renderHistorySource({ source: 'runs', status: 'error', error: 'transient timeout' }, true);

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).getByText(/Loading completed runs\./i)).toBeTruthy();
  });

  it('pairs a history-partial notice with the lanes when the fan-out degraded', () => {
    renderHistorySource(historySource(makeLanes(2), 2, true));

    const section = screen.getByRole('region', { name: /historical runs/i });
    const marker = within(section).getByRole('status');
    expect(marker.textContent).toContain('◐');
    expect(marker.textContent).toContain('history partial');
    // The lanes still render alongside the degradation signal.
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('flags stale history with a glyph+word cue when a refresh fails after a good load', () => {
    // useRunHistory re-publishes the last good payload as 'stale' when an
    // explicit refresh fails after a good load (last-good retention). The
    // section must NOT render that indistinguishably from a fresh read: a
    // visible stale cue is what keeps the silently-behind data honest and the
    // reopen-reuses-cache retry suppression operator-visible.
    renderHistorySource({
      source: 'runs',
      status: 'stale',
      fetchedAt: '2026-05-24T12:00:00Z',
      staleAt: '2026-05-24T12:01:00Z',
      error: { kind: 'none' },
      data: { totalHistorical: 2, lanes: makeLanes(2) },
    });

    const section = screen.getByRole('region', { name: /historical runs/i });
    const marker = within(section).getByRole('status');
    expect(marker.textContent).toContain('◐');
    expect(marker.textContent).toContain('history stale');
    // Last-good completed lanes still render alongside the stale signal.
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('omits the partial notice on a clean history read', () => {
    renderHistory(makeLanes(2));

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).queryByRole('status')).toBeNull();
  });

  it('says so when a clean history read finds no completed runs', () => {
    renderHistory([]);

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).getByText(/No completed runs in the current window\./i)).toBeTruthy();
  });

  it('renders a single status cue when stale history is also partial (one mark per region)', () => {
    // DESIGN.md "One mark per region": a payload that is both stale (a failed
    // refresh re-published the last-good set) AND partial (a degraded fan-out)
    // must not stack "history stale" beside "history partial". The stale cue —
    // the more urgent "this is behind, press Refresh" signal — wins.
    renderHistorySource({
      source: 'runs',
      status: 'stale',
      fetchedAt: '2026-05-24T12:00:00Z',
      staleAt: '2026-05-24T12:01:00Z',
      error: { kind: 'none' },
      data: { totalHistorical: 2, lanes: makeLanes(2), lanesPartial: true },
    });

    const section = screen.getByRole('region', { name: /historical runs/i });
    expect(within(section).getAllByRole('status')).toHaveLength(1);
    expect(within(section).getByRole('status').textContent).toContain('history stale');
    expect(within(section).queryByText(/history partial/i)).toBeNull();
  });
});

// Header-first split the formerly-single run summary into a live active+blocked
// source (SSE-refreshed) and a lazy, cache-backed history source (refreshed only
// on open / explicit Refresh). The two now run on independent clocks, so a run
// that was `complete` when history last loaded can reactivate into the live set
// before history is refreshed. RunMap reconciles at the render boundary so the
// live set always wins and a run is never double-rendered or double-counted.
describe('RunMap reconciles lazy history against the live summary (header-first skew)', () => {
  it('drops a completed run that is active again so it never renders in both sections', () => {
    renderRunMap(
      summarySource([activeLane('gc-shared'), activeLane('gc-other')]),
      historySource([historicalLane('gc-shared'), historicalLane('gc-keep')], 2),
    );

    const historical = screen.getByRole('region', { name: /historical runs/i });
    // The reactivated run is gone from Historical...
    expect(within(historical).queryByText(/Completed run gc-shared/i)).toBeNull();
    // ...the still-complete run remains...
    expect(within(historical).getByText(/Completed run gc-keep/i)).toBeTruthy();
    // ...and the reactivated run renders only in the live Active set.
    expect(screen.getByText(/Active run gc-shared/i)).toBeTruthy();
  });

  it('reconciles against blocked lanes and subtracts them from the completed count', () => {
    // A completed run that is now BLOCKED leaves Active empty, so the
    // "(N completed.)" hint shows — and must show the decremented count, not the
    // raw totalHistorical that still includes the now-live run.
    renderRunMap(
      summarySource([], [blockedLane('gc-blocked')]),
      historySource([historicalLane('gc-blocked'), historicalLane('gc-keep')], 2),
    );

    // 2 completed minus the 1 now-blocked run = 1.
    expect(screen.getByText(/No active formula runs\. \(1 completed\.\)/i)).toBeTruthy();
    const historical = screen.getByRole('region', { name: /historical runs/i });
    expect(within(historical).queryByText(/Completed run gc-blocked/i)).toBeNull();
    expect(within(historical).getByText(/Completed run gc-keep/i)).toBeTruthy();
  });

  it('leaves history untouched when no completed run is live', () => {
    renderRunMap(
      summarySource([activeLane('gc-active-only')]),
      historySource([historicalLane('gc-h1'), historicalLane('gc-h2')], 2),
    );

    const historical = screen.getByRole('region', { name: /historical runs/i });
    expect(within(historical).getAllByRole('listitem')).toHaveLength(2);
  });

  it('reconciles a STALE history payload, dropping a now-live run while keeping the stale cue', () => {
    // The skew is worst for a STALE payload: a failed refresh is serving an old
    // completed set while the live summary has already moved the run back to
    // Active. Reconciliation must run on the stale path too, and the stale cue
    // must still surface alongside the reconciled set.
    const staleHistory: SourceState<RunHistory> = {
      source: 'runs',
      status: 'stale',
      fetchedAt: '2026-05-24T12:00:00Z',
      staleAt: '2026-05-24T12:01:00Z',
      error: { kind: 'none' },
      data: {
        totalHistorical: 2,
        lanes: [historicalLane('gc-shared'), historicalLane('gc-keep')],
      },
    };
    renderRunMap(summarySource([activeLane('gc-shared')]), staleHistory);

    const historical = screen.getByRole('region', { name: /historical runs/i });
    expect(within(historical).queryByText(/Completed run gc-shared/i)).toBeNull();
    expect(within(historical).getByText(/Completed run gc-keep/i)).toBeTruthy();
    expect(within(historical).getByRole('status').textContent).toContain('history stale');
  });
});
