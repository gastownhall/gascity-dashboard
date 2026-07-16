import { describe, expect, it } from 'vitest';
import type {
  FishEntity,
  PelletEntity,
  ReefFocus,
  RigFormation,
  ScenePalette,
  SimState,
} from '../contracts';
import type { ViewRect } from './layers';
import { paintActorFocus, paintRigFocus } from './focusHighlights';
import { buildScenePalette } from './palette';

const PALETTE: ScenePalette = buildScenePalette(
  'light',
  {
    fg: '18% 0.012 75',
    'fg-muted': '42% 0.014 75',
    ok: '50% 0.085 150',
    warn: '60% 0.14 60',
  },
  'Inter',
);
const VIEW: ViewRect = { left: 0, top: 0, right: 4_000, bottom: 2_250 };
const FORMATIONS: RigFormation[] = [
  { key: 'alpha', anchorX: 900, anchorY: 1_900, radius: 200, seed: 1, openBeadTotal: 2 },
];
const PELLETS: PelletEntity[] = [
  {
    beadId: 'a-1',
    label: 'a-1',
    title: '',
    linkTo: '',
    rigKey: 'alpha',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1.8,
    isP0: true,
  },
  {
    beadId: 'b-1',
    label: 'b-1',
    title: '',
    linkTo: '',
    rigKey: 'beta',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1,
  },
];
const FISH: FishEntity[] = [
  {
    id: 'tinker',
    name: 'tinker',
    species: 'role',
    isMayor: false,
    pose: 'awaiting-input',
    poseWord: 'awaiting input',
    bellyPct: 50,
    homeKey: 'alpha',
    linkTo: '',
    tombstoned: false,
  },
];
const SIM: SimState = {
  fish: { tinker: { x: 500, y: 200, heading: 0, speed: 0, phase: 0 } },
  pellets: {
    'a-1': { x: 800, y: 700, phase: 0 },
    'b-1': { x: 1_600, y: 800, phase: 0 },
  },
  clockMs: 0,
};

function recordingContext() {
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  const dashes: number[][] = [];
  const stub = {
    beginPath(): void {},
    arc(x: number, y: number, radius: number): void {
      arcs.push({ x, y, radius });
    },
    moveTo(): void {},
    lineTo(): void {},
    stroke(): void {},
    setLineDash(value: number[]): void {
      dashes.push(value);
    },
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, arcs, dashes };
}

function actor(focus: ReefFocus | null | undefined) {
  const recorded = recordingContext();
  paintActorFocus(recorded.ctx, focus, PELLETS, FISH, SIM, PALETTE, VIEW, 1);
  return recorded;
}

describe('focus highlights', () => {
  it('draws a dashed focus mark around one selected bead', () => {
    const { arcs, dashes } = actor({ kind: 'bead', beadId: 'a-1' });
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({ x: 800, y: 700 });
    expect(dashes.some((dash) => dash.length > 0)).toBe(true);
  });

  it("highlights only the selected rig formation and that rig's rendered beads", () => {
    const actorMarks = actor({ kind: 'rig', rigKey: 'alpha' });
    const formationMarks = recordingContext();
    paintRigFocus(
      formationMarks.ctx,
      { kind: 'rig', rigKey: 'alpha' },
      FORMATIONS,
      PALETTE,
      VIEW,
      1,
    );
    expect(actorMarks.arcs).toHaveLength(1);
    expect(actorMarks.arcs[0]).toMatchObject({ x: 800, y: 700 });
    expect(formationMarks.arcs).toHaveLength(1);
    expect(formationMarks.arcs[0]).toMatchObject({ x: 900, y: 1_900 });
  });

  it('draws a focus mark around the selected needs-attention fish', () => {
    const { arcs } = actor({ kind: 'fish', fishId: 'tinker' });
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({ x: 500, y: 200 });
  });

  it('does not paint absent, mismatched, missing, or off-screen focus targets', () => {
    const missing = recordingContext();
    paintActorFocus(missing.ctx, null, PELLETS, FISH, SIM, PALETTE, VIEW, 1);
    paintActorFocus(missing.ctx, undefined, PELLETS, FISH, SIM, PALETTE, VIEW, 1);
    paintActorFocus(
      missing.ctx,
      { kind: 'bead', beadId: 'missing' },
      PELLETS,
      FISH,
      SIM,
      PALETTE,
      VIEW,
      1,
    );
    paintActorFocus(
      missing.ctx,
      { kind: 'fish', fishId: 'missing' },
      PELLETS,
      FISH,
      SIM,
      PALETTE,
      VIEW,
      1,
    );
    paintActorFocus(
      missing.ctx,
      { kind: 'fish', fishId: 'tinker' },
      PELLETS,
      FISH,
      { ...SIM, fish: {} },
      PALETTE,
      VIEW,
      1,
    );
    paintActorFocus(
      missing.ctx,
      { kind: 'fish', fishId: 'tinker' },
      PELLETS,
      FISH,
      SIM,
      PALETTE,
      { left: 1_000, top: 1_000, right: 2_000, bottom: 2_000 },
      1,
    );
    paintActorFocus(
      missing.ctx,
      { kind: 'bead', beadId: 'a-1' },
      PELLETS,
      FISH,
      { ...SIM, pellets: {} },
      PALETTE,
      VIEW,
      1,
    );
    paintActorFocus(
      missing.ctx,
      { kind: 'bead', beadId: 'a-1' },
      PELLETS,
      FISH,
      { ...SIM, pellets: { 'a-1': { x: 5_000, y: 5_000, phase: 0 } } },
      PALETTE,
      VIEW,
      1,
    );
    expect(missing.arcs).toHaveLength(0);

    const formations = recordingContext();
    paintRigFocus(formations.ctx, null, FORMATIONS, PALETTE, VIEW, 1);
    paintRigFocus(formations.ctx, { kind: 'bead', beadId: 'a-1' }, FORMATIONS, PALETTE, VIEW, 1);
    paintRigFocus(formations.ctx, { kind: 'rig', rigKey: 'missing' }, FORMATIONS, PALETTE, VIEW, 1);
    paintRigFocus(
      formations.ctx,
      { kind: 'rig', rigKey: 'alpha' },
      FORMATIONS,
      PALETTE,
      { left: 0, top: 0, right: 100, bottom: 100 },
      1,
    );
    expect(formations.arcs).toHaveLength(0);
  });

  it('uses the neutral focus colour for a city-stratum bead', () => {
    const cityPellet: PelletEntity = { ...PELLETS[0]!, beadId: 'city-1', rigKey: 'city' };
    const recorded = recordingContext();
    paintActorFocus(
      recorded.ctx,
      { kind: 'bead', beadId: 'city-1' },
      [cityPellet],
      FISH,
      { ...SIM, pellets: { 'city-1': { x: 800, y: 700, phase: 0 } } },
      PALETTE,
      VIEW,
      1,
    );
    expect(recorded.arcs).toHaveLength(1);
    expect(recorded.ctx.strokeStyle).toBe(PALETTE.text);
  });
});
