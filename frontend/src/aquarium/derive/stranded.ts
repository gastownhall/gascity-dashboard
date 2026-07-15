// Stranded work: actionable beads whose assigned owner is gone. A distressed
// AGENT rises to the surface shelf as a fish; stranded WORK has no agent to be,
// so it surfaces as a per-rig marker instead (the pellet stays sunk — "blocked"
// is already its position). The predicate is deliberately structural, not
// age-scored: a bead is stranded when it was ASSIGNED to an agent whose session
// is no longer live (orphaned mid-flight) AND every dependency is closed (so it
// is actually workable). Unassigned backlog is NOT stranded — a rig with no live
// agent has a backlog waiting to be picked up, not an alarm; surfacing the whole
// ready queue of every idle rig would drown the "needs a human" scan line. And
// NOT "any blocked bead" (an open dependency = waiting, not stranded), NOT a
// staleness threshold (no hidden clock).

import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { parseAssignee } from 'gas-city-dashboard-shared';

export interface StrandedInputs {
  beadsByRig: Readonly<Record<string, { items: readonly Bead[]; total: number }>>;
  /** session ids of live (non-ghost) agents; an assignee whose session is not
   *  here is a dead owner. */
  liveSessionIds: ReadonlySet<string>;
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
      if (isStranded(bead, activeIds, inputs.liveSessionIds)) n += 1;
    }
    if (n > 0) out[rigKey] = n;
  }
  return out;
}

function isStranded(
  bead: Bead,
  activeIds: ReadonlySet<string>,
  liveSessionIds: ReadonlySet<string>,
): boolean {
  const assignee = bead.assignee ?? '';
  if (assignee.length === 0) return false; // unassigned backlog is not an alarm
  const sessionId = parseAssignee(assignee).sessionId;
  const ownerLive = sessionId !== undefined && liveSessionIds.has(sessionId);
  if (ownerLive) return false; // the assigned agent is still working it
  return isActionable(bead, activeIds); // an open dep = waiting, not stranded
}

/** Actionable = every dependency has left the active store (closed). A dependency
 * still present is open (or in-flight) and genuinely blocks the bead. */
function isActionable(bead: Bead, activeIds: ReadonlySet<string>): boolean {
  const deps = bead.dependencies ?? [];
  return deps.every((d) => !activeIds.has(d.depends_on_id));
}
