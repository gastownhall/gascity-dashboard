import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHealthSources } from './useHealthSources';
import { invalidate } from '../api/cache';

// The hook owns the Health page's six-source fetch orchestration. These tests
// exercise that contract directly — independently of the page render — by
// stubbing the data layer the six fetchers call: the dashboard `api` client
// and the generated supervisor client. getActiveCity() resolves to `test-city`
// via the global test setup, so the supervisor fetchers reach a live city.

const mockApi = {
  systemHealth: vi.fn(),
  localToolVersions: vi.fn(),
  doltTrend: vi.fn(),
  rigStoreHealth: vi.fn(),
  supervisorStatus: vi.fn(),
};

vi.mock('../api/client', () => ({
  api: {
    systemHealth: (...args: unknown[]) => mockApi.systemHealth(...args),
    localToolVersions: (...args: unknown[]) => mockApi.localToolVersions(...args),
    doltTrend: (...args: unknown[]) => mockApi.doltTrend(...args),
    rigStoreHealth: (...args: unknown[]) => mockApi.rigStoreHealth(...args),
    supervisorStatus: (...args: unknown[]) => mockApi.supervisorStatus(...args),
  },
  formatApiError: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

const mockCityHealth = vi.fn();
vi.mock('../supervisor/client', () => ({
  supervisorApiForRequestBudget: vi.fn(() => ({ cityHealth: mockCityHealth })),
}));

const sysHealth = { host: { cpu_count: 8 }, admin: { pid: 1 } };
const localTools = { gc: { status: 'available', version: 'dev' } };
const trend = { available: true, reason: null, samples: [] };
const rigStores = { available: true, rigs: [] };
const statusBody = { store: {}, work: {} };
const healthBody = { status: 'ok', city: 'demo-city', version: '1.0.0', uptime_sec: 10 };

function seedAllOk(): void {
  mockApi.systemHealth.mockResolvedValue(sysHealth);
  mockApi.localToolVersions.mockResolvedValue(localTools);
  mockApi.doltTrend.mockResolvedValue(trend);
  mockApi.rigStoreHealth.mockResolvedValue(rigStores);
  mockApi.supervisorStatus.mockResolvedValue({
    available: true,
    sampledAt: '2026-07-02T00:00:00.000Z',
    status: statusBody,
  });
  mockCityHealth.mockResolvedValue(healthBody);
}

beforeEach(() => {
  invalidate('health');
  vi.clearAllMocks();
  seedAllOk();
});

afterEach(() => {
  cleanup();
});

describe('useHealthSources', () => {
  it('starts loading, then aggregates all six sources on success', async () => {
    const { result } = renderHook(() => useHealthSources());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    const { sources } = result.current;
    expect(sources.systemHealth).toEqual({ status: 'available', data: sysHealth });
    expect(sources.supervisor).toEqual({ status: 'available', data: healthBody });
    expect(sources.status?.status).toBe('available');
    expect(sources.localTools).toEqual({ status: 'available', data: localTools });
    expect(sources.trend).toEqual(trend);
    expect(sources.rigStores).toEqual(rigStores);
    expect(result.current.error).toBeNull();
  });

  it('degrades a single source independently without failing the others', async () => {
    mockCityHealth.mockRejectedValue(new Error('supervisor unreachable'));

    const { result } = renderHook(() => useHealthSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const { sources } = result.current;
    // The failed source resolves to its unavailable state...
    expect(sources.supervisor).toEqual({
      status: 'unavailable',
      error: 'supervisor health unavailable',
    });
    // ...while every other source still loads.
    expect(sources.systemHealth?.status).toBe('available');
    expect(sources.rigStores).toEqual(rigStores);
  });

  it('refresh() re-invokes every source fetcher', async () => {
    const { result } = renderHook(() => useHealthSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const before = mockApi.systemHealth.mock.calls.length;
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockApi.systemHealth.mock.calls.length).toBeGreaterThan(before);
    expect(mockApi.localToolVersions).toHaveBeenCalledTimes(2);
    expect(mockApi.doltTrend).toHaveBeenCalledTimes(2);
    expect(mockApi.rigStoreHealth).toHaveBeenCalledTimes(2);
    expect(mockApi.supervisorStatus).toHaveBeenCalledTimes(2);
    expect(mockCityHealth).toHaveBeenCalledTimes(2);
  });
});
