// A faint mooring line from a surfaced distressed fish down to its rig's
// formation anchor. A "needs a human" fish rises to the surface shelf, far above
// its school, so this line keeps "which rig needs you" legible even when the
// fish is nowhere near its formation. Very faint and solid — a long vertical
// drop line reads unambiguously as "moored to that rig down there", distinct
// from the short solid fish<->held-bead leash and the dashed focus-only dep
// links. Few surfaced fish, so this is one cheap batched path.

import type { AquariumPose, ScenePalette, SimState, WorldSnapshot } from '../contracts';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { withAlpha } from './oklch';

/** hairline opacity: quiet enough to stay ambient, present enough to trace home */
const SURFACE_TETHER_ALPHA = 0.16;

/** the "needs a human" poses that rise to the surface shelf (AgentNeedsYouReason). */
const SHELF_POSES: ReadonlySet<AquariumPose> = new Set([
  'awaiting-input',
  'errored',
  'stalled',
  'rate-limited',
]);

/**
 * Actor layer must be installed. `layerScale` is css-px-per-world-unit, used to
 * keep the hairline ~1 css px wide at any zoom. Draw BEFORE fish so the fish
 * body caps the line's surface end.
 */
export function paintSurfaceTethers(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  palette: ScenePalette,
  view: ViewRect,
  layerScale: number,
): void {
  const anchorByKey = new Map<string, { x: number; y: number }>();
  for (const f of snapshot.formations) anchorByKey.set(f.key, { x: f.anchorX, y: f.anchorY });
  let began = false;
  for (const fish of snapshot.fish) {
    if (!SHELF_POSES.has(fish.pose)) continue;
    // the mayor's city stratum has no formation, so a city-stratum distress fish
    // has no rig to moor to — skip rather than draw a line to nowhere.
    const anchor = anchorByKey.get(fish.homeKey);
    if (anchor === undefined) continue;
    const fk = sim.fish[fish.id];
    if (fk === undefined) continue;
    // draw if either end is on screen (the line may span the whole column).
    if (!rectContains(view, fk.x, fk.y) && !rectContains(view, anchor.x, anchor.y)) continue;
    if (!began) {
      ctx.beginPath();
      began = true;
    }
    ctx.moveTo(fk.x, fk.y);
    ctx.lineTo(anchor.x, anchor.y);
  }
  if (!began) return;
  ctx.strokeStyle = withAlpha(palette.textMuted, SURFACE_TETHER_ALPHA);
  ctx.lineWidth = 1 / layerScale;
  ctx.lineCap = 'round';
  ctx.stroke();
}
