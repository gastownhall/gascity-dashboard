import { describe, expect, it } from 'vitest';
import type { TypedEventStreamEnvelope } from 'gas-city-dashboard-shared/gc-supervisor';
import { supervisorEventDetail, supervisorEventSignal } from './eventSignals';

// The attention/watch classification drives the supervisor event badge. These
// sets are pinned here so dropping, renaming, or reclassifying a supervisor
// event type fails a test instead of silently changing what the badge surfaces
// (gascity-dashboard-afeo). The lists are the EXPECTED membership, duplicated on
// purpose — the test is the second copy that catches an edit to the source set.
const ATTENTION_TYPES = [
  'gc.store.maintenance.failed',
  'order.failed',
  'request.failed',
  'session.crashed',
  'session.stranded',
  'session.work_query_failed',
  'supervisor.shutdown_requested',
] as const;

const WATCH_TYPES = [
  'events.rotated',
  'session.quarantined',
  'session.suspended',
  'supervisor.fs_pressure.skipped_tick',
] as const;

// Minimal envelope carrying only the fields the classifier reads (type) plus
// the optional detail fields. The wire shape is a discriminated union over
// dozens of variants; this loader only ever reads `type`, `message`, `subject`,
// so a structural fixture cast to the union type is the honest minimum.
function envelope(
  type: string,
  detail: { message?: string; subject?: string } = {},
): TypedEventStreamEnvelope {
  return {
    type,
    actor: 'supervisor',
    seq: 1,
    ts: '2026-06-28T00:00:00Z',
    payload: {},
    ...detail,
  } as unknown as TypedEventStreamEnvelope;
}

describe('supervisorEventSignal', () => {
  it.each(ATTENTION_TYPES)('classifies %s as attention', (type) => {
    expect(supervisorEventSignal(envelope(type))).toBe('attention');
  });

  it.each(WATCH_TYPES)('classifies %s as watch', (type) => {
    expect(supervisorEventSignal(envelope(type))).toBe('watch');
  });

  it('classifies any unmapped type as a plain event', () => {
    for (const type of ['bead.closed', 'mail.sent', 'session.updated', 'controller.started']) {
      expect(supervisorEventSignal(envelope(type))).toBe('event');
    }
  });

  it('does not cross-classify a watch type as attention or vice versa', () => {
    // Guards against a future edit that adds a type to both sets: attention is
    // checked first, so a watch type leaking into the attention set would flip
    // here while its watch test above still passed.
    for (const type of WATCH_TYPES) {
      expect(supervisorEventSignal(envelope(type))).not.toBe('attention');
    }
    for (const type of ATTENTION_TYPES) {
      expect(supervisorEventSignal(envelope(type))).not.toBe('watch');
    }
  });
});

describe('supervisorEventDetail', () => {
  it('prefers the message when present', () => {
    expect(
      supervisorEventDetail(
        envelope('order.failed', { message: 'order blew up', subject: 'ord-1' }),
      ),
    ).toBe('order blew up');
  });

  it('falls back to the subject when no message', () => {
    expect(supervisorEventDetail(envelope('order.failed', { subject: 'ord-1' }))).toBe('ord-1');
  });

  it('falls back to the type when neither message nor subject is set', () => {
    expect(supervisorEventDetail(envelope('order.failed'))).toBe('order.failed');
  });
});
