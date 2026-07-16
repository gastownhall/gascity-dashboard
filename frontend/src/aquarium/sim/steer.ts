// Small steering primitives shared by every per-pose tick function. Pure
// point/angle math only — no entity knowledge. Self-contained (does not
// import from render/, which is owned and concurrently built by another
// agent) — sim/ and camera/ never depend on render/.

const TAU = Math.PI * 2;

export interface Pt {
  x: number;
  y: number;
}

/** Wrap an angle into (-PI, PI]. */
function normalizeAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}

/** Turn from `current` toward `desired`, capped to `maxDeltaRad` this tick,
 * always taking the short way around the wrap. */
export function limitTurn(current: number, desired: number, maxDeltaRad: number): number {
  const diff = normalizeAngle(desired - current);
  const clamped = Math.max(-maxDeltaRad, Math.min(maxDeltaRad, diff));
  return normalizeAngle(current + clamped);
}

/** Heading (radians, 0 = +x) from one point toward another. */
export function headingTo(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Move from `pos` toward `target` at `speed` wu/s for `dtS` seconds,
 * stopping exactly at the target rather than overshooting it. */
export function moveToward(pos: Pt, target: Pt, speed: number, dtS: number): Pt {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return pos;
  const step = Math.min(dist, speed * dtS);
  return { x: pos.x + (dx / dist) * step, y: pos.y + (dy / dist) * step };
}

export function clampPoint(p: Pt, minX: number, maxX: number, minY: number, maxY: number): Pt {
  return {
    x: Math.min(Math.max(p.x, minX), maxX),
    y: Math.min(Math.max(p.y, minY), maxY),
  };
}

/**
 * Seek from (pos, heading) toward `target` at `speed` wu/s for `dtS`
 * seconds. Heading turns toward the target first (capped to
 * MAX_TURN_RATE_RAD_PER_S so a fish steers instead of flipping), and
 * position then moves along THAT heading — never straight at the target
 * while still mid-turn, so facing and motion always agree.
 */
export function seekTarget(
  pos: Pt,
  heading: number,
  target: Pt,
  speed: number,
  dtS: number,
  maxTurnRateRadPerS: number,
): { pos: Pt; heading: number } {
  const desiredHeading = headingTo(pos, target);
  const nextHeading = limitTurn(heading, desiredHeading, maxTurnRateRadPerS * dtS);
  const dist = Math.hypot(target.x - pos.x, target.y - pos.y);
  const step = Math.min(dist, speed * dtS);
  return {
    pos: { x: pos.x + Math.cos(nextHeading) * step, y: pos.y + Math.sin(nextHeading) * step },
    heading: nextHeading,
  };
}
