import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import type {
  Bead,
  FormulaFeedBody,
  ListBodyBead,
  ListBodySessionResponse,
  MonitorFeedItemResponse,
} from '../generated/gc-supervisor-client/types.gen';
import {
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from './client';
import {
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
  listBeads: vi.fn(),
  listEvents: vi.fn(),
  getBead: vi.fn(),
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

  it('builds the run summary from direct supervisor beads, feed, and sessions', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') return beadList([]);
      if (query?.rig === 'rig-a') {
        return beadList([
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
      }
      return beadList([runRoot()]);
    });
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
    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 1_000 });
    expect(listBeads).toHaveBeenCalledWith('test-city', {
      limit: 80,
      type: 'molecule',
      all: true,
    });
    expect(listBeads).toHaveBeenCalledWith('test-city', {
      limit: 80,
      type: 'task',
      rig: 'rig-a',
      all: true,
    });
    expect(formulaFeed).toHaveBeenCalledWith('test-city', {
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
    expect(listSessions).toHaveBeenCalledWith('test-city');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps available lanes while marking the summary partial when a recent rig read fails', async () => {
    const listBeads = vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
      if (query?.type === 'molecule') return beadList([]);
      if (query?.rig === 'rig-a') throw new Error('rig unavailable');
      return beadList([runRoot()]);
    });
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

  it('returns an error source when the active bead list fails', async () => {
    setSupervisorApiForTests({
      ...baseApi,
      listBeads: vi.fn(async (_cityName: string, query?: Record<string, unknown>) => {
        if (query?.type === 'molecule') return beadList([]);
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

function beadList(items: Bead[], partial = false): ListBodyBead {
  return {
    items,
    partial,
    total: items.length,
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
