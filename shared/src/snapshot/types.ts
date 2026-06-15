// Read-side telemetry envelope shared across the snapshot series
// (gascity-dashboard-37u).
//
// The SourceName union enumerates the sources this dashboard actually serves.
// Sources stay out of the runtime contract until they have real collectors and
// visible product surface.

import type { Avail } from '../lists.js';

export type SourceName = 'city' | 'resources' | 'runs' | 'work';

export type SourceStatus = 'fresh' | 'stale' | 'error' | 'fixture';

export type SourceError = { kind: 'none' } | { kind: 'message'; message: string };

export interface SourceAvailableState<T> {
  source: SourceName;
  status: Exclude<SourceStatus, 'error'>;
  fetchedAt: string;
  staleAt: string;
  error: SourceError;
  data: T;
}

export interface SourceUnavailableState {
  source: SourceName;
  status: 'error';
  error: string;
}

export type SourceState<T> = SourceAvailableState<T> | SourceUnavailableState;

export interface DashboardRuntimeConfig {
  cityName: string;
  cityRoot: string;
  useFixtures: boolean;
  /**
   * True when the backend runs with `DASHBOARD_READONLY=1` (AdminConfig
   * `readOnly`, gascity-dashboard-uzhr). The server-side proxy gate (z8n7)
   * already 405s supervisor mutations in this mode; the frontend projects
   * this so the SPA can DISABLE (not hide) its mutating controls with a
   * read-only affordance, rather than letting a click 405 into an
   * unhandled API error. Part of exposure-hardening epic
   * gascity-dashboard-lv4k.
   */
  readOnly: boolean;
  /**
   * Identity of the human operator this dashboard serves, projected from the
   * backend's env-driven config (gascity-dashboard-bhvn / zero-hardcoded-roles).
   * The dashboard is a SHARED tool — it must not bake our operator into source,
   * so the frontend reads these from `/config` rather than importing a literal.
   *
   * `operatorAlias` is the display/bead-assignee identity (env
   * `DASHBOARD_OPERATOR_ALIAS`). `operatorWireAlias` is the gc mail-wire
   * identity the supervisor addresses operator mail to/from (env
   * `DASHBOARD_OPERATOR_WIRE_ALIAS`, gc convention `human`). They differ
   * because gc mail is addressed to the wire alias, not the display name.
   */
  operatorAlias: string;
  operatorWireAlias: string;
  /**
   * The label marking a bead as awaiting the operator's decision — the
   * mayor-decision queue marker (specs/architecture/mayor-decision-ledger.md).
   * Projected from env `DASHBOARD_DECISION_LABEL`, defaulting to
   * `needs/<operatorAlias>` so a rename of the operator carries the label with
   * it. Read by the attention decision-queue fetch + the generic-bead skip.
   */
  decisionLabel: string;
  /**
   * Resolved `firstParty` module ids that are mounted (PRD §2 / bead 9yj.5).
   * The backend always emits an explicit array — `[]` for a core-only
   * default install (PR-D), or e.g. `['maintainer']` when opted in via
   * `MODULES_ENABLED`. `core` modules are ALWAYS mounted and never appear
   * in this list — operators cannot disable a core module.
   *
   * `null` remains in the type only for the frontend's pre-load state
   * (config not yet fetched), which the frontend treats as core-only.
   *
   * The frontend's view registry filters `ALL_VIEWS` by this set so a
   * backend-disabled module's route does not render a React Router 404; the
   * route + nav entry are simply absent. The backend's module iterator
   * applies the same filter to `ALL_MODULES` before `bind()`-ing.
   */
  enabledModules: string[] | null;
  /**
   * Operator override for the `/` route (PRD §6 / bead 9yj.5).
   * Set via the `DEFAULT_VIEW=<module-id>` env. `null` when unset. The
   * frontend's `resolveDefaultView()` honours this value when it points at
   * an ENABLED view; otherwise it falls back to the descriptor's
   * `defaultRoute: true` flag, then to the kb3 ambient home.
   *
   * Operator wins over descriptor by design — premortem #5's "default-view
   * shadowing" signal is emitted from the resolver on the frontend when the
   * env points at an unknown or disabled module.
   */
  defaultView: string | null;
  /**
   * Dashboard-local Maintainer configuration that the browser needs to prepare
   * generated supervisor sling requests. Present only when the Maintainer
   * first-party module is enabled.
   */
  maintainer?: DashboardMaintainerRuntimeConfig;
}

export interface DashboardMaintainerRuntimeConfig {
  slingTarget: string;
  triageTarget: string;
}

export type DashboardMetric =
  | {
      status: 'available';
      value: number;
    }
  | {
      status: 'unavailable';
      source: SourceName;
      error: string;
    };

// ── runs ─────────────────────────────────────────────────────────────

