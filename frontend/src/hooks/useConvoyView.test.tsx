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
  // resetAllMocks (not clearAllMocks) so a mockReturnValueOnce/mockImplementation
  // set in one test does not leak its impl into the next — the stale-result tests
  // below depend on a clean per-call queue.
  vi.resetAllMocks();
});

// A promise whose settlement the test controls, so a load can be held in flight
// across a rerender/unmount and then resolved in a deliberate order.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

  // Stale-result guards (gascity-dashboard-v9lz). These pin the only
  // non-trivial correctness mechanism in the hook: the effect 'cancelled'
  // flag and the refresh liveRootRef guard. Tests 1 and 3 are mutation-biting:
  // each resolves the STALE load AFTER the fresh one, so a neutered guard
  // (isCurrent -> () => true) clobbers the new convoy's state and the assertion
  // flips. Test 2 (unmount) is documentation-only — React 18 silently drops
  // post-unmount setState, so neutering the cancelled guard leaves it green;
  // its assertion still verifies the observable behaviour (state stays loading
  // after unmount).
  it('discards a stale initial load that resolves after the root changed (cancelled guard)', async () => {
    const stale = deferred<ConvoyLoad>();
    const fresh = deferred<ConvoyLoad>();
    mockLoadConvoyView
      .mockReturnValueOnce(stale.promise) // load for root-1
      .mockReturnValueOnce(fresh.promise); // load for root-2

    const { result, rerender } = renderHook(({ id }) => useConvoyView(id), {
      initialProps: { id: 'root-1' },
    });
    expect(result.current.state.kind).toBe('loading');

    // Root changes while load #1 is still in flight: the effect cleanup sets
    // its cancelled flag and a fresh load starts for root-2.
    rerender({ id: 'root-2' });

    // Fresh load lands first.
    await act(async () => {
      fresh.resolve(convoyLoad('root-2'));
    });
    await waitFor(() => {
      if (result.current.state.kind !== 'ready') throw new Error('expected ready');
      expect(result.current.state.load.view.rootBeadId).toBe('root-2');
    });

    // The stale load resolves LAST — the cancelled guard must drop it.
    await act(async () => {
      stale.resolve(convoyLoad('root-1'));
    });

    if (result.current.state.kind !== 'ready') throw new Error('expected ready');
    expect(result.current.state.load.view.rootBeadId).toBe('root-2');
  });

  it('writes no ready state when an in-flight load resolves after unmount (cancelled guard)', async () => {
    const inFlight = deferred<ConvoyLoad>();
    mockLoadConvoyView.mockReturnValueOnce(inFlight.promise);

    const { result, unmount } = renderHook(() => useConvoyView('root-1'));
    expect(result.current.state.kind).toBe('loading');

    unmount();
    await act(async () => {
      inFlight.resolve(convoyLoad('root-1'));
    });

    // The last committed state stays 'loading'; the post-unmount resolution is
    // dropped by the cancelled guard rather than committing a ready view.
    expect(result.current.state.kind).toBe('loading');
  });

  it('discards a stale refresh that resolves after the root changed (liveRootRef guard)', async () => {
    const initial = deferred<ConvoyLoad>();
    const staleRefresh = deferred<ConvoyLoad>();
    const nextRoot = deferred<ConvoyLoad>();
    mockLoadConvoyView
      .mockReturnValueOnce(initial.promise) // initial load for root-1
      .mockReturnValueOnce(staleRefresh.promise) // manual refresh for root-1
      .mockReturnValueOnce(nextRoot.promise); // initial load for root-2

    const { result, rerender } = renderHook(({ id }) => useConvoyView(id), {
      initialProps: { id: 'root-1' },
    });
    await act(async () => {
      initial.resolve(convoyLoad('root-1'));
    });
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    // Kick off a manual refresh for root-1 (held in flight).
    act(() => {
      void result.current.refresh();
    });

    // Root changes before the refresh resolves: liveRootRef.current advances to
    // root-2, and a fresh initial load for root-2 lands.
    rerender({ id: 'root-2' });
    await act(async () => {
      nextRoot.resolve(convoyLoad('root-2'));
    });
    await waitFor(() => {
      if (result.current.state.kind !== 'ready') throw new Error('expected ready');
      expect(result.current.state.load.view.rootBeadId).toBe('root-2');
    });

    // The stale refresh (for root-1) resolves LAST — the liveRootRef guard must
    // drop it rather than clobber the root-2 view.
    await act(async () => {
      staleRefresh.resolve(convoyLoad('root-1'));
    });

    if (result.current.state.kind !== 'ready') throw new Error('expected ready');
    expect(result.current.state.load.view.rootBeadId).toBe('root-2');
  });
});
