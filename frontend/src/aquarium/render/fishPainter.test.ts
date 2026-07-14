import { describe, expect, it } from 'vitest';
import type { FishEntity, ScenePalette, SimState } from '../contracts';
import { buildScenePalette } from './palette';
import { fishDepthZ } from './depth';
import { RICH_FISH_BUDGET, paintFishLayer, usesRichFishPath } from './fishPainter';
import type { LayerTransform } from './layers';

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
// small scale → every fish takes the cheap flat path (no gradients needed)
const LAYER: LayerTransform = { scale: 0.1, tx: 0, ty: 0, dpr: 1 };
const VIEW = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };

function fish(id: string): FishEntity {
  return {
    id,
    name: id,
    species: 'pool',
    isMayor: false,
    pose: 'working',
    poseWord: 'working',
    bellyPct: 40,
    homeKey: 'reef-a',
    linkTo: `/agents/${id}`,
    tombstoned: false,
  };
}

/** captures the world x of each placed fish (from setTransform's e term) in
 * draw order; every other 2D call is a no-op. */
function orderingCtx(): { ctx: CanvasRenderingContext2D; placedX: number[] } {
  const placedX: number[] = [];
  const stub = {
    setTransform(_a: number, _b: number, _c: number, _d: number, e: number): void {
      placedX.push(e / LAYER.scale);
    },
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    bezierCurveTo(): void {},
    quadraticCurveTo(): void {},
    closePath(): void {},
    fill(): void {},
    stroke(): void {},
    arc(): void {},
    ellipse(): void {},
    createLinearGradient(): CanvasGradient {
      return { addColorStop(): void {} } as unknown as CanvasGradient;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'butt',
    globalAlpha: 1,
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, placedX };
}

/** counts createLinearGradient calls (rich path signature) while paintFishLayer
 * runs, so a test can assert the count-gate keeps the perf sweep flat. */
function gradientCountingCtx(): { ctx: CanvasRenderingContext2D; gradients: () => number } {
  let count = 0;
  const stub = {
    setTransform(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    bezierCurveTo(): void {},
    quadraticCurveTo(): void {},
    closePath(): void {},
    fill(): void {},
    stroke(): void {},
    arc(): void {},
    ellipse(): void {},
    createLinearGradient(): CanvasGradient {
      count += 1;
      return { addColorStop(): void {} } as unknown as CanvasGradient;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'butt',
    globalAlpha: 1,
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, gradients: () => count };
}

/** N working pool fish all at the same spot; scale controls drawn px. */
function drawFishScene(
  count: number,
  scale: number,
): { ctx: CanvasRenderingContext2D; gradients: () => number } {
  const fishList = Array.from({ length: count }, (_u, i) => fish(`agent-${i}`));
  const sim: SimState = {
    clockMs: 0,
    pellets: {},
    fish: Object.fromEntries(
      fishList.map((f) => [f.id, { x: 500, y: 1000, heading: 0, speed: 60, phase: 0.3 }]),
    ),
  };
  const layer: LayerTransform = { scale, tx: 0, ty: 0, dpr: 1 };
  const rec = gradientCountingCtx();
  paintFishLayer(rec.ctx, fishList, sim, PALETTE, layer, VIEW, 0);
  return rec;
}

describe('paintFishLayer depth ordering (painter algorithm, back-to-front)', () => {
  it('draws fish back-to-front: ascending depth z (near fish overlap far)', () => {
    // ids chosen to spread across the depth range so the sort is exercised
    const ids = ['agent-22', 'agent-200', 'agent-10', 'agent-93', 'agent-210', 'agent-0'];
    const xById = new Map(ids.map((id, i) => [id, 100 * (i + 1)]));
    const fishList = ids.map((id) => fish(id));
    const sim: SimState = {
      clockMs: 0,
      pellets: {},
      fish: Object.fromEntries(
        fishList.map((f) => [
          f.id,
          { x: xById.get(f.id) ?? 0, y: 1000, heading: 0, speed: 60, phase: 0.3 },
        ]),
      ),
    };

    const { ctx, placedX } = orderingCtx();
    paintFishLayer(ctx, fishList, sim, PALETTE, LAYER, VIEW, 0);

    // recover the id draw order from the first N placements (the final call is
    // the layer-restore setTransform at x = 0)
    const xToId = new Map(ids.map((id) => [xById.get(id) ?? 0, id]));
    const drawnOrder = placedX.slice(0, ids.length).map((x) => xToId.get(Math.round(x)));
    const expected = [...ids].sort((a, b) => fishDepthZ(a) - fishDepthZ(b));
    expect(drawnOrder).toEqual(expected);
    // sanity: the chosen ids actually span a range of depths (not a no-op sort)
    const zs = ids.map(fishDepthZ);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.3);
  });
});

describe('usesRichFishPath (count-gated rich rendering — LOD0 creatures, not icons)', () => {
  it('richens SMALL fish in a low-count scene (the ~10px LOD0 pool fish read as shaded)', () => {
    // at the fit overview a pool fish draws ~10 css px; it must take the rich
    // (countershade + fin) path so it reads as a creature, not a flat kite
    expect(usesRichFishPath(true, 10)).toBe(true);
    expect(usesRichFishPath(true, 6)).toBe(true);
  });

  it('keeps the over-budget (200-fish perf sweep) case flat at ANY drawn size', () => {
    // the count gate — not pixel size — protects the perf headroom
    expect(usesRichFishPath(false, 300)).toBe(false);
    expect(usesRichFishPath(false, 10)).toBe(false);
  });

  it('drops sub-pixel fish to the flat path (a gradient there is invisible)', () => {
    expect(usesRichFishPath(true, 3)).toBe(false);
  });
});

describe('paintFishLayer count-gate (perf-sweep stays flat, low count richens)', () => {
  it('allocates body/fin gradients for a low-count scene (rich shaded fish)', () => {
    const rec = drawFishScene(6, 1.0);
    expect(rec.gradients()).toBeGreaterThan(0);
  });

  it('allocates ZERO gradients above the fish-count budget (200-fish path stays flat)', () => {
    // over budget, every fish is flat regardless of drawn size → no gradients,
    // so the 200-fish sweep keeps its render-work headroom
    const rec = drawFishScene(RICH_FISH_BUDGET + 12, 1.0);
    expect(rec.gradients()).toBe(0);
  });
});
