// LOD fades computed locally from the pinned zoom thresholds. Text layers
// fade in across a window around each threshold instead of popping.

import { LOD2_ZOOM } from '../contracts';
import { clamp01 } from './mathUtil';

/** Smoothstep 0→1 across [0.8·threshold, 1.1·threshold]. */
export function fadeAcross(zoom: number, threshold: number): number {
  const lo = threshold * 0.8;
  const hi = threshold * 1.1;
  const t = clamp01((zoom - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

/** Zoom at which rig names + open-bead counts have faded fully in. Sits just
 * above the whole-tank fit floor (≈ 0.36) and below the default home framing
 * (≈ 0.5·1.4·fit): the fully zoomed-out reef stays unlabeled (clean, no
 * categorical-bar read), but the default working view names every rig so an
 * operator can tell projects apart without hunting for the zoom. */
export const RIG_LABEL_ZOOM = 0.46;

/** Rig names + open-bead counts (the tank's map labels) fade in across
 * RIG_LABEL_ZOOM — present at the default overview, gone only when the operator
 * zooms all the way out to the whole tank. */
export function rigLabelFade(zoom: number): number {
  return fadeAcross(zoom, RIG_LABEL_ZOOM);
}

/** Full captions and pellet id labels fade in across LOD2. Fish identity text
 * appears only here (deep zoom) — never as floating name tags at the overview. */
export function lod2Fade(zoom: number): number {
  return fadeAcross(zoom, LOD2_ZOOM);
}
