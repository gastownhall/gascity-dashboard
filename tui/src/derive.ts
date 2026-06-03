// Pure view-derivation over the dashboard DTOs. No IO, no React — so it can be
// reasoned about and (later) unit-tested in isolation. shared/ owns the wire
// shapes; this module only projects them into what the operator scans.

import {
  effectiveContextPct,
  type GcSession,
  type GcBead,
  type GcMailItem,
  type DashboardSnapshot,
  type RunLane,
} from 'gas-city-dashboard-shared';

/**
 * Context usage as a percent of the model's TRUE window. gc reports
 * `context_pct` against a hardcoded 200k denominator, so 1M-window models
 * read a misleading saturated 100; this rescales (and matches the web UI).
 */
export function ctxPct(s: GcSession): number | undefined {
  return effectiveContextPct(s);
}

export type Category = 'failed' | 'active' | 'idle';

/**
 * Agent kind, derived from the wire data (the supervisor does not label kinds
 * directly — see classification rules in `agentKind`):
 * - `pool`: a multi-session worker (a "polecat"); the `pool` field is set, or
 *   the template names the polecat pool.
 * - `role`: a named, single-purpose agent (project-lead, reviewer, deacon, …).
 * - `orch`: city/orchestration layer (mayor, control-dispatcher) that directs
 *   the rest; rig-less, or a control-dispatcher.
 */
export type AgentKind = 'pool' | 'role' | 'orch';

export const AGENT_KINDS: readonly AgentKind[] = ['pool', 'role', 'orch'];

export interface AgentView {
  readonly session: GcSession;
  /** Rig basename, e.g. `gascity` from `/home/ds/gascity`. */
  readonly rig: string;
  /** Agent basename, e.g. `polecat-4` or `oversight-rig.project-lead`. */
  readonly agent: string;
  readonly category: Category;
  readonly kind: AgentKind;
}

export function basename(path: string | null | undefined): string {
  if (!path) return '';
  const trimmed = path.replace(/\/+$/, '');
  const seg = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return seg || trimmed;
}

export function categorize(s: GcSession): Category {
  if (s.state === 'failed') return 'failed';
  if (s.state === 'active' || s.state === 'creating') return 'active';
  return 'idle';
}

const CONTROL_DISPATCHER = 'control-dispatcher';

/**
 * Classifies an agent's kind from the wire fields. The supervisor does not
 * carry a pool/role label (its `agent_kind` is the unrelated agent/provider
 * axis), so we derive it: orchestration first (a control-dispatcher or a
 * rig-less agent like the mayor directs the rest, regardless of any pool
 * bucket), then a pool worker (a multi-session "polecat", identified by the
 * `pool` field or the polecat template), else a named role agent.
 */
export function agentKind(s: GcSession): AgentKind {
  const template = s.template ?? '';
  const isDispatcher =
    template === CONTROL_DISPATCHER || template.endsWith(`/${CONTROL_DISPATCHER}`) ||
    template.endsWith(`.${CONTROL_DISPATCHER}`);
  if (isDispatcher || rigLabel(s.rig) === ORCHESTRATION) return 'orch';
  if ((s.pool && s.pool.length > 0) || template === 'polecat' || template.endsWith('/polecat')) {
    return 'pool';
  }
  return 'role';
}

/** Leading sigil per kind. The glyph is the primary, greyscale-readable signal
 *  (DESIGN.md Greyscale Test) — not a color. */
export function kindGlyph(kind: AgentKind): string {
  switch (kind) {
    case 'pool':
      return '·';
    case 'role':
      return '◆';
    case 'orch':
      return '△';
  }
}

/** Short type word shown beside the agent, pairing with the glyph so the kind
 *  reads without color. */
export function kindLabel(kind: AgentKind): string {
  return kind;
}

// ── status filter (operator hides idle/active noise; failed never hides) ─────

export type StatusFilter = 'active+idle' | 'active' | 'idle';

export const STATUS_FILTERS: readonly StatusFilter[] = ['active+idle', 'active', 'idle'];

/** Whether a category is visible under the current filter. Failed always shows
 *  so a problem can never be filtered out of sight. */
export function matchesStatusFilter(category: Category, filter: StatusFilter): boolean {
  if (category === 'failed') return true;
  if (filter === 'active+idle') return true;
  return category === filter;
}

