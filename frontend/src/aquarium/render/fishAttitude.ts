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
  /**
   * phase-independent resting S-bow, fraction of length. Guarantees a readable
   * spine curve even at the swim-cycle instant where the traveling wave is flat
   * (round-2 blind-0/blind-1 read near-straight). 0 = a rigid straight body.
   */
  restBow: number;
  eye: EyeStyle;
  mouthOpen: boolean;
  /** asleep/tombstone: painter renders with fishDim */
  dimmed: boolean;
  /** rate-limited: painter renders with the darker/tense countershade */
  tense: boolean;
  /** how tightly folded fins clamp to the body (1 = spread, →0 = clamped) */
  finClamp: number;
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
  // a pronounced resting S even in a frozen frame — round-3's 0.05 read
  // "parked/straight" to every craft judge; this is the amplitude that makes
  // a still working fish unmistakably curved, not a stick
  restBow: 0.11,
  eye: 'open',
  mouthOpen: false,
  dimmed: false,
  tense: false,
  finClamp: 1,
  maxHeadingTilt: 28 * DEG,
  swayAmp: 0,
  quiver: 0,
};

const BY_POSE: Record<AquariumPose, FishAttitude> = {
  // level, strong tail beat, open bright eye, fins spread — visibly swimming
  working: LEVEL,
  // upright, slight nose-down, slow sway, hollow half-eye, relaxed fins;
  // a calm pose that still carries a visible resting S so it isn't a stick
  idle: {
    ...LEVEL,
    pitch: -7 * DEG,
    tailBeat: 0.32,
    restBow: 0.1,
    eye: 'hollow',
    maxHeadingTilt: 14 * DEG,
    swayAmp: 3.5 * DEG,
  },
  // level, still, fins folded flat, eye a closed arc, strongly dimmed —
  // a horizontal, becalmed sleeper (no resting bow: a relaxed straight body)
  asleep: {
    ...LEVEL,
    tailBeat: 0,
    restBow: 0,
    finsFolded: true,
    finClamp: 0.42,
    eye: 'closed',
    dimmed: true,
    maxHeadingTilt: 4 * DEG,
  },
  // nose UP 30°, mouth open in a big upward gape — unmistakable "feed me";
  // fins stay spread and the body keeps full width (never a needle)
  'awaiting-input': {
    ...LEVEL,
    pitch: 30 * DEG,
    tailBeat: 0.5,
    restBow: 0.05,
    mouthOpen: true,
    maxHeadingTilt: 6 * DEG,
    swayAmp: 2 * DEG,
  },
  // LEVEL and RIGID: dead-straight body (no swim bow, no tail beat), fins
  // folded, hollow awake eye, no motion. Reads "hung up, not swimming" — a
  // stiff level float, deliberately OFF awaiting-input's nose-up axis. The
  // rigidity (zero restBow) is the greyscale-safe cue that also separates it
  // from working/idle, which keep a swimming S-curve. The old nose-up "tremor"
  // pose collapsed onto awaiting-input once colour and motion were stripped
  // (the quiver is frozen under reduced-motion and invisible in a still frame),
  // failing the Greyscale Test; posture, not motion, carries the state.
  stalled: {
    ...LEVEL,
    pitch: 0,
    tailBeat: 0,
    restBow: 0,
    eye: 'hollow',
    finsFolded: true,
    finClamp: 0.55,
    maxHeadingTilt: 4 * DEG,
    swayAmp: 0,
    quiver: 0,
  },
  // hard x-compression 0.62, fins clamped tight, slight nose-down hunch, darker
  // tense body, awake hollow eye — a squeezed, held-back fish, NOT dimmed
  'rate-limited': {
    ...LEVEL,
    xScale: 0.62,
    pitch: -5 * DEG,
    finsFolded: true,
    finClamp: 0.22,
    tailBeat: 0.12,
    restBow: 0.02,
    eye: 'hollow',
    tense: true,
    maxHeadingTilt: 6 * DEG,
  },
  // fully belly-up + CAPSIZED: pale belly on top, dark back down, X-cross eye,
  // slack agape jaw, limp drooping fins, zero tail beat. A dead float reads
  // weakly when it's level and symmetric (a legibility judge missed it), so the
  // body also hangs head-low: with the vertical flip a positive pitch rotates
  // the nose DOWN, so the fish lists like a capsized carcass, not a level swimmer
  // — the tilt is the single loudest "this is upside-down and dead" silhouette
  // cue. Head-down (not up) keeps the dorsal fin + eye firmly on the down side,
  // so the belly-up geometry invariants hold.
  errored: {
    ...LEVEL,
    flipVertical: true,
    pitch: 20 * DEG,
    tailBeat: 0,
    restBow: 0.05,
    eye: 'cross',
    mouthOpen: true,
    finsFolded: true,
    finClamp: 0.36,
    maxHeadingTilt: 8 * DEG,
    swayAmp: 2.5 * DEG,
  },
};

export function attitudeForPose(pose: AquariumPose): FishAttitude {
  return BY_POSE[pose];
}
