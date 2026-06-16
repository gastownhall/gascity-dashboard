import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import type {
  Bead,
  FormulaFeedBody,
  ListBodyBead,
  ListBodySessionResponse,
  MonitorFeedItemResponse,
} from 'gas-city-dashboard-shared/gc-supervisor';
import { resetSupervisorApiForTests, setSupervisorApiForTests, type SupervisorApi } from './client';
import { SupervisorApiError } from './errors';
import {
  CORE_RUN_SUMMARY_TIMEOUT_MS,
  loadSupervisorRunHistorySource,
  loadSupervisorRunSummaryActiveSource,
  loadSupervisorRunSummaryMountSource,
  loadSupervisorRunSummaryPreviewSource,
  loadSupervisorRunSummarySource,
  resetSupervisorRunSummaryStateForTests,
} from './runSummary';

const baseApi: SupervisorApi = {
  baseUrl: '/gc-supervisor',
  health: vi.fn(),
  cityHealth: vi.fn(),
  cityStatus: vi.fn(),
  listCities: vi.fn(),
  listAgents: vi.fn(),
  listRigs: vi.fn(),
  listBeads: vi.fn(),
  listEvents: vi.fn(),
  getBead: vi.fn(),
  beadsGraph: vi.fn(),
  createBead: vi.fn(),
  updateBead: vi.fn(),
  closeBead: vi.fn(),
  nudgeAgent: vi.fn(),
  agentPrime: vi.fn(),
  sling: vi.fn(),
  formulaFeed: vi.fn(),
  listMail: vi.fn(),
  markMailRead: vi.fn(),
  markMailUnread: vi.fn(),
  archiveMail: vi.fn(),
  replyMail: vi.fn(),
  sendMail: vi.fn(),
  mailThread: vi.fn(),
  cityEventStreamUrl: vi.fn(),
  sessionStreamUrl: vi.fn(),
  listSessions: vi.fn(),
  sessionPending: vi.fn(),
  respondSession: vi.fn(),
  sessionTranscript: vi.fn(),
  workflowRun: vi.fn(),
  formulaDetail: vi.fn(),
  mutationHeaders: () => ({ 'X-GC-Request': 'dashboard' }),
};

describe('loadSupervisorRunSummaryPreviewSource', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    resetSupervisorRunSummaryStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    resetSupervisorApiForTests();
    resetSupervisorRunSummaryStateForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('builds a first-paint summary from the cheap core read + feed only (header-first)', async () => {
    // Header-first restructure: the default summary path pays ONLY the core
    // active read (measured ~0.02s) and the formula-feed discovery. The
    // molecule(all=true) history scan (measured 9.9s) and the per-rig
    // task(all=true) closed-history reads (measured 10.9s on the largest rig)
    // exist solely for the lazy history payload and must never fire here.
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    const formulaFeed = vi.fn(async () => feed([feedRun()]));
    const listSessions = vi.fn(async () => sessionList());
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed,
      listSessions,
    });

    const source = await loadSupervisorRunSummaryPreviewSource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanes[0]?.id).toBe('run-1');
    expect(source.data.lanes[0]?.health.status).toBe('unavailable');
    expect(listBeads).toHaveBeenCalledTimes(1);
    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 500 });
    expect(formulaFeed).toHaveBeenCalledWith('test-city', {
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('marks the summary partial when the slow feed exceeds the tight first-paint budget (gascity-dashboard-4bol)', async () => {
    // First paint blocks on the preview load, so it keeps a tight 2.5s budget: a
    // city feed that takes 14s on a slow supervisor degrades to partial rather
    // than holding the tab blank. The wider refresh budget then clears it.
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    const formulaFeed = vi.fn(
      async () =>
        new Promise<FormulaFeedBody>((resolve) => {
          setTimeout(() => resolve(feed([feedRun()])), 14_000);
        }),
    );
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed,
      listSessions: vi.fn(async () => sessionList()),
    });

    const pending = loadSupervisorRunSummaryPreviewSource();
    await vi.advanceTimersByTimeAsync(2_500);
    const source = await pending;

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanesPartial).toBe(true);
  });
});

