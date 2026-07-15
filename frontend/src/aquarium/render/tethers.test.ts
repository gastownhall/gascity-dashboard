import { describe, expect, it } from 'vitest';
import type { PelletEntity, ScenePalette, SimState } from '../contracts';
import type { ViewRect } from './layers';
import { buildScenePalette } from './palette';
import { paintTethers } from './tethers';

const TOKENS: Record<string, string> = {
  fg: '18% 0.012 75',
  'fg-muted': '42% 0.014 75',
  ok: '50% 0.085 150',
  warn: '60% 0.14 60',
};
const PALETTE: ScenePalette = buildScenePalette('dark', TOKENS, 'serif');
const WIDE_VIEW: ViewRect = { left: -1e5, top: -1e5, right: 1e5, bottom: 1e5 };

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; segments: Seg[] } {
  const segments: Seg[] = [];
  let cur = { x: 0, y: 0 };
  const stub = {
    beginPath(): void {},
    moveTo(x: number, y: number): void {
      cur = { x, y };
    },
    lineTo(x: number, y: number): void {
      segments.push({ ax: cur.x, ay: cur.y, bx: x, by: y });
      cur = { x, y };
    },
    stroke(): void {},
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, segments };
}

function pellet(
  over: Partial<PelletEntity> & Pick<PelletEntity, 'beadId' | 'state'>,
): PelletEntity {
  return {
    label: over.beadId,
    title: '',
    linkTo: '',
    rigKey: 'alpha',
    ageFraction: 0,
    radiusScale: 1,
    ...over,
  };
}

const SIM: SimState = {
  fish: { f1: { x: 100, y: 200, heading: 0, speed: 0, phase: 0 } },
  pellets: {
    'held-1': { x: 150, y: 200, phase: 0 },
    'drift-1': { x: 300, y: 300, phase: 0 },
    'sunk-1': { x: 400, y: 900, phase: 0 },
    'held-stale': { x: 500, y: 500, phase: 0 },
  },
  clockMs: 0,
};

describe('paintTethers', () => {
  it('draws one hairline from a working fish to its held bead', () => {
    const pellets: PelletEntity[] = [pellet({ beadId: 'held-1', state: 'held', fishId: 'f1' })];
    const { ctx, segments } = recordingCtx();
    paintTethers(ctx, pellets, SIM, PALETTE, WIDE_VIEW, 1);
    expect(segments).toEqual([{ ax: 100, ay: 200, bx: 150, by: 200 }]);
  });

  it('tethers ONLY held beads — open/blocked pellets get no line', () => {
    const pellets: PelletEntity[] = [
      pellet({ beadId: 'drift-1', state: 'drifting' }),
      pellet({ beadId: 'sunk-1', state: 'sunken' }),
    ];
    const { ctx, segments } = recordingCtx();
    paintTethers(ctx, pellets, SIM, PALETTE, WIDE_VIEW, 1);
    expect(segments).toHaveLength(0);
  });

  it('skips a held bead whose holder is unresolved or missing from sim', () => {
    const pellets: PelletEntity[] = [
      pellet({ beadId: 'held-1', state: 'held' }), // no fishId
      pellet({ beadId: 'held-stale', state: 'held', fishId: 'ghost' }), // fish not in sim
    ];
    const { ctx, segments } = recordingCtx();
    paintTethers(ctx, pellets, SIM, PALETTE, WIDE_VIEW, 1);
    expect(segments).toHaveLength(0);
  });

  it('culls a tether whose bead is outside the view rect', () => {
    const pellets: PelletEntity[] = [pellet({ beadId: 'held-1', state: 'held', fishId: 'f1' })];
    const tinyView: ViewRect = { left: 0, top: 0, right: 120, bottom: 220 }; // excludes x=150
    const { ctx, segments } = recordingCtx();
    paintTethers(ctx, pellets, SIM, PALETTE, tinyView, 1);
    expect(segments).toHaveLength(0);
  });
});