/** Cycles the filter: active+idle → active → idle → active+idle. */
export function nextStatusFilter(filter: StatusFilter): StatusFilter {
  const i = STATUS_FILTERS.indexOf(filter);
  return STATUS_FILTERS[(i + 1) % STATUS_FILTERS.length] ?? 'active+idle';
}

/** Label for the city-level (rig-less) agents: mayor, city control-dispatcher. */
export const ORCHESTRATION = 'orchestration';

/**
 * Canonical rig label. The supervisor reports a rig inconsistently — sometimes
 * a filesystem path (`/home/ds/projects/scix_experiments`), sometimes a name
 * (`scix-experiments`), with varying case — which split one project across two
 * groups. Normalise (basename · `_`→`-` · lowercase) so a project is one group.
 */
export function rigLabel(rig: string | null | undefined): string {
  const base = basename(rig);
  if (!base) return ORCHESTRATION;
  return base.replace(/_/g, '-').toLowerCase();
}

export function toAgentView(s: GcSession): AgentView {
  return {
    session: s,
    rig: rigLabel(s.rig),
    agent: basename(s.title ?? s.alias ?? s.id) || s.id,
    category: categorize(s),
    kind: agentKind(s),
  };
}

// ── rig grouping (top-level rigs; within rig: active before idle) ───────────

export interface RigGroup {
  readonly rig: string;
  readonly agents: readonly AgentView[];
  readonly failed: number;
  readonly active: number;
  readonly idle: number;
}

const CATEGORY_RANK: Record<Category, number> = { failed: 0, active: 1, idle: 2 };

/**
 * Groups agents by rig. Within a rig: failed → active → idle, each by recency.
 * Rigs ordered by (has-failed, active-count desc, name) so the rigs an operator
 * should look at sit at the top.
 */
export function groupByRig(sessions: readonly GcSession[]): RigGroup[] {
  const byRig = new Map<string, AgentView[]>();
  for (const s of sessions) {
    const view = toAgentView(s);
    const arr = byRig.get(view.rig) ?? [];
    arr.push(view);
    byRig.set(view.rig, arr);
  }

  const groups: RigGroup[] = [...byRig.entries()].map(([rig, list]) => {
    const agents = list.slice().sort((a, b) => {
      const rank = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
      if (rank !== 0) return rank;
      return Date.parse(b.session.last_active ?? '') - Date.parse(a.session.last_active ?? '');
    });
    return {
      rig,
      agents,
      failed: list.filter((v) => v.category === 'failed').length,
      active: list.filter((v) => v.category === 'active').length,
      idle: list.filter((v) => v.category === 'idle').length,
    };
  });

  return groups.sort((a, b) => {
    // Orchestration (mayor + city dispatcher) always leads — it directs the rest.
    if (a.rig === ORCHESTRATION) return -1;
    if (b.rig === ORCHESTRATION) return 1;
    const af = a.failed > 0 ? 1 : 0;
    const bf = b.failed > 0 ? 1 : 0;
    if (af !== bf) return bf - af;
    if (b.active !== a.active) return b.active - a.active;
    return a.rig.localeCompare(b.rig);
  });
}

export function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** "claude-opus-4-8" → "opus-4-8"; trims the vendor prefix for column width. */
export function shortModel(model: string | undefined): string {
  if (!model) return '';
  return model.replace(/^claude-/, '');
}

// ── peek commands (surfaced, not executed — read-only) ──────────────────────

export interface PeekCommands {
  readonly gcPeek: string;
  readonly tmuxAttach: string;
  readonly tmuxCapture: string;
}

export function peekCommands(s: GcSession): PeekCommands {
  return {
    gcPeek: `gc session peek ${s.id}`,
    tmuxAttach: `tmux attach -t ${s.session_name}`,
    tmuxCapture: `tmux capture-pane -t ${s.session_name} -p`,
  };
}

// ── bead ↔ rig association (best-effort: beads carry no session field) ───────

/** `agent-diagnostics-x0i` → `agent-diagnostics`. */
export function beadRigPrefix(beadId: string): string {
  return beadId.replace(/-[^-]+$/, '');
}

export function beadsForRig(beads: readonly GcBead[], rig: string): GcBead[] {
  if (!rig || rig === ORCHESTRATION) return [];
  return beads.filter((b) => {
    const prefix = beadRigPrefix(b.id);
    return prefix === rig || prefix.startsWith(rig) || rig.startsWith(prefix);
  });
}

