// /reef route shell. Wires data (useAquariumData) -> world derivation
// (deriveWorldSnapshot) -> simulation + paint (useAquariumRenderLoop) ->
// camera (useAquariumCamera) -> overlay chrome + a11y (AquariumOverlay,
// SrFishList, EntityCard, HoverTooltip). specs/plans/reef-aquarium.md is the
// binding contract; DESIGN.md §7 is the visual carve-out.
//
// UNRESOLVED IMPORTS (expected at hand-off): derive/deriveWorld.ts and
// render/palette.ts are owned by sibling modules and did not exist at the
// time this file was written.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import {
  EMPTY_FLOW_OBSERVATION,
  type FixtureKind,
  type ScenePalette,
  type Viewport,
  type WorldSnapshot,
} from './contracts';
import { deriveWorldSnapshot, type DeriveMemory } from './derive/deriveWorld';
import { buildScenePalette } from './render/palette';
import { AquariumLegend } from './page/AquariumLegend';
import { AquariumOverlay } from './page/AquariumOverlay';
import { buildRigLegend } from './page/rigLegend';
import { EntityCard } from './page/EntityCard';
import { resolveFixtureKindFromSearch } from './page/fixtureMode';
import { hitTestScene, type HitResult } from './page/hitTest';
import { HoverTooltip } from './page/HoverTooltip';
import { readBodyFontFamily, readThemeTokens } from './page/paletteTokens';
import { SrFishList } from './page/SrFishList';
import { StrandedShelf } from './page/StrandedShelf';
import { useAquariumCamera } from './page/useAquariumCamera';
import { useAquariumData } from './page/useAquariumData';
import { useAquariumRenderLoop } from './page/useAquariumRenderLoop';

export interface AquariumPageProps {
  /** Overrides the URL's `?fixture=` param — the route tests' entry point
   *  into fixture mode, since jsdom has no real navigation. */
  fixtureOverride?: FixtureKind;
}

const HOVER_THROTTLE_MS = 60;

interface SelectedHit {
  hit: NonNullable<HitResult>;
  screenX: number;
  screenY: number;
}

