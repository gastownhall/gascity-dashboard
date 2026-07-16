// Ledger focus marks. Dashed circles are deliberately distinct from the solid
// one-ring pickup / two-ring completion receipts. The mark uses rig identity
// hue where available, while the dash pattern carries selection in greyscale.

import type {
  FishEntity,
  PelletEntity,
  ReefFocus,
  RigFormation,
  ScenePalette,
  SimState,
} from '../contracts';
import { PELLET_RADIUS, driftKeepCount, pelletColors, pelletVisibleAtLod } from './pellets';
import { rigHue } from './rigHue';
import { SPECIES } from './fishGeometry';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { TAU } from './mathUtil';

const MIN_PELLET_FOCUS_PX = 12;
const FISH_RADIUS_FACTOR = 0.62;
const FORMATION_RADIUS_FACTOR = 1.12;

export function paintRigFocus(
  ctx: CanvasRenderingContext2D,
  focus: ReefFocus | null | undefined,
  formations: readonly RigFormation[],
  palette: ScenePalette,
  view: ViewRect,
  layerScale: number,
): void {
  if (focus?.kind !== 'rig') return;
  const formation = formations.find((candidate) => candidate.key === focus.rigKey);
  if (formation === undefined || !rectContains(view, formation.anchorX, formation.anchorY)) {
    return;
  }
  beginFocusStroke(ctx, focusColor(palette, focus.rigKey), layerScale);
  ctx.arc(formation.anchorX, formation.anchorY, formation.radius * FORMATION_RADIUS_FACTOR, 0, TAU);
  endFocusStroke(ctx);
}

export function paintActorFocus(
  ctx: CanvasRenderingContext2D,
  focus: ReefFocus | null | undefined,
  pellets: readonly PelletEntity[],
  fish: readonly FishEntity[],
  sim: SimState,
  palette: ScenePalette,
  view: ViewRect,
  layerScale: number,
): void {
  if (focus === null || focus === undefined) return;
  if (focus.kind === 'fish') {
    const entity = fish.find((candidate) => candidate.id === focus.fishId);
    const kin = sim.fish[focus.fishId];
    if (entity === undefined || kin === undefined || !rectContains(view, kin.x, kin.y)) return;
    beginFocusStroke(ctx, focusColor(palette, entity.homeKey), layerScale);
    ctx.arc(kin.x, kin.y, SPECIES[entity.species].length * FISH_RADIUS_FACTOR, 0, TAU);
    endFocusStroke(ctx);
    return;
  }

  const keep = driftKeepCount(layerScale);
  const targets = pellets.filter(
    (pellet) =>
      (focus.kind === 'bead' ? pellet.beadId === focus.beadId : pellet.rigKey === focus.rigKey) &&
      pelletVisibleAtLod(pellet, keep),
  );
  if (targets.length === 0) return;
  const rigKey = focus.kind === 'rig' ? focus.rigKey : targets[0]!.rigKey;
  beginFocusStroke(ctx, focusColor(palette, rigKey), layerScale);
  for (const pellet of targets) {
    const kin = sim.pellets[pellet.beadId];
    if (kin === undefined || !rectContains(view, kin.x, kin.y)) continue;
    const radius = Math.max(
      MIN_PELLET_FOCUS_PX / layerScale,
      PELLET_RADIUS * pellet.radiusScale * 1.9,
    );
    ctx.moveTo(kin.x + radius, kin.y);
    ctx.arc(kin.x, kin.y, radius, 0, TAU);
  }
  endFocusStroke(ctx);
}

function focusColor(palette: ScenePalette, rigKey: string): string {
  const hue = rigHue(rigKey);
  return hue === null ? palette.text : pelletColors(palette, hue).tones[2];
}

function beginFocusStroke(ctx: CanvasRenderingContext2D, color: string, layerScale: number): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / layerScale;
  ctx.lineCap = 'round';
  ctx.setLineDash([7 / layerScale, 5 / layerScale]);
}

function endFocusStroke(ctx: CanvasRenderingContext2D): void {
  ctx.stroke();
  ctx.setLineDash([]);
}
