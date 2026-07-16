import { describe, expect, it } from 'vitest';
import type { FlowObservation, RigFormation, ScenePalette } from '../contracts';
import type { ViewRect } from './layers';
import { buildScenePalette } from './palette';
import { paintFlowReceipts } from './flowReceipts';

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
const VIEW: ViewRect = { left: 0, top: 0, right: 4000, bottom: 2250 };
const FORMATION: RigFormation = {
  key: 'alpha',
  anchorX: 900,
  anchorY: 1900,
  radius: 240,
  seed: 3,
  openBeadTotal: 4,
};

function flow(kind: 'pickup' | 'completion', ageMsAtSnapshot = 1_000): FlowObservation {
  return {
    observedForMs: 6_000,
    windowMs: 60_000,
    backloggedRigCount: 1,
    movingRigCount: 1,
    stillRigKeys: [],
    p0Waiting: 0,
    receipts: [
      {
        id: `${kind}-1`,
        beadId: 'b1',
        rigKey: 'alpha',
        kind,
        observedAtOffsetMs: 5_000,
        ageMsAtSnapshot,
      },
    ],
  };
}

function recordingContext() {
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  const stub = {
    beginPath(): void {},
    arc(x: number, y: number, radius: number): void {
      arcs.push({ x, y, radius });
    },
    stroke(): void {},
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, arcs };
}

describe('paintFlowReceipts', () => {
  it('draws one rig-anchored ring for pickup and two for completion', () => {
    const pickup = recordingContext();
    paintFlowReceipts(pickup.ctx, flow('pickup'), [FORMATION], PALETTE, VIEW, 1, 6_000, false);
    const completion = recordingContext();
    paintFlowReceipts(
      completion.ctx,
      flow('completion'),
      [FORMATION],
      PALETTE,
      VIEW,
      1,
      6_000,
      false,
    );

    expect(pickup.arcs).toHaveLength(1);
    expect(completion.arcs).toHaveLength(2);
    expect(pickup.arcs[0]?.x).toBe(FORMATION.anchorX);
    expect(pickup.arcs[0]?.y).toBeLessThan(FORMATION.anchorY);
  });

  it('freezes at snapshot age under reduced motion', () => {
    const early = recordingContext();
    const late = recordingContext();
    paintFlowReceipts(early.ctx, flow('pickup'), [FORMATION], PALETTE, VIEW, 1, 6_000, true);
    paintFlowReceipts(late.ctx, flow('pickup'), [FORMATION], PALETTE, VIEW, 1, 60_000, true);
    expect(late.arcs).toEqual(early.arcs);
  });
});
