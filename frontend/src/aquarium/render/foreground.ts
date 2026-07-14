// Near-foreground silhouettes: the classic looking-through-glass aquarium cue.
// A few large, dark, SOFT-EDGED, low-detail kelp and rock shapes rooted at the
// bottom / side edges of the tank, sitting on a NEAR parallax plane (they slide
// fast on pan) and OUT OF FOCUS (approximated by 3 stacked, semi-transparent,
// scaled-about-the-base fills — no canvas blur/filter in the hot path). They
// partially occlude the scene edges, which reads instantly as depth-through-
// glass. This is licensed ambience (DESIGN.md §7: water/kelp are licensed);
// nothing here is fish- or pellet-shaped. Geometry is built ONCE (deterministic
// mulberry32) and cached; the painter only fills it, and it is baked into the
// offscreen foreground buffer (sceneCache.ts) so it costs one drawImage/frame.

import type { ScenePalette } from '../contracts';
import { WORLD } from '../contracts';
import { traceSmoothRing } from './formationShapes';
import { mulberry32 } from './hash';
import type { ViewRect } from './layers';
import type { Pt } from './mathUtil';
import { adjustL, mixOklch, parseOklch, withAlpha } from './oklch';

interface Silhouette {
  /** smooth closed shape(s), world coordinates */
  path: Path2D;
  /** pivot for the out-of-focus feather (scale-about-base), world coordinates */
  baseX: number;
  baseY: number;
  cullLeft: number;
  cullRight: number;
}

interface AnchorSpec {
  kind: 'kelp' | 'rock';
  baseX: number;
  /** span used for width; kelp = clump half-spread, rock = mound half-width */
  halfWidth: number;
  height: number;
  lean: number;
}

// Rooted at the world floor so the base sits just below the frame edge at the
// fit-tank overview. Tall kelp hug the left/right edges; low rock mounds sit
// inboard over the seabed so they occlude background reef without covering the
// mid-water schools.
const FLOOR = WORLD.height;
const ANCHORS: readonly AnchorSpec[] = [
  { kind: 'kelp', baseX: 235, halfWidth: 158, height: 1010, lean: -78 },
  { kind: 'rock', baseX: 1080, halfWidth: 350, height: 452, lean: 0 },
  { kind: 'rock', baseX: 2905, halfWidth: 402, height: 536, lean: 0 },
  { kind: 'kelp', baseX: 3775, halfWidth: 168, height: 966, lean: 86 },
];

let cached: readonly Silhouette[] | null = null;

/** Built once; deterministic, palette-independent. */
export function foregroundSilhouettes(): readonly Silhouette[] {
  if (cached !== null) return cached;
  cached = ANCHORS.map((a, i) =>
    a.kind === 'kelp'
      ? buildKelp(a, mulberry32(0x5eed11 + i))
      : buildRock(a, mulberry32(0xf00d21 + i)),
  );
  return cached;
}

/** A kelp stand: 4 tall tapering fronds with gentle S-lean, merged into one
 * path so the whole clump feathers as a single soft mass. */
function buildKelp(a: AnchorSpec, rnd: () => number): Silhouette {
  const path = new Path2D();
  const fronds = 5;
  let minX = a.baseX;
  let maxX = a.baseX;
  for (let f = 0; f < fronds; f += 1) {
    const spread = (f / (fronds - 1) - 0.5) * a.halfWidth * 2;
    const bx = a.baseX + spread;
    const height = a.height * (0.72 + rnd() * 0.4);
    const lean = a.lean * (0.5 + rnd() * 0.8) + spread * 0.4;
    const bow = (rnd() - 0.5) * 100;
    const baseW = 36 + rnd() * 26;
    const ring = frondRing(bx, FLOOR, height, lean, bow, baseW);
    traceSmoothRing(path, ring);
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
  }
  return { path, baseX: a.baseX, baseY: FLOOR, cullLeft: minX - 40, cullRight: maxX + 40 };
}

