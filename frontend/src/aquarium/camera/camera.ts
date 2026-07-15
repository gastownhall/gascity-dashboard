// Pure camera math for the /reef canvas: fit/clamp/zoom/pan, LOD thresholds,
// screen<->world mapping, and the `#cam=x,y,zoom` deep-link hash. No canvas,
// no DOM, no React — the page shell owns wiring this to pointer events.

import {
  CAMERA_HASH_PREFIX,
  LOD1_ZOOM,
  LOD2_ZOOM,
  WORLD,
  type Camera,
  type LodTier,
  type Viewport,
} from '../contracts';

/** Camera can never zoom out past seeing the whole tank at once. */
function minZoom(viewport: Viewport): number {
  return fitTankCamera(viewport).zoom;
}

/** Generous headroom past the LOD2 detail threshold for close-up framing. */
const MAX_ZOOM = 8;

/** Zoom level (css px / world unit) that fits the entire WORLD into viewport,
 * centered on the tank midpoint. This is also the camera's zoomed-out floor. */
export function fitTankCamera(viewport: Viewport): Camera {
  const zoom = Math.min(viewport.cssWidth / WORLD.width, viewport.cssHeight / WORLD.height);
  return { x: WORLD.width / 2, y: WORLD.height / 2, zoom };
}

/** How much closer than the whole-tank fit the default framing sits. Chosen so
 * overview fish read as creatures and the empty margins crop away, while the
 * full surface→seabed pose column still shows and the view stays below the
 * LOD1 label threshold (an unlabelled overview, not a chart). */
export const HOME_ZOOM_FACTOR = 1.4;

/** The default and reset framing: closer than the whole-tank fit so overview
 * fish read as creatures and the wide empty water crops away. Capped just below
 * LOD1 so the default view never shows rig labels regardless of viewport, and
 * clamped to the world bounds. The full tank stays reachable by zooming out —
 * fitTankCamera remains the zoom-out floor. */
export function homeCamera(viewport: Viewport): Camera {
  const fit = fitTankCamera(viewport);
  const zoom = Math.min(fit.zoom * HOME_ZOOM_FACTOR, LOD1_ZOOM * 0.98);
  return clampCamera({ x: WORLD.width / 2, y: WORLD.height / 2, zoom }, viewport);
}

/** A sliver of open surface kept above the waterline when the tank can't fill
 * the viewport height, so the surface still reads as a surface. */
const OVERTALL_SURFACE_MARGIN_WU = 60;

/** Clamp zoom to [tank-fit, MAX_ZOOM], then clamp x/y so the visible rect never
 * crosses the world bounds. When the visible rect is wider than the world, x is
 * forced to the world midpoint. When it is TALLER than the world, y anchors the
 * water surface near the top of the view rather than centring the world — the
 * over-tall remainder then falls below the seabed (which the sand paints all the
 * way down) instead of stranding empty water above the waterline. */
export function clampCamera(cam: Camera, viewport: Viewport): Camera {
  const zoom = clamp(cam.zoom, minZoom(viewport), MAX_ZOOM);
  const halfWidthWu = viewport.cssWidth / 2 / zoom;
  const halfHeightWu = viewport.cssHeight / 2 / zoom;
  const x = clampAxis(cam.x, halfWidthWu, WORLD.width);
  const y = clampVerticalAxis(cam.y, halfHeightWu);
  return { x, y, zoom };
}

function clampAxis(value: number, halfExtent: number, worldExtent: number): number {
  if (halfExtent * 2 >= worldExtent) return worldExtent / 2;
  return clamp(value, halfExtent, worldExtent - halfExtent);
}

/** Vertical clamp. The view top is held at or below a small sliver of open
 * surface above the waterline (never a slab of empty water), and the view bottom
 * at or above the world floor (the seabed sand fills any remainder below it).
 * Both bounds move continuously with zoom; when the world no longer fits under
 * the surface-sliver cap the lower bound crosses the upper and the surface
 * anchor wins — and the two agree exactly at that crossing, so a narrow viewport
 * zooming across the fit-height point sees no jump (the old branch-on-threshold
 * form popped the camera ~60 wu there). */
