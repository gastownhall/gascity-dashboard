import {
  FLOW_RECEIPT_LIFETIME_MS,
  type FlowObservation,
  type RigFormation,
  type ScenePalette,
} from '../contracts';
import { formationDepth } from './depth';
import type { ViewRect } from './layers';
import { withHueChroma } from './oklch';
import { rigHue } from './rigHue';

const MAX_RISE = 520;
const BASE_RADIUS = 12;
const RADIUS_GROWTH = 18;
const RECEIPT_CHROMA = 0.13;

/** Paints session-observed transition evidence above the rig that produced it.
 * Pickup is one expanding ring; completion is two concentric rings. */
export function paintFlowReceipts(
  ctx: CanvasRenderingContext2D,
  flow: FlowObservation,
  formations: readonly RigFormation[],
  palette: ScenePalette,
  view: ViewRect,
  scale: number,
  clockMs: number,
  reducedMotion: boolean,
): void {
  const formationsByKey = new Map(formations.map((formation) => [formation.key, formation]));
  for (const receipt of flow.receipts) {
    const formation = formationsByKey.get(receipt.rigKey);
    if (formation === undefined) continue;
    const ageMs = reducedMotion
      ? receipt.ageMsAtSnapshot
      : Math.max(receipt.ageMsAtSnapshot, clockMs - receipt.observedAtOffsetMs);
    if (ageMs < 0 || ageMs >= FLOW_RECEIPT_LIFETIME_MS) continue;
    const progress = ageMs / FLOW_RECEIPT_LIFETIME_MS;
    const depth = formationDepth(formation.seed);
    const x = formation.anchorX;
    const y =
      formation.anchorY - depth.lift - formation.radius * depth.scale * 0.65 - MAX_RISE * progress;
    if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;

    const hue = rigHue(receipt.rigKey);
    ctx.strokeStyle =
      hue === null ? palette.pellet : withHueChroma(palette.text, hue, RECEIPT_CHROMA);
    ctx.lineWidth = Math.max(2 / scale, 2);
    ctx.globalAlpha = Math.max(0.12, 0.86 * (1 - progress));
    const radius = Math.max((11 + 6 * progress) / scale, BASE_RADIUS + RADIUS_GROWTH * progress);
    ring(ctx, x, y, radius);
    if (receipt.kind === 'completion') ring(ctx, x, y, radius * 0.58);
  }
  ctx.globalAlpha = 1;
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}
