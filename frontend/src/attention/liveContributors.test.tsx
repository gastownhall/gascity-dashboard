import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { composeAttention } from './compose';
import { useLiveAttentionContributors } from './liveContributors';

const mockApi = vi.hoisted(() => ({
  doltTrend: vi.fn(),
  listBuilds: vi.fn(),
  maintainerTriage: vi.fn(),
  systemHealth: vi.fn(),
}));

const mockSupervisorApi = vi.hoisted(() => ({
  cityHealth: vi.fn(),
  formulaFeed: vi.fn(),
  listAgents: vi.fn(),
  listBeads: vi.fn(),
  listEvents: vi.fn(),
  listMail: vi.fn(),
  listSessions: vi.fn(),
  sessionPending: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: mockApi,
  formatApiError: (err: unknown, fallback = 'request failed') =>
    err instanceof Error ? err.message : fallback,
}));

vi.mock('../supervisor/client', () => ({
  supervisorApi: () => mockSupervisorApi,
}));

describe('useLiveAttentionContributors', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    invalidate('attention:');
    for (const fn of [
      mockApi.doltTrend,
      mockApi.listBuilds,
      mockApi.maintainerTriage,
      mockApi.systemHealth,
      mockSupervisorApi.cityHealth,
      mockSupervisorApi.formulaFeed,
      mockSupervisorApi.listAgents,
      mockSupervisorApi.listBeads,
      mockSupervisorApi.listEvents,
      mockSupervisorApi.listMail,
      mockSupervisorApi.listSessions,
      mockSupervisorApi.sessionPending,
    ]) {
      fn.mockReset();
    }

    mockSupervisorApi.formulaFeed.mockResolvedValue({
      partial: false,
      items: [
        {
          id: 'run-1',
          root_bead_id: 'B-root',
          root_store_ref: 'city:B-root',
          scope_kind: 'city',
          scope_ref: 'test-city',
          started_at: '2026-05-29T20:00:00.000Z',
          status: 'failed',
          target: 'mayor',
          title: 'Failed run',
          type: 'formula',
          updated_at: '2026-05-29T20:05:00.000Z',
        },
      ],
    });
    mockSupervisorApi.listAgents.mockResolvedValue({
      total: 1,
      items: [{
        available: true,
        name: 'reviewer',
        running: true,
        state: 'failed',
        suspended: false,
        session: {
          attached: true,
          last_activity: '2026-05-29T20:00:00.000Z',
          name: 'reviewer',
        },
      }],
    });
    mockSupervisorApi.listSessions.mockResolvedValue({
      total: 1,
      items: [{
        id: 'gc-2568',
        session_name: 'reviewer',
        state: 'active',
        template: 'reviewer',
        alias: 'reviewer',
        provider: 'codex',
        running: true,
        attached: true,
        created_at: '2026-05-29T20:00:00.000Z',
      }],
    });
    mockSupervisorApi.sessionPending.mockResolvedValue({
      supported: true,
      pending: {
        kind: 'tool_approval',
        prompt: 'Approve deployment?',
        request_id: 'req-1',
      },
    });
    mockSupervisorApi.listBeads.mockResolvedValue({
      total: 1,
      items: [{
        created_at: '2026-05-29T20:00:00.000Z',
        id: 'B-1',
        issue_type: 'task',
        priority: null,
        status: 'blocked',
        title: 'Blocked bead',
      }],
    });
    mockSupervisorApi.listMail.mockResolvedValue({
      total: 2,
      items: [{
        body: '',
        created_at: '2026-05-29T20:00:00.000Z',
        from: 'sam',
        id: 'M-1',
        read: false,
        subject: 'Need approval',
        to: 'human',
      }, {
        body: '',
        created_at: '2026-05-29T20:01:00.000Z',
        from: 'sam',
        id: 'M-other',
        read: false,
        subject: 'Someone else needs approval',
        to: 'mayor',
      }],
    });
    mockSupervisorApi.listEvents.mockResolvedValue({
      total: 1,
      items: [{
        actor: 'supervisor',
        message: 'session crashed while applying patch',
        payload: {
          reason: 'panic',
          session_id: 'gc-session-1',
          template: 'mayor',
        },
        seq: 42,
        subject: 'gc-session-1',
        ts: '2026-06-01T10:10:00.000Z',
        type: 'session.crashed',
      }],
    });
    mockSupervisorApi.cityHealth.mockResolvedValue({
      city: 'test-city',
      status: 'ok',
      uptime_sec: 300,
      version: '1.0.0',
    });
    mockApi.systemHealth.mockResolvedValue({
      admin: {
        pid: 123,
        uptime_sec: 600,
        rss_bytes: 128_000_000,
        heap_used_bytes: 64_000_000,
        node_version: 'v22.0.0',
      },
      host: {
        load_avg_1: 0.5,
        load_avg_5: 0.4,
        load_avg_15: 0.3,
        total_mem_bytes: 100,
        free_mem_bytes: 4,
        cpu_count: 8,
        uptime_sec: 86_400,
      },
    });
    mockApi.doltTrend.mockResolvedValue({
      available: true,
      samples: [],
      source: 'supervisor',
    });
    mockApi.listBuilds.mockResolvedValue({
      failed_marker: true,
      items: [],
      source: null,
    });
    mockApi.maintainerTriage.mockResolvedValue({
      computed_at: '2026-06-01T12:00:00.000Z',
      repo: 'gastownhall/gascity',
      tiers: [
        {
          tier: 'regression_breaking',
          clusters: [],
          unclustered: [{
            author: {
              computed_at: null,
              issues_accepted: null,
              issues_opened: null,
              login: 'reviewer',
              prs_merged: null,
              prs_opened: null,
              tier: 'trusted',
            },
            blast_files: [],
            cluster_id: null,
            created_at: '2026-06-01T09:00:00.000Z',
            has_in_flight_pr: false,
            html_url: 'https://github.com/gastownhall/gascity/pull/101',
            is_marked: false,
            kind: 'pr',
            labels: [],
            lines_changed: null,
            linked_numbers: [],
            number: 101,
            slung: null,
            status: 'changes_requested',
            tier: 'regression_breaking',
            title: 'review feedback needs operator',
            triage_assessment: null,
            triage_score: 240,
            updated_at: '2026-06-01T09:30:00.000Z',
            weak_ties: [],
          }],
        },
        { tier: 'regression', clusters: [], unclustered: [] },
        { tier: 'stability', clusters: [], unclustered: [] },
      ],
      totals: { issues_open: 0, prs_open: 1 },
    });
  });

  afterEach(() => {
    invalidate('attention:');
  });

  it('composes Home/nav attention from direct supervisor facts and dashboard-local facts', async () => {
    const { result } = renderHook(() => useLiveAttentionContributors());

    await waitFor(() => {
      const model = composeAttention(result.current);
      expect(model.byDomain.runs.attention).toBe(1);
      expect(model.byDomain.agents.attention).toBe(2);
      expect(model.byDomain.beads.attention).toBe(1);
      expect(model.byDomain.mail.attention).toBe(1);
      expect(model.byDomain.mail.watch).toBe(0);
      expect(model.byDomain.mail.items.map((item) => item.id)).toEqual([
        'mail:M-1:unread-stale',
      ]);
      expect(model.byDomain.activity.attention).toBe(2);
      expect(model.byDomain.health.attention).toBe(1);
      expect(model.byDomain.maintainer.attention).toBe(1);
    });

    expect(mockSupervisorApi.formulaFeed).toHaveBeenCalledWith('test-city', {
      limit: 100,
      scope_kind: 'city',
      scope_ref: 'test-city',
    });
    expect(mockSupervisorApi.listAgents).toHaveBeenCalledWith('test-city');
    expect(mockSupervisorApi.listSessions).toHaveBeenCalledWith('test-city');
    expect(mockSupervisorApi.sessionPending).toHaveBeenCalledWith('test-city', 'gc-2568');
    expect(mockSupervisorApi.listBeads).toHaveBeenCalledWith('test-city', { limit: 1000 });
    expect(mockSupervisorApi.listEvents).toHaveBeenCalledWith('test-city', { limit: 100, since: '24h' });
    expect(mockSupervisorApi.listMail).toHaveBeenCalledWith('test-city', { limit: 100 });
    expect(mockSupervisorApi.cityHealth).toHaveBeenCalledWith('test-city');
    expect(mockApi.listBuilds).toHaveBeenCalledTimes(1);
    expect(mockApi.maintainerTriage).toHaveBeenCalledTimes(1);
    expect(mockApi.systemHealth).toHaveBeenCalledTimes(1);
    expect(mockApi.doltTrend).toHaveBeenCalledTimes(1);
  });

  it('does not fetch maintainer triage when the maintainer module is disabled', async () => {
    const { result } = renderHook(() => useLiveAttentionContributors([]));

    await waitFor(() => {
      const model = composeAttention(result.current);
      expect(model.byDomain.health.attention).toBe(1);
    });

    expect(mockApi.maintainerTriage).not.toHaveBeenCalled();
    expect(composeAttention(result.current).byDomain.maintainer.attention).toBe(0);
  });
});