/** A single frond ring: sampled centerline offset by a tapering half-width,
 * up the left edge then down the right edge (the narrow top rounds to a tip). */
function frondRing(
  bx: number,
  by: number,
  height: number,
  lean: number,
  bow: number,
  baseW: number,
): Pt[] {
  const N = 6;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const cy = by - height * t;
    const cx = bx + lean * t * t + bow * Math.sin(t * Math.PI);
    const w = baseW * (1 - t) ** 1.25 + 3;
    left.push({ x: cx - w, y: cy });
    right.push({ x: cx + w, y: cy });
  }
  return [...left, ...right.reverse()];
}

/** A low, wide rock mound with a few hashed bumps over its crown; rooted below
 * the floor so the base is off-frame. */
function buildRock(a: AnchorSpec, rnd: () => number): Silhouette {
  const path = new Path2D();
  const ring: Pt[] = [];
  const steps = 11;
  for (let i = 0; i <= steps; i += 1) {
    const angle = Math.PI - (i / steps) * Math.PI; // left → over the top → right
    const bump = 0.86 + rnd() * 0.32;
    ring.push({
      x: a.baseX + Math.cos(angle) * a.halfWidth * bump + a.lean,
      y: FLOOR - Math.sin(angle) * a.height * bump,
    });
  }
  ring.push({ x: a.baseX + a.halfWidth + a.lean, y: FLOOR + 90 });
  ring.push({ x: a.baseX - a.halfWidth + a.lean, y: FLOOR + 90 });
  traceSmoothRing(path, ring);
  return {
    path,
    baseX: a.baseX + a.lean,
    baseY: FLOOR,
    cullLeft: a.baseX + a.lean - a.halfWidth - 40,
    cullRight: a.baseX + a.lean + a.halfWidth + 40,
  };
}

interface FeatherPass {
  /** scale-about-base for this soft-edge pass */
  k: number;
  /** pre-alpha'd fill color */
  color: string;
}

const cache = new WeakMap<ScenePalette, readonly FeatherPass[]>();

/** The darkest available pigment (theme-agnostic) darkened hard into a true
 * silhouette, then split into four stacked feather passes (wide faint halo →
 * near-opaque core) that read as a DARK, out-of-focus foreground mass — the
 * classic near-glass depth cue. A light-water background needs the shape dark,
 * not a pale wash (round-5 first pass read as more background fog). */
function foregroundPasses(palette: ScenePalette): readonly FeatherPass[] {
  const hit = cache.get(palette);
  if (hit !== undefined) return hit;
  const darkBase =
    parseOklch(palette.formationEdge).l <= parseOklch(palette.waterBottom).l
      ? palette.formationEdge
      : palette.waterBottom;
  // a hint of the water hue so it belongs, then darkened hard into shadow
  const core = adjustL(mixOklch(darkBase, palette.waterBottom, 0.15), -15);
  const built: readonly FeatherPass[] = [
    { k: 1.24, color: withAlpha(core, 0.12) },
    { k: 1.14, color: withAlpha(core, 0.22) },
    { k: 1.06, color: withAlpha(core, 0.38) },
    { k: 1.0, color: withAlpha(core, 0.85) },
  ];
  cache.set(palette, built);
  return built;
}

/** Fill every visible foreground silhouette with the 3-pass soft feather. The
 * foreground parallax layer must be installed. Called only at bake time (once
 * per camera, into the offscreen foreground buffer), so the save/restore per
 * feather pass never touches the per-frame hot path. */
export function paintForeground(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
): void {
  const passes = foregroundPasses(palette);
  for (const s of foregroundSilhouettes()) {
    if (s.cullRight < view.left || s.cullLeft > view.right) continue;
    for (const pass of passes) {
      ctx.save();
      ctx.translate(s.baseX, s.baseY);
      ctx.scale(pass.k, pass.k);
      ctx.translate(-s.baseX, -s.baseY);
      ctx.fillStyle = pass.color;
      ctx.fill(s.path);
      ctx.restore();
    }
  }
}
