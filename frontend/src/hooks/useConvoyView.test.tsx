import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConvoyLoad } from '../supervisor/convoyReads';
import { SupervisorApiError } from '../supervisor/client';
import { useConvoyView } from './useConvoyView';

const mockLoadConvoyView = vi.hoisted(() => vi.fn());

vi.mock('../supervisor/convoyReads', () => ({
  loadConvoyView: mockLoadConvoyView,
}));

function convoyLoad(rootBeadId: string): ConvoyLoad {
  return {
    view: {
      rootBeadId,
      root: { id: rootBeadId, title: `root ${rootBeadId}`, status: 'in_progress' },
      progress: { closed: 0, total: 0 },
      exposure: { kind: 'collapsed', reason: 'no_children' },
    },
    partial: false,
  } as unknown as ConvoyLoad;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useConvoyView', () => {
  it('stays idle when no root bead id is supplied', () => {
    const { result } = renderHook(() => useConvoyView(null));
    expect(result.current.state).toEqual({ kind: 'idle' });
    expect(mockLoadConvoyView).not.toHaveBeenCalled();
  });

  it('stays idle for an empty root bead id without hitting the loader', () => {
    const { result } = renderHook(() => useConvoyView(''));
    expect(result.current.state).toEqual({ kind: 'idle' });
    expect(mockLoadConvoyView).not.toHaveBeenCalled();
  });

  it('loads the convoy view and lands in ready on success', async () => {
    mockLoadConvoyView.mockResolvedValue(convoyLoad('root-1'));

    const { result } = renderHook(() => useConvoyView('root-1'));

    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    expect(mockLoadConvoyView).toHaveBeenCalledWith('root-1');
    if (result.current.state.kind !== 'ready') throw new Error('expected ready');
    expect(result.current.state.refreshing).toBe(false);
    expect(result.current.state.load.view.rootBeadId).toBe('root-1');
  });

  it('surfaces a 404 as the distinct not_found state', async () => {
    mockLoadConvoyView.mockRejectedValue(new SupervisorApiError(404, 'no such convoy', undefined));

    const { result } = renderHook(() => useConvoyView('ghost'));

    await waitFor(() => expect(result.current.state.kind).toBe('not_found'));
  });

  it('surfaces any non-404 error as the failed state with a formatted message', async () => {
    mockLoadConvoyView.mockRejectedValue(new SupervisorApiError(500, 'boom', undefined));

    const { result } = renderHook(() => useConvoyView('root-1'));

    await waitFor(() => expect(result.current.state.kind).toBe('failed'));
    if (result.current.state.kind !== 'failed') throw new Error('expected failed');
    expect(result.current.state.error).toContain('boom');
  });

  it('reloads on root bead id change', async () => {
    mockLoadConvoyView.mockImplementation(async (id: string) => convoyLoad(id));

    const { result, rerender } = renderHook(({ id }) => useConvoyView(id), {
      initialProps: { id: 'root-1' },
    });
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    rerender({ id: 'root-2' });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
      if (result.current.state.kind !== 'ready') throw new Error('expected ready');
      expect(result.current.state.load.view.rootBeadId).toBe('root-2');
    });
    expect(mockLoadConvoyView).toHaveBeenCalledWith('root-2');
  });

  it('marks the existing view refreshing during a manual refresh, then ready again', async () => {
    mockLoadConvoyView.mockResolvedValueOnce(convoyLoad('root-1'));
    const { result } = renderHook(() => useConvoyView('root-1'));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    let release: (load: ConvoyLoad) => void = () => {};
    mockLoadConvoyView.mockReturnValueOnce(
      new Promise<ConvoyLoad>((resolve) => {
        release = resolve;
      }),
    );

    let refreshDone: Promise<void> = Promise.resolve();
    act(() => {
      refreshDone = result.current.refresh();
    });

    await waitFor(() => {
      if (result.current.state.kind !== 'ready') throw new Error('expected ready');
      expect(result.current.state.refreshing).toBe(true);
    });

    await act(async () => {
      release(convoyLoad('root-1'));
      await refreshDone;
    });

    if (result.current.state.kind !== 'ready') throw new Error('expected ready');
    expect(result.current.state.refreshing).toBe(false);
  });

  it('is a no-op refresh when there is no active root bead id', async () => {
    const { result } = renderHook(() => useConvoyView(null));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockLoadConvoyView).not.toHaveBeenCalled();
  });
});
