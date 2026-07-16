// Small pure math helpers shared across render/. No canvas, no state.

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Checked array access for noUncheckedIndexedAccess code paths where the
 * index is structurally in range. Throws (never masks) on a real logic bug.
 */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) {
    throw new Error(`render: index ${i} out of range (len ${arr.length})`);
  }
  return v;
}

/** wrap an angle to (−π, π] */
export function normalizeAngle(a: number): number {
  const t = (a + Math.PI) % TAU;
  return (t < 0 ? t + TAU : t) - Math.PI;
}

export interface Pt {
  x: number;
  y: number;
}

export function rotate(p: Pt, rad: number): Pt {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(p: Pt, k: number): Pt {
  return { x: p.x * k, y: p.y * k };
}
