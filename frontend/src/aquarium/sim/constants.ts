// Behavior tuning constants. Every speed is world-units/second; every
// duration is milliseconds. Centralized so a single number change tunes one
// behavior everywhere it's used (no magic numbers scattered through the
// per-pose tick functions).

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
export const TREAD_BOB_SPEED_WU = 6;

/** Max heading change per second — caps turn rate so fish steer, never flip. */
export const MAX_TURN_RATE_RAD_PER_S = Math.PI * 1.4;

/** Small oscillation amplitude for "holding position" poses (stalled,
 * rate-limited, awaiting-input tread). */
export const BOB_AMPLITUDE_WU = 8;
export const BOB_PERIOD_MS = 2200;

export const WATERLINE_BAND_AWAITING_WU = 60;
export const WATERLINE_BAND_ERRORED_WU = 90;

/** Soft-repel margins: a fish this close to the waterline (except
 * awaiting-input/errored, which are licensed into the band) or the world
 * edge is nudged back in, on top of the hard clamp. */
export const WALL_MARGIN_WU = 60;
export const WATERLINE_SOFT_MARGIN_WU = 30;