describe('loadSupervisorRunSummarySource', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    resetSupervisorRunSummaryStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    resetSupervisorApiForTests();
    resetSupervisorRunSummaryStateForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('builds the run summary from the core read, feed, and sessions (header-first)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // The active run's open/in-progress step beads ride the SAME core active
    // read — no per-rig all=true fan-out is needed for phase derivation.
    const listBeads = vi.fn(async () =>
      beadList([
        runRoot(),
        bead({
          id: 'run-1-step-1',
          title: 'Implementation patch',
          status: 'in_progress',
          metadata: {
            'gc.kind': 'step',
            'gc.root_bead_id': 'run-1',
            'gc.parent_bead_id': 'run-1',
            'gc.step_id': 'implementation.patch',
          },
        }),
      ]),
    );
    const formulaFeed = vi.fn(async () => feed([feedRun()]));
    const listSessions = vi.fn(async () => sessionList());
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed,
      listSessions,
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.fetchedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanes).toHaveLength(1);
    expect(source.data.lanes[0]).toMatchObject({
      id: 'run-1',
      title: 'Adopt PR #42',
      phase: 'implementation',
      scope: {
        status: 'available',
        kind: 'rig',
        ref: 'rig-a',
        rootStoreRef: 'rig:rig-a',
      },
      statusCounts: { open: 1, in_progress: 1 },
    });
    expect(source.data.census.status).toBe('available');
    // Header-first: ONLY the cheap core read — no molecule(all=true) scan and
    // no per-rig task(all=true) reads on the refresh path.
    expect(listBeads).toHaveBeenCalledTimes(1);
    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 500 });
    expect(formulaFeed).toHaveBeenCalledWith('test-city', {
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
    expect(listSessions).toHaveBeenCalledWith('test-city');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forceFresh marks ONLY the proxy-cached feed read for cache bypass (gascity-dashboard-i3dz)', async () => {
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    const formulaFeed = vi.fn(async () => feed([feedRun()]));
    const listSessions = vi.fn(async () => sessionList());
    setSupervisorApiForTests({ ...baseApi, listBeads, formulaFeed, listSessions });

    const source = await loadSupervisorRunSummarySource({ forceFresh: true });
    expect(source.status).toBe('fresh');

    // The proxy-cached city-wide feed read carries the bypass option...
    expect(formulaFeed).toHaveBeenCalledWith(
      'test-city',
      { scope_kind: 'city', scope_ref: 'test-city' },
      { cacheBypass: true },
    );
    // ...while the uncached core-active read keeps the plain two-arg call (no
    // options object), so it is never marked for bypass.
    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 500 });
  });

  it('a normal (non-forceFresh) wide refresh leaves the cacheable feed on the plain cacheable call', async () => {
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    const formulaFeed = vi.fn(async () => feed([feedRun()]));
    const listSessions = vi.fn(async () => sessionList());
    setSupervisorApiForTests({ ...baseApi, listBeads, formulaFeed, listSessions });

    await loadSupervisorRunSummarySource();

    // No bypass option is attached, so the proxy keeps serving its amortized
    // cache for preview/SSE/upgrade reads.
    expect(formulaFeed).toHaveBeenCalledWith('test-city', {
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
  });

  it('derives a rig lane scope from the feed root_store_ref even when the feed scope_kind is city (q89b detail scope leak)', async () => {
    // The formula feed's top-level scope_kind is always 'city'; the rig identity
    // lives only in root_store_ref. When the root bead carries no scope metadata
    // (scope must come from the feed map), the lane must still resolve to its rig
    // scope so the detail href carries it and the workflow fetch hits the fast
    // single-store path — not the city-wide full-store scan.
    const rootNoScope = runRoot({
      id: 'run-2',
      metadata: {
        'gc.kind': 'run',
        'gc.formula': 'mol-adopt-pr-v2',
        'gc.formula_contract': 'graph.v2',
      },
    });
    const listBeads = vi.fn(async () => beadList([rootNoScope]));
    const cityScopedFeedRun = feedRun({
      id: 'run-2',
      root_bead_id: 'run-2',
      workflow_id: 'run-2',
      root_store_ref: 'rig:rig-b',
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([cityScopedFeedRun])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    const lane = source.data.lanes.find((l) => l.id === 'run-2');
    expect(lane?.scope).toEqual({
      status: 'available',
      kind: 'rig',
      ref: 'rig-b',
      rootStoreRef: 'rig:rig-b',
    });
  });

  it('does not emit a malformed feed root_store_ref as the lane scope (validates against SCOPE_REF_RE)', async () => {
    // The store-ref-first branch in discoverFromFeed must validate the parsed
    // ref against SCOPE_REF_RE before using it — fromStoreRef does not validate,
    // so a malformed root_store_ref like 'rig:bad ref@!' would otherwise become a
    // scope_ref the detail route rejects. It must fall back to the feed scope.
    const rootNoScope = runRoot({
      id: 'run-3',
      metadata: {
        'gc.kind': 'run',
        'gc.formula': 'mol-adopt-pr-v2',
        'gc.formula_contract': 'graph.v2',
      },
    });
    const listBeads = vi.fn(async () => beadList([rootNoScope]));
    const malformedFeedRun = feedRun({
      id: 'run-3',
      root_bead_id: 'run-3',
      workflow_id: 'run-3',
      root_store_ref: 'rig:bad ref@!',
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([malformedFeedRun])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    const lane = source.data.lanes.find((l) => l.id === 'run-3');
    expect(lane?.scope).toMatchObject({
      status: 'available',
      kind: 'city',
      ref: 'test-city',
    });
    if (lane?.scope.status === 'available') {
      expect(lane.scope.ref).not.toBe('bad ref@!');
    }
  });

  it('enriches blocked lanes with health and keeps them out of the active set (gascity-dashboard-4xcv)', async () => {
    // gc-1920 repro: a stale blocked formula latch must land in
    // blockedLanes (with derived health, so attention still sees it),
    // never in lanes/totalActive.
    const listBeads = vi.fn(async () =>
      beadList([
        runRoot(),
        runRoot({
          id: 'gc-1920',
          title: 'mol-focus-review',
          status: 'blocked',
          metadata: {
            'gc.kind': 'workflow',
            'gc.formula_contract': 'graph.v2',
            'gc.scope_kind': 'city',
            'gc.scope_ref': 'test-city',
            'gc.root_store_ref': 'city:test-city',
          },
        }),
      ]),
    );
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['run-1']);
    expect(source.data.blockedLanes.map((lane) => lane.id)).toEqual(['gc-1920']);
    expect(source.data.blockedLanes[0]?.health.status).toBe('available');
    expect(source.data.runCounts.blocked).toBe(1);
  });

  // gascity-dashboard-s4rp: the gc-1920 phantom now surfaces NOT as blocked but
  // as a stale session-less approval latch — counted Active:1 despite no live
  // session, no in_progress step, and ~4d since its last write. Enrichment must
  // demote it out of the Active set and count once sessions resolve.
  function staleLatch(): Bead {
    return runRoot({
      id: 'gc-1920',
      title: 'mol-focus-review',
      description: 'Focus + in-session review formula. Approval gate, review.',
      status: 'open',
      updated_at: '2026-05-28T00:00:00.000Z',
      metadata: {
        'gc.kind': 'run',
        'gc.formula_contract': 'graph.v2',
        'gc.scope_kind': 'city',
        'gc.scope_ref': 'test-city',
        'gc.root_store_ref': 'city:test-city',
      },
    });
  }

  it('demotes a stale session-less approval latch out of the Active set (gascity-dashboard-s4rp)', async () => {
    const listBeads = vi.fn(async () =>
      beadList([
        runRoot(),
        staleLatch(),
        bead({
          id: 'run-1-step-1',
          title: 'Implementation patch',
          status: 'in_progress',
          updated_at: '2026-06-01T11:55:00.000Z',
          metadata: {
            'gc.kind': 'step',
            'gc.root_bead_id': 'run-1',
            'gc.step_id': 'implementation.patch',
          },
        }),
      ]),
    );
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    // run-1 has an in_progress step and stays Active; gc-1920 is demoted out of
    // the Active set, count, AND the blocked bucket (dropped).
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['run-1']);
    expect(source.data.blockedLanes).toEqual([]);
    expect(source.data.runCounts.total).toBe(1);
  });

  it('keeps a session-less recent latch in the Active set (gascity-dashboard-s4rp)', async () => {
    // Same shape as the stale latch but written 30 minutes ago — a recent
    // session-less latch must still appear as Active (not demoted by liveness).
    const listBeads = vi.fn(async () =>
      beadList([{ ...staleLatch(), updated_at: '2026-06-01T11:30:00.000Z' }]),
    );
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['gc-1920']);
    // gascity-dashboard-q3p1: this latch is a bare root with NO step beads, so
    // phase comes from the tightened keyword fallback. Its title
    // ('mol-focus-review') carries a 'review' signal → 'review'. The old
    // assertion was 'approval', which was the bug itself: the OLD scan read
    // 'approval'/'gate' out of the run's DESCRIPTION ("Approval gate, review.")
    // even though no approval-gate step exists. The lane staying Active — the
    // actual subject of this test — is unchanged.
    expect(source.data.lanes[0]?.phase).toBe('review');
  });

  it('demotes a phantom exactly even when active runs exceed the visible cap (gascity-dashboard-s4rp)', async () => {
    // Demotion runs on the FULL active set, not the capped window, so totalActive
    // is exact: a phantom is removed from the count even with >8 active runs.
    const liveRuns = Array.from({ length: 9 }, (_, i) =>
      runRoot({
        id: `live-${i}`,
        title: `Live run ${i}`,
        status: 'open',
        updated_at: '2026-06-01T11:55:00.000Z',
        metadata: {
          'gc.kind': 'run',
          'gc.formula_contract': 'graph.v2',
          'gc.scope_kind': 'city',
          'gc.scope_ref': 'test-city',
          'gc.root_store_ref': 'city:test-city',
        },
      }),
    );
    const listBeads = vi.fn(async () => beadList([...liveRuns, staleLatch()]));
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(9);
    // gascity-dashboard: `lanes` carries the FULL active set now — the rendered
    // 8-lane collapse is applied by RunMap, not the wire.
    expect(source.data.lanes).toHaveLength(9);
    expect(source.data.lanes.map((lane) => lane.id)).not.toContain('gc-1920');
    // The phantom (the 10th, session-less latch) is demoted; all 9 live runs survive.
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(liveRuns.map((_, i) => `live-${i}`));
    expect(source.data.runCounts.total).toBe(9);
    expect(source.data.runCounts.visible).toBe(9);
  });

  it('keeps available lanes while marking the summary partial when the feed read fails (gascity-dashboard-n6f1)', async () => {
    // The feed is discovery + scope fallback for the lane set, so its loss means
    // the lane set may be degraded (scopes unresolved) — flag partial, but the
    // active lanes from the core read still render. Never required: a feed
    // failure must not blank the view (live it measured 14.3s city-scoped).
    // gascity-dashboard-dh7t: the failure must also be logged, not swallowed.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => {
        throw new Error('feed unavailable');
      }),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanesPartial).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('formula feed read failed for city=test-city'),
    );
    expect(errorSpy.mock.calls[0]?.[0]).toContain('feed unavailable');
    errorSpy.mockRestore();
  });

  it('logs and degrades lane health to unavailable when the session read fails (gascity-dashboard-dh7t)', async () => {
    // A swallowed session-read failure leaves every lane health at 'unavailable'
    // with no operator-visible reason. The lanes still render (sessions are
    // enrichment, not required); the failure must be logged before degrading.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
      listSessions: vi.fn(async () => {
        throw new Error('sessions unavailable');
      }),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanes[0]?.health.status).toBe('unavailable');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('run sessions read failed for city=test-city'),
    );
    expect(errorSpy.mock.calls[0]?.[0]).toContain('sessions unavailable');
    errorSpy.mockRestore();
  });

  it('marks the summary partial when the active bead list is cursor-truncated', async () => {
    // gascity-dashboard-4xcv: the supervisor truncates at the fetch limit and
    // reports the rest via next_cursor WITHOUT setting partial. Treat a present
    // cursor as partial so saturation surfaces the notice + retry instead of
    // silently dropping lanes at 501+ beads.
    const listBeads = vi.fn(async () => beadList([runRoot()], false, 'next-page-token'));
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanesPartial).toBe(true);
  });

  it('marks the summary partial when the active bead list is truncated at the fetch limit', async () => {
    // gascity-dashboard-q89b: the primary fetch is bounded; when the upstream
    // total exceeds what one page returned, active runs may be missing and the
    // lanes must read as partial rather than complete.
    const listBeads = vi.fn(async () => ({ ...beadList([runRoot()]), total: 501 }));
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.lanesPartial).toBe(true);
  });

  it('does not let optional enrichment reads hold the summary refresh indefinitely', async () => {
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    const formulaFeed = vi.fn(async () => new Promise<FormulaFeedBody>(() => {}));
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed,
      listSessions: vi.fn(async () => sessionList()),
    });

    const pending = loadSupervisorRunSummarySource();
    // The full source is Runs.tsx's background refresh, so its enrichment runs on
    // the wider REFRESH budget (gascity-dashboard-4bol); the cap still fires.
    await vi.advanceTimersByTimeAsync(30_000);
    const source = await pending;

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanesPartial).toBe(true);
  });

  it('clears the spurious partial when the slow feed lands within the wider refresh budget (gascity-dashboard-4bol)', async () => {
    // The background refresh tolerates a slow supervisor: a city feed that takes
    // 14s — past the 2.5s first-paint budget but inside the 30s refresh budget —
    // lands, so the lanes are NOT latched partial (upstream gascity-dashboard#88).
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    const formulaFeed = vi.fn(
      async () =>
        new Promise<FormulaFeedBody>((resolve) => {
          setTimeout(() => resolve(feed([feedRun()])), 14_000);
        }),
    );
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed,
      listSessions: vi.fn(async () => sessionList()),
    });

    const pending = loadSupervisorRunSummarySource();
    await vi.advanceTimersByTimeAsync(14_000);
    const source = await pending;

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanesPartial).toBeUndefined();
  });

  it('keeps the tight first-paint budget on the mount source so Home/Formula Run Detail never block on a slow read (gascity-dashboard-4bol)', async () => {
    // Same 14s feed as the refresh test above, but the mount source (Home,
    // Formula Run Detail first paint) runs on the 2.5s budget — the read does NOT
    // land, so the lanes are latched partial rather than blocking ~30s on a cold
    // navigation. This is the regression guard for the refresh-budget leak.
    const listBeads = vi.fn(async () => beadList([runRoot()]));
    const formulaFeed = vi.fn(
      async () =>
        new Promise<FormulaFeedBody>((resolve) => {
          setTimeout(() => resolve(feed([feedRun()])), 14_000);
        }),
    );
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed,
      listSessions: vi.fn(async () => sessionList()),
    });

    const pending = loadSupervisorRunSummaryMountSource();
    await vi.advanceTimersByTimeAsync(2_500);
    const source = await pending;

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanesPartial).toBe(true);
  });

  it('returns an error source when the active bead list fails', async () => {
    setSupervisorApiForTests({
      ...baseApi,
      listBeads: vi.fn(async () => {
        throw new Error('beads unavailable');
      }),
      formulaFeed: vi.fn(async () => feed([])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(source).toEqual({
      source: 'runs',
      status: 'error',
      error: 'beads unavailable',
    });
  });

  // gascity-dashboard fix/runs-fetch-resilience: a transient core-read timeout
  // under a CPU burst must not blank the view on a first load (no last-good
  // snapshot yet). The core active-bead read retries once before giving up.
  it('retries the core active-bead read once on a transient timeout and resolves to data', async () => {
    let coreAttempts = 0;
    const listBeads = vi.fn(async () => {
      coreAttempts += 1;
      if (coreAttempts === 1) {
        throw new SupervisorApiError(
          undefined,
          'gc supervisor request timed out after 15000ms',
          undefined,
        );
      }
      return beadList([runRoot()]);
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const pending = loadSupervisorRunSummarySource();
    // Drain the short retry backoff so the second attempt fires.
    await vi.advanceTimersByTimeAsync(250);
    const source = await pending;

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(coreAttempts).toBe(2);
    expect(source.data.totalActive).toBe(1);
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['run-1']);
  });

  it('surfaces an error when the core active-bead read times out on every attempt', async () => {
    let coreAttempts = 0;
    const listBeads = vi.fn(async () => {
      coreAttempts += 1;
      throw new SupervisorApiError(
        undefined,
        'gc supervisor request timed out after 15000ms',
        undefined,
      );
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const pending = loadSupervisorRunSummarySource();
    await vi.advanceTimersByTimeAsync(250);
    const source = await pending;

    // A sustained failure is not hidden: after the retries are spent the view
    // still surfaces the error so a real outage isn't masked forever.
    expect(coreAttempts).toBe(2);
    expect(source.status).toBe('error');
    if (source.status !== 'error') throw new Error('expected error source');
    expect(source.error).toContain('timed out after 15000ms');
  });

  it('does not retry the core read on a non-transient (4xx) failure', async () => {
    let coreAttempts = 0;
    const listBeads = vi.fn(async () => {
      coreAttempts += 1;
      throw new SupervisorApiError(400, 'bad request', undefined);
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([])),
      listSessions: vi.fn(async () => sessionList()),
    });

    const source = await loadSupervisorRunSummarySource();

    expect(coreAttempts).toBe(1);
    expect(source.status).toBe('error');
  });

  it('reads the core active-bead fetch on the raised burst-tolerant budget', () => {
    // The path is ~0.02s normally, so the higher ceiling only matters during a
    // spike; it must stay well above the old 5s budget to absorb a burst.
    expect(CORE_RUN_SUMMARY_TIMEOUT_MS).toBe(15_000);
    expect(CORE_RUN_SUMMARY_TIMEOUT_MS).toBeGreaterThan(5_000);
  });
});

describe('loadSupervisorRunSummaryActiveSource — cheap SSE-burst path', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    resetSupervisorRunSummaryStateForTests();
  });
  afterEach(() => {
    resetSupervisorApiForTests();
    vi.restoreAllMocks();
  });

  it('skips the molecule history scan, city feed, and per-rig task reads', async () => {
    // The core active read returns ONLY the no-query (active) listBeads call —
    // any molecule/per-rig listBeads call or formulaFeed call would mean the
    // cheap path is still firing the expensive reads. The run carries an
    // in-progress step in the SAME core read (no per-rig fetch on the cheap
    // path), so the lane stays active without session enrichment.
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query && (query.type !== undefined || query.rig !== undefined)) {
        throw new Error(`cheap path must not call listBeads with ${JSON.stringify(query)}`);
      }
      return beadList([
        runRoot(),
        bead({
          id: 'run-1-step-1',
          title: 'Implementation patch',
          status: 'in_progress',
          metadata: {
            'gc.kind': 'step',
            'gc.root_bead_id': 'run-1',
            'gc.parent_bead_id': 'run-1',
            'gc.step_id': 'implementation.patch',
          },
        }),
      ]);
    });
    const formulaFeed = vi.fn(async () => feed([]));
    const listSessions = vi.fn(async () => sessionList());
    setSupervisorApiForTests({ ...baseApi, listBeads, formulaFeed, listSessions });

    const source = await loadSupervisorRunSummaryActiveSource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    // The active lane is present, and its rig scope resolves from the bead's own
    // gc.root_store_ref metadata — no feed needed.
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['run-1']);
    expect(source.data.lanes[0]?.scope).toMatchObject({ status: 'available', kind: 'rig' });
    // The expensive reads were never issued.
    expect(formulaFeed).not.toHaveBeenCalled();
    expect(
      listBeads.mock.calls.every(([, query]) => query === undefined || query.limit !== undefined),
    ).toBe(true);
    expect(listBeads.mock.calls.some(([, query]) => query?.type === 'molecule')).toBe(false);
    expect(listBeads.mock.calls.some(([, query]) => query?.rig !== undefined)).toBe(false);
  });
});

