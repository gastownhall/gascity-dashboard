import { describe, expect, it } from 'vitest';
import type {
  Camera,
  FishEntity,
  PelletEntity,
  ScenePalette,
  SimState,
  Viewport,
  WorldSnapshot,
} from '../contracts';
import { EMPTY_FLOW_OBSERVATION, LOD1_ZOOM, UNRIGGED_KEY } from '../contracts';
import { buildScenePalette } from './palette';
import { paintTextLayers } from './text';
import { parseOklch } from './oklch';
import { rigHue } from './rigHue';
import { PARALLAX, layerTransform, worldToScreen } from './layers';

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
    strokeStyle: '',
    lineWidth: 1,
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    stroke(): void {},
    setLineDash(): void {},
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
  strandedWork: [],
  flow: EMPTY_FLOW_OBSERVATION,
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
    expect(drawn.some((d) => d.text === 'REEF-GAMMA · 46 OPEN')).toBe(true);
  });

  it('keeps the rig name + open-bead count on as the operator zooms further in', () => {
    const drawn = drawAt(1.0);
    expect(drawn.some((d) => d.text === 'REEF-GAMMA · 46 OPEN')).toBe(true);
  });
});

describe('rig labels identify the bead field instead of clipping under the reef', () => {
  it('centres the rig label over its visible bead cluster', () => {
    const clusterSnapshot: WorldSnapshot = {
      ...SNAPSHOT,
      pellets: [
        pellet({ beadId: 'a', rigKey: 'reef-gamma' }),
        pellet({ beadId: 'b', rigKey: 'reef-gamma' }),
      ],
    };
    const sim: SimState = {
      fish: {},
      pellets: {
        a: { x: 1180, y: 1450, phase: 0 },
        b: { x: 1220, y: 1510, phase: 0 },
      },
      clockMs: 0,
    };
    const camera: Camera = { x: 1000, y: 1850, zoom: 0.5 };
    const { ctx, drawn } = recordingCtx();
    paintTextLayers(ctx, clusterSnapshot, sim, PALETTE, camera, VIEWPORT);

    const label = drawn.find((d) => d.text === 'REEF-GAMMA · 46 OPEN');
    const actorLayer = layerTransform(camera, VIEWPORT, PARALLAX.actors);
    const clusterTop = worldToScreen(actorLayer, 1200, 1450);
    expect(label?.x).toBeCloseTo(clusterTop.x, 5);
    expect(label?.y).toBeLessThan(clusterTop.y);
  });
});

