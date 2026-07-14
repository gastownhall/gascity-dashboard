// Behavior tuning constants. Every speed is world-units/second; every
// duration is milliseconds. Centralized so a single number change tunes one
// behavior everywhere it's used (no magic numbers scattered through the
// per-pose tick functions).

import { WORLD } from '../contracts';

/** How far a held pellet sits forward of its holder's mouth, along heading. */
export const MOUTH_OFFSET_WU = 46;

/** Per-frame dt is clamped to this ceiling — a tab-backgrounded rAF resuming
 * with a huge dt must never let a fish teleport across the tank. */
export const DT_CLAMP_MS = 50;

export const CRUISE_SPEED_MIN = 60;
export const CRUISE_SPEED_MAX = 90;
export const IDLE_SPEED_MIN = 20;
export const IDLE_SPEED_MAX = 30;
export const MAYOR_SPEED = 40;
export const ERRORED_RISE_SPEED = 12;
/** Brisk (not "slow" like errored) rise to the waterline for an
 * awaiting-input alert — an operator ask should read as urgent quickly. */
export const AWAITING_INPUT_RISE_SPEED = 70;

/** Max heading change per second — caps turn rate so fish steer, never flip. */
export const MAX_TURN_RATE_RAD_PER_S = Math.PI * 1.4;

// ---------------------------------------------------------------------------
// Working-shoal boids (flocking). Radii live here (not inline in fishTick)
// because the spatial grid in sim/grid.ts also needs them: its cell edge is
// the neighbour radius, so a 3x3 block around a fish's own cell is guaranteed
// to contain every point within one neighbour radius.

/** Cohesion + alignment gather radius (wide: gathers the shoal). */
export const SHOAL_NEIGHBOR_RADIUS_WU = 360;
/** Separation radius (tight: personal space, keeps fish off one point). */
export const SHOAL_SEPARATION_RADIUS_WU = 64;
/** Scales the inverse-square separation push into world units. */
export const SHOAL_SEPARATION_SCALE = 5200;
/** How far ahead the alignment steer projects along the shoal's mean heading. */
export const SHOAL_ALIGN_LOOKAHEAD_WU = 130;

// FIX 2 (round 3) — break the bar-chart read: a working shoal must not hover
// in a tight column directly over its own labelled mound. Widen each shoal's
// horizontal home spread so schools bleed across neighbouring formations and
// the open mid-water. A fish still pulls toward its own rig's x (truthful
// membership), just over a much wider band, and the position-keyed grid lets
// adjacent rigs' shoals mingle where their formations sit close.
/** Minimum half-width (world units) a working shoal spreads around its rig. */
export const SHOAL_MIN_HALF_SPREAD_WU = 460;
/** Shoal half-width also scales with formation size, whichever is larger. */
export const SHOAL_SPREAD_RADIUS_FACTOR = 1.4;

/** Small oscillation amplitude for "holding position" poses (stalled,
 * rate-limited, awaiting-input tread). */
export const BOB_AMPLITUDE_WU = 8;
export const BOB_PERIOD_MS = 2200;

// ---------------------------------------------------------------------------
// Water-column bands (absolute world y; y grows downward). Each calm/hold
// pose owns a distinct vertical stratum so posture AND height together make
// the pose unmistakable — the round-1 failure was every pose piling near the
// seabed and blurring together. Ordering top→bottom:
//   awaiting-input / errored  (surface band, touching the waterline)
//   stalled                   (upper-mid, clearly below the surface)
//   working shoal             (mid, the pellet band above every formation crest)
//   idle                      (mid-low, lower & looser than the working shoal)
//   rate-limited / asleep     (seabed: tucked under the overhang / on the base)
const COLUMN_SPAN = WORLD.seabedY - WORLD.waterlineY;

// FIX 3 (round 3) — awaiting-input ↔ stalled were muddled (both nose-up).
// Separate them by HEIGHT alone: awaiting-input rises to TOUCH the waterline
// band; stalled treads far below with a large open gap between them.
/** awaiting-input hugs the waterline (touching the band). */
export const BAND_AWAITING_Y = WORLD.waterlineY + 28;
/** errored holds just under awaiting-input so the two never coincide. */
export const BAND_ERRORED_Y = WORLD.waterlineY + 90;
/** stalled treads upper-mid — a big vertical gap below the surface band. */
export const BAND_STALLED_Y = WORLD.waterlineY + Math.round(COLUMN_SPAN * 0.3);
/** working shoals here — mid-water, above the tallest formation crest. */
export const BAND_WORKING_Y = WORLD.waterlineY + Math.round(COLUMN_SPAN * 0.45);
/** idle wanders here — below the working shoal, above the seabed. */
export const BAND_IDLE_Y = WORLD.waterlineY + Math.round(COLUMN_SPAN * 0.62);

// FIX 1 (round 4) — the mid-water read as a flat CROSS-SECTION line: one thin
// horizontal band of working fish. Each calm/hold band gets a vertical scatter
// half-extent so it reads as an occupied VOLUME, not a line. The working band
// is widened the most (its shoal is the mid-water's mass) but stays BOUNDED so
// it never crosses into the stalled stratum above or the idle stratum below —
// the blind-legibility 7/7 win depends on those strata staying disjoint.
/** stalled tread scatter (unchanged read — a tight upper-mid band). */
export const STALLED_BAND_HALF_HEIGHT_WU = 45;
/** working shoal scatter — wide, so the pellet band is a thick occupied volume.
 * Also each working fish homes to its own y within ±this (fishTick shoalHomeY),
 * so the thickness persists in live motion, not only at spawn. */
export const WORKING_BAND_HALF_HEIGHT_WU = 120;
/** idle wander scatter — mid-low, looser than the working shoal. */
export const IDLE_BAND_HALF_HEIGHT_WU = 80;

/** Guaranteed clear vertical gap between the working band's nearest extreme and
 * the adjacent pose band (stalled above, idle below). Derived from the band
 * centres and half-extents so it can never silently go negative: a future band
 * edit that squeezes the strata makes this drop and its guard test fail loudly,
 * catching any regression of the pose separation before it reaches a judge. */
export const WORKING_BAND_GUARD_WU = Math.min(
  BAND_WORKING_Y - WORKING_BAND_HALF_HEIGHT_WU - (BAND_STALLED_Y + STALLED_BAND_HALF_HEIGHT_WU),
  BAND_IDLE_Y - IDLE_BAND_HALF_HEIGHT_WU - (BAND_WORKING_Y + WORKING_BAND_HALF_HEIGHT_WU),
);

/** Soft-repel margin: a fish this close to the world edge is nudged back in,
 * on top of the hard clamp. */
export const WALL_MARGIN_WU = 60;
