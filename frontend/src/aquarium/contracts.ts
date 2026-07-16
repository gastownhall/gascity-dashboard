// Pinned cross-module contracts for the /reef aquarium.
// derive/ sim/ camera/ render/ fixtures/ and the page shell all import from
// here and only from here for cross-module types. Spec: specs/plans/reef-aquarium.md.

import type { AgentNeedsYouReason } from 'gas-city-dashboard-shared';

// ---------------------------------------------------------------------------
// Poses & species

export type AquariumPose = AgentNeedsYouReason | 'working' | 'idle' | 'asleep';

export const ALL_POSES: readonly AquariumPose[] = [
  'working',
  'idle',
  'asleep',
  'awaiting-input',
  'stalled',
  'rate-limited',
  'errored',
] as const;

export type FishSpecies = 'pool' | 'role' | 'grouper';

// ---------------------------------------------------------------------------
// World geometry (world units; y grows downward)

export const WORLD = {
  width: 4000,
  height: 2250,
  /** dashed waterline; awaiting-input fish rise to just below it */
  waterlineY: 120,
  /** formations sit on the seabed band between seabedY and height */
  seabedY: 1900,
} as const;

export interface RigFormation {
  /** canonical rig name, or the reserved keys below */
  key: string;
  anchorX: number;
  /** formation base center on the seabed */
  anchorY: number;
  /** silhouette footprint radius; scales gently with crew size */
  radius: number;
  /** deterministic silhouette seed (hash of key) */
  seed: number;
  /** truthful open-bead total for the rig (may exceed rendered pellets) */
  openBeadTotal: number;
}

export const UNRIGGED_KEY = 'unrigged';
/** mayor + city-stratum agents swim open water; no formation is drawn */
export const CITY_KEY = 'city';

// ---------------------------------------------------------------------------
// Entities (derive/ produces these; sim/ owns kinematic fields)

export interface FishEntity {
  /** stable identity: session_name (or agent name for fallback fish) */
  id: string;
  /** display label (cleaned) */
  name: string;
  species: FishSpecies;
  isMayor: boolean;
  pose: AquariumPose;
  /** caption state word, e.g. "working", "awaiting input" */
  poseWord: string;
  /** effectiveContextPct: integer 0..100, undefined = indeterminate slim body */
  bellyPct: number | undefined;
  /** RigFormation.key | UNRIGGED_KEY | CITY_KEY */
  homeKey: string;
  /** current task bead (active_bead, else parseAssignee join), working fish only */
  taskBeadId?: string;
  /** app-relative link target, e.g. /agents/<name> */
  linkTo: string;
  /** ghost: missed the latest read but inside the reconciliation window */
  tombstoned: boolean;
}

export type PelletState = 'drifting' | 'held' | 'sunken' | 'eaten';

/** User-facing status word for a pellet's internal physics state — the hover
 * tooltip and click card show this, never the raw enum ('drifting' read as the
 * status of nearly every open bead). Maps the sim vocabulary to bead vocabulary. */
export const PELLET_STATE_WORD: Record<PelletState, string> = {
  drifting: 'open',
  held: 'in progress',
  sunken: 'blocked',
  eaten: 'closed',
};

export interface PelletEntity {
  beadId: string;
  /** short display id for LOD2 labels */
  label: string;
  /** the bead's human title, for the hover/click card (may be '' if unset) */
  title: string;
  /** route to open this bead's detail (the supervisor bead-detail modal),
   *  mirroring a fish's linkTo to its agent. */
  linkTo: string;
  /** bead ids this bead depends on (its `depends_on_id`s). Absent when it has
   *  none. Drawn as faint links only while this pellet is the selected one. */
  dependsOn?: readonly string[];
  /** parent epic id (`bead.parent`), for grouping same-epic beads on focus.
   *  Absent for a parentless bead (stays in the general drift). */
  epicId?: string;
  /** the parent epic's short title, for the focus-only epic label. Falls back to
   *  the epic id when the epic bead's title isn't in the open store. */
  epicTitle?: string;
  rigKey: string;
  state: PelletState;
  /** bead age, 0 (just created) .. 1 (stale). Drives an open bead's drift
   *  height: fresh food floats high, stale food sinks toward the seabed. */
  ageFraction: number;
  /** morsel size multiplier from bead priority (higher priority = bigger). */
  radiusScale: number;
  /** bead is P0 (priority <= 0): carries a specular glint at LOD1+ as redundant
   *  P0 emphasis on top of size. Absent/false for every other priority. */
  isP0?: boolean;
  /** newly-arrived open bead: falls in from the surface (feeding drop-in). */
  arriving?: boolean;
  /** fish holding it (state 'held') or that ate it (state 'eaten') */
  fishId?: string;
  /** ms remaining on the gulp animation (state 'eaten' only) */
  gulpMsLeft?: number;
}