function clampVerticalAxis(value: number, halfHeightWu: number): number {
  const lo = WORLD.waterlineY - OVERTALL_SURFACE_MARGIN_WU + halfHeightWu;
  const hi = WORLD.height - halfHeightWu;
  return lo >= hi ? lo : clamp(value, lo, hi);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Zoom by `zoomFactor`, keeping the world point under (cssX, cssY) fixed on
 * screen (the standard "zoom at cursor" anchor), then re-clamps to bounds. */
export function zoomAtCursor(
  cam: Camera,
  viewport: Viewport,
  cssX: number,
  cssY: number,
  zoomFactor: number,
): Camera {
  const worldBefore = worldFromScreen(cam, viewport, cssX, cssY);
  const zoom = clamp(cam.zoom * zoomFactor, minZoom(viewport), MAX_ZOOM);
  const anchored: Camera = { x: cam.x, y: cam.y, zoom };
  const worldAfter = worldFromScreen(anchored, viewport, cssX, cssY);
  const recentered: Camera = {
    x: anchored.x + (worldBefore.x - worldAfter.x),
    y: anchored.y + (worldBefore.y - worldAfter.y),
    zoom,
  };
  return clampCamera(recentered, viewport);
}

/** Drag-pan: the world follows the cursor, so a positive screen delta moves
 * the camera focus in the opposite (negative) world direction. */
export function panCamera(cam: Camera, dxCss: number, dyCss: number): Camera {
  return { x: cam.x - dxCss / cam.zoom, y: cam.y - dyCss / cam.zoom, zoom: cam.zoom };
}

/** LOD0 (tank overview) below LOD1_ZOOM, LOD1 (reef) below LOD2_ZOOM, else LOD2 (fish). */
export function lodTier(zoom: number): LodTier {
  if (zoom >= LOD2_ZOOM) return 2;
  if (zoom >= LOD1_ZOOM) return 1;
  return 0;
}

/** Width of the fade-in band leading up to a tier's threshold zoom. */
const FADE_ZOOM_SPAN = 0.25;

/**
 * Opacity for the text layer gated at `tier`'s LOD threshold: 0 a full fade
 * span below the threshold, ramping linearly to 1 exactly at the threshold
 * and staying there past it. Tier 0 has no gating threshold (its overlay text
 * is always visible), so it is always fully opaque.
 */
export function textAlpha(zoom: number, tier: LodTier): number {
  if (tier === 0) return 1;
  const threshold = tier === 1 ? LOD1_ZOOM : LOD2_ZOOM;
  const t = (zoom - (threshold - FADE_ZOOM_SPAN)) / FADE_ZOOM_SPAN;
  return clamp(t, 0, 1);
}

/** CSS-pixel screen point for a world point under `cam`. */
export function screenFromWorld(
  cam: Camera,
  viewport: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - cam.x) * cam.zoom + viewport.cssWidth / 2,
    y: (y - cam.y) * cam.zoom + viewport.cssHeight / 2,
  };
}

/** World point under a CSS-pixel screen point, given `cam`. */
export function worldFromScreen(
  cam: Camera,
  viewport: Viewport,
  cssX: number,
  cssY: number,
): { x: number; y: number } {
  return {
    x: (cssX - viewport.cssWidth / 2) / cam.zoom + cam.x,
    y: (cssY - viewport.cssHeight / 2) / cam.zoom + cam.y,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `#cam=x,y,zoom`, each field rounded to 2 decimal places. */
export function serializeCameraHash(cam: Camera): string {
  return `${CAMERA_HASH_PREFIX}${round2(cam.x)},${round2(cam.y)},${round2(cam.zoom)}`;
}

/** Inverse of {@link serializeCameraHash}. Returns null for any malformed,
 * wrong-prefix, wrong-arity, non-finite, or non-positive-zoom input. */
export function parseCameraHash(hash: string): Camera | null {
  if (!hash.startsWith(CAMERA_HASH_PREFIX)) return null;
  const fields = hash.slice(CAMERA_HASH_PREFIX.length).split(',').map(Number);
  if (fields.length !== 3) return null;
  const [x, y, zoom] = fields;
  if (x === undefined || y === undefined || zoom === undefined) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  if (zoom <= 0) return null;
  return { x, y, zoom };
}
