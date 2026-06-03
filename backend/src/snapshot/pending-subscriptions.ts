// PendingSubscriptionManager — Layer 2 of the city-wide pending aggregator
// (gascity-dashboard-3rm7, PRD R3/R16, Option A). It reconciles a live set of
// per-session SSE subscriptions to the active-session set, feeds observed
// PendingInteractions into the PendingStore, and reconnects with backoff on
// stream failure.
//
// The transport is injected as a SessionStreamSubscriber so this orchestration
// is unit-tested deterministically with a fake; the real fetch/text-event-stream
// subscriber (Layer 2b) implements the same interface. The reconnect scheduler
// is injected for the same reason (tests drive it synchronously).
//
// Premortem Theme A (the top tier must never lie):
//  - syncActiveSessions() closes subscriptions for sessions no longer active and
//    calls store.retainActive(), so a gone session's pending cannot linger.
//  - a successful pending frame resets the backoff attempt counter.
//  - a transient stream error KEEPS the last-known pending (no flapping) and
//    reconnects; it does not clear, because a disconnect is not a resolve. The
//    bounded staleness window across a reconnect is the documented tradeoff;
//    the dashboard layer (R16) surfaces a degraded provenance when the
//    aggregator's view is not live.

import type { PendingInteraction } from 'gas-city-dashboard-shared';

import type { PendingStore } from './pending-store.js';

export interface SessionStreamSubscription {
  close(): void;
}

export interface SessionPendingHandlers {
  /** A parsed `pending` frame: an interaction, or null when pending was cleared. */
  onPending(pending: PendingInteraction | null): void;
  /** The stream failed; the manager will reconnect with backoff. */
  onError(error: Error): void;
}

export interface SessionStreamSubscriber {
  subscribe(sessionId: string, handlers: SessionPendingHandlers): SessionStreamSubscription;
}

/** Schedule a reconnect for `run`, returning a cancel handle. `attempt` starts at 0. */
export type ReconnectScheduler = (run: () => void, attempt: number) => () => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

export const defaultReconnectScheduler: ReconnectScheduler = (run, attempt) => {
  const ms = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 6));
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export interface PendingSubscriptionManagerOptions {
  subscriber: SessionStreamSubscriber;
  store: PendingStore;
  now?: () => Date;
  scheduleReconnect?: ReconnectScheduler;
  /** Invoked after any change to the store's pending set (push for Layer 3). */
  onChange?: () => void;
}

interface SessionSub {
  subscription: SessionStreamSubscription;
  attempt: number;
  cancelReconnect?: () => void;
}

export class PendingSubscriptionManager {
  private readonly subscriber: SessionStreamSubscriber;
  private readonly store: PendingStore;
  private readonly now: () => Date;
  private readonly scheduleReconnect: ReconnectScheduler;
  private readonly onChange: () => void;
  private readonly subs = new Map<string, SessionSub>();

  constructor(options: PendingSubscriptionManagerOptions) {
    this.subscriber = options.subscriber;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.scheduleReconnect = options.scheduleReconnect ?? defaultReconnectScheduler;
    this.onChange = options.onChange ?? (() => {});
  }

  /** Number of sessions currently subscribed (live or awaiting reconnect). */
  get subscribedCount(): number {
    return this.subs.size;
  }

  /**
   * Reconcile subscriptions to `activeSessionIds`: open new ones, tear down
   * sessions no longer active, and drop their pending from the store.
   */
  syncActiveSessions(activeSessionIds: Iterable<string>): void {
    const active = activeSessionIds instanceof Set
      ? activeSessionIds
      : new Set(activeSessionIds);
    for (const sessionId of [...this.subs.keys()]) {
      if (!active.has(sessionId)) this.teardown(sessionId);
    }
    for (const sessionId of active) {
      if (!this.subs.has(sessionId)) this.open(sessionId, 0);
    }
    if (this.store.retainActive(active) > 0) this.onChange();
  }

  /** Close every subscription and cancel pending reconnects (e.g. shutdown). */
  closeAll(): void {
    for (const sessionId of [...this.subs.keys()]) this.teardown(sessionId);
  }

  private open(sessionId: string, attempt: number): void {
    const subscription = this.subscriber.subscribe(sessionId, {
      onPending: (pending) => this.handlePending(sessionId, pending),
      onError: (error) => this.handleError(sessionId, error),
    });
    this.subs.set(sessionId, { subscription, attempt });
  }

  private handlePending(sessionId: string, pending: PendingInteraction | null): void {
    const sub = this.subs.get(sessionId);
    if (sub === undefined) return; // torn down mid-flight
    sub.attempt = 0; // a live frame resets backoff
    if (pending === null) {
      this.store.clear(sessionId);
    } else {
      this.store.observe(sessionId, pending, this.now().toISOString());
    }
    this.onChange();
  }

  private handleError(sessionId: string, _error: Error): void {
    const sub = this.subs.get(sessionId);
    if (sub === undefined) return;
    sub.subscription.close();
    const attempt = sub.attempt;
    // Keep last-known pending across the reconnect (a disconnect is not a
    // resolve); reconnect with backoff.
    const cancel = this.scheduleReconnect(() => {
      if (this.subs.get(sessionId) === sub) this.open(sessionId, attempt + 1);
    }, attempt);
    sub.cancelReconnect = cancel;
  }

  private teardown(sessionId: string): void {
    const sub = this.subs.get(sessionId);
    if (sub === undefined) return;
    sub.cancelReconnect?.();
    sub.subscription.close();
    this.subs.delete(sessionId);
  }
}
