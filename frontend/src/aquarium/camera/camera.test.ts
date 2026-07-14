import { describe, expect, it } from 'vitest';
import { WORLD, LOD1_ZOOM, LOD2_ZOOM, CAMERA_HASH_PREFIX, type Camera } from '../contracts';
import {
  fitTankCamera,
  homeCamera,
  clampCamera,
  zoomAtCursor,
  panCamera,
  lodTier,
  textAlpha,
  worldFromScreen,
  screenFromWorld,
  parseCameraHash,
  serializeCameraHash,
} from './camera';

const VIEWPORT_1440 = { cssWidth: 1440, cssHeight: 900, dpr: 1 };

describe('fitTankCamera', () => {
  it('fits the whole tank and centers on the world midpoint at a 1440x900 viewport', () => {
    const cam = fitTankCamera(VIEWPORT_1440);
    // documented in contracts.ts: LOD1_ZOOM comment says the fit zoom for a
    // 1440x900 viewport is ~0.36 — pin that exact contract.
    expect(cam.zoom).toBeCloseTo(1440 / WORLD.width, 5);
    expect(cam.zoom).toBeCloseTo(0.36, 2);
    expect(cam.x).toBeCloseTo(WORLD.width / 2, 5);
    expect(cam.y).toBeCloseTo(WORLD.height / 2, 5);
  });

  it('picks the tighter axis so nothing is cropped, for a portrait viewport', () => {
    const cam = fitTankCamera({ cssWidth: 900, cssHeight: 1440, dpr: 1 });
    expect(cam.zoom).toBeCloseTo(900 / WORLD.width, 5);
  });
});

describe('homeCamera (default / reset framing)', () => {
  it('sits closer than the whole-tank fit so overview fish read bigger', () => {
    const home = homeCamera(VIEWPORT_1440);
    const fit = fitTankCamera(VIEWPORT_1440);
    expect(home.zoom).toBeGreaterThan(fit.zoom);
  });

  it('stays below the LOD1 label threshold at any viewport (an unlabelled overview)', () => {
    for (const vp of [
      VIEWPORT_1440,
      { cssWidth: 1920, cssHeight: 1080, dpr: 1 },
      { cssWidth: 3440, cssHeight: 1440, dpr: 1 },
    ]) {
      expect(homeCamera(vp).zoom, `${vp.cssWidth}x${vp.cssHeight}`).toBeLessThan(LOD1_ZOOM);
    }
  });

  it('never zooms out past the fit floor and stays within world bounds', () => {
    const home = homeCamera(VIEWPORT_1440);
    // clamped through clampCamera, so it equals its own clamp (in-bounds)
    expect(home).toEqual(clampCamera(home, VIEWPORT_1440));
    expect(home.zoom).toBeGreaterThanOrEqual(fitTankCamera(VIEWPORT_1440).zoom);
  });
});

describe('worldFromScreen / screenFromWorld roundtrip', () => {
  it('is the identity within floating tolerance for an interior point', () => {
    const cam: Camera = { x: 2000, y: 1100, zoom: 1.5 };
    const world = worldFromScreen(cam, VIEWPORT_1440, 800, 300);
    const screen = screenFromWorld(cam, VIEWPORT_1440, world.x, world.y);
    expect(screen.x).toBeCloseTo(800, 6);
    expect(screen.y).toBeCloseTo(300, 6);
  });

  it('maps the viewport center to the camera focus', () => {
    const cam: Camera = { x: 1234, y: 567, zoom: 2 };
    const world = worldFromScreen(
      cam,
      VIEWPORT_1440,
      VIEWPORT_1440.cssWidth / 2,
      VIEWPORT_1440.cssHeight / 2,
    );
    expect(world.x).toBeCloseTo(cam.x, 6);
    expect(world.y).toBeCloseTo(cam.y, 6);
  });
});

describe('zoomAtCursor', () => {
  it('keeps the world point under the cursor fixed on screen', () => {
    const cam: Camera = { x: 2000, y: 1100, zoom: 1 };
    const cssX = 900;
    const cssY = 400;
    const worldBefore = worldFromScreen(cam, VIEWPORT_1440, cssX, cssY);

    const zoomed = zoomAtCursor(cam, VIEWPORT_1440, cssX, cssY, 1.5);
    expect(zoomed.zoom).toBeCloseTo(1.5, 6);

    const worldAfter = worldFromScreen(zoomed, VIEWPORT_1440, cssX, cssY);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4);
  });

  it('zooming out from a mid-tank camera never exceeds the tank-fit zoom lower bound', () => {
    const cam: Camera = { x: 2000, y: 1100, zoom: 1 };
    const zoomed = zoomAtCursor(cam, VIEWPORT_1440, 720, 450, 0.001);
    expect(zoomed.zoom).toBeGreaterThanOrEqual(fitTankCamera(VIEWPORT_1440).zoom - 1e-9);
  });
});

