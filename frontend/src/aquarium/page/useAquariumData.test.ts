import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../../api/cache';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from '../../supervisor/client';
import { useAquariumData } from './useAquariumData';

const baseApi: SupervisorApi = {
  baseUrl: '/gc-supervisor',
  health: vi.fn(),
  cityHealth: vi.fn(),
  cityStatus: vi.fn(),
  listCities: vi.fn(),
  listAgents: vi.fn(async () => ({ items: [], total: 0 })),
  listRigs: vi.fn(async () => ({
    items: [
      {
        name: 'reef-alpha',
        path: '/rigs/reef-alpha',
        agent_count: 1,
        running_count: 1,
        suspended: false,
      },
      {
        name: 'reef-beta',
        path: '/rigs/reef-beta',
        agent_count: 1,
        running_count: 1,
        suspended: false,
      },
    ],
    total: 2,
  })),
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
  cityEventStreamUrl: vi.fn(() => 'http://example.invalid/events'),
  sessionStreamUrl: vi.fn(),
  listSessions: vi.fn(async () => ({ items: [], total: 0 })),
  sessionPending: vi.fn(),
  respondSession: vi.fn(),
  sessionTranscript: vi.fn(),
  workflowRun: vi.fn(),
  formulaDetail: vi.fn(),
  mutationHeaders: () => ({ ...GC_MUTATION_HEADERS }),
};

afterEach(() => {
  resetSupervisorApiForTests();
  invalidate('agents');
  invalidate('sessions');
  invalidate('rigs');
  invalidate('aquarium:');
  vi.unstubAllGlobals();
});

describe('useAquariumData (live mode)', () => {
  it('fans out one bounded bead read per canonical rig name into beadsByRig', async () => {
    // No real EventSource in jsdom; useGcEventRefresh degrades to 'closed'
    // without one, which is fine — this test only cares about beadsByRig.
    vi.stubGlobal('EventSource', undefined);

    const listBeads = vi.fn(async (_city: string, query?: { rig?: string }) => {
      if (query?.rig === 'reef-alpha') {
        return {
          items: [
            {
              id: 'td-a1',
              title: 'a1',
              status: 'open',
              issue_type: 'task',
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          total: 1,
        };
      }
      if (query?.rig === 'reef-beta') {
        return {
          items: [
            {
              id: 'td-b1',
              title: 'b1',
              status: 'open',
              issue_type: 'task',
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          total: 1,
        };
      }
      throw new Error(`unexpected rig filter: ${query?.rig}`);
    });
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const { result } = renderHook(() => useAquariumData(null));

    await waitFor(() => {
      expect(Object.keys(result.current.inputs.beadsByRig).sort()).toEqual([
        'reef-alpha',
        'reef-beta',
      ]);
    });

    expect(result.current.inputs.beadsByRig['reef-alpha']?.items.map((b) => b.id)).toEqual([
      'td-a1',
    ]);
    expect(result.current.inputs.beadsByRig['reef-beta']?.items.map((b) => b.id)).toEqual([
      'td-b1',
    ]);
    expect(result.current.inputs.unavailableBeadRigKeys).toEqual([]);
    expect(listBeads).toHaveBeenCalledWith('test-city', { rig: 'reef-alpha', limit: 250 });
    expect(listBeads).toHaveBeenCalledWith('test-city', { rig: 'reef-beta', limit: 250 });
  });

  it('marks one rejected rig read unavailable without dropping the others', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const listBeads = vi.fn(async (_city: string, query?: { rig?: string }) => {
      if (query?.rig === 'reef-alpha') throw new Error('supervisor unavailable');
      return {
        items: [
          {
            id: 'td-b1',
            title: 'b1',
            status: 'open',
            issue_type: 'task',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
      };
    });
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const { result } = renderHook(() => useAquariumData(null));

    await waitFor(() => {
      expect(result.current.inputs.beadsByRig['reef-beta']?.items.length).toBe(1);
    });

    expect(result.current.inputs.beadsByRig['reef-alpha']).toEqual({ items: [], total: 0 });
    expect(result.current.inputs.unavailableBeadRigKeys).toEqual(['reef-alpha']);
    expect(result.current.connState).toBe('degraded');
  });

  it('marks a bounded, truncated rig response as unavailable for transition claims', async () => {
    vi.stubGlobal('EventSource', undefined);
    const listBeads = vi.fn(async (_city: string, query?: { rig?: string }) => ({
      items: [
        {
          id: `${query?.rig}-visible`,
          title: 'visible bead',
          status: 'open',
          issue_type: 'task',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      total: query?.rig === 'reef-alpha' ? 2 : 1,
    }));
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const { result } = renderHook(() => useAquariumData(null));
    await waitFor(() => {
      expect(result.current.inputs.beadsByRig['reef-alpha']?.items).toHaveLength(1);
    });

    expect(result.current.inputs.unavailableBeadRigKeys).toEqual(['reef-alpha']);
    expect(result.current.connState).toBe('degraded');
  });
});

describe('useAquariumData (fixture mode)', () => {
  it('makes zero supervisor calls and returns fixture inputs', async () => {
    const listBeads = vi.fn();
    const listAgents = vi.fn();
    const listSessions = vi.fn();
    const listRigs = vi.fn();
    setSupervisorApiForTests({ ...baseApi, listBeads, listAgents, listSessions, listRigs });

    const { result } = renderHook(() => useAquariumData('aquarium'));

    await waitFor(() => {
      expect(result.current.connState).toBe('fixture');
    });

    expect(listBeads).not.toHaveBeenCalled();
    expect(listAgents).not.toHaveBeenCalled();
    expect(listSessions).not.toHaveBeenCalled();
    expect(listRigs).not.toHaveBeenCalled();
    expect(result.current.inputs.agents.length).toBeGreaterThan(0);
    expect(result.current.inputs.unavailableBeadRigKeys).toEqual([]);
    expect(result.current.manifest?.kind).toBe('aquarium');
  });

  it('reports a null manifest in live mode', async () => {
    setSupervisorApiForTests({
      ...baseApi,
      listBeads: vi.fn(async () => ({ items: [], total: 0 })),
    });
    const { result } = renderHook(() => useAquariumData(null));
    await waitFor(() => {
      expect(result.current.connState).not.toBe('fixture');
    });
    expect(result.current.manifest).toBeNull();
  });
});
