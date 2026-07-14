// Fish shading: countershading colors (dark dorsal → light ventral) and the
// canvas gradients that carry them. Countershading is what most kills the
// clip-art read, so the L delta here is large and deliberate. The body
// gradient runs along the ANATOMICAL dorsal→ventral axis (from hull mid
// points), so it follows pitch and flips belly-up with the fish — an errored
// fish shows its pale belly on top with no special-casing. Fin membranes fade
// root→tip so nothing reads as a pasted opaque polygon.

import type { ScenePalette } from '../contracts';
import type { FishHull } from './fishGeometry';
import type { Pt } from './mathUtil';
import { at } from './mathUtil';
import { adjustL, withAlpha } from './oklch';

export interface CountershadeColors {
  /** dark back */
  dorsal: string;
  /** flank mid-tone */
  mid: string;
  /** light belly */
  ventral: string;
  /** brightest belly edge (countershade highlight) */
  belly: string;
  outline: string;
  /** opaque fin-membrane root tone (caudal/dorsal/pelvic grow from the body) */
  finRoot: string;
  /** light pectoral tone — the near fin catching the light */
  finLight: string;
}

interface Pair {
  normal: CountershadeColors;
  dim: CountershadeColors;
}

const cache = new WeakMap<ScenePalette, Pair>();

function build(
  base: string,
  outline: string,
  dorsalDrop: number,
  ventralLift: number,
): CountershadeColors {
  const dorsal = adjustL(base, -dorsalDrop);
  const mid = adjustL(base, 2);
  const ventral = adjustL(base, ventralLift);
  const belly = adjustL(base, ventralLift + 10);
  return { dorsal, mid, ventral, belly, outline, finRoot: dorsal, finLight: belly };
}

export function countershadeColors(palette: ScenePalette, dim: boolean): CountershadeColors {
  let pair = cache.get(palette);
  if (pair === undefined) {
    pair = {
      // strong countershade for a rendered-at-150px close-up
      normal: build(palette.fishBody, palette.fishOutline, 15, 16),
      // asleep/tombstone: muted, low-contrast, sleepy
      dim: build(palette.fishDim, withAlpha(palette.fishOutline, 0.6), 8, 9),
    };
    cache.set(palette, pair);
  }
  return dim ? pair.dim : pair.normal;
}

/** Linear gradient down the anatomical dorsal→ventral axis of the hull. */
export function bodyGradient(
  ctx: CanvasRenderingContext2D,
  hull: FishHull,
  c: CountershadeColors,
): CanvasGradient {
  const n = hull.dorsal.length;
  const mid = Math.floor(n / 2);
  const d = at(hull.dorsal, mid);
  const v = at(hull.ventral, mid);
  // extend a touch past both edges so the crisp dark/light lands inside the hull
  const top = { x: d.x + (d.x - v.x) * 0.18, y: d.y + (d.y - v.y) * 0.18 };
  const bot = { x: v.x + (v.x - d.x) * 0.22, y: v.y + (v.y - d.y) * 0.22 };
  const g = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
  g.addColorStop(0, c.dorsal);
  g.addColorStop(0.46, c.mid);
  g.addColorStop(0.8, c.ventral);
  g.addColorStop(1, c.belly);
  return g;
}

/** Root→tip membrane gradient: opaque body tone at the root, feathered to
 * fully transparent at the tip so the fin melts into the water at its edge. */
export function finGradient(
  ctx: CanvasRenderingContext2D,
  root: Pt,
  tip: Pt,
  color: string,
  rootAlpha: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(root.x, root.y, tip.x, tip.y);
  g.addColorStop(0, withAlpha(color, rootAlpha));
  g.addColorStop(0.55, withAlpha(color, rootAlpha * 0.5));
  g.addColorStop(1, withAlpha(color, 0));
  return g;
}

export function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
