// A faint hairline from a working fish to the in-progress bead it holds, so the
// fish<->bead pair reads as one working unit at a glance (no hover needed). A
// held pellet sits MOUTH_OFFSET_WU ahead of its holder along the heading, so
// the tether bridges that gap; its fish-end is drawn under the fish body (the
// fish layer paints after this pass), so it reads as a short leash emerging
// toward the carried bead. Held pellets are few (one per working fish), so this
// is a single cheap batched path.

import type { PelletEntity, ScenePalette, SimState } from '../contracts';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { withAlpha } from './oklch';

/** hairline opacity: present enough to link the pair, quiet enough to stay ambient */
const TETHER_ALPHA = 0.32;

/**
 * Actor layer must be installed. `layerScale` is css-px-per-world-unit, used to
 * keep the hairline ~1 css px wide at any zoom. Draw BEFORE pellets and fish so
 * both marks cap the line's ends.
 */
export function paintTethers(
  ctx: CanvasRenderingContext2D,
  pellets: readonly PelletEntity[],
  sim: SimState,
  palette: ScenePalette,
  view: ViewRect,
  layerScale: number,
): void {
  let began = false;
  for (const pellet of pellets) {
    if (pellet.state !== 'held' || pellet.fishId === undefined) continue;
    const pk = sim.pellets[pellet.beadId];
    const fk = sim.fish[pellet.fishId];
    // sim can lag a fresh snapshot by a frame; a stale/unresolved holder has no
    // fish kinematics — skip rather than draw a line to nowhere.
    if (pk === undefined || fk === undefined) continue;
    if (!rectContains(view, pk.x, pk.y)) continue;
    if (!began) {
      ctx.beginPath();
      began = true;
    }
    ctx.moveTo(fk.x, fk.y);
    ctx.lineTo(pk.x, pk.y);
  }
  if (!began) return;
  ctx.strokeStyle = withAlpha(palette.textMuted, TETHER_ALPHA);
  ctx.lineWidth = 1 / layerScale;
  ctx.lineCap = 'round';
  ctx.stroke();
}
