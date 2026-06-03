import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  GC_EVENT_PREFIX,
  type RunSummary,
  type SourceStatus,
  type RunLane,
  type SourceState,
} from 'gas-city-dashboard-shared';
import { setActiveCity } from '../api/cityBase';
import { invalidateKey } from '../api/cache';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor } from '../attention/compose';
import { RunsPage } from './Runs';
import { MemoryRouter } from 'react-router-dom';
import { NowProvider } from '../contexts/NowContext';
import { loadSupervisorRunSummarySource } from '../supervisor/runSummary';

// gascity-dashboard-bqn: regression coverage for the live-updates wiring
// on /runs. The actual SSE / coalesce / reconnect behavior lives in
// useGcEventRefresh (untested today — separate follow-up bead). These
// tests pin Runs.tsx's contract with that hook + with the api
// client's bypass-TTL refresh path.
//
// What's pinned here:
//   - useGcEventRefresh is called with GC_EVENT_PREFIX.bead and a function.
//   - <SseIndicator state={...} /> renders inside PageHeader meta.
//   - The manual Refresh button refetches the direct supervisor run summary,
//     not the dashboard snapshot facade.
//   - A burst of synthetic SSE matches within the in-component debounce
//     window produces AT MOST one direct run-summary refresh (architect H2
//     upstream-load protection).
//   - The SSE callback no-ops when runs.status !== 'fresh' so
//     fixture-fallback mode isn't hammered (architect H1).

vi.mock('../supervisor/runSummary', () => ({
  loadSupervisorRunSummarySource: vi.fn(),
}));

// Capture the prefixes + onMatch passed to useGcEventRefresh so each
// test can fire synthetic events into Runs' callback directly.
// Bypasses real EventSource — the hook's own coalesce / reconnect is
// not under test here.
const lastHookCall: { prefixes: ReadonlyArray<string> | null; onMatch: (() => void) | null } = {
  prefixes: null,
  onMatch: null,
};
vi.mock('../hooks/useGcEvents', () => ({
  useGcEventRefresh: vi.fn((prefixes: ReadonlyArray<string>, onMatch: () => void) => {
    lastHookCall.prefixes = prefixes;
    lastHookCall.onMatch = onMatch;
    return 'open' as const;
  }),
}));

const mockLoadRunSummary = loadSupervisorRunSummarySource as Mock;

function buildRunSource(
  runsStatus: Exclude<SourceStatus, 'error'> = 'fresh',
): SourceState<RunSummary> {
  return {
    source: 'runs',
    status: runsStatus,
    fetchedAt: '2026-05-25T00:00:00.000Z',
    staleAt: '2026-05-25T00:01:00.000Z',
    error: { kind: 'none' },
    data: {
      totalActive: 0,
      totalHistorical: 0,
      historicalLanes: [],
      runCounts: {
        total: 0,
        visible: 0,
        prReview: 0,
        designReview: 0,
        bugfix: 0,
        blocked: 0,
        other: 0,
      },
      lanes: [],
      recentChanges: [],
      census: { status: 'unavailable', error: 'run health has not been derived' },
    },
  };
}

function completedLane(): RunLane {
  return {
    id: 'done-root',
    title: 'Completed formula run',
    formula: { status: 'known', name: 'mol-adopt-pr-v2' },
    scope: {
      status: 'available',
      kind: 'city',
      ref: 'racoon-city',
      rootStoreRef: 'city:racoon-city',
    },
    external: { status: 'unavailable', error: 'external unavailable in test' },
    phase: 'complete',
    phaseLabel: 'complete',
    statusCounts: { closed: 2 },
    activeAssignees: [],
    updatedAt: { status: 'available', at: '2026-05-27T22:01:00Z' },
    stages: [
      { key: 'intake', label: 'Intake', status: 'complete' },
      { key: 'implementation', label: 'Implementation', status: 'complete' },
      { key: 'review', label: 'Review', status: 'complete' },
      { key: 'approval', label: 'Approval', status: 'complete' },
      { key: 'finalization', label: 'Finalization', status: 'complete' },
    ],
    progress: {
      status: 'stage_only',
      stage: {
        status: 'available',
        index: 4,
        key: 'finalization',
        label: 'Finalization',
      },
      error: 'active run step unavailable',
    },
    formulaStageResolved: false,
    health: {
      status: 'available',
      data: {
        phaseConfidence: 'known',
        needsOperator: false,
        stuckNode: { status: 'unavailable', error: 'run stuck node unavailable' },
        thrashingDetected: false,
        session: { status: 'unresolved', error: 'run session unresolved' },
      },
    },
  };
}