export interface FlowObservation {
  observedForMs: number;
  windowMs: number;
  /** Rigs whose bounded bead read was complete in this snapshot. */
  observedRigCount: number;
  /** All rigs requested in this snapshot, including incomplete reads. */
  totalRigCount: number;
  backloggedRigCount: number;
  movingRigCount: number;
  /** At most two available, backlogged rigs with no observed transition. */
  stillRigKeys: readonly string[];
  p0Waiting: number;
  /** Available rigs with a pickup or completion observed in the last 15 minutes. */
  recentlyMovingRigKeys: readonly string[];
}

export const FLOW_OBSERVATION_WINDOW_MS = 60 * 60 * 1_000;
export const FLOW_STILL_MIN_OBSERVATION_MS = 5 * 60 * 1_000;
export const FLOW_RECENT_MOVEMENT_MS = 15 * 60 * 1_000;
export const EMPTY_FLOW_OBSERVATION: FlowObservation = Object.freeze({
  observedForMs: 0,
  windowMs: FLOW_OBSERVATION_WINDOW_MS,
  observedRigCount: 0,
  totalRigCount: 0,
  backloggedRigCount: 0,
  movingRigCount: 0,
  stillRigKeys: Object.freeze([]),
  p0Waiting: 0,
  recentlyMovingRigKeys: Object.freeze([]),
});

/** Snapshot truth: everything derive/ knows, before sim adds motion. */
export interface WorldSnapshot {
  formations: RigFormation[];
  fish: FishEntity[];
  pellets: PelletEntity[];
  /** count of distress fish (the overlay ledger line's number) */
  needsAttention: number;
  /** per-rig count of open beads sampled out beyond the rendered pellet cap —
   *  the truthful "how many more than shown" accounting. Not drawn as a floating
   *  marker (the formation label already carries the full openBeadTotal); kept
   *  for the cap-correctness tests and a future "N more" drill-in. */
  pelletOverflow: Record<string, number>;
  /** orphaned work whose assigned owner's session died — surfaced as the
   *  drillable "N stranded" shelf pill (grouped by rig, each linking to the
   *  bead). Empty when nothing is orphaned. */
  strandedWork: StrandedWorkItem[];
  /** Session-local flow evidence. This never claims history from a snapshot. */
  flow: FlowObservation;
}

/** A ledger-driven selection painted back into the tank. The discriminator is
 * also the greyscale-safe meaning of the dashed focus mark. */
export type ReefFocus =
  | { kind: 'bead'; beadId: string }
  | { kind: 'rig'; rigKey: string }
  | { kind: 'fish'; fishId: string };

/** One orphaned bead for the stranded shelf drill-in. */
export interface StrandedWorkItem {
  beadId: string;
  title: string;
  /** owning rig key, for grouping in the drill-in list */
  rigKey: string;
  /** route to the bead's detail (same target a pellet links to) */
  linkTo: string;
}

/** Ordinary drifting backlog budget per rig. Held, blocked, and P0 pellets are
 * always retained even when those high-signal entities exceed this budget. */
export const PELLET_RENDER_CAP_PER_RIG = 40;

// ---------------------------------------------------------------------------
// Simulation (pure; owns positions/kinematics keyed by entity id)

export interface FishKinematics {
  x: number;
  y: number;
  /** radians; 0 = +x */
  heading: number;
  /** world units / second */
  speed: number;
  /** stable per-fish phase for tail/fin cycles */
  phase: number;
}

export interface PelletKinematics {
  x: number;
  y: number;
  /** drift bob phase */
  phase: number;
}