// ── run lanes (formulas) ────────────────────────────────────────────────────

/** `scope.rootStoreRef` "rig:gascity" → "gascity". */
export function laneRig(lane: RunLane): string | null {
  if (lane.scope.status !== 'available') return null;
  const ref = lane.scope.rootStoreRef;
  if (typeof ref !== 'string') return null;
  return ref.startsWith('rig:') ? ref.slice('rig:'.length) : null;
}

export function laneNeedsOperator(lane: RunLane): boolean {
  return lane.health.status === 'available' && lane.health.data.needsOperator;
}

export function lanesForRig(lanes: readonly RunLane[], rig: string): RunLane[] {
  if (!rig || rig === ORCHESTRATION) return [];
  return lanes.filter((l) => {
    const lr = laneRig(l);
    return lr !== null && (lr === rig || lr.startsWith(rig) || rig.startsWith(lr));
  });
}

// ── beads grouping (by status, kanban-style) ────────────────────────────────

export interface BeadGroup {
  readonly status: string;
  readonly beads: readonly GcBead[];
}

const BEAD_STATUS_ORDER = ['open', 'in_progress', 'blocked', 'deferred', 'closed'];

function beadStatusRank(status: string): number {
  const i = BEAD_STATUS_ORDER.indexOf(status);
  return i < 0 ? BEAD_STATUS_ORDER.length : i;
}

/** Groups beads by status (open → in_progress → blocked → deferred → closed);
 *  within a status, higher priority (lower number) first, then newest. */
export function groupBeads(beads: readonly GcBead[]): BeadGroup[] {
  const byStatus = new Map<string, GcBead[]>();
  for (const b of beads) {
    const arr = byStatus.get(b.status) ?? [];
    arr.push(b);
    byStatus.set(b.status, arr);
  }
  return [...byStatus.entries()]
    .map(([status, list]) => ({
      status,
      beads: list.slice().sort((a, b) => {
        const pa = a.priority ?? 99;
        const pb = b.priority ?? 99;
        if (pa !== pb) return pa - pb;
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      }),
    }))
    .sort((a, b) => beadStatusRank(a.status) - beadStatusRank(b.status));
}

// ── run lanes grouping (by rig) ─────────────────────────────────────────────

export interface RunGroup {
  readonly rig: string;
  readonly lanes: readonly RunLane[];
}

/** Groups run lanes by rig; within a rig, needs-operator first, then by title. */
export function groupRuns(lanes: readonly RunLane[]): RunGroup[] {
  const byRig = new Map<string, RunLane[]>();
  for (const l of lanes) {
    const rig = laneRig(l) ?? ORCHESTRATION;
    const arr = byRig.get(rig) ?? [];
    arr.push(l);
    byRig.set(rig, arr);
  }
  return [...byRig.entries()]
    .map(([rig, list]) => ({
      rig,
      lanes: list.slice().sort((a, b) => {
        const na = laneNeedsOperator(a) ? 0 : 1;
        const nb = laneNeedsOperator(b) ? 0 : 1;
        if (na !== nb) return na - nb;
        return a.title.localeCompare(b.title);
      }),
    }))
    .sort((a, b) => a.rig.localeCompare(b.rig));
}

// ── city board (rig × in-flight phase count matrix) ──────────────────────────

/**
 * In-flight run phases shown as columns on the city board, in display order.
 * `complete` is deliberately excluded: historical complete lanes are capped in
 * the snapshot DTO (shared `RunsAggregate`), so a `done`/total column would show
 * a confident wrong number from data the TUI doesn't fetch. Every other RunPhase
 * is in-flight and maps to exactly one column, so a row's total is the sum of
 * its columns. See specs/architecture/tui-tmux-dashboard-gap-analysis.md (P1).
 */
export const CITY_BOARD_PHASES = [
  'intake',
  'implementation',
  'review',
  'approval',
  'finalization',
  'blocked',
  'active',
] as const;

export type CityBoardPhase = (typeof CITY_BOARD_PHASES)[number];

/**
 * Short, greyscale-readable column head per phase — the signal is the word, not
 * a hue (DESIGN.md Greyscale Test). Mirrors the operator's gc-console vocabulary
 * where it reads cleanly (intake→ready, approval→ok'd, finalization→PR).
 */
