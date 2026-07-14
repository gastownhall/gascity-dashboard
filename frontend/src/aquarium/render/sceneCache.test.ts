import { describe, expect, it } from 'vitest';
import type { Camera, RigFormation, ScenePalette, Viewport } from '../contracts';
import { buildScenePalette } from './palette';
import { type BakeKey, needsRebake } from './sceneCache';

const TOKENS: Record<string, string> = {
  surface: '96% 0.012 75',
  fg: '18% 0.012 75',
  'fg-muted': '42% 0.014 75',
  'fg-faint': '52% 0.014 75',
  rule: '80% 0.012 75',
  accent: '40% 0.13 25',
  ok: '50% 0.085 150',
  warn: '60% 0.14 60',
};
const PALETTE: ScenePalette = buildScenePalette('light', TOKENS, 'serif');
const VIEWPORT: Viewport = { cssWidth: 1440, cssHeight: 900, dpr: 1 };
const FORMATIONS: RigFormation[] = [
  { key: 'reef-a', anchorX: 1000, anchorY: 1850, radius: 200, seed: 3, openBeadTotal: 4 },
];
const MARGIN = 320;

function keyAt(camera: Camera): BakeKey {
  return {
    camX: camera.x,
    camY: camera.y,
    zoom: camera.zoom,
    cssWidth: VIEWPORT.cssWidth,
    cssHeight: VIEWPORT.cssHeight,
    dpr: VIEWPORT.dpr,
    palette: PALETTE,
    formations: FORMATIONS,
    reducedMotion: false,
  };
}

const CAM: Camera = { x: 1000, y: 1200, zoom: 1 };

describe('needsRebake (offscreen cache invalidation rule)', () => {
  it('always rebakes when there is no prior bake', () => {
    expect(needsRebake(null, CAM, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
  });

  it('does NOT rebake when nothing changed', () => {
    expect(needsRebake(keyAt(CAM), CAM, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(false);
  });

  it('rebakes on any zoom change (baked pixels are scale-specific)', () => {
    const moved: Camera = { ...CAM, zoom: 1.0001 };
    expect(needsRebake(keyAt(CAM), moved, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
  });

  it('does NOT rebake for a pan within the margin', () => {
    // pan of MARGIN / zoom world units → exactly the margin in screen px
    const within: Camera = { ...CAM, x: CAM.x + (MARGIN - 1) / CAM.zoom };
    expect(needsRebake(keyAt(CAM), within, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(
      false,
    );
  });

  it('rebakes once a pan exceeds the margin on either axis', () => {
    const farX: Camera = { ...CAM, x: CAM.x + (MARGIN + 1) / CAM.zoom };
    const farY: Camera = { ...CAM, y: CAM.y + (MARGIN + 1) / CAM.zoom };
    expect(needsRebake(keyAt(CAM), farX, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
    expect(needsRebake(keyAt(CAM), farY, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
  });

  it('scales the pan threshold with zoom (screen-space margin)', () => {
    const key = keyAt({ ...CAM, zoom: 2 });
    // at zoom 2 the same world pan is twice the screen delta: half the world
    // slack before a rebake
    const within: Camera = { x: CAM.x + (MARGIN - 2) / 2, y: CAM.y, zoom: 2 };
    const beyond: Camera = { x: CAM.x + (MARGIN + 2) / 2, y: CAM.y, zoom: 2 };
    expect(needsRebake(key, within, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(false);
    expect(needsRebake(key, beyond, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
  });

  it('rebakes on viewport, dpr, palette, formation-set or reduced-motion change', () => {
    const key = keyAt(CAM);
    expect(
      needsRebake(key, CAM, { ...VIEWPORT, cssWidth: 1441 }, PALETTE, FORMATIONS, false, MARGIN),
    ).toBe(true);
    expect(needsRebake(key, CAM, { ...VIEWPORT, dpr: 2 }, PALETTE, FORMATIONS, false, MARGIN)).toBe(
      true,
    );
    const otherPalette = buildScenePalette('dark', TOKENS, 'serif');
    expect(needsRebake(key, CAM, VIEWPORT, otherPalette, FORMATIONS, false, MARGIN)).toBe(true);
    expect(needsRebake(key, CAM, VIEWPORT, PALETTE, [...FORMATIONS], false, MARGIN)).toBe(true);
    expect(needsRebake(key, CAM, VIEWPORT, PALETTE, FORMATIONS, true, MARGIN)).toBe(true);
  });
});
