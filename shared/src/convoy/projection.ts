import type { DashboardBead } from '../dashboard-beads.js';
import type { RunFormulaSource } from '../run-detail.js';
import { resolveRunFormulaIdentity } from '../runs/formula-name.js';

// Dashboard-owned projection of a convoy (an end-to-end unit of work keyed by a
// root bead) into the shape the /convoy/:rootBead route renders. It composes a
// supervisor bead graph (already narrowed to DashboardBead at the frontend
// edge) plus the optional convoy progress count — it does NOT mirror a
// supervisor wire shape, and stays pure so the route's branching (materialized
// steps vs the honest graph.v2 degradation) is unit-testable without the DOM.

const CLOSED_STATUS = 'closed';
const GRAPH_V2_CONTRACT = 'graph.v2';
const FORMULA_CONTRACT_KEY = 'gc.formula_contract';
const RUN_TARGET_KEY = 'gc.run_target';
const ROUTED_TO_KEY = 'gc.routed_to';

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
 *
 * The graph.v2 classification requires BOTH `gc.formula_contract=graph.v2` AND
 * a run-target key (`gc.run_target` OR the current `gc.routed_to`, which the
 * supervisor retired `gc.run_target` in favor of per gascity #2763) — the same
 * dual-key contract+target gate `rootRunTarget`/`resolveRunFormulaName` use
 * (formula-name.ts): only a fully-instantiated runnable root carries both.
 * A childless bead that has the contract label but no target (e.g. a stray
 * label on a non-run bead) is a genuine leaf, so it reports `no_children`
 * rather than the misleading "supervisor does not expose this run's step graph".
 *
 * Unlike the name fallback there, this gate intentionally does NOT also exclude
 * terminal-status roots: a completed graph.v2 run's steps are just as unexposed
 * as a running one's, so `graph_v2_root_only` stays the honest reason for it.
 * (The name fallback excludes terminal roots only to avoid trusting a retitled
 * closed root's title as a formula name — a different concern.)
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
  /**
   * Provenance of `formulaName`. Route-mode resolution only ever yields
   * `metadata` (explicit `gc.formula`) or `title_fallback` (graph.v2 gate) —
   * the `formula_detail` source is unreachable without a detail fetch — so the
   * type is the narrower `RunFormulaSource`, not the full identity source.
   */
  formulaNameProvenance: RunFormulaSource | null;
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
    // `formula_detail` is unreachable in route mode (see the field doc); the
    // guard narrows the type to `RunFormulaSource | null` without a cast.
    formulaNameProvenance: identity.source === 'formula_detail' ? null : identity.source,
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
    const isGraphV2Run =
      metaString(root, FORMULA_CONTRACT_KEY) === GRAPH_V2_CONTRACT &&
      (metaString(root, RUN_TARGET_KEY) !== undefined ||
        metaString(root, ROUTED_TO_KEY) !== undefined);
    return { kind: 'collapsed', reason: isGraphV2Run ? 'graph_v2_root_only' : 'no_children' };
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
