import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import type { AlertItem } from 'gas-city-dashboard-shared';

import { handleHomePendingStream } from '../src/routes/home-pending.js';
import type { SnapshotService } from '../src/snapshot/service.js';

// Layer 3 dashboard SSE handler (gascity-dashboard-26zl). Driven with fake
// req/res + a fake service so the stream contract is deterministic.

class FakeRes extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  writes: string[] = [];
  writableEnded = false;
  status(code: number): this { this.statusCode = code; return this; }
  setHeader(k: string, v: string): void { this.headers[k] = v; }
  flushHeaders(): void {}
  write(chunk: string): boolean { this.writes.push(chunk); return true; }
  end(): void { this.writableEnded = true; }
}

function fakeService(): {
  service: SnapshotService;
  fire: () => void;
  setAlerts: (a: AlertItem[]) => void;
  unsubscribed: () => boolean;
} {
  let alerts: AlertItem[] = [];
  let listener: (() => void) | null = null;
  let unsub = false;
  const service = {
    pendingAlerts: () => alerts,
    streamPending: (l: () => void) => {
      listener = l;
      return () => { unsub = true; listener = null; };
    },
  } as unknown as SnapshotService;
  return {
    service,
    fire: () => listener?.(),
    setAlerts: (a) => { alerts = a; },
    unsubscribed: () => unsub,
  };
}

const alert = (requestId: string): AlertItem => ({
  kind: 'pending-decision', source: 'pending',
  ref: { requestId, sessionId: 's1' }, href: '/agents/s1',
  title: 't', reason: 'tool_approval', severity: 'attention',
  occurredAt: '2026-06-02T12:00:00.000Z',
  dedupKey: `pending-decision:${requestId}`, version: 1, provenance: 'fresh',
});

describe('handleHomePendingStream', () => {
  test('opens an event-stream and sends an initial pending frame', () => {
    const { service } = fakeService();
    const res = new FakeRes();
    handleHomePendingStream(service, new EventEmitter() as never, res as never, { heartbeatMs: 10_000 });
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    assert.equal(res.writes.length, 1);
    assert.match(res.writes[0]!, /^event: pending\ndata: /);
    assert.match(res.writes[0]!, /"alerts":\[\]/);
  });

  test('pushes an updated frame when the aggregator changes', () => {
    const f = fakeService();
    const res = new FakeRes();
    handleHomePendingStream(f.service, new EventEmitter() as never, res as never, { heartbeatMs: 10_000 });
    f.setAlerts([alert('req-1')]);
    f.fire();
    assert.equal(res.writes.length, 2); // initial + change
    assert.match(res.writes[1]!, /pending-decision:req-1/);
  });

  test('on client disconnect it unsubscribes and ends the response', () => {
    const f = fakeService();
    const res = new FakeRes();
    const req = new EventEmitter();
    handleHomePendingStream(f.service, req as never, res as never, { heartbeatMs: 10_000 });
    req.emit('close');
    assert.ok(f.unsubscribed());
    assert.ok(res.writableEnded);
  });
});
