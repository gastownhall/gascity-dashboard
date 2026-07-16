import { describe, expect, it } from 'vitest';
import type { FlowObservation, RigFormation, ScenePalette } from '../contracts';
import type { ViewRect } from './layers';
import { buildScenePalette } from './palette';
import { paintRecentRigMovement } from './rigMovement';

const PALETTE: ScenePalette = buildScenePalette(
  'dark',
  {
    fg: '18% 0.012 75',
    'fg-muted': '42% 0.014 75',
    ok: '50% 0.085 150',
    warn: '60% 0.14 60',
  },
  'serif',
);
const VIEW: ViewRect = { left: 0, top: 0, right: 4_000, bottom: 2_250 };
const FORMATION: RigFormation = {
  key: 'alpha',
  anchorX: 900,
  anchorY: 1_900,
  radius: 240,
  seed: 3,
  openBeadTotal: 4,
};
const FLOW: FlowObservation = {
  observedForMs: 6_000,
  windowMs: 60_000,
  observedRigCount: 1,
  totalRigCount: 1,
  backloggedRigCount: 1,
  movingRigCount: 1,
  stillRigKeys: [],
  p0Waiting: 0,
  recentlyMovingRigKeys: ['alpha'],
};

function recordingContext() {
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  let fillCount = 0;
  let strokeCount = 0;
  const stub = {
    beginPath(): void {},
    arc(x: number, y: number, radius: number): void {
      arcs.push({ x, y, radius });
    },
    moveTo(): void {},
    fill(): void {
      fillCount += 1;
    },
    stroke(): void {
      strokeCount += 1;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  };
  return {
    ctx: stub as unknown as CanvasRenderingContext2D,
    arcs,
    fillCount: () => fillCount,
    strokeCount: () => strokeCount,
  };
}

describe('paintRecentRigMovement', () => {
  it('draws one fixed three-bubble trail above each recently moving rig', () => {
    const recorded = recordingContext();
    paintRecentRigMovement(recorded.ctx, FLOW, [FORMATION], PALETTE, VIEW, 1);

    expect(recorded.arcs).toHaveLength(3);
    expect(recorded.fillCount()).toBe(0);
    expect(recorded.strokeCount()).toBe(1);
    expect(recorded.arcs.every((arc) => arc.y < FORMATION.anchorY)).toBe(true);
  });

  it('keeps the cue legible at overview zoom', () => {
    const recorded = recordingContext();
    paintRecentRigMovement(recorded.ctx, FLOW, [FORMATION], PALETTE, VIEW, 0.36);

    expect(recorded.arcs.every((arc) => arc.radius * 0.36 >= 3.25)).toBe(true);
  });

  it('skips rigs without recent movement, formations, or viewport presence', () => {
    const recorded = recordingContext();
    paintRecentRigMovement(
      recorded.ctx,
      { ...FLOW, recentlyMovingRigKeys: ['missing', 'offscreen'] },
      [{ ...FORMATION, key: 'offscreen', anchorX: -100 }],
      PALETTE,
      VIEW,
      1,
    );

    expect(recorded.arcs).toEqual([]);
    expect(recorded.fillCount()).toBe(0);
  });

  it('uses a neutral fallback for the city stratum and resets canvas alpha', () => {
    const recorded = recordingContext();
    paintRecentRigMovement(
      recorded.ctx,
      { ...FLOW, recentlyMovingRigKeys: ['city'] },
      [{ ...FORMATION, key: 'city' }],
      PALETTE,
      VIEW,
      1,
    );

    expect(recorded.ctx.strokeStyle).toBe(PALETTE.textMuted);
    expect(recorded.ctx.globalAlpha).toBe(1);
  });
});
