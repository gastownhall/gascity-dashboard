import {
  FLOW_OBSERVATION_WINDOW_MS,
  FLOW_RECEIPT_LIFETIME_MS,
  FLOW_STILL_MIN_OBSERVATION_MS,
  type FlowObservation,
  type FlowReceipt,
  type FlowReceiptKind,
} from '../contracts';
import type { BeadHolder } from './pellets';

const MAX_STILL_RIGS = 2;

interface ObservedEvent {
  id: string;
  beadId: string;
  rigKey: string;
  kind: FlowReceiptKind;
  observedAtMs: number;
}

export interface FlowMemory {
  startedAtMs: number;
  events: readonly ObservedEvent[];
}

export interface ObserveFlowInputs {
  current: Readonly<Record<string, BeadHolder>>;
  previous: Readonly<Record<string, BeadHolder>>;
  memory: FlowMemory | null;
  nowMs: number;
  unavailableRigKeys: readonly string[];
  openTotalsByRig: Readonly<Record<string, number>>;
}

export function observeFlow(inputs: ObserveFlowInputs): {
  flow: FlowObservation;
  memory: FlowMemory;
} {
  const startedAtMs = inputs.memory?.startedAtMs ?? inputs.nowMs;
  const unavailable = new Set(inputs.unavailableRigKeys);
  const rigKeys = Object.keys(inputs.openTotalsByRig);
  const observedRigCount = rigKeys.filter((rigKey) => !unavailable.has(rigKey)).length;
  const observedForMs = Math.min(
    FLOW_OBSERVATION_WINDOW_MS,
    Math.max(0, inputs.nowMs - startedAtMs),
  );
  const newEvents = inputs.memory === null ? [] : detectEvents(inputs, unavailable);
  const events = [...(inputs.memory?.events ?? []), ...newEvents].filter(
    (event) => inputs.nowMs - event.observedAtMs <= FLOW_OBSERVATION_WINDOW_MS,
  );
  const availableBacklog = Object.entries(inputs.openTotalsByRig)
    .filter(([rigKey, total]) => total > 0 && !unavailable.has(rigKey))
    .sort(([a], [b]) => a.localeCompare(b));
  const availableRigKeys = new Set(availableBacklog.map(([rigKey]) => rigKey));
  const movingRigs = new Set(
    events.filter((event) => availableRigKeys.has(event.rigKey)).map((event) => event.rigKey),
  );

  return {
    flow: {
      observedForMs,
      windowMs: FLOW_OBSERVATION_WINDOW_MS,
      observedRigCount,
      totalRigCount: rigKeys.length,
      backloggedRigCount: availableBacklog.length,
      movingRigCount: movingRigs.size,
      stillRigKeys: selectStillRigs(inputs.current, availableBacklog, movingRigs, observedForMs),
      p0Waiting: countP0Waiting(inputs.current, unavailable),
      receipts: buildReceipts(events, startedAtMs, inputs.nowMs),
    },
    memory: { startedAtMs, events },
  };
}

function selectStillRigs(
  holders: Readonly<Record<string, BeadHolder>>,
  availableBacklog: ReadonlyArray<readonly [string, number]>,
  movingRigs: ReadonlySet<string>,
  observedForMs: number,
): string[] {
  if (observedForMs < FLOW_STILL_MIN_OBSERVATION_MS) return [];
  return availableBacklog
    .filter(([rigKey]) => !movingRigs.has(rigKey))
    .sort(
      ([a, totalA], [b, totalB]) =>
        p0WaitingForRig(holders, b) - p0WaitingForRig(holders, a) ||
        totalB - totalA ||
        a.localeCompare(b),
    )
    .slice(0, MAX_STILL_RIGS)
    .map(([rigKey]) => rigKey);
}

function countP0Waiting(
  holders: Readonly<Record<string, BeadHolder>>,
  unavailable: ReadonlySet<string>,
): number {
  return Object.values(holders).filter(
    (holder) => holder.isP0 && holder.state !== 'held' && !unavailable.has(holder.rigKey),
  ).length;
}

function buildReceipts(
  events: readonly ObservedEvent[],
  startedAtMs: number,
  nowMs: number,
): FlowReceipt[] {
  return events
    .filter((event) => nowMs - event.observedAtMs < FLOW_RECEIPT_LIFETIME_MS)
    .map((event) => ({
      id: event.id,
      beadId: event.beadId,
      rigKey: event.rigKey,
      kind: event.kind,
      observedAtOffsetMs: event.observedAtMs - startedAtMs,
      ageMsAtSnapshot: nowMs - event.observedAtMs,
    }));
}

function detectEvents(
  inputs: ObserveFlowInputs,
  unavailable: ReadonlySet<string>,
): ObservedEvent[] {
  const events: ObservedEvent[] = [];
  for (const [beadId, current] of Object.entries(inputs.current)) {
    const previous = inputs.previous[beadId];
    if (
      previous !== undefined &&
      previous.state !== 'held' &&
      current.state === 'held' &&
      !unavailable.has(current.rigKey)
    ) {
      events.push(makeEvent(beadId, current.rigKey, 'pickup', inputs.nowMs));
    }
  }
  for (const [beadId, previous] of Object.entries(inputs.previous)) {
    if (inputs.current[beadId] === undefined && !unavailable.has(previous.rigKey)) {
      events.push(makeEvent(beadId, previous.rigKey, 'completion', inputs.nowMs));
    }
  }
  return events;
}

function makeEvent(
  beadId: string,
  rigKey: string,
  kind: FlowReceiptKind,
  observedAtMs: number,
): ObservedEvent {
  return {
    id: `${kind}:${beadId}:${observedAtMs}`,
    beadId,
    rigKey,
    kind,
    observedAtMs,
  };
}

function p0WaitingForRig(holders: Readonly<Record<string, BeadHolder>>, rigKey: string): number {
  return Object.values(holders).filter(
    (holder) => holder.rigKey === rigKey && holder.isP0 && holder.state !== 'held',
  ).length;
}
