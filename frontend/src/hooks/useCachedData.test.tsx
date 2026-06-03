import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCached, invalidate } from "../api/cache";
import { useCachedData } from "./useCachedData";

afterEach(() => {
  cleanup();
  invalidate("");
});

describe("useCachedData", () => {
  it("does not let a stale fetch overwrite state after the cache key changes", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetchers: Record<string, () => Promise<string>> = {
      first: vi.fn(() => first.promise),
      second: vi.fn(() => second.promise),
    };

    const { result, rerender } = renderHook(
      ({ cacheKey }: { cacheKey: string }) =>
        useCachedData(cacheKey, fetcherFor(fetchers, cacheKey)),
      { initialProps: { cacheKey: "first" } },
    );

    expect(result.current.loading).toBe(true);

    rerender({ cacheKey: "second" });

    await act(async () => {
      second.resolve("second result");
      await second.promise;
    });
    await waitFor(() => expect(result.current.data).toBe("second result"));

    await act(async () => {
      first.resolve("first result");
      await first.promise;
    });

    expect(result.current.data).toBe("second result");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not let a stale same-key fetch overwrite the cache slot", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const cacheKey = "run-run:active";

    const { result } = renderHook(() =>
      useCachedData(cacheKey, () => slow.promise, {
        refreshFetcher: () => fast.promise,
      }),
    );

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await act(async () => {
      fast.resolve("fresh result");
      await refreshPromise;
    });
    await waitFor(() => expect(result.current.data).toBe("fresh result"));
    expect(getCached<string>(cacheKey)).toBe("fresh result");

    await act(async () => {
      slow.resolve("stale result");
      await slow.promise;
    });

    expect(result.current.data).toBe("fresh result");
    expect(getCached<string>(cacheKey)).toBe("fresh result");
  });

  it("seeds data from a superseded run when no result has landed yet", async () => {
    // A busy SSE stream re-fires refresh() faster than the slow fetch
    // resolves, so every run is superseded before it completes. Without
    // first-paint rescue the latest-run guard never sets data and the
    // panel stays empty forever (the beads-board "Nothing on the queue"
    // bug). The first completing run for the still-current key must seed
    // data even though a newer run is already in flight.
    const first = deferred<string>();
    const second = deferred<string>();
    const calls = [first, second];
    let callIndex = 0;
    const fetcher = vi.fn(() => calls[callIndex++]!.promise);
    const cacheKey = "beads:board:";

    const { result } = renderHook(() =>
      useCachedData(cacheKey, fetcher),
    );

    // Mount fires run #1 (first). A refresh supersedes it with run #2
    // (second) before run #1 resolves.
    act(() => {
      void result.current.refresh();
    });

    // Run #1 resolves AFTER being superseded — first-paint rescue seeds it.
    await act(async () => {
      first.resolve("first result");
      await first.promise;
    });
    await waitFor(() => expect(result.current.data).toBe("first result"));

    // Once the latest run lands it wins, replacing the rescued value.
    await act(async () => {
      second.resolve("second result");
      await second.promise;
    });
    await waitFor(() => expect(result.current.data).toBe("second result"));
  });

  it("reports the latest fetch failure through onError", async () => {
    const onError = vi.fn();
    const failure = new Error("network down");

    const { result } = renderHook(() =>
      useCachedData("broken", () => Promise.reject(failure), { onError }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("network down");
    expect(onError).toHaveBeenCalledWith(failure);
  });
});

function fetcherFor<T>(
  fetchers: Record<string, () => Promise<T>>,
  key: string,
) {
  const fetcher = fetchers[key];
  if (!fetcher) throw new Error(`missing fetcher for ${key}`);
  return fetcher;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
