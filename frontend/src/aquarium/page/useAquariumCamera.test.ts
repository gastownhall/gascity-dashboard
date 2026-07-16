import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOD1_ZOOM, type Viewport } from '../contracts';
import { useAquariumCamera, wheelZoomFactor } from './useAquariumCamera';

const VIEWPORT: Viewport = { cssWidth: 1200, cssHeight: 800, dpr: 1 };

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('useAquariumCamera', () => {
  it('centers a selected entity and raises the camera to the requested detail tier', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAquariumCamera(VIEWPORT, onChange));

    act(() => result.current.focusWorldPoint(2_400, 1_100, LOD1_ZOOM));

    expect(result.current.cameraRef.current).toMatchObject({
      x: 2_400,
      y: 1_100,
      zoom: LOD1_ZOOM,
    });
    expect(result.current.lodTierRef.current).toBe(1);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('supports pointer pan, wheel zoom, double-click zoom, and coordinate conversion', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAquariumCamera(VIEWPORT));
    const target = {
      setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 10, top: 20 }),
    };
    const start = { ...result.current.cameraRef.current };

    act(() => {
      result.current.onPointerMove(pointerEvent(target, { pointerId: 99, clientX: 0, clientY: 0 }));
      result.current.onPointerDown(
        pointerEvent(target, { pointerId: 7, clientX: 100, clientY: 100 }),
      );
      result.current.onPointerMove(
        pointerEvent(target, { pointerId: 8, clientX: 120, clientY: 120 }),
      );
      result.current.onPointerMove(
        pointerEvent(target, { pointerId: 7, clientX: 140, clientY: 115 }),
      );
      result.current.onPointerUp(pointerEvent(target, { pointerId: 8 }));
      result.current.onPointerUp(pointerEvent(target, { pointerId: 7 }));
    });
    expect(target.setPointerCapture).toHaveBeenCalledWith(7);
    expect(result.current.cameraRef.current).not.toEqual(start);

    const afterPan = result.current.cameraRef.current.zoom;
    const wheelTarget = document.createElement('canvas');
    vi.spyOn(wheelTarget, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
    } as DOMRect);
    act(() =>
      result.current.onWheel(
        wheelEvent(wheelTarget, { deltaY: -100, deltaMode: 0, clientX: 610, clientY: 420 }),
      ),
    );
    expect(result.current.cameraRef.current.zoom).toBeGreaterThan(afterPan);

    const afterWheel = result.current.cameraRef.current.zoom;
    act(() => result.current.onDoubleClick(mouseEvent(target, { clientX: 610, clientY: 420 })));
    expect(result.current.cameraRef.current.zoom).toBeGreaterThan(afterWheel);
    expect(result.current.worldFromClientOffset(600, 400)).toEqual({
      x: result.current.cameraRef.current.x,
      y: result.current.cameraRef.current.y,
    });
  });

  it('supports keyboard and button camera controls without claiming unrelated keys', () => {
    const { result } = renderHook(() => useAquariumCamera(VIEWPORT));
    const ignoredPrevent = vi.fn();
    act(() => result.current.onKeyDown(keyEvent('x', ignoredPrevent)));
    expect(ignoredPrevent).not.toHaveBeenCalled();

    const handledKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'];
    for (const key of handledKeys) {
      const preventDefault = vi.fn();
      act(() => result.current.onKeyDown(keyEvent(key, preventDefault)));
      expect(preventDefault, key).toHaveBeenCalledOnce();
    }

    const home = { ...result.current.cameraRef.current };
    act(() => {
      result.current.zoomIn();
      result.current.zoomOut();
      result.current.resetCamera();
    });
    expect(result.current.cameraRef.current).toEqual(home);
  });

  it('loads a deep-linked camera and writes a throttled focus hash', () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/#cam=2000,1100,1.1');
    const { result, unmount } = renderHook(() => useAquariumCamera(VIEWPORT));
    expect(result.current.cameraRef.current).toMatchObject({ x: 2_000, y: 1_100, zoom: 1.1 });

    act(() => {
      result.current.focusWorldPoint(2_100, 1_200, LOD1_ZOOM);
      result.current.focusWorldPoint(2_200, 1_300, LOD1_ZOOM);
      vi.runAllTimers();
    });
    expect(window.location.hash).toBe('#cam=2200,1300,1.1');

    act(() => result.current.focusWorldPoint(2_300, 1_400, LOD1_ZOOM));
    unmount();
  });
});

function pointerEvent(
  currentTarget: object,
  fields: Partial<PointerEvent<HTMLCanvasElement>>,
): PointerEvent<HTMLCanvasElement> {
  return { currentTarget, ...fields } as unknown as PointerEvent<HTMLCanvasElement>;
}

function wheelEvent(
  currentTarget: HTMLCanvasElement,
  fields: Partial<globalThis.WheelEvent>,
): globalThis.WheelEvent {
  return {
    currentTarget,
    preventDefault: vi.fn(),
    ...fields,
  } as unknown as globalThis.WheelEvent;
}

function mouseEvent(
  currentTarget: object,
  fields: Partial<MouseEvent<HTMLCanvasElement>>,
): MouseEvent<HTMLCanvasElement> {
  return { currentTarget, ...fields } as unknown as MouseEvent<HTMLCanvasElement>;
}

function keyEvent(key: string, preventDefault: () => void): KeyboardEvent<HTMLCanvasElement> {
  return { key, preventDefault } as KeyboardEvent<HTMLCanvasElement>;
}

// Wheel zoom must be PROPORTIONAL to the scroll delta (not a fixed step per
// event), so trackpads / momentum scroll stay controllable instead of
// compounding to an uncontrollable zoom.
describe('wheelZoomFactor', () => {
  const VH = 900;

  it('zooms in for scroll-up (deltaY < 0) and out for scroll-down', () => {
    expect(wheelZoomFactor(-100, 0, VH)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, VH)).toBeLessThan(1);
  });

  it('is proportional: a bigger delta zooms more than a small one', () => {
    const small = wheelZoomFactor(-20, 0, VH);
    const big = wheelZoomFactor(-120, 0, VH);
    expect(small).toBeGreaterThan(1);
    expect(big).toBeGreaterThan(small);
  });

  it('is gentle for a typical mouse notch (~100px) — well under the old fixed 1.4x', () => {
    expect(wheelZoomFactor(-100, 0, VH)).toBeLessThan(1.2);
  });

  it('clamps a single huge event so it cannot jump', () => {
    expect(wheelZoomFactor(-100000, 0, VH)).toBeLessThanOrEqual(2);
    expect(wheelZoomFactor(100000, 0, VH)).toBeGreaterThanOrEqual(0.5);
  });

  it('normalizes deltaMode: line (1) and page (2) scale up vs raw pixels', () => {
    // One line (deltaMode 1) is worth LINE_HEIGHT_PX pixels; one page is a
    // whole viewport — both should zoom more than a single raw-pixel unit.
    expect(wheelZoomFactor(-1, 1, VH)).toBeGreaterThan(wheelZoomFactor(-1, 0, VH));
    expect(wheelZoomFactor(-1, 2, VH)).toBeGreaterThan(wheelZoomFactor(-1, 1, VH));
  });
});
