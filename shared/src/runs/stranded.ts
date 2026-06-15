import type { RunLane, RunLaneScope } from '../snapshot/types.js';

// gascity-dashboard-pxvb: the stranded-runs selector, the analogue of
// selectBlockedRuns (runs/blocked.ts). The Runs nav badge and the /runs page
// both read this one projection of `summary.strandedLanes`, so the badge count
// and the page's Stranded count read the same selector and cannot disagree.
// Its input is buildRunSummary's `strandedLanes` — already dangling-root
// suppressed, run-marker gated (isRunGroup), and asserted stranded only from a
// COMPLETE formula-feed observation plus the dispatch grace (isStrandedRun), so
// a feed outage never strands a lane and this selector only ever sees a
// conclusively orphaned run.

export interface StrandedRun {
  id: string;
  title: string;
  /** Why the run is stranded — a structural, glyph+word-friendly phrase. */
  reason: string;
  /** The operator's next step to resolve the orphan. */
  remedy: string;
  scope: RunLaneScope;
}

/** Project the stranded lanes into operator-actionable rows. */
export function selectStrandedRuns(strandedLanes: readonly RunLane[]): StrandedRun[] {
  return strandedLanes
    .filter((lane) => lane.registration === 'stranded')
    .map((lane) => ({
      id: lane.id,
      title: lane.title,
      reason: strandedRunReason(),
      remedy: strandedRunRemedy(),
      scope: lane.scope,
    }));
}

/** Structural why-stranded phrase. A stranded run has no live stage to read, so
 *  the reason is the orphan fact itself, not a stage label (ZFC). */
export function strandedRunReason(): string {
  return 'Never registered with the supervisor; this run never executed.';
}

/** The single next step the operator takes to resolve the orphan. */
export function strandedRunRemedy(): string {
  return 'Clean up the orphaned run or re-dispatch it.';
}
