// Stranded work: actionable beads with no live owner. A distressed AGENT rises
// to the surface shelf as a fish; stranded WORK has no agent to be, so it
// surfaces as a per-rig marker instead (the pellet stays sunk — "blocked" is
// already its position). The predicate is deliberately structural, not
// age-scored: a bead is stranded when every dependency is closed (so it is
// actually workable) AND it has no live owner — either it is assigned to an
// agent whose session is gone, or it is unassigned on a rig with no live agent
// to pick it up. NOT "any blocked bead" (a bead with an open dependency is
// waiting, not stranded) and NOT a staleness threshold (no hidden clock).

import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import {
  isBlockedStatus,
  isInFlightStatus,
  isOpenStatus,
  parseAssignee,
} from 'gas-city-dashboard-shared';

export interface StrandedInputs {
  beadsByRig: Readonly<Record<string, { items: readonly Bead[]; total: number }>>;
  /** session ids of live (non-ghost) agents; an assignee whose session is not
   *  here is a dead owner. */
  liveSessionIds: ReadonlySet<string>;
  /** live-agent count per rig key; a rig at 0 has no one to grab unclaimed work. */
  liveAgentsByRig: ReadonlyMap<string, number>;
}

/** Per-rig count of stranded beads (rigs with none are absent from the map). */
export function buildStrandedByRig(inputs: StrandedInputs): Record<string, number> {
  // Only beads present in the active store exist here; a dependency that has
  // left the store has closed and no longer blocks.
  const activeIds = new Set<string>();
  for (const entry of Object.values(inputs.beadsByRig))
    for (const bead of entry.items) activeIds.add(bead.id);

  const out: Record<string, number> = {};
  for (const [rigKey, entry] of Object.entries(inputs.beadsByRig)) {
    let n = 0;
    for (const bead of entry.items) {
      if (isStranded(bead, rigKey, activeIds, inputs)) n += 1;
    }
    if (n > 0) out[rigKey] = n;
  }
  return out;
}

function isStranded(
  bead: Bead,
  rigKey: string,
  activeIds: ReadonlySet<string>,
  inputs: StrandedInputs,
): boolean {
  // in-progress work has a live holder; only open/blocked beads can strand.
  if (isInFlightStatus(bead.status)) return false;
  if (!isOpenStatus(bead.status) && !isBlockedStatus(bead.status)) return false;
  if (!isActionable(bead, activeIds)) return false; // an open dep = waiting, not stranded
  const assignee = bead.assignee ?? '';
  if (assignee.length > 0) {
    // orphaned: assigned to an agent whose session is no longer live.
    const sid = parseAssignee(assignee).sessionId;
    return sid === undefined || !inputs.liveSessionIds.has(sid);
  }
  // unassigned: stranded only when the rig has no live agent to claim it.
  return (inputs.liveAgentsByRig.get(rigKey) ?? 0) === 0;
}

/** Actionable = every dependency has left the active store (closed). A dependency
 * still present is open (or in-flight) and genuinely blocks the bead. */
function isActionable(bead: Bead, activeIds: ReadonlySet<string>): boolean {
  const deps = bead.dependencies ?? [];
  return deps.every((d) => !activeIds.has(d.depends_on_id));
}
