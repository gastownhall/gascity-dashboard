import type {
  WorkflowBeadResponse,
  WorkflowDepResponse,
} from './generated/gc-supervisor-client/index.js';

/**
 * Raw dependency edge from gc supervisor's run snapshot endpoint. Rides the
 * generated WorkflowDepResponse wire shape directly (AGENTS.md: do not
 * mirror supervisor wire shapes in shared).
 */
export type RunSnapshotDep = WorkflowDepResponse;

/**
 * Raw bead row inside a gc supervisor run snapshot. This is still
 * supervisor wire shape, not the dashboard's display node shape. Rides the
 * generated WorkflowBeadResponse wire shape directly (AGENTS.md: do not
 * mirror supervisor wire shapes in shared).
 */
export type RunSnapshotBead = WorkflowBeadResponse;

/**
 * Dashboard-normalized gc supervisor snapshot. The current supervisor wire
 * route is GET /v0/city/{name}/workflow/{workflow_id}; the dashboard client
 * translates `workflow_id` to `run_id` at the edge so the rest of the app uses
 * product language.
 */
export interface RunSnapshot {
  run_id: string;
  root_bead_id: string;
  root_store_ref: string;
  resolved_root_store: string;
  scope_kind: string;
  scope_ref: string;
  snapshot_version: number;
  snapshot_event_seq?: number | null;
  partial: boolean;
  stores_scanned: string[] | null;
  beads: RunSnapshotBead[] | null;
  deps: RunSnapshotDep[] | null;
  logical_nodes: Record<string, never>[] | null;
  logical_edges: RunSnapshotDep[] | null;
  scope_groups: Record<string, never>[] | null;
}

export interface FormulaPreviewNode {
  id: string;
  /** Required per OpenAPI FormulaPreviewNodeResponse. */
  title: string;
  /** Required per OpenAPI FormulaPreviewNodeResponse. */
  kind: string;
}

export interface FormulaPreviewEdge {
  from: string;
  to: string;
  kind?: string;
}

export interface FormulaDetail {
  name: string;
  preview?: {
    nodes?: FormulaPreviewNode[];
    edges?: FormulaPreviewEdge[];
  };
  steps?: FormulaPreviewNode[];
  deps?: FormulaPreviewEdge[];
}
