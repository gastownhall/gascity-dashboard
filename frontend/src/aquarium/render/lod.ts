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

/** Full captions and pellet id labels fade in across LOD2. Fish identity text
 * appears only here (deep zoom) — never as floating name tags at LOD0/LOD1. */
export function lod2Fade(zoom: number): number {
  return fadeAcross(zoom, LOD2_ZOOM);
}