export interface RunSummary {
  /** Count of ACTIVE lanes (`phase` neither 'complete' nor 'blocked').
   *  gascity-dashboard-4xcv: blocked lanes are EXCLUDED — a stale blocked
   *  formula latch (gc-1920 repro) is not progressing and must not read as
   *  Active. Blocked lanes live in `blockedLanes` and still surface for
   *  operator attention; they are simply not part of the Active set or
   *  the headline `activeRuns` metric. */
  totalActive: number;
  runCounts: RunCounts;
  /** Active lanes, sorted by compareLanes (newest-first). The FULL active set —
   *  `totalActive === lanes.length`. The rendered collapsed window
   *  (MAX_VISIBLE_ACTIVE_LANES) and its "Show N more runs" expander are applied
   *  by the consumer (RunMap), mirroring RunHistory/MAX_HISTORICAL_LANES.
   *
   *  Header-first restructure: the summary deliberately carries NO historical
   *  (phase === 'complete') lanes. Surfacing them required the expensive
   *  closed-history fan-out (molecule all=true scan + per-rig all=true reads,
   *  measured 9.9s + 10.9s against second-scale budgets) on every refresh, for
   *  data hidden behind ?history=1 by default. Completed runs live in
   *  {@link RunHistory}, loaded lazily by the /runs history toggle. */
  lanes: RunLane[];
  /** Blocked (phase === 'blocked') lanes, sorted by compareLanes
   *  (gascity-dashboard-4xcv). Rendered as their own section so a blocked
   *  run stays visible for the operator without being misread as Active.
   *  `runCounts.blocked` counts this array. Deliberately uncapped: every
   *  blocked lane is an operator-attention item and must not be silently
   *  truncated the way the active 8-cap window trims calm lanes. */
  blockedLanes: RunLane[];
  /** Stranded (`registration === 'stranded'`) lanes, sorted by compareLanes
   *  (gascity-dashboard-pxvb). An orphaned molecule that never executed and
   *  never will — partitioned out of the Active set alongside `blockedLanes`
   *  so it stops reading as live work in `totalActive`/`census.totalInFlight`,
   *  but stays on the page (and in the attention surface) as the state most
   *  needing an operator action (clean up / re-dispatch). `runCounts.stranded`
   *  counts this array. Deliberately uncapped, mirroring `blockedLanes`: every
   *  stranded lane is an operator-attention item and must not be truncated by
   *  the active 8-cap window.
   *
   *  Visibility precedence vs the 24h stale latch (isStaleSessionlessLatch): a
   *  stranded lane is sessionless with no in_progress step, so once its last
   *  write ages past STALE_LATCH_AFTER_MS the latch demotes it out of this set
   *  exactly like any other abandoned lane — a day-old orphan leaves the board
   *  rather than accumulating forever (see isStrandedRun in runs/liveness.ts).
   *  That demotion happens at enrichment (frontend), where session facts and
   *  the snapshot generation time are available. */
  strandedLanes: RunLane[];
  recentChanges: RunChange[];
  /**
   * City-level health census (gascity-dashboard-3ax). Threshold-INDEPENDENT
   * counts only — derived once in the backend snapshot read path. The
   * time-derived `byStalenessTier` / "failing" counts are deliberately NOT
   * here: per R9 the staleness threshold crossing is owned by the frontend's
   * 1s selector (kb3), so a server-frozen tier census would under-count for
   * up to the cache TTL on a pure-time stall crossing.
   */
  census: RunCensusState;
  /**
   * True when one or more per-rig recent-run queries failed during the
   * fan-out and were skipped, so the lane set may be incomplete
   * (gascity-dashboard-n6f1). A single rig's listBeads rejecting degrades
   * the snapshot rather than collapsing it to status=error; this flag lets
   * the operator see "runs degraded" instead of an apparent full set.
   *
   * Optional literal `true` per the rigsPartial / agentsPartial convention
   * (gascity-dashboard-19w.1.1): the collector only ever assigns `true`
   * (else leaves the field absent), so consumers must check
   * truthiness/presence, never `=== false`.
   */
  lanesPartial?: true;
}

/**
 * Completed (phase === 'complete') run lanes, the lazy /runs history payload
 * (header-first restructure). Deriving these requires the expensive closed-
 * history fan-out (molecule all=true scan + per-rig all=true task reads), so
 * the data is fetched on demand when the operator opens the history section,
 * never on the default run-summary refresh path.
 */