export const CITY_BOARD_PHASE_LABEL: Record<CityBoardPhase, string> = {
  intake: 'ready',
  implementation: 'impl',
  review: 'review',
  approval: "ok'd",
  finalization: 'PR',
  blocked: 'block',
  active: 'active',
};

export interface RigPhaseCounts {
  readonly rig: string;
  readonly counts: Record<CityBoardPhase, number>;
  /**
   * In-flight lanes in this rig flagged needs-operator — the board's single
   * red-mark source. It stands in for the gc console's "stalled" attention
   * column until a client-computed stalled tier (from `updatedAt` + session
   * activity) is added; `needsOperator` is the honest signal the TUI reads today.
   */
  readonly needsOperator: number;
  /** Total in-flight lanes counted for this rig (sum of the phase columns). */
  readonly total: number;
}

function emptyPhaseCounts(): Record<CityBoardPhase, number> {
  return Object.fromEntries(CITY_BOARD_PHASES.map((phase) => [phase, 0])) as Record<
    CityBoardPhase,
    number
  >;
}

/**
 * The city board: per-rig counts of in-flight run lanes by phase, plus a
 * separate needs-operator tally. Complete (historical) lanes are excluded.
 * City-scoped lanes bucket under {@link ORCHESTRATION}. Rows are ordered so the
 * operator's eye lands first on rigs needing attention: needs-operator rigs
 * lead, then by busiest (total desc), then name.
 */
export function cityBoard(lanes: readonly RunLane[]): RigPhaseCounts[] {
  const byRig = new Map<
    string,
    { counts: Record<CityBoardPhase, number>; needsOperator: number; total: number }
  >();
  for (const lane of lanes) {
    if (lane.phase === 'complete') continue;
    const phase: CityBoardPhase = lane.phase;
    const rig = laneRig(lane) ?? ORCHESTRATION;
    const entry = byRig.get(rig) ?? { counts: emptyPhaseCounts(), needsOperator: 0, total: 0 };
    entry.counts[phase] += 1;
    entry.total += 1;
    if (laneNeedsOperator(lane)) entry.needsOperator += 1;
    byRig.set(rig, entry);
  }
  return [...byRig.entries()]
    .map(([rig, v]) => ({ rig, counts: { ...v.counts }, needsOperator: v.needsOperator, total: v.total }))
    .sort((a, b) => {
      const aAttn = a.needsOperator > 0 ? 0 : 1;
      const bAttn = b.needsOperator > 0 ? 0 : 1;
      if (aAttn !== bAttn) return aAttn - bAttn;
      if (b.total !== a.total) return b.total - a.total;
      return a.rig.localeCompare(b.rig);
    });
}

// ── snapshot accessors (collapse the Avail/SourceState unions) ───────────────

export interface SystemHealth {
  readonly activeAgents: number | null;
  readonly activeSessions: number | null;
  readonly activeRuns: number | null;
  readonly maxAgents: number | null;
  readonly vcpu: number | null;
  readonly load1: number | null;
  readonly loadPerVcpu: number | null;
  readonly memUtil: number | null;
  readonly lanes: readonly RunLane[];
}

function metric(m: { status: string; value?: number } | undefined): number | null {
  return m && m.status === 'available' && typeof m.value === 'number' ? m.value : null;
}

export function systemHealth(snap: DashboardSnapshot | null): SystemHealth {
  if (!snap) {
    return {
      activeAgents: null,
      activeSessions: null,
      activeRuns: null,
      maxAgents: null,
      vcpu: null,
      load1: null,
      loadPerVcpu: null,
      memUtil: null,
      lanes: [],
    };
  }
  const res = snap.sources.resources;
  const runs = snap.sources.runs;
  // SourceState is unavailable only when status === 'error'; otherwise it
  // carries data (fresh/stale/fixture).
  const resData = res.status !== 'error' ? res.data : null;
  const lanes = runs.status !== 'error' ? runs.data.lanes : [];
  return {
    activeAgents: metric(snap.headline.activeAgents),
    activeSessions: metric(snap.headline.activeSessions),
    activeRuns: metric(snap.headline.activeRuns),
    maxAgents: metric(snap.headline.maxAgents),
    vcpu: resData?.vcpuCount ?? null,
    load1: resData?.loadAverage[0] ?? null,
    loadPerVcpu: resData?.loadPerVcpu ?? null,
    memUtil: resData?.memory.utilization ?? null,
    lanes,
  };
}

