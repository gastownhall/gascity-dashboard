import { FLOW_STILL_MIN_OBSERVATION_MS, type FlowObservation } from '../contracts';

export function formatTideReport(flow: FlowObservation): string {
  const backlog = `${flow.backloggedRigCount} backlogged ${plural(flow.backloggedRigCount, 'rig')}`;
  const priority = `${flow.p0Waiting} P0 waiting`;
  if (flow.observedForMs < FLOW_STILL_MIN_OBSERVATION_MS) {
    return `observing flow · ${backlog} · ${priority}`;
  }

  const minutes = Math.max(1, Math.floor(flow.observedForMs / 60_000));
  const movement = `work moved in ${flow.movingRigCount} of ${flow.backloggedRigCount} ${plural(flow.backloggedRigCount, 'rig')} over ${minutes}m`;
  const still =
    flow.stillRigKeys.length > 0
      ? ` · ${flow.stillRigKeys.map(displayRigKey).join(', ')} still`
      : '';
  return `${movement}${still} · ${priority}`;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function displayRigKey(key: string): string {
  return key.replaceAll('-', ' ').toUpperCase();
}
