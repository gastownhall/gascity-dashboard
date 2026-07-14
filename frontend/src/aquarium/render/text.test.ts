import { describe, expect, it } from 'vitest';
import type { Camera, ScenePalette, SimState, Viewport, WorldSnapshot } from '../contracts';
import { buildScenePalette } from './palette';
import { paintTextLayers } from './text';

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
}

/** minimal canvas double: records fillText, swallows transforms + style sets */
function recordingCtx(): { ctx: CanvasRenderingContext2D; drawn: DrawnText[] } {
  const drawn: DrawnText[] = [];
  const stub = {
    setTransform(): void {},
    fillText(text: string, x: number, y: number): void {
      drawn.push({ text, x, y });
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