export interface RunHistory {
  /** TRUE count of completed lanes. gascity-dashboard-9w3k: may EXCEED
   *  `lanes.length` when the MAX_HISTORICAL_LANES cap applies, so the operator
   *  sees the real number behind the recency window. */
  totalHistorical: number;
  /** Completed lanes, sorted by compareLanes (newest-first), capped at
   *  MAX_HISTORICAL_LANES. When the cap trims older lanes, totalHistorical
   *  still reports the true count. */
  lanes: RunLane[];
  /**
   * True when one or more closed-history reads failed or truncated during the
   * fan-out, so the completed set may be incomplete. Optional literal `true`
   * per the lanesPartial / rigsPartial convention (gascity-dashboard-19w.1.1):
   * consumers check truthiness/presence, never `=== false`.
   */
  lanesPartial?: true;
}

export type RunCensusState = Avail<{
  data: RunCensus;
}>;

/**
 * Threshold-independent city census (gascity-dashboard-3ax, PRD §4 / R5).
 * Every field here is derivable from a single snapshot with no wall-clock
 * threshold, so freezing it inside the 60s cache TTL is safe. The frontend
 * adds the time-derived "failing / stalled" count on its 1s clock.
 */
export interface RunCensus {
  /** Lane count per phase across the snapshot. Includes the `blocked` phase;
   *  `complete` lanes are tallied here but excluded from `totalInFlight`. */
  byPhase: Record<RunPhase, number>;
  /** Total non-complete lanes (the census denominator base). Includes blocked
   *  lanes — they are non-progressing but still in flight for census purposes. */
  totalInFlight: number;
  /**
   * In-flight lanes the engine cannot classify with confidence
   * (phaseConfidence === 'inferred'). R5: drives "1 unverifiable" and must
   * never be folded into a calm count. Excluded from `knownDenominator`.
   */
  unverifiable: number;
  /**
   * In-flight lanes with phaseConfidence === 'known'. R5: the honest
   * denominator behind "nothing failing (of N known)".
   */
  knownDenominator: number;
  /**
   * In-flight lanes where progress-monotonicity tripped (R1 thrashing).
   * Cross-cycle, server-only — the one "failing"-class signal the client
   * cannot recompute, so it is shipped as a count here. Time-derived stalls
   * are added client-side.
   */
  thrashing: number;
}

export type RunPhaseConfidence = 'known' | 'inferred';

/**
 * Per-lane health derived by the backend engine (gascity-dashboard-3ax).
 * R9-strict contract: this carries FACTS and the one server-only signal
 * (`thrashingDetected`), never a frozen staleness-tier enum. The frontend
 * computes the staleness tier + age from `RunLane.updatedAt` (=
 * max bead updated_at) and the resolved session's `lastActive` fact on its
 * 1s clock.
 *
 * Every lane carries an explicit health state. The lane builder emits an
 * unavailable pre-engine state; the snapshot read path replaces it with these
 * available health facts.
 */
export interface RunLaneHealth {
  /**
   * 'known' iff a formula matched AND the active gc.step_id resolved into a
   * known stage; else 'inferred' (generic fallback / the includes('blocked')
   * sniff). A structural fact about which code path fired (ZFC-clean). An
   * 'inferred' lane must never drive the maroon One Mark (R2/R5).
   */
  phaseConfidence: RunPhaseConfidence;
  /**
   * Decision-pending from bead state alone (human-approval gate or blocked).
   * Threshold-independent. The stalled-driven attention signal is added
   * client-side from the staleness tier.
   */
  needsOperator: boolean;
  /**
   * The semantic node id (raw gc.step_id) the lane is parked on, for the
   * `?node=:stuckNodeId` deep link (PRD §5). Unavailable when no active step
   * resolved.
   */
  stuckNode: RunLaneStuckNode;
  /**
   * R1 progress-monotonicity: attempt-of-active-step climbed while the
   * lane's graph position (active stage) stayed flat across cache
   * generations. Freshness-independent — the only stall signal robust to a
   * thrashing retry/poll loop. Cross-cycle; cannot be client-derived.
   *
   * WARNING (R2 footgun): this is the RAW structural fact and can be `true`
   * even when `phaseConfidence === 'inferred'`. An inferred lane must NEVER
   * drive the maroon One Mark, so a consumer using this to paint a visual
   * alarm MUST gate on `phaseConfidence === 'known'` first. The server-side
   * census already does this (its `thrashing` count excludes inferred lanes).
   */
  thrashingDetected: boolean;
  /** Resolved session facts. Unresolved and missing upstream fields are explicit states. */
  session: RunLaneSessionState;
}

export type RunLaneHealthState = Avail<{
  data: RunLaneHealth;
}>;

