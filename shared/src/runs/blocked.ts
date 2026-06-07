import type { RunLane, RunLaneScope } from '../snapshot/types.js';

// gascity-dashboard-2j8e.2: the genuinely-blocked-runs selector. The Runs nav
// badge and the /runs page both read this one projection, so the badge count
// and the page count read the same selector and cannot disagree. Its input is
// buildRunSummary's `blockedLanes` — already dangling-root + non-graph.v2
// suppressed (the gc-1920-class phantom: codeprobe upstream_error, no backing
// bead, never a graph.v2 run) — so phantom suppression is upstream, not a dead
// per-lane guard here. A supervisor `partial` read is never counted: this
// selector only ever sees real blocked beads.

export interface BlockedRun {
  id: string;
  title: string;
  /** Why the run is blocked — a structural, glyph+word-friendly phrase. */
  reason: string;
  /** The operator's next step to clear the block. */
  remedy: string;
  scope: RunLaneScope;
}

/** Project the genuinely-blocked lanes into operator-actionable rows. */
export function selectBlockedRuns(blockedLanes: readonly RunLane[]): BlockedRun[] {
  return blockedLanes
    .filter((lane) => lane.phase === 'blocked')
    .map((lane) => ({
      id: lane.id,
      title: lane.title,
      reason: blockedRunReason(lane),
      remedy: blockedRunRemedy(lane),
      scope: lane.scope,
    }));
}

/** Structural why-blocked phrase derived from the lane's own facts (ZFC). */
export function blockedRunReason(lane: RunLane): string {
  const stageLabel = blockedStageLabel(lane);
  if (stageLabel !== null) return `Blocked at ${stageLabel}`;
  const blockedSteps = lane.statusCounts['blocked'] ?? 0;
  if (blockedSteps > 0) {
    return `${blockedSteps} blocked step${blockedSteps === 1 ? '' : 's'}`;
  }
  return 'Blocked, awaiting operator';
}

/** The single next step the operator takes to clear the block. */
export function blockedRunRemedy(lane: RunLane): string {
  if (lane.activeAssignees.length === 0) {
    return 'No worker assigned. Claim or dispatch one.';
  }
  return 'Open run detail to review the blocked step.';
}

function blockedStageLabel(lane: RunLane): string | null {
  if (lane.progress.status === 'active_step' || lane.progress.status === 'stage_only') {
    const stage = lane.progress.stage;
    if (stage.status === 'available') return stage.label;
  }
  return null;
}