// ── idle / reallocation analysis (the operator's "why are these here?") ──────

export interface IdleRollup {
  readonly rig: string;
  readonly neverActive: number;
  readonly total: number;
}

/**
 * Per-rig count of sessions that have NEVER emitted activity (no last_active).
 * These are the pool/role agents an operator may want to reclaim for busier
 * rigs. Sorted by never-active count desc.
 */
export function neverActiveByRig(sessions: readonly GcSession[]): IdleRollup[] {
  const byRig = new Map<string, { never: number; total: number }>();
  for (const s of sessions) {
    const rig = rigLabel(s.rig);
    const entry = byRig.get(rig) ?? { never: 0, total: 0 };
    entry.total += 1;
    if (!s.last_active) entry.never += 1;
    byRig.set(rig, entry);
  }
  return [...byRig.entries()]
    .map(([rig, v]) => ({ rig, neverActive: v.never, total: v.total }))
    .filter((r) => r.neverActive > 0)
    .sort((a, b) => b.neverActive - a.neverActive);
}

export interface ContextPressureEntry {
  readonly session: GcSession;
  readonly pct: number;
}

/** Agents under context pressure (>= threshold% of TRUE window), worst first. */
export function contextPressure(
  sessions: readonly GcSession[],
  thresholdPct = 75,
): ContextPressureEntry[] {
  return sessions
    .map((s) => ({ session: s, pct: ctxPct(s) }))
    .filter((e): e is ContextPressureEntry => e.pct !== undefined && e.pct >= thresholdPct)
    .sort((a, b) => b.pct - a.pct);
}

// ── sessions live feed ("what each is doing", mechanical) ────────────────────

/** Currently-running sessions (active/creating), most-recently-active first.
 *  The flat "live now" feed behind the Sessions view. */
export function runningSessions(sessions: readonly GcSession[]): GcSession[] {
  return sessions
    .filter((s) => categorize(s) === 'active')
    .slice()
    .sort((a, b) => Date.parse(b.last_active ?? '') - Date.parse(a.last_active ?? ''));
}

/**
 * A readable, mechanical phrase for what a session is doing right now. This is
 * the honest non-LLM signal: the supervisor's coarse `activity` hint while
 * active, or the dormant transition reason. A model-written task summary is a
 * separate future layer — no per-session transcript is exposed as data today,
 * so we never fabricate one.
 */
export function activityPhrase(s: GcSession): string {
  if (categorize(s) !== 'active') {
    return s.attached ? 'attached' : (s.reason ?? s.state);
  }
  if (!s.activity) return 'active';
  switch (s.activity) {
    case 'tool_use':
      return 'running a tool';
    case 'thinking':
      return 'thinking';
    case 'idle':
      return 'active, between steps';
    default:
      return s.activity;
  }
}

// ── operator ledger (things waiting on the user) ─────────────────────────────

/** The operator's canonical mail triager. By Gas City convention the mayor
 *  digests the worker firehose and forwards only what needs the human. */
const MAYOR = 'mayor';

/**
 * Mail the operator should actually see: escalations from the orchestration
 * layer (the mayor), not the worker firehose. The wire's `read`/`priority`
 * flags are unusable as a "needs you" signal here — the supervisor never sets
 * priority and the operator never marks mail read (the mayor handles it) — so
 * we filter by SENDER ROLE instead: keep mail from an orchestration-kind agent
 * (resolved against the live session list) or the mayor, fold away pool-worker
 * chatter. Newest first.
 */
