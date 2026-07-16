import {
  FLOW_OBSERVATION_WINDOW_MS,
  FLOW_RECENT_MOVEMENT_MS,
  FLOW_STILL_MIN_OBSERVATION_MS,
  type FlowObservation,
} from '../contracts';
import type { BeadHolder } from './pellets';

const MAX_STILL_RIGS = 2;

interface ObservedEvent {
  rigKey: string;
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
      recentlyMovingRigKeys: selectRecentlyMovingRigs(events, availableRigKeys, inputs.nowMs),
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

function selectRecentlyMovingRigs(
  events: readonly ObservedEvent[],
  availableRigKeys: ReadonlySet<string>,
  nowMs: number,
): string[] {
  return [
    ...new Set(
      events
        .filter(
          (event) =>
            availableRigKeys.has(event.rigKey) &&
            nowMs - event.observedAtMs < FLOW_RECENT_MOVEMENT_MS,
        )
        .map((event) => event.rigKey),
    ),
  ].sort((a, b) => a.localeCompare(b));
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
      events.push({ rigKey: current.rigKey, observedAtMs: inputs.nowMs });
    }
  }
  for (const [beadId, previous] of Object.entries(inputs.previous)) {
    if (inputs.current[beadId] === undefined && !unavailable.has(previous.rigKey)) {
      events.push({ rigKey: previous.rigKey, observedAtMs: inputs.nowMs });
    }
  }
  return events;
}

function p0WaitingForRig(holders: Readonly<Record<string, BeadHolder>>, rigKey: string): number {
  return Object.values(holders).filter(
    (holder) => holder.rigKey === rigKey && holder.isP0 && holder.state !== 'held',
  ).length;
}
