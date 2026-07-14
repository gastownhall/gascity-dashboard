// Per-pose rest/settle positions relative to a fish's home anchor. Used both
// as the exact frame in reduced-motion mode and as the steering target for
// "hold position" poses (asleep/awaiting-input/stalled/rate-limited/
// errored) in normal motion. Deterministic: seeded only by a per-fish hash,
// never Math.random.
//
// Vertical placement is the round-2 legibility fix: each pose settles in its
// own water-column band (see sim/constants BAND_*), so posture and height
// together read the pose. Horizontal placement stays tethered to the home
// formation x, so a rig is always a place you can find on the reef.

import { WORLD, type AquariumPose } from '../contracts';
import { hashRange, hashUnit } from '../derive/hash';
import {
  BAND_AWAITING_Y,
  BAND_ERRORED_Y,
  BAND_IDLE_Y,
  BAND_STALLED_Y,
  BAND_WORKING_Y,
  IDLE_BAND_HALF_HEIGHT_WU,
  STALLED_BAND_HALF_HEIGHT_WU,
  WORKING_BAND_HALF_HEIGHT_WU,
} from './constants';

export interface HomeAnchor {
  x: number;
  y: number;
  /** formation footprint radius, or a default "open water" radius for
   * CITY_KEY fish (mayor / city-stratum) which have no formation. */
  radius: number;
}

/** A pose-specific salt keeps two poses from resolving to the exact same
 * scatter point for the same fish id (e.g. asleep vs rate-limited). */
const POSE_SALT: Readonly<Record<AquariumPose, number>> = {
  working: 0x1,
  idle: 0x2,
  asleep: 0x3,
  'awaiting-input': 0x4,
  stalled: 0x5,
  'rate-limited': 0x6,
  errored: 0x7,
};

export function restPosition(
  pose: AquariumPose,
  anchor: HomeAnchor,
  seed: number,
): { x: number; y: number } {
  const s = seed ^ (POSE_SALT[pose] * 0x9e3779b1);
  switch (pose) {
    case 'working':
      // Mid-water shoal in the pellet band, spread across the formation width
      // and thickened VERTICALLY (round 4) so it reads as a volume, not a line.
      return bandScatter(anchor, s, BAND_WORKING_Y, anchor.radius, WORKING_BAND_HALF_HEIGHT_WU);
    case 'idle':
      // Lower and looser than the working shoal, still mid-water.
      return bandScatter(anchor, s, BAND_IDLE_Y, anchor.radius * 0.85, IDLE_BAND_HALF_HEIGHT_WU);
    case 'stalled':
      // Upper-mid, treading; tighter horizontal spread than the shoal.
      return bandScatter(
        anchor,
        s,
        BAND_STALLED_Y,
        anchor.radius * 0.55,
        STALLED_BAND_HALF_HEIGHT_WU,
      );
    case 'asleep':
      return settledOnSeabed(anchor, s);
    case 'awaiting-input':
      return surfaceBand(anchor, s, BAND_AWAITING_Y);
    case 'errored':
      return surfaceBand(anchor, s, BAND_ERRORED_Y);
    case 'rate-limited':
      return tuckedUnderFormation(anchor, s);
  }
}

/** A point in a horizontal band at absolute `bandY`, scattered around the
 * home x by `xSpread` and around the band by `ySpread` — a living stratum,
 * not a flat line. Clamped above the waterline so it can never surface. */
function bandScatter(
  anchor: HomeAnchor,
  seed: number,
  bandY: number,
  xSpread: number,
  ySpread: number,
): { x: number; y: number } {
  const x = anchor.x + hashRange(seed, -xSpread, xSpread);
  const y = bandY + hashRange(seed + 1, -ySpread, ySpread);
  return { x, y: Math.max(y, WORLD.waterlineY + 20) };
}

/** FIX 3: asleep rests OUT on the open sand, clearly clear of the rock — one
 * deterministic side, offset well beyond the silhouette footprint. Reads as
 * "sleeping in the open", the deliberate opposite of rate-limited's tuck HARD
 * under the overhang, so the two seabed poses never blur together. Clamped
 * into the world so a rig near an edge can't sleep off-tank. */
const OPEN_SAND_MARGIN_WU = 40;
function settledOnSeabed(anchor: HomeAnchor, seed: number): { x: number; y: number } {
  const side = hashUnit(seed) < 0.5 ? -1 : 1;
  const offset = anchor.radius * 0.9 + hashRange(seed + 1, 60, 130);
  const x = anchor.x + side * offset;
  const y = anchor.y + hashRange(seed + 2, 6, 44);
  return {
    x: Math.min(Math.max(x, OPEN_SAND_MARGIN_WU), WORLD.width - OPEN_SAND_MARGIN_WU),
    y: Math.min(y, WORLD.height - 20),
  };
}

/** Risen to the surface band near the home x, with a little horizontal
 * scatter and a hair of vertical jitter so a row of surfacing fish doesn't
 * pin to one exact height. */
function surfaceBand(anchor: HomeAnchor, seed: number, bandY: number): { x: number; y: number } {
  return {
    x: anchor.x + hashRange(seed, -60, 60),
    y: bandY + hashRange(seed + 1, -12, 12),
  };
}

/** FIX 3: rate-limited jams HARD up under the overhang — a tight central x
 * (deep inside the footprint, in the rock's shadow) and high up under the
 * crest. Maximally unlike asleep's open-sand rest, so one reads "jammed under
 * a rock" and the other "sleeping in the open". */
function tuckedUnderFormation(anchor: HomeAnchor, seed: number): { x: number; y: number } {
  const x = anchor.x + hashRange(seed, -anchor.radius * 0.28, anchor.radius * 0.28);
  const y = anchor.y - hashRange(seed + 1, 70, 140);
  return { x, y };
}