// Header-first restructure: the closed-history fan-out (molecule all=true scan,
// measured 9.9s vs the old 3s bound; per-rig task all=true reads, measured
// 10.9s on a 29.8k-issue rig store) moved OFF the default refresh path onto
// this lazy, on-demand history source with its own wide budget.
describe('loadSupervisorRunHistorySource — lazy closed-history fan-out', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    resetSupervisorRunSummaryStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    resetSupervisorApiForTests();
    resetSupervisorRunSummaryStateForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function closedMoleculeRoot(id: string): Bead {
    return bead({
      id,
      title: `Done run ${id}`,
      issue_type: 'molecule',
      status: 'closed',
      updated_at: '2026-06-01T10:00:00.000Z',
      metadata: { 'gc.kind': 'run', 'gc.root_store_ref': 'rig:rig-a' },
    });
  }

  it('builds completed lanes from the molecule scan + per-rig closed reads', async () => {
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') return beadList([closedMoleculeRoot('hist-1')]);
      if (query?.rig === 'rig-a') return beadList([]);
      return beadList([runRoot()]);
    });
    const formulaFeed = vi.fn(async () => feed([feedRun()]));
    setSupervisorApiForTests({ ...baseApi, listBeads, formulaFeed });

    const source = await loadSupervisorRunHistorySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    // Only the COMPLETED run becomes a history lane; the active run-1 does not.
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['hist-1']);
    expect(source.data.totalHistorical).toBe(1);
    expect(source.data.lanesPartial).toBeUndefined();
    // The full fan-out fires here, on demand: core read, molecule scan, feed,
    // and the per-rig closed read discovered from the active set + feed.
    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 500 });
    expect(listBeads).toHaveBeenCalledWith('test-city', {
      limit: 500,
      type: 'molecule',
      all: true,
    });
    expect(listBeads).toHaveBeenCalledWith('test-city', {
      limit: 500,
      type: 'task',
      rig: 'rig-a',
      all: true,
    });
    expect(formulaFeed).toHaveBeenCalledWith('test-city', {
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
  });

  it('lets the measured-slow molecule scan land within the wide history budget (no 3s bound)', async () => {
    // Live the molecule(all=true) scan measured 9.9s — past the old 3s
    // MOLECULE_HISTORY_TIMEOUT_MS, which made it time out on EVERY refresh and
    // chronically latch "runs partial". On the lazy history path the scan is the
    // payload, so it rides the 30s history budget and lands.
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') {
        return new Promise<ListBodyBead>((resolve) => {
          setTimeout(() => resolve(beadList([closedMoleculeRoot('hist-1')])), 9_900);
        });
      }
      if (query?.rig !== undefined) return beadList([]);
      return beadList([runRoot()]);
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
    });

    const pending = loadSupervisorRunHistorySource();
    await vi.advanceTimersByTimeAsync(9_900);
    const source = await pending;

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['hist-1']);
    expect(source.data.lanesPartial).toBeUndefined();
  });

  it('marks the history partial when the molecule scan rejects, keeping per-rig lanes', async () => {
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') throw new Error('molecule history unavailable');
      if (query?.rig === 'rig-a') return beadList([closedMoleculeRoot('hist-rig')]);
      return beadList([runRoot()]);
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
    });

    const source = await loadSupervisorRunHistorySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['hist-rig']);
    expect(source.data.lanesPartial).toBe(true);
  });

  it('marks the history partial when a per-rig closed read fails', async () => {
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') return beadList([closedMoleculeRoot('hist-1')]);
      if (query?.rig === 'rig-a') throw new Error('rig unavailable');
      return beadList([runRoot()]);
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feed([feedRun()])),
    });

    const source = await loadSupervisorRunHistorySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.lanes.map((lane) => lane.id)).toEqual(['hist-1']);
    expect(source.data.lanesPartial).toBe(true);
  });

  it('forceFresh marks ONLY the proxy-cached molecule + feed reads for cache bypass (gascity-dashboard-i3dz)', async () => {
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') return beadList([]);
      return beadList([runRoot()]);
    });
    const formulaFeed = vi.fn(async () => feed([feedRun()]));
    setSupervisorApiForTests({ ...baseApi, listBeads, formulaFeed });

    const source = await loadSupervisorRunHistorySource({ forceFresh: true });
    expect(source.status).toBe('fresh');

    expect(listBeads).toHaveBeenCalledWith(
      'test-city',
      { limit: 500, type: 'molecule', all: true },
      { cacheBypass: true },
    );
    expect(formulaFeed).toHaveBeenCalledWith(
      'test-city',
      { scope_kind: 'city', scope_ref: 'test-city' },
      { cacheBypass: true },
    );
    // The uncached core-active and per-rig reads keep the plain two-arg call.
    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 500 });
    expect(listBeads).toHaveBeenCalledWith('test-city', {
      limit: 500,
      type: 'task',
      rig: 'rig-a',
      all: true,
    });
  });

  it('returns an error source when the core active-bead read fails', async () => {
    setSupervisorApiForTests({
      ...baseApi,
      listBeads: vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
        if (query?.type === 'molecule') return beadList([]);
        throw new Error('beads unavailable');
      }),
      formulaFeed: vi.fn(async () => feed([])),
    });

    const source = await loadSupervisorRunHistorySource();

    expect(source).toEqual({
      source: 'runs',
      status: 'error',
      error: 'beads unavailable',
    });
  });
});

