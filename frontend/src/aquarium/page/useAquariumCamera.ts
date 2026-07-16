// Camera interaction: ref-held state updated at gesture rate, never React
// state — the rAF loop in AquariumPage reads `cameraRef.current` directly
// each frame, so panning/zooming never triggers a React re-render. The
// optional `onChange` callback exists for reduced-motion mode, which runs
// no rAF loop at all: a gesture must repaint itself explicitly (see
// useAquariumRenderLoop's `requestPaint`).
//
// UNRESOLVED IMPORT (expected at hand-off): camera/camera.ts is owned by a
// sibling module and did not exist at the time this file was written. Every
// function below is called exactly as specs/plans/reef-aquarium.md promises
// it; nothing here is a stub.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, MutableRefObject, PointerEvent, WheelEvent } from 'react';
import {
  clampCamera,
  homeCamera,
  lodTier,
  panCamera,
  parseCameraHash,
  serializeCameraHash,
  worldFromScreen,
  zoomAtCursor,
} from '../camera/camera';
import type { Camera, LodTier, Viewport } from '../contracts';

const BUTTON_ZOOM_FACTOR = 1.4;
const DOUBLE_CLICK_ZOOM_FACTOR = 2;
// Wheel zoom is PROPORTIONAL to the scroll delta, not a fixed step per event:
// trackpads and momentum scroll fire many events, and a fixed 1.4x per event
// compounds to an uncontrollable 1.4^N. `exp(-normalizedPx * sensitivity)`
// gives a gentle, delta-proportional zoom; clamped per event so one big notch
// can't jump. Tuned for ~1.12x per typical 100px mouse notch.
const WHEEL_ZOOM_SENSITIVITY = 0.0011;
const WHEEL_ZOOM_MIN_FACTOR = 0.5;
const WHEEL_ZOOM_MAX_FACTOR = 2;
const LINE_HEIGHT_PX = 16;
const KEYBOARD_PAN_PX = 60;
const HASH_WRITE_THROTTLE_MS = 400;

export interface AquariumCameraApi {
  cameraRef: MutableRefObject<Camera>;
  lodTierRef: MutableRefObject<LodTier>;
  onWheel: (e: WheelEvent<HTMLCanvasElement>) => void;
  onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLCanvasElement>) => void;
  onDoubleClick: (e: MouseEvent<HTMLCanvasElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLCanvasElement>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetCamera: () => void;
  /** Center a ledger-selected entity and reveal at least the requested detail
   * tier so an off-screen selection always produces visible tank feedback. */
  focusWorldPoint: (x: number, y: number, minZoom: number) => void;
  /** css-px client coords (e.g. a click's clientX/clientY minus the
   *  canvas's bounding-rect origin) -> world coords, at the CURRENT camera. */
  worldFromClientOffset: (cssX: number, cssY: number) => { x: number; y: number };
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

/**
 * Zoom multiplier for one wheel event, proportional to the scroll delta and
 * normalized across deltaMode (pixel / line / page), clamped so a single large
 * event can't jump. Exported for tests. deltaY < 0 (scroll up) zooms in (>1).
 */
export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  viewportHeightPx: number,
): number {
  const px =
    deltaMode === 1
      ? deltaY * LINE_HEIGHT_PX
      : deltaMode === 2
        ? deltaY * viewportHeightPx
        : deltaY;
  const factor = Math.exp(-px * WHEEL_ZOOM_SENSITIVITY);
  return Math.min(WHEEL_ZOOM_MAX_FACTOR, Math.max(WHEEL_ZOOM_MIN_FACTOR, factor));
}

