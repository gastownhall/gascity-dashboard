// gc-supervisor wire shapes that BackendModule descriptors are contractually
// allowed to consume via `CityContext.gc` (see `shared/src/views.ts`).
//
// 9yj.1.1: extracted from `shared/src/index.ts` to break a type-only cycle
// (`views.ts` imports from `index.ts`, `index.ts` re-exports `views.ts`).
// TypeScript and bundlers tolerate type-only cycles, but the architecture
// is fragile — every new export added to the barrel risks a new edge.
// This file holds the gc-client subset views.ts depends on; index.ts
// re-exports them so external consumers (`gas-city-dashboard-shared`) see
// no API change.
//
// This file MUST NOT import from `./index.js`. Doing so would re-introduce
// the cycle this file exists to prevent. Keep it as a leaf node in the
// module graph.

import type { GcCountedList } from './lists.js';

export type IsoTimestamp = string;
export type SessionId = string;

export type GcSessionState =
  | 'creating'
  | 'active'
  | 'asleep'
  | 'detached'
  | 'failed'
  | 'closed'
  | string;

export interface GcSession {
  id: SessionId;
  template: string;
  /** Supervisor's tmux/screen session name on disk. Required per OpenAPI
   *  SessionResponse; present in 73/73 live sessions. */
  session_name: string;
  /** Required per OpenAPI SessionResponse; present in 73/73 live sessions. */
  title: string;
  alias?: string;
  state: GcSessionState;
  /** Set when state transition has a structured reason (e.g. "city-stop"). */
  reason?: string;
  /** Human-readable display name from the provider (e.g. "Claude Code"). */
  display_name?: string;
  created_at: IsoTimestamp;
  /** Last time the session emitted activity; only set after first activity. */
  last_active?: IsoTimestamp;
  /** Whether a human is currently attached to the tmux session. */
  attached: boolean;
  rig?: string;
  pool?: string;
  agent_kind?: 'pool' | 'role' | string;
  /** Process-running state independent of session.state (which is gc-level).
   *  Required per OpenAPI SessionResponse; present in 73/73 live sessions. */
  running: boolean;
  model?: string;
  context_pct?: number;
  context_window?: number;
  /** Coarse activity hint: 'idle' | 'thinking' | 'tool_use' | ... */
  activity?: string;
  /** Session provider (e.g. 'codex', 'claude', 'gemini'). Required per
   *  OpenAPI SessionResponse; present in 73/73 live sessions. */
  provider: string;
}

export type GcSessionList = GcCountedList<GcSession>;

/**
 * Body for `POST /v0/city/{city}/sling` (gascity-dashboard-mq2). Mirrors
 * the supervisor's `SlingInputBody` schema. v1 text-only sling shape (`gc sling
 * <target> <text>` CLI passed positionally). The formula/scope fields are
 * part of the upstream schema but unused by v1 text-only slings — kept off
 * this type until the formula-driven follow-up (bead 6fp) needs them.
 */
export interface SlingInput {
  target: string;
  /** Free-text bead body. */
  bead?: string;
}

/**
 * Response from `POST /v0/city/{city}/sling`. `root_bead_id` is the routed
 * bead the dashboard records in slung-state (replaces the `^Slung <id>`
 * stdout parse). Other fields are surfaced by the supervisor but unused
 * here; typed optional so a schema addition upstream doesn't break parsing.
 */
export interface SlingResponse {
  root_bead_id?: string;
  bead?: string;
  /**
   * Renamed from the wire field `workflow_id` (#61 formula-run naming
   * alignment). The gc supervisor still emits `workflow_id` on the /sling
   * wire; the decoder (backend/src/gc-supervisor-decoders.ts) maps that wire
   * field onto this renamed property so parsing does not silently drop it.
   */
  run_id?: string;
  target?: string;
  status?: string;
}