describe('rig label with no open work drops the "· 0" count noise', () => {
  const ZERO_SNAPSHOT: WorldSnapshot = {
    formations: [
      { key: 'decisions', anchorX: 1000, anchorY: 1850, radius: 220, seed: 7, openBeadTotal: 0 },
      { key: UNRIGGED_KEY, anchorX: 1400, anchorY: 1850, radius: 220, seed: 3, openBeadTotal: 0 },
    ],
    fish: [],
    pellets: [],
    needsAttention: 0,
    pelletOverflow: {},
    strandedWork: [],
    flow: EMPTY_FLOW_OBSERVATION,
  };

  it('names a zero-work rig without a "· 0" suffix', () => {
    const { ctx, drawn } = recordingCtx();
    paintTextLayers(
      ctx,
      ZERO_SNAPSHOT,
      EMPTY_SIM,
      PALETTE,
      { x: 1000, y: 1850, zoom: 0.5 },
      VIEWPORT,
    );
    expect(drawn.some((d) => d.text === 'DECISIONS')).toBe(true);
    expect(drawn.some((d) => d.text.includes('· 0'))).toBe(false);
    expect(drawn.some((d) => d.text === 'UNRIGGED')).toBe(true);
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
  strandedWork: [],
  flow: EMPTY_FLOW_OBSERVATION,
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

function fish(over: Partial<FishEntity> & Pick<FishEntity, 'id'>): FishEntity {
  return {
    name: over.id,
    species: 'pool',
    isMayor: false,
    pose: 'working',
    poseWord: 'working',
    bellyPct: 50,
    homeKey: 'reef-gamma',
    linkTo: '',
    tombstoned: false,
    ...over,
  };
}
function pellet(over: Partial<PelletEntity> & Pick<PelletEntity, 'beadId'>): PelletEntity {
  return {
    label: `${over.beadId!.slice(0, 6)}…`,
    title: '',
    linkTo: '',
    rigKey: 'reef-gamma',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1,
    ...over,
  };
}

describe('held-bead titles (what is being worked on, and by whom)', () => {
  const HELD = pellet({
    beadId: 'gc-abc123def',
    title: 'Fix the convoy latch',
    state: 'held',
    fishId: 'fish-1',
  });
  const DRIFT = pellet({ beadId: 'gc-queued99', title: 'Queued backlog item' });
  const SNAP: WorldSnapshot = {
    formations: SNAPSHOT.formations,
    fish: [fish({ id: 'polecat-7', species: 'role' })],
    pellets: [HELD, DRIFT],
    needsAttention: 0,
    pelletOverflow: {},
    strandedWork: [],
    flow: EMPTY_FLOW_OBSERVATION,
  };
  const sim: SimState = {
    fish: {},
    pellets: {
      'gc-abc123def': { x: 1000, y: 1850, phase: 0 },
      'gc-queued99': { x: 1040, y: 1850, phase: 0 },
    },
    clockMs: 0,
  };
  // fish-1 resolves to the 'polecat-7' fish via id; give the fish that id.
  SNAP.fish[0]!.id = 'fish-1';
  SNAP.fish[0]!.name = 'polecat-7';

  function draw(zoom: number): DrawnText[] {
    const { ctx, drawn } = recordingCtx();
    paintTextLayers(ctx, SNAP, sim, PALETTE, { x: 1000, y: 1850, zoom }, VIEWPORT);
    return drawn;
  }

  it('labels a held bead with its title (not its id) and the holding agent, at LOD1', () => {
    const drawn = draw(LOD1_ZOOM);
    expect(drawn.some((d) => d.text === 'Fix the convoy latch')).toBe(true);
    expect(drawn.some((d) => d.text === 'polecat-7')).toBe(true);
    // the raw / elided bead id is never drawn as a floating tag
    expect(drawn.some((d) => d.text.includes('gc-abc123def') || d.text.includes('gc-abc…'))).toBe(
      false,
    );
  });

  it('never labels a drifting (open) bead in-scene — its title is a hover detail', () => {
    const drawn = draw(LOD1_ZOOM);
    expect(drawn.some((d) => d.text === 'Queued backlog item')).toBe(false);
  });

  it('draws no bead titles at the overview (below LOD1) so the tank stays clean', () => {
    const drawn = draw(0.5);
    expect(drawn.some((d) => d.text === 'Fix the convoy latch')).toBe(false);
  });
});

describe('epic grouping labels (focus-only, LOD1+; overview stays age-drift)', () => {
  const pe = (beadId: string, epicId: string, epicTitle: string): PelletEntity =>
    pellet({ beadId, state: 'drifting', epicId, epicTitle });
  const SNAP: WorldSnapshot = {
    formations: SNAPSHOT.formations,
    fish: [],
    pellets: [
      pe('c1', 'e1', 'Convoy graph'),
      pe('c2', 'e1', 'Convoy graph'),
      pe('solo', 'e2', 'Freshness spine'),
    ],
    needsAttention: 0,
    pelletOverflow: {},
    strandedWork: [],
    flow: EMPTY_FLOW_OBSERVATION,
  };
  const sim: SimState = {
    fish: {},
    pellets: {
      c1: { x: 1000, y: 1850, phase: 0 },
      c2: { x: 1040, y: 1850, phase: 0 },
      solo: { x: 1200, y: 1850, phase: 0 },
    },
    clockMs: 0,
  };
  const draw = (zoom: number): DrawnText[] => {
    const { ctx, drawn } = recordingCtx();
    paintTextLayers(ctx, SNAP, sim, PALETTE, { x: 1000, y: 1850, zoom }, VIEWPORT);
    return drawn;
  };

  it('labels a same-epic cluster (≥2 beads) with the epic title at LOD1', () => {
    expect(draw(LOD1_ZOOM).some((d) => d.text === 'Convoy graph')).toBe(true);
  });

  it('does not label a lone epic bead (one bead is not a group)', () => {
    expect(draw(LOD1_ZOOM).some((d) => d.text === 'Freshness spine')).toBe(false);
  });

  it('shows no epic labels at the overview (below LOD1) — the drift stays calm', () => {
    expect(draw(0.5).some((d) => d.text === 'Convoy graph')).toBe(false);
  });
});
