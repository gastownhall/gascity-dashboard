import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ConvoyRootsLoad, ConvoyRootSummary } from '../supervisor/convoyReads';
import { useConvoyRoots } from './useConvoyRoots';

const mockLoadActiveConvoyRoots = vi.hoisted(() => vi.fn());
vi.mock('../supervisor/convoyReads', () => ({
  loadActiveConvoyRoots: mockLoadActiveConvoyRoots,
}));
const mockLoad = mockLoadActiveConvoyRoots as Mock;

function rootsLoad(id: string): ConvoyRootsLoad {
  return {
    partial: false,
    roots: [
      {
        rootBeadId: id,
        title: id,
        status: 'in_progress',
        formulaName: id,
        formulaNameProvenance: 'metadata',
      } satisfies ConvoyRootSummary,
    ],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  mockLoad.mockReset();
});

describe('useConvoyRoots', () => {
  it('lands the latest-issued refresh even when an earlier one resolves later', async () => {
    const r1 = deferred<ConvoyRootsLoad>();
    const r2 = deferred<ConvoyRootsLoad>();
    mockLoad
      .mockResolvedValueOnce(rootsLoad('gc-initial')) // initial mount load
      .mockReturnValueOnce(r1.promise) // refresh generation 1
      .mockReturnValueOnce(r2.promise); // refresh generation 2 (supersedes 1)

    const { result } = renderHook(() => useConvoyRoots());
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    // Two overlapping refreshes (bypassing the UI's disabled-while-loading guard).
    await act(async () => {
      void result.current.refresh();
      void result.current.refresh();
    });

    // The later-issued refresh resolves first and lands…
    await act(async () => {
      r2.resolve(rootsLoad('gc-r2'));
    });
    // …and the earlier one resolving LAST is ignored, not last-resolve-wins.
    await act(async () => {
      r1.resolve(rootsLoad('gc-r1'));
    });

    const state = result.current.state;
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`);
    expect(state.load.roots.map((root) => root.rootBeadId)).toEqual(['gc-r2']);
  });
});