export interface RunCounts {
  total: number;
  /** @deprecated use total — RunMap owns the rendered collapse; always equals total.
   *
   *  Count of active lanes carried on the wire. Now equal to `total` (the full
   *  active set), since RunMap owns the rendered collapse rather than the wire
   *  pre-capping at MAX_VISIBLE_ACTIVE_LANES. */
  visible: number;
  prReview: number;
  designReview: number;
  bugfix: number;
  /** Count of blocked lanes (`phase === 'blocked'`, i.e. `blockedLanes.length`).
   *  gascity-dashboard-4xcv: disjoint from `total`, which counts only the
   *  Active set. A lane with a blocked member always classifies as
   *  phase 'blocked' (mapRunPhase checks members first), so this is the
   *  complete blocked count, not a subset. */
  blocked: number;
  /** Count of stranded lanes (`registration === 'stranded'`, i.e.
   *  `strandedLanes.length`). gascity-dashboard-pxvb: disjoint from `total`
   *  and `blocked` — a stranded run (orphaned molecule that never executed) is
   *  partitioned out of the Active set alongside blocked, so it is never
   *  double-counted as live work. */
  stranded: number;
  other: number;
}

export interface RunLane {
  id: string;
  title: string;
  formula: RunLaneFormula;
  scope: RunLaneScope;
  external: RunLaneExternalReference;
  phase: RunPhase;
  phaseLabel: string;
  statusCounts: Record<string, number>;
  activeAssignees: string[];
  updatedAt: RunLaneUpdatedAt;
  stages: RunStage[];
  progress: RunLaneProgress;
  /**
   * Provenance fact (gascity-dashboard-3ax): the lane's stages came from a
   * RECOGNISED formula AND the active gc.step_id mapped into one of those
   * formula stages — i.e. not the generic 5-stage fallback or the
   * includes('blocked') sniff. The engine ANDs this with session-resolution
   * to set phaseConfidence (PRD §6 / R2). Bead-side only; the builder owns it.
   */
  formulaStageResolved: boolean;
  /**
   * Engine-derived health (gascity-dashboard-3ax). The lane builder emits
   * an explicit unavailable pre-engine state; the snapshot read path replaces
   * it with available health facts.
   */
  health: RunLaneHealthState;
  /**
   * Supervisor-registry fact (gascity-dashboard-uxvk). Lanes are built from
   * rig-store molecule root beads, so a molecule orphaned by a supervisor crash
   * at dispatch time (bead graph persisted, workflow registry has no entry,
   * zero step progress) is otherwise indistinguishable from a live run.
   * 'stranded' is only asserted from a COMPLETE formula-feed observation plus
   * the dispatch grace (see isStrandedRun); anything weaker stays 'unknown' so
   * a feed outage can never strand every lane.
   */
  registration: RunLaneRegistration;
}

/**
 * 'unknown' covers both "no complete feed observation yet" and "absent from
 * the feed but not conclusively stranded" (inside the dispatch grace, or
 * showing step progress so it merely aged out of the feed window) — neither
 * is evidence either way, so consumers must never read 'unknown' as
 * registered.
 */
export type RunLaneRegistration = 'registered' | 'stranded' | 'unknown';

export type RunLaneUpdatedAt = Avail<{
  at: string;
}>;

export type RunLaneProgress =
  | {
      status: 'active_step';
      /** Raw gc.step_id of the active primary step. */
      stepId: string;
      stage: RunLaneStagePosition;
      attempt: RunLaneStepAttempt;
    }
  | {
      status: 'stage_only';
      stage: RunLaneStagePosition;
      error: string;
    }
  | {
      status: 'unavailable';
      error: string;
    };

export type RunLaneStagePosition = Avail<{
  index: number;
  key: string;
  label: string;
}>;

export type RunLaneStepAttempt = Avail<{
  value: number;
}>;

export type RunLaneStuckNode = Avail<{
  id: string;
}>;

export type RunLaneSessionState =
  | {
      status: 'resolved';
      lastActive: RunLaneSessionLastActive;
      running: RunLaneSessionRunning;
      activity: RunLaneSessionActivity;
    }
  | {
      status: 'unresolved';
      error: string;
    };

export type RunLaneSessionLastActive = Avail<{
  at: string;
}>;

export type RunLaneSessionRunning = Avail<{
  value: boolean;
}>;

export type RunLaneSessionActivity = Avail<{
  value: string;
}>;

export type RunLaneFormula =
  | {
      status: 'known';
      name: string;
    }
  | {
      status: 'unavailable';
      error: string;
    };

export type RunLaneExternalReference =
  | {
      status: 'available';
      label: string;
      url: string;
    }
  | {
      status: 'label_only';
      label: string;
    }
  | {
      status: 'unavailable';
      error: string;
    };

export type RunLaneScope = Avail<{
  kind: 'city' | 'rig';
  ref: string;
  rootStoreRef: string;
}>;

export type RunPhase =
  | 'intake'
  | 'implementation'
  | 'review'
  | 'approval'
  | 'finalization'
  | 'blocked'
  | 'complete'
  | 'active';

export interface RunStage {
  key: string;
  label: string;
  status: 'pending' | 'active' | 'complete' | 'blocked';
}

export interface RunChange {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}
