import { describe, expect, it } from 'vitest';
import type { PelletEntity, ScenePalette, SimState } from '../contracts';
import { LOD2_ZOOM } from '../contracts';
import type { ViewRect } from './layers';
import { buildScenePalette } from './palette';
import { paintDepLinks } from './depLinks';
import { driftKeepCount, pelletVisibleAtLod } from './pellets';

const TOKENS: Record<string, string> = {
  fg: '18% 0.012 75',
  'fg-muted': '42% 0.014 75',
  ok: '50% 0.085 150',
  warn: '60% 0.14 60',
};
const PALETTE: ScenePalette = buildScenePalette('dark', TOKENS, 'serif');
const WIDE: ViewRect = { left: -1e5, top: -1e5, right: 1e5, bottom: 1e5 };

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
function recordingCtx(): {
  ctx: CanvasRenderingContext2D;
  segments: Seg[];
  strokeDash: () => number[];
} {
  const segments: Seg[] = [];
  let cur = { x: 0, y: 0 };
  let dash: number[] = [];
  let dashAtStroke: number[] = [];
  const stub = {
    beginPath(): void {},
    moveTo(x: number, y: number): void {
      cur = { x, y };
    },
    lineTo(x: number, y: number): void {
      segments.push({ ax: cur.x, ay: cur.y, bx: x, by: y });
      cur = { x, y };
    },
    setLineDash(d: number[]): void {
      dash = d;
    },
    stroke(): void {
      dashAtStroke = [...dash];
    },
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
  };
  return {
    ctx: stub as unknown as CanvasRenderingContext2D,
    segments,
    strokeDash: () => dashAtStroke,
  };
}

function pellet(over: Partial<PelletEntity> & Pick<PelletEntity, 'beadId'>): PelletEntity {
  return {
    label: over.beadId,
    title: '',
    linkTo: '',
    rigKey: 'alpha',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1,
    ...over,
  };
}

const SIM: SimState = {
  fish: {},
  pellets: {
    sel: { x: 100, y: 100, phase: 0 },
    dep1: { x: 200, y: 200, phase: 0 },
    dep2: { x: 300, y: 300, phase: 0 },
    offscreen: { x: 9e5, y: 9e5, phase: 0 },
  },
  clockMs: 0,
};

describe('paintDepLinks (focus-only dependency links)', () => {
  it('draws a dashed link from the selected pellet to each in-view dependency', () => {
    const pellets = [
      pellet({ beadId: 'sel', dependsOn: ['dep1', 'dep2'] }),
      pellet({ beadId: 'dep1' }),
      pellet({ beadId: 'dep2' }),
    ];
    const { ctx, segments, strokeDash } = recordingCtx();
    // selection happens at LOD2, where nothing is thinned
    paintDepLinks(ctx, 'sel', pellets, SIM, PALETTE, WIDE, LOD2_ZOOM);
    expect(segments).toEqual([
      { ax: 100, ay: 100, bx: 200, by: 200 },
      { ax: 100, ay: 100, bx: 300, by: 300 },
    ]);
    // dashed, so it never reads as the solid fish<->bead tether
    expect(strokeDash().length).toBeGreaterThan(0);
  });

  it('draws nothing when no pellet is selected', () => {
    const pellets = [pellet({ beadId: 'sel', dependsOn: ['dep1'] }), pellet({ beadId: 'dep1' })];
    const { ctx, segments } = recordingCtx();
    paintDepLinks(ctx, null, pellets, SIM, PALETTE, WIDE, 1);
    expect(segments).toHaveLength(0);
  });

  it('draws nothing when the selected pellet has no dependencies', () => {
    const { ctx, segments } = recordingCtx();
    paintDepLinks(ctx, 'sel', [pellet({ beadId: 'sel' })], SIM, PALETTE, WIDE, 1);
    expect(segments).toHaveLength(0);
  });

  it('skips a dependency with no on-screen pellet (closed, uncapped, or off view)', () => {
    const pellets = [
      pellet({ beadId: 'sel', dependsOn: ['dep1', 'offscreen', 'ghost'] }),
      pellet({ beadId: 'dep1' }),
    ];
    const tinyView: ViewRect = { left: 0, top: 0, right: 250, bottom: 250 };
    const { ctx, segments } = recordingCtx();
    paintDepLinks(ctx, 'sel', pellets, SIM, PALETTE, tinyView, LOD2_ZOOM);
    // dep1 (200,200) is in view; 'offscreen' is far; 'ghost' has no sim pellet
    expect(segments).toEqual([{ ax: 100, ay: 100, bx: 200, by: 200 }]);
  });

  it('gates endpoints through LOD thinning — no link to a dep the overview thinned away', () => {
    const OVERVIEW = 0.5; // below LOD1 → drifting backlog sampled to ~1/6
    // a drifting dep id that IS thinned at the overview keep count
    const depId = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].find(
      (id) => !pelletVisibleAtLod(pellet({ beadId: id }), driftKeepCount(OVERVIEW)),
    )!;
    // a held selected pellet always draws, so only the dep's visibility is under test
    const pellets = [
      pellet({ beadId: 'sel', state: 'held', dependsOn: [depId] }),
      pellet({ beadId: depId }),
    ];
    const sim: SimState = {
      fish: {},
      pellets: { sel: { x: 100, y: 100, phase: 0 }, [depId]: { x: 200, y: 200, phase: 0 } },
      clockMs: 0,
    };
    const overview = recordingCtx();
    paintDepLinks(overview.ctx, 'sel', pellets, sim, PALETTE, WIDE, OVERVIEW);
    expect(overview.segments).toHaveLength(0); // dep thinned away → no dangling line
    const closeUp = recordingCtx();
    paintDepLinks(closeUp.ctx, 'sel', pellets, sim, PALETTE, WIDE, LOD2_ZOOM);
    expect(closeUp.segments).toHaveLength(1); // at LOD2 the dep is drawn → link appears
  });
});
