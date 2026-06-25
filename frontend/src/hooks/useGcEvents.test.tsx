import { act, cleanup, renderHook } from '@testing-library/react';
import { GC_EVENT_PREFIX } from 'gas-city-dashboard-shared';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { reportClientError } from '../lib/clientErrorReporting';
import { SSE_IDLE_WATCHDOG_MS, useGcEventRefresh } from './useGcEvents';

const eventSources: FakeEventSource[] = [];
const mockReportClientError = reportClientError as Mock;

vi.mock('../lib/clientErrorReporting', () => ({
  reportClientError: vi.fn(() => Promise.resolve({ status: 'reported' })),
}));

describe('useGcEventRefresh', () => {
  beforeEach(() => {
    eventSources.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource);
    mockReportClientError.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fires once for a matching named gc event', () => {
    const onMatch = vi.fn();
    const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], onMatch));

    act(() => eventSources[0]?.open());
    expect(result.current).toBe('open');

    act(() => eventSources[0]?.emitNamed('event', JSON.stringify({ type: 'bead.updated' })));

    expect(onMatch).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('open');
  });

  it('opens the direct supervisor city event stream instead of the dashboard stream mirror', () => {
    renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));

    expect(String(eventSources[0]?.url)).toBe('/gc-supervisor/v0/city/test-city/events/stream');
  });

  it('lets callers ignore prefix-matching events outside their projection', () => {
    const onMatch = vi.fn();
    const { result } = renderHook(() =>
      useGcEventRefresh([GC_EVENT_PREFIX.bead], onMatch, {
        matches: (event) => event.run?.run_id === 'current-run',
      }),
    );

    act(() => eventSources[0]?.open());
    expect(result.current).toBe('open');

    act(() =>
      eventSources[0]?.emitNamed(
        'event',
        JSON.stringify({
          type: 'bead.updated',
          run: { run_id: 'other-run' },
        }),
      ),
    );
    expect(onMatch).not.toHaveBeenCalled();

    act(() =>
      eventSources[0]?.emitNamed(
        'event',
        JSON.stringify({
          type: 'bead.updated',
          run: { run_id: 'current-run' },
        }),
      ),
    );
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('surfaces malformed event payloads as degraded instead of silently swallowing them', () => {
    const onMatch = vi.fn();
    const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], onMatch));

    act(() => eventSources[0]?.open());
    act(() => eventSources[0]?.emitNamed('event', 'not json'));

    expect(onMatch).not.toHaveBeenCalled();
    expect(result.current).toBe('degraded');
    expect(mockReportClientError).toHaveBeenCalledWith({
      component: 'gc-events',
      operation: 'parse event',
      message: 'Malformed gc event payload: invalid JSON.',
    });
  });

  it('reports closed when EventSource is unavailable', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('EventSource', undefined);

    const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));

    expect(result.current).toBe('closed');
  });

  it('does not leave a quiet supervisor stream showing connecting indefinitely', () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));

    expect(result.current).toBe('connecting');
    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(result.current).toBe('connecting');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('open');
  });

  it('does not open a city event stream when no prefixes are requested', () => {
    const { result } = renderHook(() => useGcEventRefresh([], vi.fn()));

    expect(result.current).toBe('closed');
    expect(eventSources).toHaveLength(0);
  });

  describe('reconnect backoff', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('reconnects after an exponentially growing, 30s-capped delay', () => {
      const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));
      expect(eventSources).toHaveLength(1);

      // First error schedules a reconnect using the initial 1s delay.
      act(() => eventSources[0]?.error());
      expect(result.current).toBe('closed');
      expect(eventSources).toHaveLength(1);

      // Just before the 1s delay elapses, no reconnect has happened.
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(eventSources).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(eventSources).toHaveLength(2);

      // The delay doubled to 2s for the next reconnect.
      act(() => eventSources[1]?.error());
      act(() => {
        vi.advanceTimersByTime(1_999);
      });
      expect(eventSources).toHaveLength(2);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(eventSources).toHaveLength(3);

      // Drive past the cap: each subsequent retry doubles (4s, 8s, 16s) and
      // then clamps at 30s no matter how many failures accrue.
      const driveOneRetry = (delayMs: number) => {
        const idx = eventSources.length - 1;
        act(() => eventSources[idx]?.error());
        act(() => {
          vi.advanceTimersByTime(delayMs - 1);
        });
        expect(eventSources).toHaveLength(idx + 1);
        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(eventSources).toHaveLength(idx + 2);
      };
      driveOneRetry(4_000);
      driveOneRetry(8_000);
      driveOneRetry(16_000);
      driveOneRetry(30_000);
      // Already at the cap; the next delay stays clamped at 30s, not 60s.
      driveOneRetry(30_000);
    });

    it('resets the backoff delay to 1s once a reconnect opens', () => {
      renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));

      // Two failures grow the delay to 4s for the third attempt.
      act(() => eventSources[0]?.error());
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      act(() => eventSources[1]?.error());
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(eventSources).toHaveLength(3);

      // A successful open resets the backoff window.
      act(() => eventSources[2]?.open());
      act(() => eventSources[2]?.error());
      // The delay is back to the initial 1s, not the grown 8s.
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(eventSources).toHaveLength(3);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(eventSources).toHaveLength(4);
    });

    it('cancels a pending reconnect timer on unmount', () => {
      const { unmount } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));
      act(() => eventSources[0]?.error());
      unmount();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      // No reconnect after teardown.
      expect(eventSources).toHaveLength(1);
    });
  });

  describe('idle-watchdog (half-open detection)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    const emitEvent = () =>
      act(() => eventSources[0]?.emitNamed('event', JSON.stringify({ type: 'bead.updated' })));

    it('flips an open-but-silent stream to degraded once the idle window elapses', () => {
      const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));
      act(() => eventSources[0]?.open());
      expect(result.current).toBe('open');

      // Just before the window closes the stream still reads live.
      act(() => {
        vi.advanceTimersByTime(SSE_IDLE_WATCHDOG_MS - 1);
      });
      expect(result.current).toBe('open');

      // At the window edge a silently half-open socket degrades to ochre.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe('degraded');
    });

    it('keeps a continuously-active stream open — each event re-arms the watchdog', () => {
      const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));
      act(() => eventSources[0]?.open());

      // An event arriving just shy of every window keeps resetting the timer,
      // so the stream never trips the watchdog across several windows.
      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(SSE_IDLE_WATCHDOG_MS - 1);
        });
        emitEvent();
        expect(result.current).toBe('open');
      }
    });

    it('recovers to open when an event arrives after the watchdog degraded it', () => {
      const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));
      act(() => eventSources[0]?.open());

      act(() => {
        vi.advanceTimersByTime(SSE_IDLE_WATCHDOG_MS);
      });
      expect(result.current).toBe('degraded');

      // A real event proves the socket is alive again: liveness recovers.
      emitEvent();
      expect(result.current).toBe('open');
    });

    it('does not fire the watchdog after the stream errors and closes', () => {
      const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));
      act(() => eventSources[0]?.open());
      act(() => eventSources[0]?.error());
      expect(result.current).toBe('closed');

      // The idle timer was cleared on close, so advancing past the window must
      // not resurrect a stale 'degraded'. Within the window the reconnect cycle
      // runs (retry -> connecting -> grace-promote), landing back on 'open' — a
      // tighter terminal state than merely "not degraded".
      act(() => {
        vi.advanceTimersByTime(SSE_IDLE_WATCHDOG_MS);
      });
      expect(result.current).toBe('open');
    });

    it('cancels the watchdog on unmount so no state update lands after teardown', () => {
      const { result, unmount } = renderHook(() =>
        useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()),
      );
      act(() => eventSources[0]?.open());
      unmount();
      act(() => {
        vi.advanceTimersByTime(SSE_IDLE_WATCHDOG_MS);
      });
      // No throw and the last observed state is the pre-unmount 'open'.
      expect(result.current).toBe('open');
    });

    it('arms the watchdog via the connecting-grace path, not only an explicit open', () => {
      const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));

      // Never call .open(): a quiet supervisor that accepts the socket but sends
      // no onopen is promoted to 'open' by the 2s connecting-grace timer. That
      // arm-path was previously uncovered — every other watchdog case opens
      // explicitly, so only the onopen arm was exercised.
      expect(result.current).toBe('connecting');
      act(() => {
        vi.advanceTimersByTime(2_000); // CONNECTING_GRACE_MS
      });
      expect(result.current).toBe('open');

      // The grace callback armed the watchdog, so a then-silent stream still
      // degrades a full idle window later.
      act(() => {
        vi.advanceTimersByTime(SSE_IDLE_WATCHDOG_MS);
      });
      expect(result.current).toBe('degraded');
    });

    it('runs a fresh watchdog on the reconnected stream without a stale one from the dead socket', () => {
      const { result } = renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], vi.fn()));

      // Source 0 opens (arming its watchdog) then errors. onerror clears that
      // watchdog and schedules a 1s reconnect.
      act(() => eventSources[0]?.open());
      act(() => eventSources[0]?.error());
      expect(result.current).toBe('closed');

      // The backoff elapses and connect() builds source 1, which then opens and
      // arms its OWN watchdog.
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(eventSources).toHaveLength(2);
      act(() => eventSources[1]?.open());
      expect(result.current).toBe('open');

      // Advance to the instant source 0's watchdog WOULD have fired had it leaked
      // (one full window after source 0 opened, at t0+window). The stream must
      // still read 'open' — proving no stale timer from the dead socket forced a
      // premature 'degraded' on its successor.
      act(() => {
        vi.advanceTimersByTime(SSE_IDLE_WATCHDOG_MS - 1_000);
      });
      expect(result.current).toBe('open');

      // Source 1's own watchdog then fires a full window after IT opened.
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(result.current).toBe('degraded');
    });
  });

  describe('coalesce throttle window', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('fires immediately for the first match, then coalesces a burst into one trailing fire', () => {
      const onMatch = vi.fn();
      renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], onMatch));
      act(() => eventSources[0]?.open());

      const emit = () =>
        act(() => eventSources[0]?.emitNamed('event', JSON.stringify({ type: 'bead.updated' })));

      // Leading edge: the first matching event fires onMatch right away.
      emit();
      expect(onMatch).toHaveBeenCalledTimes(1);

      // A burst inside the 2.5s window does not fire again immediately;
      // it schedules a single trailing fire at the window edge.
      emit();
      emit();
      emit();
      expect(onMatch).toHaveBeenCalledTimes(1);

      // Before the window closes, still just the leading fire.
      act(() => {
        vi.advanceTimersByTime(2_499);
      });
      expect(onMatch).toHaveBeenCalledTimes(1);

      // At the window edge the single trailing fire lands: burst -> 2 total.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onMatch).toHaveBeenCalledTimes(2);
    });

    it('fires immediately again once the window has elapsed', () => {
      const onMatch = vi.fn();
      renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], onMatch));
      act(() => eventSources[0]?.open());

      const emit = () =>
        act(() => eventSources[0]?.emitNamed('event', JSON.stringify({ type: 'bead.updated' })));

      emit();
      expect(onMatch).toHaveBeenCalledTimes(1);

      // After the full window elapses with no events, the next match is
      // outside the window and fires on its own leading edge.
      act(() => {
        vi.advanceTimersByTime(2_500);
      });
      emit();
      expect(onMatch).toHaveBeenCalledTimes(2);
    });

    it('honors a caller-supplied coalesceMs to widen the trailing window', () => {
      const onMatch = vi.fn();
      renderHook(() => useGcEventRefresh([GC_EVENT_PREFIX.bead], onMatch, { coalesceMs: 10_000 }));
      act(() => eventSources[0]?.open());

      const emit = () =>
        act(() => eventSources[0]?.emitNamed('event', JSON.stringify({ type: 'bead.updated' })));

      // Leading edge still fires the first match immediately.
      emit();
      expect(onMatch).toHaveBeenCalledTimes(1);

      // A burst that would have flushed under the default 2.5s window is held
      // back: nothing extra fires until the wider 10s window closes.
      emit();
      emit();
      act(() => {
        vi.advanceTimersByTime(9_999);
      });
      expect(onMatch).toHaveBeenCalledTimes(1);

      // At the widened window edge the single trailing fire lands.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onMatch).toHaveBeenCalledTimes(2);
    });
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

  error(): void {
    this.onerror?.(new Event('error'));
  }

  emitNamed(type: string, data: string): void {
    const event = new MessageEvent<string>(type, { data });
    this.listeners.get(type)?.forEach((listener) => listener(event));
    if (type === 'message') this.onmessage?.(event);
  }
}