function runRoot(overrides: Partial<Bead> = {}): Bead {
  return bead({
    id: 'run-1',
    title: 'Adopt PR #42',
    issue_type: 'molecule',
    metadata: {
      'gc.kind': 'run',
      'gc.formula': 'mol-adopt-pr-v2',
      'gc.formula_contract': 'graph.v2',
      'gc.scope_kind': 'rig',
      'gc.scope_ref': 'rig-a',
      'gc.root_store_ref': 'rig:rig-a',
    },
    ...overrides,
  });
}

function bead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'bead-1',
    title: 'Bead',
    issue_type: 'task',
    status: 'open',
    created_at: '2026-06-01T11:00:00.000Z',
    ...overrides,
  };
}

function beadList(items: Bead[], partial = false, nextCursor?: string): ListBodyBead {
  return {
    items,
    partial,
    total: items.length,
    ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
  };
}

function feed(items: MonitorFeedItemResponse[], partial = false): FormulaFeedBody {
  return {
    items,
    partial,
  };
}

function feedRun(overrides: Partial<MonitorFeedItemResponse> = {}): MonitorFeedItemResponse {
  return {
    id: 'run-1',
    root_bead_id: 'run-1',
    root_store_ref: 'rig:rig-a',
    workflow_id: 'run-1',
    scope_kind: 'rig',
    scope_ref: 'rig-a',
    started_at: '2026-06-01T11:00:00.000Z',
    status: 'running',
    target: 'rig-a/codex',
    title: 'Adopt PR #42',
    type: 'formula',
    updated_at: '2026-06-01T11:05:00.000Z',
    ...overrides,
  };
}

