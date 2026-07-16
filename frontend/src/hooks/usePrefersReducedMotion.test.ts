import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

type Listener = () => void;

// jsdom has no matchMedia by default; stub it per-test so both branches
// (present/absent) are exercised deliberately.
function stubMatchMedia(matches: boolean): { fireChange: (next: boolean) => void } {
  let currentMatches = matches;
  let listener: Listener | null = null;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return currentMatches;
      },
      media: query,
      onchange: null,
      addEventListener: vi.fn((_event: string, cb: Listener) => {
        listener = cb;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return {
    fireChange: (next: boolean) => {
      currentMatches = next;
      listener?.();
    },
  };
}

function deleteMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  deleteMatchMedia();
});

describe('usePrefersReducedMotion', () => {
  it('reports true when matchMedia is unavailable (the fail-safe default)', () => {
    deleteMatchMedia();
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('reports false when the operator has not requested reduced motion', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('reports true when the operator has requested reduced motion', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('tracks a live change from the media query', () => {
    const { fireChange } = stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => fireChange(true));

    expect(result.current).toBe(true);
  });
});