export function operatorMail(
  mail: readonly GcMailItem[],
  sessions: readonly GcSession[],
): GcMailItem[] {
  const orchSenders = new Set<string>([MAYOR]);
  for (const s of sessions) {
    if (agentKind(s) === 'orch') orchSenders.add(basename(s.title ?? s.alias ?? s.id) || s.id);
  }
  return mail
    .filter((m) => !m.read && orchSenders.has(basename(m.from)))
    .slice()
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

/** Count of unread mail folded away by {@link operatorMail} — the worker
 *  reports the mayor handles. Surfaced so the filter is never silent. */
export function foldedMailCount(
  mail: readonly GcMailItem[],
  shown: readonly GcMailItem[],
): number {
  const unread = mail.filter((m) => !m.read).length;
  return Math.max(0, unread - shown.length);
}

/** One-line snippet of a mail body: whitespace collapsed, hard-truncated with
 *  an ellipsis so a long body can't blow out the ledger row. */
export function mailSnippet(body: string, max = 120): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

// ── mayor-companion overview (truncated attention-first summary) ──────────────

/** Row caps for the fixed overview bands — a side panel summarises, it never
 *  dumps. ACTIVE is not capped: it is the scrollable region. */
export const OVERVIEW_WAITING_CAP = 4;
export const OVERVIEW_WIP_CAP = 4;

/** Display label for a rig: city-level (rig-less) agents read as the city name,
 *  not the internal `orchestration` grouping key. Display-only — the key that
 *  drives grouping/mail/board logic is unchanged. */
export function displayRig(rig: string, city: string): string {
  return rig === ORCHESTRATION ? city : rig;
}

/** All currently-active agents, orchestration first (the layer tracked from the
 *  mayor seat), then the recency order `runningSessions` already produced.
 *  Uncapped — the overview's ACTIVE band scrolls. */
export function orchFirstActive(sessions: readonly GcSession[]): AgentView[] {
  return runningSessions(sessions)
    .map(toAgentView)
    .sort((a, b) => (a.kind === 'orch' ? 0 : 1) - (b.kind === 'orch' ? 0 : 1));
}

/** The run lane an agent is working, matched via `RunLane.activeAssignees`
 *  (the wire's who-is-on-this-lane list). Best-effort by the agent's display
 *  name / alias / agent_name (assignees carry no session id). `undefined` when
 *  the agent isn't assigned to a lane — callers fall back to the activity hint,
 *  never a fabricated task. */
export function agentLane(view: AgentView, lanes: readonly RunLane[]): RunLane | undefined {
  const ids = new Set(
    [view.agent, view.session.alias, view.session.title]
      .filter((s): s is string => Boolean(s))
      .flatMap((s) => [s, basename(s)]),
  );
  return lanes.find((l) => l.activeAssignees.some((a) => ids.has(a) || ids.has(basename(a))));
}

/** One thing the operator is on the hook for: a run parked on them, or a piece
 *  of orchestration mail escalated to them. */
export type WaitingItem =
  | { readonly kind: 'run'; readonly lane: RunLane }
  | { readonly kind: 'mail'; readonly mail: GcMailItem };

/**
 * The truncated summary a mayor-seat operator scans: what needs them, what's
 * live, what's queued. A projection over the same DTOs the full views use, so
 * it can never disagree with a drill-in.
 */
export interface OverviewModel {
  /** Needs-operator runs first (they block a pipeline), then mayor mail. Capped. */
  readonly waiting: readonly WaitingItem[];
  /** Full waiting count before the cap, so a backlog is never silently hidden. */
  readonly waitingTotal: number;
  /** All live agents, orchestration first (the layer you track from the mayor
   *  seat), then the recency order. Uncapped — the ACTIVE band scrolls. */
  readonly active: readonly AgentView[];
  readonly activeCount: number;
  readonly agentTotal: number;
  readonly beadsOpen: number;
  readonly beadsInProgress: number;
  /** In-progress beads (the wip list), capped. */
  readonly wip: readonly GcBead[];
  readonly runsActive: number;
  readonly runsNeedsOp: number;
}

export function overviewModel(
  sessions: readonly GcSession[],
  beads: readonly GcBead[],
  mail: readonly GcMailItem[],
  lanes: readonly RunLane[],
): OverviewModel {
  const needsOp = lanes.filter(laneNeedsOperator);
  const escalations = operatorMail(mail, sessions);
  const waitingAll: WaitingItem[] = [
    ...needsOp.map((lane): WaitingItem => ({ kind: 'run', lane })),
    ...escalations.map((m): WaitingItem => ({ kind: 'mail', mail: m })),
  ];

  const active = orchFirstActive(sessions);
  const wipAll = beads.filter((b) => b.status === 'in_progress');

  return {
    waiting: waitingAll.slice(0, OVERVIEW_WAITING_CAP),
    waitingTotal: waitingAll.length,
    active,
    activeCount: active.length,
    agentTotal: sessions.length,
    beadsOpen: beads.filter((b) => b.status === 'open').length,
    beadsInProgress: wipAll.length,
    wip: wipAll.slice(0, OVERVIEW_WIP_CAP),
    runsActive: lanes.length,
    runsNeedsOp: needsOp.length,
  };
}