function sessionList(): ListBodySessionResponse {
  return {
    items: [],
    total: 0,
  };
}

// gascity-dashboard-uxvk: orphaned-molecule registration. The wide sources
// observe the supervisor formula feed; a COMPLETE read is cached per city so
// the cheap SSE-burst source (which deliberately skips the feed) judges lanes
// off the same observation instead of flapping every stranded lane back to
// unknown on each burst.
describe('run registration (gascity-dashboard-uxvk)', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    resetSupervisorRunSummaryStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    resetSupervisorApiForTests();
    resetSupervisorRunSummaryStateForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function orphanBeads(): Bead[] {
    // The gc-odssky shape: a molecule root with an all-open step graph,
    // dispatched an hour ago (well past the dispatch grace).
    return [
      runRoot({ id: 'gc-odssky', title: 'mol-pr-start: gascity issue #3192' }),
      bead({
        id: 'gc-odssky-s1',
        title: 'read issue',
        status: 'open',
        metadata: {
          'gc.kind': 'step',
          'gc.root_bead_id': 'gc-odssky',
          'gc.step_id': 'read-issue',
        },
      }),
    ];
  }

  function wideApi(feedBody: FormulaFeedBody) {
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') return beadList([]);
      if (query?.rig !== undefined) return beadList([]);
      return beadList(orphanBeads());
    });
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed: vi.fn(async () => feedBody),
      listSessions: vi.fn(async () => sessionList()),
    });
  }

  it('marks an orphaned molecule stranded off a complete feed read', async () => {
    wideApi(feed([]));

    const source = await loadSupervisorRunSummarySource();

    expect(source.status).toBe('fresh');
    if (source.status === 'error') throw new Error(source.error);
    // gascity-dashboard-pxvb: the stranded lane is partitioned out of Active
    // into its own bucket and must not count as live work.
    const lane = source.data.strandedLanes.find((l) => l.id === 'gc-odssky');
    expect(lane?.registration).toBe('stranded');
    expect(lane?.phase).toBe('intake');
    expect(source.data.lanes.some((l) => l.id === 'gc-odssky')).toBe(false);
    expect(source.data.totalActive).toBe(0);
    expect(source.data.runCounts.stranded).toBe(1);
    // The census in-flight count excludes the orphan entirely — the false-alive
    // bug pxvb fixes was exactly this lane reading as live work.
    if (source.data.census.status !== 'available') throw new Error('census unavailable');
    expect(source.data.census.data.totalInFlight).toBe(0);
    expect(source.data.census.data.byPhase.intake).toBe(0);
  });

  it('demotes a stranded lane past the 24h stale latch out of the board (pxvb precedence)', async () => {
    // Documented precedence on isStrandedRun: a day-old orphan leaves the board
    // with the rest of the stale latches rather than accumulating in Stranded
    // forever. The orphan's last write (created_at 11:00) is read against a much
    // later snapshot generation time so it ages past STALE_LATCH_AFTER_MS.
    vi.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
    wideApi(feed([]));

    const source = await loadSupervisorRunSummarySource();

    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.strandedLanes.some((l) => l.id === 'gc-odssky')).toBe(false);
    expect(source.data.lanes.some((l) => l.id === 'gc-odssky')).toBe(false);
  });

  it('a run listed by the feed is registered', async () => {
    wideApi(
      feed([feedRun({ id: 'gc-odssky', root_bead_id: 'gc-odssky', workflow_id: 'gc-odssky' })]),
    );

    const source = await loadSupervisorRunSummarySource();

    if (source.status === 'error') throw new Error(source.error);
    const lane = source.data.lanes.find((l) => l.id === 'gc-odssky');
    expect(lane?.registration).toBe('registered');
  });

  it('a partial feed read never strands a lane', async () => {
    wideApi(feed([], true));

    const source = await loadSupervisorRunSummarySource();

    if (source.status === 'error') throw new Error(source.error);
    const lane = source.data.lanes.find((l) => l.id === 'gc-odssky');
    expect(lane?.registration).toBe('unknown');
  });

  it('a feed item missing root_bead_id never strands a lane (absence unprovable)', async () => {
    // A run item keyed only by workflow_id may cover a root under a key the
    // bead store never sees, so the root-id set cannot prove gc-odssky absent.
    const { root_bead_id: _omitted, ...rootless } = feedRun({
      id: 'other-run',
      workflow_id: 'wf-other',
    });
    wideApi(feed([rootless]));

    const source = await loadSupervisorRunSummarySource();

    if (source.status === 'error') throw new Error(source.error);
    expect(source.data.lanes.find((l) => l.id === 'gc-odssky')?.registration).toBe('unknown');
  });

  it('a later complete feed read that lists the root recovers stranded to registered', async () => {
    wideApi(feed([]));
    const first = await loadSupervisorRunSummarySource();
    if (first.status === 'error') throw new Error(first.error);
    expect(first.data.strandedLanes.find((l) => l.id === 'gc-odssky')?.registration).toBe(
      'stranded',
    );

    wideApi(
      feed([feedRun({ id: 'gc-odssky', root_bead_id: 'gc-odssky', workflow_id: 'gc-odssky' })]),
    );
    const second = await loadSupervisorRunSummarySource();
    if (second.status === 'error') throw new Error(second.error);
    expect(second.data.lanes.find((l) => l.id === 'gc-odssky')?.registration).toBe('registered');
  });

  it('a partial feed read that lists the root recovers stranded to registered', async () => {
    // A partial read cannot prove absence, but it proves presence: the listed
    // root must not stay stranded off the older cached observation.
    wideApi(feed([]));
    const first = await loadSupervisorRunSummarySource();
    if (first.status === 'error') throw new Error(first.error);
    expect(first.data.strandedLanes.find((l) => l.id === 'gc-odssky')?.registration).toBe(
      'stranded',
    );

    wideApi(
      feed(
        [feedRun({ id: 'gc-odssky', root_bead_id: 'gc-odssky', workflow_id: 'gc-odssky' })],
        true,
      ),
    );
    const second = await loadSupervisorRunSummarySource();
    if (second.status === 'error') throw new Error(second.error);
    expect(second.data.lanes.find((l) => l.id === 'gc-odssky')?.registration).toBe('registered');
  });

  it('a root-incomplete feed read that lists the root recovers stranded to registered', async () => {
    wideApi(feed([]));
    const first = await loadSupervisorRunSummarySource();
    if (first.status === 'error') throw new Error(first.error);
    expect(first.data.strandedLanes.find((l) => l.id === 'gc-odssky')?.registration).toBe(
      'stranded',
    );

    const { root_bead_id: _omitted, ...rootless } = feedRun({
      id: 'other-run',
      workflow_id: 'wf-other',
    });
    wideApi(
      feed([
        feedRun({ id: 'gc-odssky', root_bead_id: 'gc-odssky', workflow_id: 'gc-odssky' }),
        rootless,
      ]),
    );
    const second = await loadSupervisorRunSummarySource();
    if (second.status === 'error') throw new Error(second.error);
    expect(second.data.lanes.find((l) => l.id === 'gc-odssky')?.registration).toBe('registered');
  });

  it('a workflow_id-only row never recovers a stranded lane (non-authoritative key)', async () => {
    // The presence overlay trusts only run.root_bead_id. A rootless row whose
    // workflow_id happens to equal the stranded root proves nothing about the
    // bead root — the lane must stay stranded off the cached observation.
    wideApi(feed([]));
    const first = await loadSupervisorRunSummarySource();
    if (first.status === 'error') throw new Error(first.error);
    expect(first.data.strandedLanes.find((l) => l.id === 'gc-odssky')?.registration).toBe(
      'stranded',
    );

    const { root_bead_id: _omitted, ...rootless } = feedRun({
      id: 'gc-odssky',
      workflow_id: 'gc-odssky',
    });
    wideApi(feed([rootless]));
    const second = await loadSupervisorRunSummarySource();
    if (second.status === 'error') throw new Error(second.error);
    expect(second.data.strandedLanes.find((l) => l.id === 'gc-odssky')?.registration).toBe(
      'stranded',
    );
  });

  it('the cheap active source reuses the cached complete-feed observation (no flap)', async () => {
    wideApi(feed([]));
    const wide = await loadSupervisorRunSummarySource();
    if (wide.status === 'error') throw new Error(wide.error);
    expect(wide.data.strandedLanes.find((l) => l.id === 'gc-odssky')?.registration).toBe(
      'stranded',
    );

    // The cheap source: core active read + sessions only, NO feed read.
    const listBeads = vi.fn(async () => beadList(orphanBeads()));
    const formulaFeed = vi.fn();
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      formulaFeed,
      listSessions: vi.fn(async () => sessionList()),
    });

    const cheap = await loadSupervisorRunSummaryActiveSource();

    if (cheap.status === 'error') throw new Error(cheap.error);
    expect(formulaFeed).not.toHaveBeenCalled();
    expect(cheap.data.strandedLanes.find((l) => l.id === 'gc-odssky')?.registration).toBe(
      'stranded',
    );
  });

  it('without any complete feed observation the cheap source reports unknown', async () => {
    const listBeads = vi.fn(async () => beadList(orphanBeads()));
    setSupervisorApiForTests({
      ...baseApi,
      listBeads,
      listSessions: vi.fn(async () => sessionList()),
    });

    const cheap = await loadSupervisorRunSummaryActiveSource();

    if (cheap.status === 'error') throw new Error(cheap.error);
    expect(cheap.data.lanes.find((l) => l.id === 'gc-odssky')?.registration).toBe('unknown');
  });
});
