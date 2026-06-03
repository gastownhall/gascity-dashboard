import type { IsoTimestamp } from './gc-client-types.js';
import type { GcCountedList } from './lists.js';

export type BeadId = string;

export type BeadStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'closed'
  | 'deferred'
  | string;

export type BeadIssueType =
  | 'feature'
  | 'bug'
  | 'task'
  | 'docs'
  | 'session'
  | 'message'
  | 'convoy'
  | string;

/**
 * Dependency edge inside the OpenAPI `Bead.dependencies` list. Mirrors the
 * supervisor's `Dep` schema. Surfaced so formula-run graph collectors can read
 * dependencies without an `as any` cast.
 */
export interface GcBeadDep {
  depends_on_id: string;
  issue_id: string;
  type: string;
}

export interface GcBead {
  id: BeadId;
  title: string;
  status: BeadStatus;
  issue_type: BeadIssueType;
  /** Supervisor sends `priority: null` for non-engineering beads (messages,
   *  sessions, …) and the OpenAPI spec declares the field optional. Treat
   *  this as nullable on the wire; callers that need a sortable number must
   *  coalesce. */
  priority: number | null;
  description?: string;
  assignee?: string;
  created_at: IsoTimestamp;
  labels?: string[];
  /** OpenAPI Bead.metadata is declared as `{[key: string]: string}` — values
   *  are strings only. Callers needing typed numbers/booleans must parse
   *  explicitly. */
  metadata?: Record<string, string>;
  /** Supervisor-supplied reference handle. On formula templates this is
   *  the formula name (e.g. "mol-focus-review"). Absent on most beads. */
  ref?: string;
  /** Parent bead id (OpenAPI Bead.parent). */
  parent?: string;
  /** Originating actor / source id (OpenAPI Bead.from). */
  from?: string;
  /** True when the supervisor marks the bead as ephemeral. */
  ephemeral?: boolean;
  /** Bead ids this bead needs before it can run (OpenAPI Bead.needs). */
  needs?: string[] | null;
  /** Structured dependency rows (OpenAPI Bead.dependencies). */
  dependencies?: GcBeadDep[] | null;
  /** Last supervisor update time when exposed. Older generated fixtures only carry created_at. */
  updated_at?: IsoTimestamp;
}

export type GcBeadList = GcCountedList<GcBead>;
