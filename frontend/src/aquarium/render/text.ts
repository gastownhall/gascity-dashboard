// All in-scene type: rig labels (small tracked caps + open-bead count), fish
// name tags (fade in across LOD1), LOD2 captions (name, pose word, task bead,
// belly percent as typeset figures), pellet id labels, and "+N" pellet
// overflow. Text is always horizontal and screen-space (map-label style):
// anchors project through the owning layer's parallax transform, glyphs stay
// at fixed css-px sizes. The Honest Zoom Rule: every string here is a
// snapshot fact; nothing is invented to fill the glass.

import type { Camera, ScenePalette, SimState, Viewport, WorldSnapshot } from '../contracts';
import { CITY_KEY } from '../contracts';
import { SPECIES } from './fishGeometry';
import type { LayerTransform } from './layers';
import { PARALLAX, applyScreenSpace, layerTransform, worldToScreen } from './layers';
import { lod1Fade, lod2Fade } from './lod';
import type { Pt } from './mathUtil';

export function paintTextLayers(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  palette: ScenePalette,
  camera: Camera,
  viewport: Viewport,
): void {
  applyScreenSpace(ctx, viewport);
  ctx.textBaseline = 'alphabetic';
  const f1 = lod1Fade(camera.zoom);
  const f2 = lod2Fade(camera.zoom);
  const mid = layerTransform(camera, viewport, PARALLAX.mid);
  const act = layerTransform(camera, viewport, PARALLAX.actors);
  paintRigLabels(ctx, snapshot, palette, mid, viewport);
  paintOverflow(ctx, snapshot, palette, mid, viewport);
  const tagAlpha = f1 * (1 - f2);
  if (tagAlpha > 0.01) paintNameTags(ctx, snapshot, sim, palette, act, viewport, tagAlpha);
  if (f2 > 0.01) {
    paintCaptions(ctx, snapshot, sim, palette, act, viewport, f2);
    paintPelletLabels(ctx, snapshot, sim, palette, act, viewport, f2);
  }
  ctx.globalAlpha = 1;
}

function offscreen(pos: Pt, viewport: Viewport, margin: number): boolean {
  return (
    pos.x < -margin ||
    pos.x > viewport.cssWidth + margin ||
    pos.y < -margin ||
    pos.y > viewport.cssHeight + margin
  );
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (typeof c.letterSpacing === 'string') c.letterSpacing = value;
}

function paintRigLabels(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  palette: ScenePalette,
  mid: LayerTransform,
  viewport: Viewport,
): void {
  ctx.font = `600 11px ${palette.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.textMuted;
  setLetterSpacing(ctx, '1px');
  for (const formation of snapshot.formations) {
    if (formation.key === CITY_KEY) continue;
    const pos = worldToScreen(mid, formation.anchorX, formation.anchorY);
    if (offscreen(pos, viewport, 140)) continue;
    ctx.fillText(`${formation.key.toUpperCase()} · ${formation.openBeadTotal}`, pos.x, pos.y + 26);
  }
  setLetterSpacing(ctx, '0px');
}

function paintOverflow(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  palette: ScenePalette,
  mid: LayerTransform,
  viewport: Viewport,
): void {
  ctx.font = `600 11px ${palette.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.textMuted;
  for (const formation of snapshot.formations) {
    if (formation.key === CITY_KEY) continue;
    const overflow = snapshot.pelletOverflow[formation.key];
    if (overflow === undefined || overflow <= 0) continue;
    const pos = worldToScreen(
      mid,
      formation.anchorX + formation.radius * 0.55,
      formation.anchorY - formation.radius * 1.15,
    );
    if (offscreen(pos, viewport, 60)) continue;
    ctx.fillText(`+${overflow}`, pos.x, pos.y);
  }
}

interface FishAnchor {
  x: number;
  y: number;
  lift: number;
  drop: number;
  tombstoned: boolean;
  name: string;
  meta: string;
}

function visibleFishAnchors(
  snapshot: WorldSnapshot,
  sim: SimState,
  act: LayerTransform,
  viewport: Viewport,
): FishAnchor[] {
  const anchors: FishAnchor[] = [];
  for (const fish of snapshot.fish) {
    const kin = sim.fish[fish.id];
    if (kin === undefined) continue;
    const pos = worldToScreen(act, kin.x, kin.y);
    if (offscreen(pos, viewport, 80)) continue;
    const halfSpan = SPECIES[fish.species].length * 0.5 * act.scale;
    const metaParts = [
      fish.poseWord,
      fish.taskBeadId,
      fish.bellyPct === undefined ? undefined : `${fish.bellyPct}%`,
    ].filter((part): part is string => part !== undefined);
    anchors.push({
      x: pos.x,
      y: pos.y,
      lift: halfSpan * 0.7 + 9,
      drop: halfSpan * 0.7 + 16,
      tombstoned: fish.tombstoned,
      name: fish.name,
      meta: metaParts.join(' · '),
    });
  }
  return anchors;
}

function paintNameTags(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  palette: ScenePalette,
  act: LayerTransform,
  viewport: Viewport,
  alpha: number,
): void {
  ctx.font = `10.5px ${palette.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.text;
  for (const anchor of visibleFishAnchors(snapshot, sim, act, viewport)) {
    ctx.globalAlpha = anchor.tombstoned ? alpha * 0.5 : alpha;
    ctx.fillText(anchor.name, anchor.x, anchor.y - anchor.lift);
  }
  ctx.globalAlpha = 1;
}

function paintCaptions(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  palette: ScenePalette,
  act: LayerTransform,
  viewport: Viewport,
  alpha: number,
): void {
  const anchors = visibleFishAnchors(snapshot, sim, act, viewport);
  ctx.textAlign = 'center';
  ctx.font = `600 12px ${palette.fontFamily}`;
  ctx.fillStyle = palette.text;
  for (const anchor of anchors) {
    ctx.globalAlpha = anchor.tombstoned ? alpha * 0.5 : alpha;
    ctx.fillText(anchor.name, anchor.x, anchor.y + anchor.drop);
  }
  ctx.font = `10.5px ${palette.fontFamily}`;
  ctx.fillStyle = palette.textMuted;
  for (const anchor of anchors) {
    if (anchor.meta === '') continue;
    ctx.globalAlpha = anchor.tombstoned ? alpha * 0.5 : alpha;
    ctx.fillText(anchor.meta, anchor.x, anchor.y + anchor.drop + 14);
  }
  ctx.globalAlpha = 1;
}

function paintPelletLabels(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  palette: ScenePalette,
  act: LayerTransform,
  viewport: Viewport,
  alpha: number,
): void {
  ctx.font = `10px ${palette.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.textMuted;
  ctx.globalAlpha = alpha;
  for (const pellet of snapshot.pellets) {
    if (pellet.state === 'eaten') continue;
    const kin = sim.pellets[pellet.beadId];
    if (kin === undefined) continue;
    const pos = worldToScreen(act, kin.x, kin.y);
    if (offscreen(pos, viewport, 40)) continue;
    ctx.fillText(pellet.label, pos.x + 9, pos.y - 6);
  }
  ctx.globalAlpha = 1;
}
