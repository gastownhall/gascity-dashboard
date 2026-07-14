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

/** awaiting-input rises to touch the waterline band. */
export const BAND_AWAITING_Y = WORLD.waterlineY + 60;
/** errored holds just under awaiting-input so the two never coincide. */
export const BAND_ERRORED_Y = WORLD.waterlineY + 110;
/** stalled treads here — elevated, but well below the surface. */
export const BAND_STALLED_Y = WORLD.waterlineY + Math.round(COLUMN_SPAN * 0.28);
/** working shoals here — mid-water, above the tallest formation crest. */
export const BAND_WORKING_Y = WORLD.waterlineY + Math.round(COLUMN_SPAN * 0.45);
/** idle wanders here — below the working shoal, above the seabed. */
export const BAND_IDLE_Y = WORLD.waterlineY + Math.round(COLUMN_SPAN * 0.62);

/** Soft-repel margin: a fish this close to the world edge is nudged back in,
 * on top of the hard clamp. */
export const WALL_MARGIN_WU = 60;
