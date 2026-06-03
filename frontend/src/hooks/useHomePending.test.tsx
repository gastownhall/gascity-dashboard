import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AlertItem } from 'gas-city-dashboard-shared';
import { setActiveCity } from '../api/cityBase';
import { reportClientError } from '../lib/clientErrorReporting';
import { useHomePending } from './useHomePending';

vi.mock('../lib/clientErrorReporting', () => ({
  reportClientError: vi.fn(() => Promise.resolve({ status: 'reported' })),
}));

const eventSources: FakeEventSource[] = [];
const mockReport = reportClientError as Mock;

const alert = (requestId: string): AlertItem => ({
  kind: 'pending-decision', source: 'pending',
  ref: { requestId, sessionId: 's1' }, href: '/agents/s1',
  title: 't', reason: 'tool_approval', severity: 'attention',
  occurredAt: '2026-06-02T12:00:00.000Z',
  dedupKey: `pending-decision:${requestId}`, version: 1, provenance: 'fresh',
});

describe('useHomePending', () => {
  beforeEach(() => {
    eventSources.length = 0;
    setActiveCity('test-city');
    vi.stubGlobal('EventSource', FakeEventSource);
    mockReport.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens a stream and reports open on connect', () => {
    const { result } = renderHook(() => useHomePending());
    expect(result.current.conn).toBe('connecting');
    act(() => eventSources[0]?.open());
    expect(result.current.conn).toBe('open');
    expect(eventSources[0]?.url).toContain('/home/pending/stream');
  });

  it('surfaces pending-decision alerts from a frame', () => {
    const { result } = renderHook(() => useHomePending());
    act(() => eventSources[0]?.open());
    act(() => eventSources[0]?.emitNamed('pending', JSON.stringify({ alerts: [alert('req-1')] })));
    expect(result.current.alerts.map((a) => a.dedupKey)).toEqual(['pending-decision:req-1']);
    expect(result.current.conn).toBe('open');
  });

  it('keeps last-known alerts but marks degraded on a transient error', () => {
    const { result } = renderHook(() => useHomePending());
    act(() => eventSources[0]?.open());
    act(() => eventSources[0]?.emitNamed('pending', JSON.stringify({ alerts: [alert('req-1')] })));
    act(() => eventSources[0]?.error()); // readyState stays OPEN (reconnecting)
    expect(result.current.conn).toBe('degraded');
    expect(result.current.alerts.length).toBe(1); // not cleared — a drop is not a resolve
  });

  it('reports closed when the stream is permanently closed', () => {
    const { result } = renderHook(() => useHomePending());
    act(() => eventSources[0]?.open());
    act(() => {
      eventSources[0]!.readyState = FakeEventSource.CLOSED;
      eventSources[0]!.error();
    });
    expect(result.current.conn).toBe('closed');
  });

  it('degrades (not crashes) on a malformed frame and reports once', () => {
    const { result } = renderHook(() => useHomePending());
    act(() => eventSources[0]?.open());
    act(() => eventSources[0]?.emitNamed('pending', 'not json'));
    expect(result.current.conn).toBe('degraded');
    expect(mockReport).toHaveBeenCalledTimes(1);
  });

  it('does not open a stream when disabled', () => {
    const { result } = renderHook(() => useHomePending(false));
    expect(eventSources.length).toBe(0);
    expect(result.current.conn).toBe('closed');
  });

  // gascity-dashboard-gztl (R6/R15/R16): the pending-scope provenance is the
  // fail-safe the home renders signal-unavailable off. It must gate on the
  // in-band item provenance, NOT just connection liveness — an open stream over
  // a dark aggregator is the premortem's #1 missed-alarm risk.
  describe('provenance (R15 fail-safe)', () => {
    const staleAlert = (requestId: string): AlertItem => ({ ...alert(requestId), provenance: 'stale' });

    it('is unavailable before any frame, even once the connection is open', () => {
      const { result } = renderHook(() => useHomePending());
      expect(result.current.provenance).toBe('unavailable');
      act(() => eventSources[0]?.open());
      expect(result.current.provenance).toBe('unavailable'); // open is not yet certified
    });

    it('certifies fresh once a frame of all-fresh items arrives', () => {
      const { result } = renderHook(() => useHomePending());
      act(() => eventSources[0]?.open());
      act(() => eventSources[0]?.emitNamed('pending', JSON.stringify({ alerts: [alert('req-1')] })));
      expect(result.current.provenance).toBe('fresh');
    });

    it('treats an empty fresh frame as a certified quiet state (fresh, not unknown)', () => {
      const { result } = renderHook(() => useHomePending());
      act(() => eventSources[0]?.open());
      act(() => eventSources[0]?.emitNamed('pending', JSON.stringify({ alerts: [] })));
      expect(result.current.alerts).toEqual([]);
      expect(result.current.provenance).toBe('fresh');
    });

    it('stays unavailable on an OPEN stream whose frame carries a stale item (dark aggregator)', () => {
      const { result } = renderHook(() => useHomePending());
      act(() => eventSources[0]?.open());
      act(() => eventSources[0]?.emitNamed('pending', JSON.stringify({ alerts: [alert('req-1')] })));
      expect(result.current.provenance).toBe('fresh');

      // The backend restamps the last-known pending 'stale' when its per-session
      // subscription goes dark. Connection is still open — provenance must NOT
      // read fresh, or the home shows a false all-clear over stale data.
      act(() => eventSources[0]?.emitNamed('pending', JSON.stringify({ alerts: [staleAlert('req-1')] })));
      expect(result.current.conn).toBe('open');
      expect(result.current.provenance).toBe('unavailable');
      expect(result.current.alerts.length).toBe(1); // row kept, marked unavailable — a dark source is not a resolve
    });

    it('drops back to unavailable when the stream errors', () => {
      const { result } = renderHook(() => useHomePending());
      act(() => eventSources[0]?.open());
      act(() => eventSources[0]?.emitNamed('pending', JSON.stringify({ alerts: [alert('req-1')] })));
      expect(result.current.provenance).toBe('fresh');
      act(() => eventSources[0]?.error());
      expect(result.current.provenance).toBe('unavailable');
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
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  close(): void { this.readyState = FakeEventSource.CLOSED; }
  open(): void { this.readyState = FakeEventSource.OPEN; this.onopen?.(new Event('open')); }
  error(): void { this.onerror?.(new Event('error')); }
  emitNamed(type: string, data: string): void {
    const event = new MessageEvent<string>(type, { data });
    this.listeners.get(type)?.forEach((listener) => listener(event));
    if (type === 'message') this.onmessage?.(event);
  }
}
