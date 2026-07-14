// Pose → posture. The attitude is how a pose shapes the body: pitch, belly-up
// flip, x-compression, fin fold, eye, mouth, tail beat, ambient sway/quiver.
// Posture carries state (greyscale-safe) so the seven poses read from silhouette
// alone. The sim owns a fish's HEIGHT in the tank; this owns its body attitude.
// Angles follow the SHARED POSE TABLE (specs/plans/reef-aquarium.md).

import type { AquariumPose } from '../contracts';

export type EyeStyle = 'open' | 'hollow' | 'closed' | 'cross';

export interface FishAttitude {
  /** radians; positive lifts the nose (y-down canvas: nose.y decreases) */
  pitch: number;
  /** errored: belly-up (dorsal offsets + eye + gradient all invert) */
  flipVertical: boolean;
  /** rate-limited: tucked x-compression */
  xScale: number;
  finsFolded: boolean;
  /** 0..1 swim-cycle amplitude multiplier — also the still-frame body bow */
  tailBeat: number;
  eye: EyeStyle;
  mouthOpen: boolean;
  /** asleep/tombstone: painter renders with fishDim */
  dimmed: boolean;
  /** painter clamp on heading-driven body rotation */
  maxHeadingTilt: number;
  /** radians of slow ambient body sway the painter applies over the clock */
  swayAmp: number;
  /** radians of fast fine tremor (stalled) — 0 disables; frozen under RM */
  quiver: number;
}

const DEG = Math.PI / 180;

const LEVEL: FishAttitude = {
  pitch: 0,
  flipVertical: false,
  xScale: 1,
  finsFolded: false,
  tailBeat: 1,
  eye: 'open',
  mouthOpen: false,
  dimmed: false,
  maxHeadingTilt: 28 * DEG,
  swayAmp: 0,
  quiver: 0,
};

const BY_POSE: Record<AquariumPose, FishAttitude> = {
  // level, strong tail beat, open bright eye, fins spread — visibly swimming
  working: LEVEL,
  // upright, slight nose-down, slow sway, hollow half-eye, relaxed fins
  idle: {
    ...LEVEL,
    pitch: -7 * DEG,
    tailBeat: 0.32,
    eye: 'hollow',
    maxHeadingTilt: 14 * DEG,
    swayAmp: 3.5 * DEG,
  },
  // level, still, fins folded flat, eye a closed arc, strongly dimmed
  asleep: {
    ...LEVEL,
    tailBeat: 0,
    finsFolded: true,
    eye: 'closed',
    dimmed: true,
    maxHeadingTilt: 4 * DEG,
  },
  // nose UP 30°, mouth open in an upward gape — unmistakable "feed me"
  'awaiting-input': {
    ...LEVEL,
    pitch: 30 * DEG,
    tailBeat: 0.5,
    mouthOpen: true,
    maxHeadingTilt: 6 * DEG,
    swayAmp: 2 * DEG,
  },
  // nose UP 42° (steeper than awaiting), hollow eye, fins folded, faint quiver
  stalled: {
    ...LEVEL,
    pitch: 42 * DEG,
    tailBeat: 0.34,
    eye: 'hollow',
    finsFolded: true,
    maxHeadingTilt: 5 * DEG,
    swayAmp: 1.5 * DEG,
    quiver: 1.6 * DEG,
  },
  // x-compressed 0.8, fins folded tight, hollow eye — hunched, held back, not
  // swimming; the short body is the unmistakable "rate-limited" read
  'rate-limited': {
    ...LEVEL,
    xScale: 0.8,
    finsFolded: true,
    tailBeat: 0.15,
    eye: 'hollow',
    maxHeadingTilt: 6 * DEG,
  },
  // fully belly-up: pale belly on top, dark back down, X-cross eye, limp fins
  errored: {
    ...LEVEL,
    flipVertical: true,
    tailBeat: 0.08,
    eye: 'cross',
    finsFolded: true,
    maxHeadingTilt: 8 * DEG,
    swayAmp: 2 * DEG,
  },
};

export function attitudeForPose(pose: AquariumPose): FishAttitude {
  return BY_POSE[pose];
}
