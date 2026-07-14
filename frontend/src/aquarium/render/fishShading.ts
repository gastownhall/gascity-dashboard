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
import { adjustLC, withAlpha } from './oklch';

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

/**
 * normal — strong dark-back→lit-belly countershade for a 150px close-up.
 * dim    — asleep/tombstone: pale, desaturated, low-contrast, sleepy.
 * tense  — rate-limited: awake but throttled; darker AND more saturated than
 *          normal (held/hunched), NOT washed out like dim.
 */
export type ShadeVariant = 'normal' | 'dim' | 'tense';

interface ShadeSpec {
  base: string;
  outline: string;
  /** [deltaL, chromaScale] per station, dark back → lit belly */
  dorsal: readonly [number, number];
  mid: readonly [number, number];
  ventral: readonly [number, number];
  belly: readonly [number, number];
}

type Variants = Record<ShadeVariant, CountershadeColors>;

const cache = new WeakMap<ScenePalette, Variants>();

function build(s: ShadeSpec): CountershadeColors {
  const dorsal = adjustLC(s.base, s.dorsal[0], s.dorsal[1]);
  const mid = adjustLC(s.base, s.mid[0], s.mid[1]);
  const ventral = adjustLC(s.base, s.ventral[0], s.ventral[1]);
  const belly = adjustLC(s.base, s.belly[0], s.belly[1]);
  return { dorsal, mid, ventral, belly, outline: s.outline, finRoot: dorsal, finLight: belly };
}

export function countershadeColors(
  palette: ScenePalette,
  variant: ShadeVariant,
): CountershadeColors {
  let built = cache.get(palette);
  if (built === undefined) {
    const outline = palette.fishOutline;
    built = {
      // dark back drops hard and gains chroma; the belly lifts far AND
      // desaturates toward a lit cream/silver — the two ends read ~45 L apart
      normal: build({
        base: palette.fishBody,
        outline,
        dorsal: [-22, 1.2],
        mid: [0, 1],
        ventral: [26, 0.55],
        belly: [37, 0.38],
      }),
      // pale, washed, low-contrast: unmistakably asleep, not merely dark
      dim: build({
        base: palette.fishDim,
        outline: withAlpha(outline, 0.55),
        dorsal: [-6, 0.55],
        mid: [2, 0.5],
        ventral: [9, 0.4],
        belly: [15, 0.3],
      }),
      // held/hunched: darker overall + more saturated, outline full (awake)
      tense: build({
        base: palette.fishBody,
        outline,
        dorsal: [-24, 1.35],
        mid: [-9, 1.2],
        ventral: [7, 0.95],
        belly: [16, 0.78],
      }),
    };
    cache.set(palette, built);
  }
  return built[variant];
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
  // dark back holds the top third, the lit belly owns the bottom third, with a
  // crisp flank transition between — the countershade reads as a lit form, not
  // a faint tint
  g.addColorStop(0, c.dorsal);
  g.addColorStop(0.32, c.mid);
  g.addColorStop(0.68, c.ventral);
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