function requireRunData(source: SourceState<RunSummary>) {
  if (source.status === 'error') throw new Error(source.error);
  return source.data;
}

function activeLane(overrides: Partial<RunLane> = {}): RunLane {
  return {
    ...completedLane(),
    id: 'active-root',
    title: 'Active formula run',
    phase: 'implementation',
    phaseLabel: 'implementation',
    statusCounts: { in_progress: 1 },
    health: {
      status: 'available',
      data: {
        phaseConfidence: 'known',
        needsOperator: false,
        stuckNode: { status: 'unavailable', error: 'run stuck node unavailable' },
        thrashingDetected: false,
        session: { status: 'unresolved', error: 'run session unresolved' },
      },
    },
    ...overrides,
  };
}

function contributor(items: ReturnType<AttentionContributor['getItems']>): AttentionContributor {
  return {
    id: 'runs:test',
    domain: 'runs',
    getItems: () => items,
  };
}

beforeEach(() => {
  setActiveCity('racoon-city');
  mockLoadRunSummary.mockReset();
  lastHookCall.prefixes = null;
  lastHookCall.onMatch = null;
  invalidateKey('runs:summary:racoon-city');
  mockLoadRunSummary.mockResolvedValue(buildRunSource('fresh'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(
  initialPath = '/runs',
  contributors: readonly AttentionContributor[] = [],
) {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <NowProvider intervalMs={1_000_000}>
        <AttentionProvider contributors={contributors}>
          <RunsPage />
        </AttentionProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

async function waitForMount() {
  // Wait until the Refresh button mounts AND becomes enabled (loading
  // flips back to false after the initial fetcher resolves). Using the
  // disabled-to-enabled transition rather than text presence keeps the
  // wait stable across copy changes and avoids substring collisions
  // (the page renders both "Active" in CountsHeader and "active
  // runs" in the synopsis line).
  const btn = (await screen.findByRole('button', { name: /refresh/i })) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
}

describe('RunsPage — SSE wiring (gascity-dashboard-bqn)', () => {
  it('subscribes to useGcEventRefresh with [bead.] prefix', async () => {
    mount();
    await waitForMount();
    expect(lastHookCall.prefixes).toEqual([GC_EVENT_PREFIX.bead]);
    expect(typeof lastHookCall.onMatch).toBe('function');
  });

  it('renders the SseIndicator in PageHeader meta', async () => {
    mount();
    await waitForMount();
    // SseIndicator with state='open' renders a StatusBadge with label 'live'.
    expect(screen.getByText(/^live$/i)).toBeTruthy();
  });

  it('marks run lanes that match composed run attention without hiding other runs', async () => {
    const source = buildRunSource('fresh');
    const runs = requireRunData(source);
    const blocked = activeLane({
      id: 'blocked-root',
      title: 'Blocked formula run',
      phase: 'blocked',
      phaseLabel: 'blocked',
      statusCounts: { blocked: 1 },
      health: {
        status: 'available',
        data: {
          phaseConfidence: 'known',
          needsOperator: true,
          stuckNode: { status: 'unavailable', error: 'run stuck node unavailable' },
          thrashingDetected: false,
          session: { status: 'unresolved', error: 'run session unresolved' },
        },
      },
    });
    const calm = activeLane({
      id: 'calm-root',
      title: 'Calm formula run',
      phase: 'implementation',
      phaseLabel: 'implementation',
      statusCounts: { in_progress: 1 },
    });
    runs.totalActive = 2;
    runs.runCounts.total = 2;
    runs.runCounts.blocked = 1;
    runs.lanes = [blocked, calm];
    mockLoadRunSummary.mockResolvedValue(source);

    mount('/runs', [
      contributor([{
        id: 'runs:blocked-root:needs-operator',
        domain: 'runs',
        severity: 'attention',
        title: 'Blocked formula run needs operator',
      }]),
    ]);

    const blockedLink = await screen.findByRole('link', { name: /Blocked formula run/i });
    const calmLink = await screen.findByRole('link', { name: /Calm formula run/i });

    expect(blockedLink.closest('li')?.getAttribute('data-attention-severity')).toBe('attention');
    expect(calmLink.closest('li')?.getAttribute('data-attention-severity')).toBeNull();
  });

  it('does not flatten an unavailable run count into zero', async () => {
    mockLoadRunSummary.mockResolvedValue({
      source: 'runs',
      status: 'error',
      error: 'run collector unavailable in test',
    } satisfies SourceState<RunSummary>);

    mount();
    await waitForMount();

    expect(
      screen.getByText(/Run counts unavailable: run collector unavailable in test/i),
    ).toBeTruthy();
    expect(screen.queryByText(/^0 active runs/i)).toBeNull();
  });

  // yh5i: completed lanes now land in historicalLanes (toggle-visible),
  // not the default-visible `lanes`. The test below pins the new contract;
  // see the toggle tests further down for the ?history=1 reveal path.
  it('yh5i: hides completed formula runs from default view, shows them under ?history=1', async () => {
    const source = buildRunSource('fresh');
    const lane = completedLane();
    const runs = requireRunData(source);
    runs.totalActive = 0;
    runs.totalHistorical = 1;
    runs.lanes = [];
    runs.historicalLanes = [lane];
    runs.census = {
      status: 'available',
      data: {
        byPhase: {
          intake: 0,
          implementation: 0,
          review: 0,
          approval: 0,
          finalization: 0,
          blocked: 0,
          complete: 1,
          active: 0,
        },
        totalInFlight: 0,
        unverifiable: 0,
        knownDenominator: 0,
        thrashing: 0,
      },
    };
    mockLoadRunSummary.mockResolvedValue(source);

    // Default view (/runs): historical lane is hidden, empty-state
    // trailer hints at the count.
    mount();
    await waitForMount();
    expect(screen.queryByText('Completed formula run')).toBeNull();
    expect(
      screen.getByText(/No active formula runs\. \(1 completed\.\)/i),
    ).toBeTruthy();
    // The toggle button is enabled (totalHistorical > 0) and labeled
    // with the count.
    const toggleDefault = screen.getByRole('button', { name: /show 1 completed/i }) as HTMLButtonElement;
    expect(toggleDefault.disabled).toBe(false);
    expect(toggleDefault.getAttribute('aria-expanded')).toBe('false');
    cleanup();

    // History view (?history=1): the historical section renders the lane.
    mount('/runs?history=1');
    await waitForMount();
    expect(screen.getByText('Completed formula run')).toBeTruthy();
    const toggleHistory = screen.getByRole('button', { name: /hide historical/i }) as HTMLButtonElement;
    expect(toggleHistory.getAttribute('aria-expanded')).toBe('true');
    expect(toggleHistory.getAttribute('aria-controls')).toBeTruthy();
  });

  it('7hek: groups active lanes by rig under section headers and shows each root bead id', async () => {
    const source = buildRunSource('fresh');
    const runs = requireRunData(source);
    const laneA: RunLane = {
      ...completedLane(),
      id: 'gc-aaa',
      phase: 'approval',
      phaseLabel: 'approval',
      scope: { status: 'available', kind: 'rig', ref: 'gascity', rootStoreRef: 'rig:gascity' },
    };
    const laneB: RunLane = {
      ...completedLane(),
      id: 'gc-bbb',
      phase: 'approval',
      phaseLabel: 'approval',
      scope: {
        status: 'available',
        kind: 'rig',
        ref: 'gascity-packs',
        rootStoreRef: 'rig:gascity-packs',
      },
    };
    runs.totalActive = 2;
    runs.lanes = [laneA, laneB];
    mockLoadRunSummary.mockResolvedValue(source);

    mount();
    await waitForMount();
    // Rig section headers (the `rig:` prefix is stripped for display).
    expect(screen.getByText('gascity')).toBeTruthy();
    expect(screen.getByText('gascity-packs')).toBeTruthy();
    // Each run's root bead id is rendered so same-formula runs are distinguishable.
    expect(screen.getByText('gc-aaa')).toBeTruthy();
    expect(screen.getByText('gc-bbb')).toBeTruthy();
  });

  it('yh5i: toggle button is disabled when totalHistorical is 0', async () => {
    // Default run source has totalHistorical = 0.
    mount();
    await waitForMount();
    const toggle = screen.getByRole('button', {
      name: /no completed formula runs in the current window/i,
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // aria-controls must NOT reference a non-existent DOM id when the
    // historical section is not rendered (WAI-ARIA spec).
    expect(toggle.getAttribute('aria-controls')).toBeNull();
  });

  it('yh5i: toggle stays enabled when showHistory=true even if totalHistorical drops to 0', async () => {
    // Reachable via back-button + SSE refresh: URL has ?history=1 but the
    // last historical lane has since rolled out. The user must still be
    // able to dismiss the historical section.
    mount('/runs?history=1');
    await waitForMount();
    const toggle = screen.getByRole('button', { name: /hide historical/i }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(screen.getByText(/No completed runs in the current window/i)).toBeTruthy();
  });

  it('manual Refresh button refetches the direct supervisor run summary', async () => {
    mount();
    await waitForMount();
    // Reset to ignore the mount-effect call.
    mockLoadRunSummary.mockClear();

    const btn = screen.getByRole('button', { name: /refresh/i }) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });

    expect(mockLoadRunSummary).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of SSE matches to AT MOST one run-summary refresh within the debounce window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await waitForMount();
    mockLoadRunSummary.mockClear();

    // Simulate a busy slung pipeline: 5 onMatch calls within 1s. The
    // 10s in-component debounce floor must collapse this to a single
    // upstream POST. (useGcEventRefresh's own 2.5s coalesce sits in
    // front of onMatch in production; this test exercises ONLY the
    // Runs-side debounce we added per architect H2.)
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        lastHookCall.onMatch?.();
        await vi.advanceTimersByTimeAsync(50);
      }
    });

    // Within the 10s window, exactly one (the leading edge) fires.
    // `toBe(1)` rather than `toBeLessThanOrEqual(1)` so a regression
    // that suppresses the leading edge entirely (count would be 0) is
    // caught loudly.
    expect(mockLoadRunSummary.mock.calls.length).toBe(1);
  });

  it('fires a second run-summary refresh once the debounce window elapses', async () => {
    // Pins the trailing edge of the in-component debounce. The burst
    // test above proves we collapse a flurry to one POST; this test
    // proves we DON'T accidentally latch the gate shut forever. If a
    // future refactor drops the `lastRefreshAtRef.current = Date.now()`
    // reset (or fails to clear it on error), the second event would be
    // silently swallowed and the page would stop receiving live updates
    // until full reload. Catch that loudly here.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await waitForMount();
    mockLoadRunSummary.mockClear();

    // Leading edge: one event, one POST.
    await act(async () => {
      lastHookCall.onMatch?.();
    });
    expect(mockLoadRunSummary.mock.calls.length).toBe(1);

    // Advance past the 10s debounce floor (REFRESH_DEBOUNCE_MS = 10_000
    // in Runs.tsx; +100ms cushion so we're unambiguously past it).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });

    // Second event after the window must fire a second POST.
    await act(async () => {
      lastHookCall.onMatch?.();
    });
    expect(mockLoadRunSummary.mock.calls.length).toBe(2);
  });

  it('SSE callback no-ops when runs source status is not fresh', async () => {
    // First load returns a fixture-status source (gc supervisor is
    // down, committed fixtures are serving). SSE-driven force
    // refresh must NOT fire in this state — otherwise we hammer
    // loadFixture every coalesce-tick during a gc outage.
    mockLoadRunSummary.mockResolvedValue(buildRunSource('fixture'));
    mount();
    await waitForMount();
    mockLoadRunSummary.mockClear();

    await act(async () => {
      lastHookCall.onMatch?.();
    });

    expect(mockLoadRunSummary).not.toHaveBeenCalled();
  });
});

describe('RunsPage — partial lane set (gascity-dashboard-n6f1)', () => {
  it('surfaces a "runs partial" degraded signal when lanesPartial is set', async () => {
    const source = buildRunSource('fresh');
    requireRunData(source).lanesPartial = true;
    mockLoadRunSummary.mockResolvedValue(source);

    mount();
    await waitForMount();

    const marker = screen.getByText(/runs partial/i);
    expect(marker).toBeTruthy();
    expect(marker.getAttribute('role')).toBe('status');
  });

  it('omits the partial signal on a clean direct run source', async () => {
    mount();
    await waitForMount();

    expect(screen.queryByText(/runs partial/i)).toBeNull();
  });
});
