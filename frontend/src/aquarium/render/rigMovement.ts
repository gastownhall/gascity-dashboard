import type {
  FlowObservation,
  RigFormation,
  ScenePalette,
} from '../contracts';
import { formationDepth } from './depth';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { withHueChroma } from './oklch';
import { rigHue } from './rigHue';

const MOVEMENT_CHROMA = 0.13;
const MOVEMENT_ALPHA = 0.58;
const BUBBLES = [
  { xPx: 0, yPx: 0, radiusPx: 4 },
  { xPx: 10, yPx: -16, radiusPx: 5.5 },
  { xPx: 4, yPx: -34, radiusPx: 3.5 },
] as const;

/** Paints one fixed bubble trail above each rig where work moved recently.
 * The trail is a binary rig-level cue; bubble count never represents events. */
export function paintRecentRigMovement(
  ctx: CanvasRenderingContext2D,
  flow: FlowObservation,
  formations: readonly RigFormation[],
  palette: ScenePalette,
  view: ViewRect,
  scale: number,
): void {
  const formationsByKey = new Map(formations.map((formation) => [formation.key, formation]));
  for (const rigKey of flow.recentlyMovingRigKeys) {
    const formation = formationsByKey.get(rigKey);
    if (formation === undefined) continue;
    const depth = formationDepth(formation.seed);
    const x = formation.anchorX + formation.radius * depth.scale * 0.42;
    const y = formation.anchorY - depth.lift - formation.radius * depth.scale * 1.12;
    if (!rectContains(view, x, y)) continue;

    const hue = rigHue(rigKey);
    ctx.fillStyle = hue === null ? palette.pellet : withHueChroma(palette.text, hue, MOVEMENT_CHROMA);
    ctx.globalAlpha = MOVEMENT_ALPHA;
    ctx.beginPath();
    for (const bubble of BUBBLES) {
      ctx.moveTo(x + (bubble.xPx + bubble.radiusPx) / scale, y + bubble.yPx / scale);
      ctx.arc(
        x + bubble.xPx / scale,
        y + bubble.yPx / scale,
        bubble.radiusPx / scale,
        0,
        Math.PI * 2,
      );
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
