// The paint pipeline: DPR canvas sizing, and either a continuous rAF loop
// (advanceSim -> paintScene every frame) or, under reduced motion, a single
// settled paint per state change with no autonomous loop at all
// (specs/plans/reef-aquarium.md "Reduced motion"). `requestPaint` is how a
// ref-only camera gesture (which never triggers a React re-render) still
// gets on screen while reduced motion has no loop polling for it.
//
// UNRESOLVED IMPORT (expected at hand-off): sim/advanceSim.ts and
// render/paintScene.ts are owned by sibling modules and did not exist at the
// time this file was written.

import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { advanceSim } from '../sim/advanceSim';
import { paintScene } from '../render/paintScene';
import type { Camera, ScenePalette, SimState, Viewport, WorldSnapshot } from '../contracts';

/** window.__aquariumFrameTimesMs is capped so a long-running fixture-mode
 *  perf sweep can't grow the array unbounded. */
const FRAME_TIME_CAP = 5000;

// The perf gate measures RENDER WORK per frame (the advanceSim + paintScene
// wall time), not the requestAnimationFrame interval. The rAF interval is
// vsync-locked to the display refresh (~16.67ms at 60Hz), so its median is
// pinned at one refresh regardless of how fast the render actually is — it
// measures frame PACING, not whether the render fits the frame budget. Timing
// the paint work directly answers the real question ("does a pan/zoom frame's
// render complete inside the 16ms budget?"). The raw rAF deltas are still
// exposed on __aquariumRafDeltasMs for reference (dropped-frame diagnosis).

const INITIAL_SIM_STATE: SimState = { fish: {}, pellets: {}, clockMs: 0 };

export interface UseAquariumRenderLoopArgs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewport: Viewport;
  snapshot: WorldSnapshot | null;
  cameraRef: MutableRefObject<Camera>;
  palette: ScenePalette;
  reducedMotion: boolean;
  isFixture: boolean;
}

export interface AquariumRenderLoopApi {
  /** No-op unless reduced motion is active — a camera gesture calls this so
   *  its instant jump still reaches the screen with no polling loop running. */
  requestPaint: () => void;
  /** Read-only: the live kinematics hit-testing needs to resolve a click to
   *  the fish/pellet actually on screen (not just the derived snapshot's
   *  static entity list). */
  simRef: RefObject<SimState>;
}

export function useAquariumRenderLoop({
  canvasRef,
  viewport,
  snapshot,
  cameraRef,
  palette,
  reducedMotion,
  isFixture,
}: UseAquariumRenderLoopArgs): AquariumRenderLoopApi {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const isFixtureRef = useRef(isFixture);
  isFixtureRef.current = isFixture;
  const simRef = useRef<SimState>(INITIAL_SIM_STATE);

  useCanvasDprSizing(canvasRef, viewport);

  const paintOnce = useCallback(
    (dtMs: number) => {
      const canvas = canvasRef.current;
      const currentSnapshot = snapshotRef.current;
      if (canvas === null || currentSnapshot === null) return;
      const ctx = canvas.getContext('2d');
      // jsdom (and any canvas-less environment) returns null here — skip
      // painting silently; every other concern (DOM, a11y, overlay) still
      // renders normally, which is exactly what the route tests rely on.
      if (ctx === null) return;
      simRef.current = advanceSim(currentSnapshot, simRef.current, dtMs, reducedMotionRef.current);
      paintScene(
        ctx,
        currentSnapshot,
        simRef.current,
        cameraRef.current,
        viewportRef.current,
        paletteRef.current,
        { reducedMotion: reducedMotionRef.current },
      );
    },
    [canvasRef, cameraRef],
  );

  // Continuous loop, only while motion is not reduced.
  useEffect(() => {
    if (reducedMotion) return;
    let rafId = 0;
    let lastTs: number | null = null;
    const tick = (ts: number) => {
      const dtMs = lastTs === null ? 0 : ts - lastTs;
      lastTs = ts;
      const workStart = performance.now();
      paintOnce(dtMs);
      if (isFixtureRef.current) {
        pushFrameTime(performance.now() - workStart);
        pushRafDelta(dtMs);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [reducedMotion, paintOnce]);

  // Reduced motion: one settled paint whenever the derived world, viewport,
  // or palette actually change. Camera-driven repaints route through
  // requestPaint instead (camera lives in a ref, so it never lands here).
  useEffect(() => {
    if (!reducedMotion) return;
    paintOnce(0);
  }, [reducedMotion, snapshot, viewport, palette, paintOnce]);

  const requestPaint = useCallback(() => {
    if (reducedMotionRef.current) paintOnce(0);
  }, [paintOnce]);

  return { requestPaint, simRef };
}

function useCanvasDprSizing(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  viewport: Viewport,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = Math.round(viewport.cssWidth * viewport.dpr);
    canvas.height = Math.round(viewport.cssHeight * viewport.dpr);
    canvas.style.width = `${viewport.cssWidth}px`;
    canvas.style.height = `${viewport.cssHeight}px`;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  }, [canvasRef, viewport]);
}

function pushFrameTime(workMs: number): void {
  const times = window.__aquariumFrameTimesMs ?? [];
  times.push(workMs);
  if (times.length > FRAME_TIME_CAP) times.shift();
  window.__aquariumFrameTimesMs = times;
}

function pushRafDelta(dtMs: number): void {
  const deltas = window.__aquariumRafDeltasMs ?? [];
  deltas.push(dtMs);
  if (deltas.length > FRAME_TIME_CAP) deltas.shift();
  window.__aquariumRafDeltasMs = deltas;
}
