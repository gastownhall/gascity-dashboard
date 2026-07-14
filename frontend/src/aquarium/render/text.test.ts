import { describe, expect, it } from 'vitest';
import type { Camera, ScenePalette, SimState, Viewport, WorldSnapshot } from '../contracts';
import { UNRIGGED_KEY } from '../contracts';
import { buildScenePalette } from './palette';
import { paintTextLayers } from './text';
import { parseOklch } from './oklch';
import { rigHue } from './rigHue';

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

interface DrawnText {
  text: string;
  x: number;
  y: number;
  fillStyle: string;
}

/** minimal canvas double: records fillText (with the fillStyle in force at draw
 * time), swallows transforms + style sets */
function recordingCtx(): { ctx: CanvasRenderingContext2D; drawn: DrawnText[] } {
  const drawn: DrawnText[] = [];
  const stub = {
    setTransform(): void {},
    fillText(text: string, x: number, y: number): void {
      drawn.push({ text, x, y, fillStyle: this.fillStyle });
    },
    textBaseline: 'alphabetic',
    textAlign: 'left',
    font: '',
    fillStyle: '',
    globalAlpha: 1,
    letterSpacing: '0px',
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, drawn };
}

const SNAPSHOT: WorldSnapshot = {
  formations: [
    { key: 'reef-gamma', anchorX: 1000, anchorY: 1850, radius: 220, seed: 7, openBeadTotal: 46 },
  ],
  fish: [],
  pellets: [],
  needsAttention: 0,
  pelletOverflow: {},
};
const EMPTY_SIM: SimState = { fish: {}, pellets: {}, clockMs: 0 };

function drawAt(zoom: number): DrawnText[] {
  const { ctx, drawn } = recordingCtx();
  const camera: Camera = { x: 1000, y: 1850, zoom };
  paintTextLayers(ctx, SNAPSHOT, EMPTY_SIM, PALETTE, camera, VIEWPORT);
  return drawn;
}

describe('rig labels across zoom (map labels at the working overview)', () => {
  it('draws NO rig name/count at the fully zoomed-out whole tank (fit ≈ 0.36)', () => {
    // the full zoom-out reef stays unlabeled so it never reads as categorical bars
    const drawn = drawAt(0.36);
    const rigText = drawn.filter((d) => d.text.includes('REEF-GAMMA'));
    expect(rigText, JSON.stringify(drawn)).toHaveLength(0);
  });

  it('names the rig at the default home framing (~0.5), so projects read without deep zoom', () => {
    const drawn = drawAt(0.5);
    expect(drawn.some((d) => d.text === 'REEF-GAMMA · 46')).toBe(true);
  });

  it('keeps the rig name + open-bead count on as the operator zooms further in', () => {
    const drawn = drawAt(1.0);
    expect(drawn.some((d) => d.text === 'REEF-GAMMA · 46')).toBe(true);
  });
});

const HUE_SNAPSHOT: WorldSnapshot = {
  formations: [
    { key: 'cension', anchorX: 1000, anchorY: 1850, radius: 220, seed: 7, openBeadTotal: 12 },
    { key: UNRIGGED_KEY, anchorX: 1000, anchorY: 1850, radius: 220, seed: 3, openBeadTotal: 5 },
  ],
  fish: [],
  pellets: [],
  needsAttention: 0,
  pelletOverflow: {},
};

describe('rig label colour carries rig identity in-scene', () => {
  const camera: Camera = { x: 1000, y: 1850, zoom: 0.5 };

  it("draws a rig's overview label in that rig's own hue, so colour↔name reads without zoom", () => {
    const { ctx, drawn } = recordingCtx();
    paintTextLayers(ctx, HUE_SNAPSHOT, EMPTY_SIM, PALETTE, camera, VIEWPORT);
    const label = drawn.find((d) => d.text.startsWith('CENSION'));
    expect(label).toBeDefined();
    const hue = rigHue('cension');
    expect(hue).not.toBeNull();
    expect(parseOklch(label!.fillStyle).h).toBeCloseTo(hue!, 5);
  });

  it('keeps unrigged/city strata neutral (the muted text colour, no hue tint)', () => {
    const { ctx, drawn } = recordingCtx();
    paintTextLayers(ctx, HUE_SNAPSHOT, EMPTY_SIM, PALETTE, camera, VIEWPORT);
    const label = drawn.find((d) => d.text.startsWith(UNRIGGED_KEY.toUpperCase()));
    expect(label).toBeDefined();
    expect(label!.fillStyle).toBe(PALETTE.textMuted);
  });
});