describe('panCamera', () => {
  it('moves world coordinates opposite to a positive screen-space drag', () => {
    const cam: Camera = { x: 2000, y: 1100, zoom: 1 };
    const panned = panCamera(cam, 100, 40);
    expect(panned.x).toBeLessThan(cam.x);
    expect(panned.y).toBeLessThan(cam.y);
    expect(panned.zoom).toBe(cam.zoom);
  });

  it('scales the world-space pan delta by the inverse of zoom', () => {
    const cam: Camera = { x: 2000, y: 1100, zoom: 2 };
    const panned = panCamera(cam, 100, 0);
    expect(cam.x - panned.x).toBeCloseTo(50, 6);
  });
});

describe('clampCamera', () => {
  it('leaves an already-in-bounds camera untouched', () => {
    const cam: Camera = { x: 2000, y: 1100, zoom: 1 };
    const clamped = clampCamera(cam, VIEWPORT_1440);
    expect(clamped).toEqual(cam);
  });

  it('centers the camera when the viewport shows more than the whole tank', () => {
    const cam: Camera = { x: 50, y: 50, zoom: fitTankCamera(VIEWPORT_1440).zoom };
    const clamped = clampCamera(cam, VIEWPORT_1440);
    expect(clamped.x).toBeCloseTo(WORLD.width / 2, 5);
  });

  it('never lets the visible rect cross the world edge at high zoom', () => {
    const cam: Camera = { x: -500, y: -500, zoom: 3 };
    const clamped = clampCamera(cam, VIEWPORT_1440);
    const halfWidthWu = VIEWPORT_1440.cssWidth / 2 / clamped.zoom;
    const halfHeightWu = VIEWPORT_1440.cssHeight / 2 / clamped.zoom;
    expect(clamped.x - halfWidthWu).toBeGreaterThanOrEqual(-1e-6);
    expect(clamped.y - halfHeightWu).toBeGreaterThanOrEqual(-1e-6);
    expect(clamped.x + halfWidthWu).toBeLessThanOrEqual(WORLD.width + 1e-6);
    expect(clamped.y + halfHeightWu).toBeLessThanOrEqual(WORLD.height + 1e-6);
  });
});

describe('lodTier', () => {
  it('is 0 below LOD1_ZOOM', () => {
    expect(lodTier(LOD1_ZOOM - 0.01)).toBe(0);
  });
  it('is 1 at and above LOD1_ZOOM but below LOD2_ZOOM', () => {
    expect(lodTier(LOD1_ZOOM)).toBe(1);
    expect(lodTier(LOD2_ZOOM - 0.01)).toBe(1);
  });
  it('is 2 at and above LOD2_ZOOM', () => {
    expect(lodTier(LOD2_ZOOM)).toBe(2);
    expect(lodTier(LOD2_ZOOM + 5)).toBe(2);
  });
});

describe('textAlpha', () => {
  it('tier 0 is always fully visible (no gating threshold)', () => {
    expect(textAlpha(0.01, 0)).toBe(1);
    expect(textAlpha(5, 0)).toBe(1);
  });

  it('is monotonically non-decreasing in zoom for tier 1 and tier 2', () => {
    const samplesZoom = [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.5, 2, 2.2, 3, 5];
    for (const tier of [1, 2] as const) {
      let prev = -Infinity;
      for (const z of samplesZoom) {
        const a = textAlpha(z, tier);
        expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        prev = a;
      }
    }
  });

  it('reaches full opacity by its own threshold zoom', () => {
    expect(textAlpha(LOD1_ZOOM, 1)).toBeCloseTo(1, 6);
    expect(textAlpha(LOD2_ZOOM, 2)).toBeCloseTo(1, 6);
  });

  it('is fully transparent well below its threshold', () => {
    expect(textAlpha(0, 1)).toBe(0);
    expect(textAlpha(0.5, 2)).toBe(0);
  });
});

describe('camera hash roundtrip', () => {
  it('serializes with the documented prefix and 2dp rounding', () => {
    const cam: Camera = { x: 1234.5678, y: -9.001, zoom: 1.23456 };
    const hash = serializeCameraHash(cam);
    expect(hash).toBe(`${CAMERA_HASH_PREFIX}1234.57,-9,1.23`);
  });

  it('parses what it serialized back to the rounded value', () => {
    const cam: Camera = { x: 1234.5678, y: -9.001, zoom: 1.23456 };
    const parsed = parseCameraHash(serializeCameraHash(cam));
    expect(parsed).not.toBeNull();
    expect(parsed?.x).toBeCloseTo(1234.57, 6);
    expect(parsed?.y).toBeCloseTo(-9, 6);
    expect(parsed?.zoom).toBeCloseTo(1.23, 6);
  });

  it('returns null for a missing prefix, wrong arity, or non-finite fields', () => {
    expect(parseCameraHash('')).toBeNull();
    expect(parseCameraHash('#cam=1,2')).toBeNull();
    expect(parseCameraHash('#cam=1,2,3,4')).toBeNull();
    expect(parseCameraHash('#cam=a,2,3')).toBeNull();
    expect(parseCameraHash('#foo=1,2,3')).toBeNull();
    expect(parseCameraHash('#cam=1,2,0')).toBeNull();
    expect(parseCameraHash('#cam=1,2,-1')).toBeNull();
  });
});
