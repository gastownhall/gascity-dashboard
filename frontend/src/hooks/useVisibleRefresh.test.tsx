import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisibleRefresh } from './useVisibleRefresh';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useVisibleRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not overlap refresh calls while one is still in flight', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const first = deferred<void>();
    const refresh = vi.fn(() => first.promise);

    renderHook(() => useVisibleRefresh(refresh, 1_000));

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      vi.advanceTimersByTime(1_000);
    });

    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await first.promise;
    });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not run an initial refresh before the first visible interval tick', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const refresh = vi.fn(() => Promise.resolve());

    renderHook(() => useVisibleRefresh(refresh, 1_000));

    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('skips interval ticks while the tab is hidden', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const refresh = vi.fn(() => Promise.resolve());

    renderHook(() => useVisibleRefresh(refresh, 1_000));

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-reads immediately when the tab becomes visible after being hidden past the stale window', async () => {
    vi.useFakeTimers();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const refresh = vi.fn(() => Promise.resolve());

    // Hidden for far longer than any polled domain's stale threshold: the fixed
    // interval fires repeatedly but tick() bails on document.hidden, so no read
    // refreshes and every fetchedAt ages out.
    renderHook(() => useVisibleRefresh(refresh, 1_000));
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(refresh).not.toHaveBeenCalled();

    // Refocus: the immediate visibilitychange refresh fires BEFORE the next
    // interval tick, so fetchedAt advances before a stale window can render.
    hiddenSpy.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when visibilitychange fires while still hidden', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const refresh = vi.fn(() => Promise.resolve());

    renderHook(() => useVisibleRefresh(refresh, 1_000));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('clears the interval and visibilitychange listener on unmount', async () => {
    vi.useFakeTimers();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const refresh = vi.fn(() => Promise.resolve());

    const { unmount } = renderHook(() => useVisibleRefresh(refresh, 1_000));
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();

    // Neither a further interval tick nor a refocus event reaches the unmounted
    // hook.
    hiddenSpy.mockReturnValue(true);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    hiddenSpy.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not poll or listen for refocus while disabled', async () => {
    vi.useFakeTimers();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const refresh = vi.fn(() => Promise.resolve());

    renderHook(() => useVisibleRefresh(refresh, 1_000, { enabled: false }));

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    hiddenSpy.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