export interface SimState {
  fish: Record<string, FishKinematics>;
  pellets: Record<string, PelletKinematics>;
  /** monotonically advanced by tick; drives cyclic motion */
  clockMs: number;
}

/**
 * Advance one frame. Pure: (snapshot, prev, dtMs) -> next.
 * Must be deterministic given (snapshot, prev, dtMs) — no Math.random,
 * no Date.now; per-entity variation comes from id-hash phases.
 * reducedMotion => returns a settled state (truthful resting positions,
 * zero autonomous velocity) in a single call.
 */
export type AdvanceSim = (
  snapshot: WorldSnapshot,
  prev: SimState,
  dtMs: number,
  reducedMotion: boolean,
) => SimState;

// ---------------------------------------------------------------------------
// Camera & LOD

export interface Camera {
  /** world coords at viewport center */
  x: number;
  y: number;
  /** css px per world unit */
  zoom: number;
}

export type LodTier = 0 | 1 | 2;

/** zoom at which the whole tank fits a 1440x900 viewport ≈ 0.36 */
export const LOD1_ZOOM = 0.9; // rig names + tags fade in
export const LOD2_ZOOM = 2.2; // full captions, pellet labels

export interface Viewport {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

// ---------------------------------------------------------------------------
// Rendering

/** Resolved color strings (canvas-ready, e.g. 'oklch(96% 0.012 75)') */
export interface ScenePalette {
  waterTop: string;
  waterBottom: string;
  hazeFar: string;
  lightShaft: string;
  formation: string;
  formationEdge: string;
  kelp: string;
  fishBody: string;
  fishOutline: string;
  fishDim: string; // asleep/tombstone
  pellet: string;
  text: string;
  textMuted: string;
  waterline: string;
  ok: string;
  warn: string;
  /** canvas font family; mirrors the app's single typeface */
  fontFamily: string;
}

export type ThemeMood = 'light' | 'dark';

/**
 * Paint one frame. Painters are stateless; all state arrives as args.
 * Text layers respect LOD fades derived from camera.zoom.
 */
export type PaintScene = (
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  camera: Camera,
  viewport: Viewport,
  palette: ScenePalette,
  opts: {
    reducedMotion: boolean;
    selectedBeadId?: string | null;
    focus?: ReefFocus | null;
  },
) => void;

// ---------------------------------------------------------------------------
// Fixtures & harness contract

export type FixtureKind = 'aquarium' | 'perf' | 'blind' | 'flow';

/** URL contract (dev-only): /reef?fixture=<kind>#cam=<x>,<y>,<zoom> */
export const FIXTURE_QUERY_PARAM = 'fixture';
export const CAMERA_HASH_PREFIX = '#cam=';

/** Ground truth the honesty auditor checks screenshots against. */
export interface FixtureManifest {
  kind: FixtureKind;
  rigs: Array<{ key: string; openBeadTotal: number }>;
  fish: Array<{
    name: string;
    poseWord: string;
    pose: AquariumPose;
    rigKey: string;
    bellyPct: number | undefined;
    taskBeadId?: string;
  }>;
  pelletBeadIds: string[];
  needsAttention: number;
  /** flow fixture only: rigs the derived snapshot must mark as recently moving. */
  recentlyMovingRigKeys?: string[];
  /** blind fixture only: camera per fish (same order as fish[]) for unlabeled crops */
  blindCams?: Array<{ x: number; y: number; zoom: number }>;
}

declare global {
  interface Window {
    /** set in fixture mode for the snapshot harness */
    __aquariumManifest?: FixtureManifest;
    /** set in fixture mode so the harness can verify derived flow evidence. */
    __aquariumFlow?: FlowObservation;
    /** set in fixture mode; per-frame RENDER WORK time (advanceSim + paintScene
     *  wall-clock ms) — the perf gate metric. NOT the rAF interval, which is
     *  vsync-locked to the display refresh and cannot go below ~16.67ms at
     *  60Hz regardless of render speed. */
    __aquariumFrameTimesMs?: number[];
    /** set in fixture mode; raw requestAnimationFrame deltas (frame pacing) for
     *  dropped-frame diagnosis. Vsync-floored, so not the render-cost gate. */
    __aquariumRafDeltasMs?: number[];
  }
}
