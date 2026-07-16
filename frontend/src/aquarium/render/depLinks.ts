// Focus-only dependency links: while a bead pellet is selected, draw a faint
// dashed line from it to each bead it depends on (its `depends_on_id`s) whose
// pellet is currently on screen. Deliberately NOT drawn globally — a live city
// has hundreds of dependency edges, and drawing them all is spaghetti that
// re-creates the very "coloured dust" the reef works to avoid. It reveals a
// relationship on demand, then clears. Dashed (vs the solid fish<->bead tether)
// so the two relationship lines never read as the same thing. Both endpoints are
// gated through the same LOD thinning paintPellets uses: selection happens at
// LOD2 (nothing thinned), but nothing clears the selection on zoom-out, so a
// link is drawn only to endpoints on screen at the current zoom — never a dashed
// line to a pellet the overview thinned away.

import type { PelletEntity, ScenePalette, SimState } from '../contracts';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { withAlpha } from './oklch';
import { driftKeepCount, pelletVisibleAtLod } from './pellets';

/** present enough to trace the dependency, quiet enough to stay ambient */
const DEP_LINK_ALPHA = 0.55;
/** dash geometry in css px (divided by layerScale to stay constant on screen) */
const DEP_DASH_CSS = 6;
const DEP_GAP_CSS = 4;

/**
 * Actor layer must be installed. Draws nothing unless `selectedBeadId` names a
 * rendered pellet that has dependencies. `layerScale` is css-px-per-world-unit,
 * used to keep the hairline ~1 css px wide and the dashes a constant screen size
 * at any zoom.
 */
export function paintDepLinks(
  ctx: CanvasRenderingContext2D,
  selectedBeadId: string | null | undefined,
  pellets: readonly PelletEntity[],
  sim: SimState,
  palette: ScenePalette,
  view: ViewRect,
  layerScale: number,
): void {
  if (selectedBeadId === null || selectedBeadId === undefined) return;
  const selected = pellets.find((p) => p.beadId === selectedBeadId);
  const deps = selected?.dependsOn;
  if (selected === undefined || deps === undefined || deps.length === 0) return;
  const keep = driftKeepCount(layerScale);
  // Selection is only possible at LOD2, but nothing clears it on zoom-out — so
  // gate on the SAME LOD thinning paintPellets uses. If the selected pellet was
  // itself thinned away (zoomed back to the overview), draw nothing rather than
  // a line from empty water.
  if (!pelletVisibleAtLod(selected, keep)) return;
  const from = sim.pellets[selectedBeadId];
  if (from === undefined || !rectContains(view, from.x, from.y)) return;

  let began = false;
  for (const depId of deps) {
    const dep = pellets.find((p) => p.beadId === depId);
    const to = sim.pellets[depId];
    // a dep that is closed, capped out, off screen, or thinned out at this zoom
    // has no on-screen pellet to point at — skip rather than draw into open water.
    if (dep === undefined || to === undefined) continue;
    if (!pelletVisibleAtLod(dep, keep) || !rectContains(view, to.x, to.y)) continue;
    if (!began) {
      ctx.beginPath();
      began = true;
    }
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  if (!began) return;
  ctx.setLineDash([DEP_DASH_CSS / layerScale, DEP_GAP_CSS / layerScale]);
  ctx.strokeStyle = withAlpha(palette.textMuted, DEP_LINK_ALPHA);
  ctx.lineWidth = 1 / layerScale;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash([]);
}