export function useAquariumCamera(viewport: Viewport, onChange?: () => void): AquariumCameraApi {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const cameraRef = useRef<Camera>(homeCamera(viewport));
  const lodTierRef = useRef<LodTier>(lodTier(cameraRef.current.zoom));
  const dragRef = useRef<DragState | null>(null);
  const hashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Commit a new camera: clamp to tank bounds, refresh the cached LOD tier,
  // and notify the caller (reduced-motion's single-paint repaint hook).
  const commit = useCallback((next: Camera) => {
    cameraRef.current = clampCamera(next, viewportRef.current);
    lodTierRef.current = lodTier(cameraRef.current.zoom);
    onChangeRef.current?.();
  }, []);

  // Parse '#cam=x,y,zoom' once on mount — a deep-link (or the snapshot
  // harness) starts the scene at an exact framing instead of the fit-all default.
  useEffect(() => {
    const parsed = parseCameraHash(window.location.hash);
    if (parsed !== null) commit(parsed);
    // Mount-only: this is a one-time deep-link read, not a live subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (hashTimerRef.current !== null) clearTimeout(hashTimerRef.current);
    };
  }, []);

  const writeHashThrottled = useCallback(() => {
    if (hashTimerRef.current !== null) return;
    hashTimerRef.current = setTimeout(() => {
      hashTimerRef.current = null;
      const hash = serializeCameraHash(cameraRef.current);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${hash}`,
      );
    }, HASH_WRITE_THROTTLE_MS);
  }, []);

  const onWheel = useCallback(
    (e: WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode, viewportRef.current.cssHeight);
      commit(
        zoomAtCursor(
          cameraRef.current,
          viewportRef.current,
          e.clientX - rect.left,
          e.clientY - rect.top,
          factor,
        ),
      );
      writeHashThrottled();
    },
    [commit, writeHashThrottled],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== e.pointerId) return;
      const dxCss = e.clientX - drag.lastX;
      const dyCss = e.clientY - drag.lastY;
      dragRef.current = { pointerId: drag.pointerId, lastX: e.clientX, lastY: e.clientY };
      commit(panCamera(cameraRef.current, dxCss, dyCss));
    },
    [commit],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      if (dragRef.current?.pointerId === e.pointerId) {
        dragRef.current = null;
        writeHashThrottled();
      }
    },
    [writeHashThrottled],
  );

  const onDoubleClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      commit(
        zoomAtCursor(
          cameraRef.current,
          viewportRef.current,
          e.clientX - rect.left,
          e.clientY - rect.top,
          DOUBLE_CLICK_ZOOM_FACTOR,
        ),
      );
      writeHashThrottled();
    },
    [commit, writeHashThrottled],
  );

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      commit(zoomAtCursor(cameraRef.current, vp, vp.cssWidth / 2, vp.cssHeight / 2, factor));
      writeHashThrottled();
    },
    [commit, writeHashThrottled],
  );

  const zoomIn = useCallback(() => zoomAtCenter(BUTTON_ZOOM_FACTOR), [zoomAtCenter]);
  const zoomOut = useCallback(() => zoomAtCenter(1 / BUTTON_ZOOM_FACTOR), [zoomAtCenter]);

  const resetCamera = useCallback(() => {
    commit(homeCamera(viewportRef.current));
    writeHashThrottled();
  }, [commit, writeHashThrottled]);

  const focusWorldPoint = useCallback(
    (x: number, y: number, minZoom: number) => {
      commit({ x, y, zoom: Math.max(cameraRef.current.zoom, minZoom) });
      writeHashThrottled();
    },
    [commit, writeHashThrottled],
  );

  const panByKey = useCallback(
    (dxCss: number, dyCss: number) => {
      commit(panCamera(cameraRef.current, dxCss, dyCss));
      writeHashThrottled();
    },
    [commit, writeHashThrottled],
  );

  // Screen-direction pan per arrow key. Right/Down arrows pan the camera
  // toward -x/-y (panCamera's sign convention: dragging content left moves
  // the camera view rightward), so the visual result still matches the key.
  const keyActions = useMemo<Readonly<Record<string, () => void>>>(
    () => ({
      ArrowLeft: () => panByKey(KEYBOARD_PAN_PX, 0),
      ArrowRight: () => panByKey(-KEYBOARD_PAN_PX, 0),
      ArrowUp: () => panByKey(0, KEYBOARD_PAN_PX),
      ArrowDown: () => panByKey(0, -KEYBOARD_PAN_PX),
      '+': () => zoomAtCenter(BUTTON_ZOOM_FACTOR),
      '=': () => zoomAtCenter(BUTTON_ZOOM_FACTOR),
      '-': () => zoomAtCenter(1 / BUTTON_ZOOM_FACTOR),
      Home: resetCamera,
      Escape: resetCamera,
    }),
    [panByKey, zoomAtCenter, resetCamera],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLCanvasElement>) => {
      const action = keyActions[e.key];
      if (action === undefined) return;
      e.preventDefault();
      action();
    },
    [keyActions],
  );

  const worldFromClientOffset = useCallback((cssX: number, cssY: number) => {
    return worldFromScreen(cameraRef.current, viewportRef.current, cssX, cssY);
  }, []);

  return {
    cameraRef,
    lodTierRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    onKeyDown,
    zoomIn,
    zoomOut,
    resetCamera,
    focusWorldPoint,
    worldFromClientOffset,
  };
}
