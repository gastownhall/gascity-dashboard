// Per-pose rest/settle positions relative to a fish's home anchor. Used both
// as the exact frame in reduced-motion mode and as the steering target for
// "hold position" poses (asleep/awaiting-input/stalled/rate-limited/
// errored) in normal motion. Deterministic: seeded only by a per-fish hash,
// never Math.random.

import { WORLD, type AquariumPose } from '../contracts';
import { hashRange } from '../derive/hash';

export interface HomeAnchor {
  x: number;
  y: number;
  /** formation footprint radius, or a default "open water" radius for
   * CITY_KEY fish (mayor / city-stratum) which have no formation. */
  radius: number;
}

const TAU = Math.PI * 2;

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
    case 'asleep':
      return settledOnSeabed(anchor, s);
    case 'awaiting-input':
      return riskToWaterline(anchor, s, WORLD.waterlineY + 60);
    case 'errored':
      return riskToWaterline(anchor, s, WORLD.waterlineY + 90);
    case 'rate-limited':
      return tuckedUnderFormation(anchor, s);
    case 'stalled':
    case 'working':
    case 'idle':
      return nearAnchorSpawn(anchor, s);
  }
}

function settledOnSeabed(anchor: HomeAnchor, seed: number): { x: number; y: number } {
  const angle = hashRange(seed, 0, TAU);
  const x = anchor.x + Math.cos(angle) * anchor.radius * 0.75;
  const y = anchor.y + hashRange(seed + 1, 10, 60);
  return { x, y: Math.min(y, WORLD.height - 20) };
}

function riskToWaterline(
  anchor: HomeAnchor,
  seed: number,
  targetY: number,
): { x: number; y: number } {
  return { x: anchor.x + hashRange(seed, -60, 60), y: targetY };
}

function tuckedUnderFormation(anchor: HomeAnchor, seed: number): { x: number; y: number } {
  const x = anchor.x + hashRange(seed, -anchor.radius * 0.4, anchor.radius * 0.4);
  const y = anchor.y - hashRange(seed + 1, 40, 100);
  return { x, y };
}

/** Where a fish first appears (or "holds") near its home formation, spread
 * out by hash so a crowded formation doesn't stack fish on one point. */
function nearAnchorSpawn(anchor: HomeAnchor, seed: number): { x: number; y: number } {
  const angle = hashRange(seed, 0, TAU);
  const spread = hashRange(seed + 1, 0.2, 0.9) * anchor.radius;
  return {
    x: anchor.x + Math.cos(angle) * spread,
    y: anchor.y - Math.abs(Math.sin(angle)) * spread * 0.6,
  };
}
