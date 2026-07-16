import { describe, expect, it } from 'vitest';
import {
  EMPTY_FLOW_OBSERVATION,
  type FishEntity,
  type RigFormation,
  type ScenePalette,
  type SimState,
  type WorldSnapshot,
} from '../contracts';
import type { ViewRect } from './layers';
import { buildScenePalette } from './palette';
import { paintSurfaceTethers } from './surfaceTethers';

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

function fish(over: Partial<FishEntity> & Pick<FishEntity, 'id' | 'pose'>): FishEntity {
  return {
    name: over.id,
    species: 'pool',
    isMayor: false,
    poseWord: over.pose,
    bellyPct: 50,
    homeKey: 'reef-alpha',
    linkTo: '',
    tombstoned: false,
    ...over,
  };
}
const FORMATION: RigFormation = {
  key: 'reef-alpha',
  anchorX: 100,
  anchorY: 1850,
  radius: 200,
  seed: 1,
  openBeadTotal: 5,
};
function snapshot(fishList: FishEntity[], formations: RigFormation[] = [FORMATION]): WorldSnapshot {
  return {
    formations,
    fish: fishList,
    pellets: [],
    needsAttention: 0,
    pelletOverflow: {},
    strandedWork: [],
    flow: EMPTY_FLOW_OBSERVATION,
  };
}
function simWith(entries: Record<string, { x: number; y: number }>): SimState {
  const f: SimState['fish'] = {};
  for (const [id, p] of Object.entries(entries)) f[id] = { ...p, heading: 0, speed: 0, phase: 0 };
  return { fish: f, pellets: {}, clockMs: 0 };
}

describe('paintSurfaceTethers', () => {
  it('moors a surfaced distressed fish down to its rig anchor', () => {
    const snap = snapshot([fish({ id: 'a1', pose: 'errored' })]);
    const sim = simWith({ a1: { x: 120, y: 148 } });
    const { ctx, segments } = recordingCtx();
    paintSurfaceTethers(ctx, snap, sim, PALETTE, WIDE_VIEW, 1);
    // fish (surface) -> its formation anchor (seabed)
    expect(segments).toEqual([{ ax: 120, ay: 148, bx: 100, by: 1850 }]);
  });

  it('tethers every distress pose but never a working/idle/asleep fish', () => {
    const snap = snapshot([
      fish({ id: 'w', pose: 'working' }),
      fish({ id: 'i', pose: 'idle' }),
      fish({ id: 's', pose: 'asleep' }),
      fish({ id: 'a', pose: 'awaiting-input' }),
      fish({ id: 'e', pose: 'errored' }),
      fish({ id: 't', pose: 'stalled' }),
      fish({ id: 'r', pose: 'rate-limited' }),
    ]);
    const sim = simWith({
      w: { x: 100, y: 900 },
      i: { x: 100, y: 1200 },
      s: { x: 100, y: 1850 },
      a: { x: 100, y: 148 },
      e: { x: 100, y: 210 },
      t: { x: 100, y: 275 },
      r: { x: 100, y: 340 },
    });
    const { ctx, segments } = recordingCtx();
    paintSurfaceTethers(ctx, snap, sim, PALETTE, WIDE_VIEW, 1);
    // exactly the four distress poses get a mooring line
    expect(segments).toHaveLength(4);
  });

  it('skips a distress fish whose rig has no formation (city stratum) or is missing from sim', () => {
    const snap = snapshot([
      fish({ id: 'city', pose: 'errored', homeKey: 'city' }),
      fish({ id: 'ghost', pose: 'stalled' }), // in reef-alpha but absent from sim
    ]);
    const sim = simWith({});
    const { ctx, segments } = recordingCtx();
    paintSurfaceTethers(ctx, snap, sim, PALETTE, WIDE_VIEW, 1);
    expect(segments).toHaveLength(0);
  });

  it('culls when both ends are outside the view rect', () => {
    const snap = snapshot([fish({ id: 'a1', pose: 'errored' })]);
    const sim = simWith({ a1: { x: 120, y: 148 } });
    const farView: ViewRect = { left: 5000, top: 5000, right: 6000, bottom: 6000 };
    const { ctx, segments } = recordingCtx();
    paintSurfaceTethers(ctx, snap, sim, PALETTE, farView, 1);
    expect(segments).toHaveLength(0);
  });
});