export function AquariumPage({ fixtureOverride }: AquariumPageProps) {
  const location = useLocation();
  const urlFixtureKind = useMemo(
    () => resolveFixtureKindFromSearch(location.search),
    [location.search],
  );
  const fixtureKind = fixtureOverride ?? urlFixtureKind;

  const { inputs, connState, manifest } = useAquariumData(fixtureKind);
  const reducedMotion = usePrefersReducedMotion();
  const { resolved: themeMood } = useTheme();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>(measureViewport);

  useEffect(() => {
    const measure = () => setViewport(measureViewport());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Fixture mode publishes ground truth for the snapshot harness.
  useEffect(() => {
    if (manifest !== null) window.__aquariumManifest = manifest;
  }, [manifest]);

  const palette: ScenePalette = useMemo(
    () => buildScenePalette(themeMood, readThemeTokens(), readBodyFontFamily()),
    [themeMood],
  );

  // deriveWorldSnapshot on data change; memory lives in a ref (it is
  // pipeline-internal continuity state, not something a re-render should
  // reset), nowMs is injected here — the one call site, not inside derive/.
  const memoryRef = useRef<DeriveMemory | null>(null);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  useEffect(() => {
    const result = deriveWorldSnapshot(inputs, memoryRef.current, Date.now());
    memoryRef.current = result.memory;
    setSnapshot(result.snapshot);
  }, [inputs]);

  // The reef key: which colour is which rig, and where each bead state lives.
  const rigLegend = useMemo(
    () => buildRigLegend(snapshot?.formations ?? [], snapshot?.fish ?? []),
    [snapshot],
  );

  // requestPaintRef breaks the circular dependency between the camera hook
  // (which needs to trigger a repaint on gesture) and the render-loop hook
  // (which needs the camera's ref to paint from) — same "keep a ref pointed
  // at the latest callback" idiom useCachedData.ts uses for its fetcher.
  const [hover, setHover] = useState<SelectedHit | null>(null);
  const [selected, setSelected] = useState<SelectedHit | null>(null);
  const lastHoverAtRef = useRef(0);
  // Only a selected PELLET drives dependency links; a selected fish draws none.
  const selectedBeadId = selected?.hit.kind === 'pellet' ? selected.hit.entity.beadId : null;

  const requestPaintRef = useRef<() => void>(() => {});
  const camera = useAquariumCamera(viewport, () => requestPaintRef.current());
  const renderLoop = useAquariumRenderLoop({
    canvasRef,
    viewport,
    snapshot,
    cameraRef: camera.cameraRef,
    palette,
    reducedMotion,
    isFixture: fixtureKind !== null,
    selectedBeadId,
  });
  requestPaintRef.current = renderLoop.requestPaint;

  const resolveHit = useCallback(
    (cssX: number, cssY: number): SelectedHit | null => {
      if (snapshot === null) return null;
      const world = camera.worldFromClientOffset(cssX, cssY);
      const pelletsEligible = camera.lodTierRef.current === 2;
      const hit = hitTestScene(
        world.x,
        world.y,
        snapshot.fish,
        renderLoop.simRef.current.fish,
        snapshot.pellets,
        renderLoop.simRef.current.pellets,
        pelletsEligible,
      );
      return hit === null ? null : { hit, screenX: cssX, screenY: cssY };
    },
    [snapshot, camera, renderLoop.simRef],
  );

  const onCanvasClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setSelected(resolveHit(e.clientX - rect.left, e.clientY - rect.top));
    },
    [resolveHit],
  );

  const onCanvasPointerMove = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      camera.onPointerMove(e);
      const now = Date.now();
      if (now - lastHoverAtRef.current < HOVER_THROTTLE_MS) return;
      lastHoverAtRef.current = now;
      const rect = e.currentTarget.getBoundingClientRect();
      setHover(resolveHit(e.clientX - rect.left, e.clientY - rect.top));
    },
    [camera, resolveHit],
  );

  const ariaLabel = `${snapshot?.fish.length ?? 0} fish; ${snapshot?.needsAttention ?? 0} need attention; connection ${connState}`;

  return (
    <div className="relative" style={{ width: viewport.cssWidth, height: viewport.cssHeight }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        className="absolute inset-0 h-full w-full outline-none focus-mark"
        onWheel={camera.onWheel}
        onPointerDown={camera.onPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={camera.onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={camera.onDoubleClick}
        onKeyDown={camera.onKeyDown}
        onClick={onCanvasClick}
      />
      <AquariumOverlay
        needsAttention={snapshot?.needsAttention ?? 0}
        flow={snapshot?.flow ?? EMPTY_FLOW_OBSERVATION}
        connState={connState}
        onZoomIn={camera.zoomIn}
        onZoomOut={camera.zoomOut}
        onReset={camera.resetCamera}
      />
      <AquariumLegend legend={rigLegend} />
      <StrandedShelf work={snapshot?.strandedWork ?? []} />
      {selected === null && hover !== null && (
        <HoverTooltip
          hit={hover.hit}
          screenX={hover.screenX}
          screenY={hover.screenY}
          viewport={viewport}
        />
      )}
      {selected !== null && (
        <EntityCard
          hit={selected.hit}
          anchorX={selected.screenX}
          anchorY={selected.screenY}
          viewport={viewport}
          onDismiss={() => setSelected(null)}
        />
      )}
      <SrFishList fish={snapshot?.fish ?? []} />
    </div>
  );
}

/**
 * The viewport under the Header, measured live — never a hardcoded px. The
 * Header is app chrome rendered by Layout above this route's `<main>`;
 * querying it by tag is safe because /reef renders no `<header>` of its own.
 * Before the first post-mount measurement (there is exactly one `<header>`
 * in the DOM at that point, or none on a very first paint before Layout
 * commits) this degrades to a 0px header inset, corrected on the immediate
 * follow-up effect run.
 */
function measureViewport(): Viewport {
  const header = document.querySelector('header');
  const headerHeight = header !== null ? header.getBoundingClientRect().height : 0;
  return {
    cssWidth: window.innerWidth,
    cssHeight: Math.max(0, window.innerHeight - headerHeight),
    dpr: window.devicePixelRatio || 1,
  };
}
