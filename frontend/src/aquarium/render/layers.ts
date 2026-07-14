// Parallax layer transforms and view-rect culling. Parallax applies to
// translation only (all layers share camera.zoom), and is anchored at the
// tank center so the default home view composes with zero layer skew; layers
// slide apart only as the camera pans away from center.

import type { Camera, Viewport } from '../contracts';
import { WORLD } from '../contracts';
import type { Pt } from './mathUtil';

export const PARALLAX = {
  far: 0.85,
  mid: 0.95,
  actors: 1.0,
  near: 1.06,
} as const;

/** world → css px mapping for one parallax layer: screen = world·scale + t. */
export interface LayerTransform {
  scale: number;
  tx: number;
  ty: number;
  dpr: number;
}

export function layerTransform(
  camera: Camera,
  viewport: Viewport,
  parallax: number,
): LayerTransform {
  const cx = WORLD.width / 2;
  const cy = WORLD.height / 2;
  const ex = cx + (camera.x - cx) * parallax;
  const ey = cy + (camera.y - cy) * parallax;
  return {
    scale: camera.zoom,
    tx: viewport.cssWidth / 2 - ex * camera.zoom,
    ty: viewport.cssHeight / 2 - ey * camera.zoom,
    dpr: viewport.dpr,
  };
}

/** Install a layer's world-space transform (ctx arrives DPR-prescaled by the
 * shell; setTransform must re-bake dpr since it replaces the whole matrix). */
export function applyLayer(ctx: CanvasRenderingContext2D, t: LayerTransform): void {
  const k = t.dpr * t.scale;
  ctx.setTransform(k, 0, 0, k, t.dpr * t.tx, t.dpr * t.ty);
}

/** Reset to css-px screen space (text layers, water column, vignette). */
export function applyScreenSpace(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Visible world rect for a layer, padded by margin world units. */
export function visibleWorldRect(t: LayerTransform, viewport: Viewport, margin: number): ViewRect {
  return {
    left: (0 - t.tx) / t.scale - margin,
    top: (0 - t.ty) / t.scale - margin,
    right: (viewport.cssWidth - t.tx) / t.scale + margin,
    bottom: (viewport.cssHeight - t.ty) / t.scale + margin,
  };
}

export function rectContains(r: ViewRect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function worldToScreen(t: LayerTransform, x: number, y: number): Pt {
  return { x: x * t.scale + t.tx, y: y * t.scale + t.ty };
}
