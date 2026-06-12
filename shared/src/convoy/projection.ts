import type { DashboardBead } from '../dashboard-beads.js';
import {
  resolveRunFormulaIdentity,
  type ResolvedRunFormulaIdentity,
} from '../runs/formula-name.js';

// Dashboard-owned projection of a convoy (an end-to-end unit of work keyed by a
// root bead) into the shape the /convoy/:rootBead route renders. It composes a
// supervisor bead graph (already narrowed to DashboardBead at the frontend
// edge) plus the optional convoy progress count — it does NOT mirror a
// supervisor wire shape, and stays pure so the route's branching (materialized
// steps vs the honest graph.v2 degradation) is unit-testable without the DOM.

const CLOSED_STATUS = 'closed';
const GRAPH_V2_CONTRACT = 'graph.v2';

export interface ConvoyStep {
  bead: DashboardBead;
  /** In-graph needs that are not yet closed — the steps this one still waits on. */
  blockedBy: readonly string[];
  /** gc.step_ref when the bead is a materialized formula step, else null. */
  stepRef: string | null;
}

/**
 * Why the step DAG is not shown. `graph_v2_root_only` is the known upstream
 * hole (the supervisor collapses graph.v2 run snapshots to the root bead, so
 * step nodes are not reconstructable — tracked by gascity-dashboard-jl3c);
 * `no_children` is a genuine leaf with nothing below it.
 */
export type ConvoyCollapseReason = 'graph_v2_root_only' | 'no_children';

export type ConvoyStepExposure =
  | { kind: 'exposed'; steps: readonly ConvoyStep[] }
  | { kind: 'collapsed'; reason: ConvoyCollapseReason };

export interface ConvoyProgressCounts {
  closed: number;
  total: number;
}

export interface ConvoyView {
  rootBeadId: string;
  root: DashboardBead;
  /** Formula driving the convoy, when the root carries it. */
  formulaName: string | null;
  formulaNameProvenance: ResolvedRunFormulaIdentity['source'];
  /** Live worker session name while the root is in flight, else null. */
  sessionName: string | null;
  /** Step completion. Supervisor count when available, else derived from the graph. */
  progress: ConvoyProgressCounts | null;
  exposure: ConvoyStepExposure;
}

/**
 * Project a convoy root and its in-graph children into the route view model.
 *
 * `children` are the graph beads below the root (the root itself excluded by
 * the caller). `supervisorProgress` is the convoy endpoint's closed/total when
 * the read succeeded — it is preferred over the derived count because it still
 * reports a total when the step graph has collapsed.
 */
export function projectConvoyView(
  root: DashboardBead,
  children: readonly DashboardBead[],
  supervisorProgress: ConvoyProgressCounts | null,
): ConvoyView {
  const identity = resolveRunFormulaIdentity('route', { root });
  const exposure = computeExposure(root, children);
  const progress =
    supervisorProgress ?? (exposure.kind === 'exposed' ? deriveProgress(exposure.steps) : null);
  return {
    rootBeadId: root.id,
    root,
    formulaName: identity.name,
    formulaNameProvenance: identity.source,
    sessionName: metaString(root, 'gc.session_name') ?? null,
    progress,
    exposure,
  };
}

function computeExposure(
  root: DashboardBead,
  children: readonly DashboardBead[],
): ConvoyStepExposure {
  if (children.length === 0) {
    const reason: ConvoyCollapseReason =
      metaString(root, 'gc.formula_contract') === GRAPH_V2_CONTRACT
        ? 'graph_v2_root_only'
        : 'no_children';
    return { kind: 'collapsed', reason };
  }
  const statusById = new Map<string, string>([[root.id, root.status]]);
  for (const child of children) statusById.set(child.id, child.status);
  const steps = [...children].sort(compareSteps).map((child) => toStep(child, statusById));
  return { kind: 'exposed', steps };
}

function toStep(bead: DashboardBead, statusById: ReadonlyMap<string, string>): ConvoyStep {
  const blockedBy = (bead.needs ?? []).filter((id) => {
    const status = statusById.get(id);
    return status !== undefined && status !== CLOSED_STATUS;
  });
  return { bead, blockedBy, stepRef: metaString(bead, 'gc.step_ref') ?? null };
}

function deriveProgress(steps: readonly ConvoyStep[]): ConvoyProgressCounts {
  const closed = steps.filter((step) => step.bead.status === CLOSED_STATUS).length;
  return { closed, total: steps.length };
}

function compareSteps(a: DashboardBead, b: DashboardBead): number {
  const byCreated = a.created_at.localeCompare(b.created_at);
  return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
}

function metaString(bead: DashboardBead, key: string): string | undefined {
  const value = bead.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
