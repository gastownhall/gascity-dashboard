import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GC_EVENT_PREFIX } from 'gas-city-dashboard-shared';
import { invalidate } from '../../api/cache';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from '../../supervisor/client';
import { useAquariumData } from './useAquariumData';

const eventSources: FakeEventSource[] = [];

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
  eventSources.length = 0;
});

describe('useAquariumData (live mode)', () => {
  it('refreshes session activity immediately after a mail event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const listSessions = vi.fn(async () => ({ items: [], total: 0 }));
    setSupervisorApiForTests({
      ...baseApi,
      listSessions,
      listBeads: vi.fn(async () => ({ items: [], total: 0 })),
    });

    const { result } = renderHook(() => useAquariumData(null));
    await waitFor(() => expect(result.current.dataState).toBe('complete'));
    expect(listSessions).toHaveBeenCalledTimes(1);

    act(() => {
      eventSources[0]?.open();
      eventSources[0]?.emitNamed('event', JSON.stringify({ type: `${GC_EVENT_PREFIX.mail}sent` }));
    });

    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  });

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

    expect(result.current.dataState).toBe('loading');

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
    expect(result.current.dataState).toBe('complete');
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
    expect(result.current.connState).toBe('closed');
    expect(result.current.dataState).toBe('partial');
    expect(result.current.coverageKnown).toBe(true);
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
    expect(result.current.connState).toBe('closed');
    expect(result.current.dataState).toBe('partial');
  });

  it('marks a partial supervisor rig list as partial even when every returned rig bead read succeeds', async () => {
    vi.stubGlobal('EventSource', undefined);
    const listRigs = vi.fn(async () => ({
      items: [
        {
          name: 'reef-alpha',
          path: '/rigs/reef-alpha',
          agent_count: 1,
          running_count: 1,
          suspended: false,
        },
      ],
      total: 2,
      partial: true,
      partial_errors: ['reef-beta store unavailable'],
    }));
    setSupervisorApiForTests({
      ...baseApi,
      listRigs,
      listBeads: vi.fn(async () => ({ items: [], total: 0 })),
    });

    const { result } = renderHook(() => useAquariumData(null));
    await waitFor(() => expect(result.current.inputs.rigs).toHaveLength(1));
    await waitFor(() => expect(result.current.dataState).toBe('partial'));
    expect(result.current.coverageKnown).toBe(false);
  });

  it('marks a failed refresh with retained cache data as partial', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const listRigs = vi
      .fn()
      .mockResolvedValueOnce(await baseApi.listRigs('test-city'))
      .mockRejectedValueOnce(new Error('rig refresh failed'));
    setSupervisorApiForTests({
      ...baseApi,
      listRigs,
      listBeads: vi.fn(async () => ({ items: [], total: 0 })),
    });

    const { result } = renderHook(() => useAquariumData(null));
    await waitFor(() => expect(result.current.dataState).toBe('complete'));
    await act(async () => result.current.refresh());

    expect(result.current.inputs.rigs).toHaveLength(2);
    expect(result.current.dataState).toBe('partial');
    expect(result.current.coverageKnown).toBe(false);
  });

  it('stays loading until pending-interaction reads finish', async () => {
    vi.stubGlobal('EventSource', undefined);
    let resolvePending: ((value: { supported: boolean }) => void) | undefined;
    const pending = new Promise<{ supported: boolean }>((resolve) => {
      resolvePending = resolve;
    });
    setSupervisorApiForTests({
      ...baseApi,
      listAgents: vi.fn(async () => ({
        items: [
          {
            name: 'reef-alpha/scout',
            available: true,
            running: true,
            state: 'idle',
            suspended: false,
            session: { name: 'reef-alpha-scout', attached: false },
          },
        ],
        total: 1,
      })),
      listSessions: vi.fn(async () => ({
        items: [
          {
            id: 'gc-scout',
            template: 'codex',
            session_name: 'reef-alpha-scout',
            title: 'scout',
            state: 'running',
            created_at: '2026-07-15T00:00:00Z',
            attached: false,
            running: true,
            provider: 'codex',
          },
        ],
        total: 1,
      })),
      listBeads: vi.fn(async () => ({ items: [], total: 0 })),
      sessionPending: vi.fn(() => pending),
    });

    const { result } = renderHook(() => useAquariumData(null));
    await waitFor(() => expect(baseApi.listRigs).toHaveBeenCalled());
    expect(result.current.dataState).toBe('loading');
    await act(async () => resolvePending?.({ supported: true }));
    await waitFor(() => expect(result.current.dataState).toBe('complete'));
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
    expect(result.current.dataState).toBe('complete');
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

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = FakeEventSource.CONNECTING;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(readonly url: string | URL) {
    eventSources.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  emitNamed(type: string, data: string): void {
    const event = new MessageEvent<string>(type, { data });
    this.listeners.get(type)?.forEach((listener) => listener(event));
    if (type === 'message') this.onmessage?.(event);
  }
}
