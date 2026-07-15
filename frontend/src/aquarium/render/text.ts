// All in-scene type: rig labels (small tracked caps + open-bead count, legit at
// LOD0/LOD1 as the tank's map), LOD2 captions (name, pose word, task bead,
// belly percent as typeset figures), pellet id labels, and "+N" pellet
// overflow. Fish IDENTITY is deliberately NOT drawn in swim space at overview
// or mid zoom — floating name tags next to every fish broke the aquarium
// illusion, so a fish's name lives on the hover/click HTML overlay and only
// appears in-scene at deep LOD2 captions. Text is always horizontal and
// screen-space (map-label style): anchors project through the owning layer's
// parallax transform, glyphs stay at fixed css-px sizes. The Honest Zoom Rule:
// every string here is a snapshot fact; nothing is invented to fill the glass.

import type { Camera, ScenePalette, SimState, Viewport, WorldSnapshot } from '../contracts';
import { CITY_KEY } from '../contracts';
import { SPECIES } from './fishGeometry';
import type { LayerTransform } from './layers';
import { PARALLAX, applyScreenSpace, layerTransform, worldToScreen } from './layers';
import { lod1Fade, lod2Fade, rigLabelFade } from './lod';
import type { Pt } from './mathUtil';
import { withHueChroma } from './oklch';
import { RIG_CHROMA, rigHue } from './rigHue';

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
  const fRig = rigLabelFade(camera.zoom);
  const f1 = lod1Fade(camera.zoom);
  const f2 = lod2Fade(camera.zoom);
  const mid = layerTransform(camera, viewport, PARALLAX.mid);
  const act = layerTransform(camera, viewport, PARALLAX.actors);
  // rig names/counts are the tank's map: present at the default overview so an
  // operator can tell projects apart, faded out only at the fully zoomed-out
  // whole-tank view (where they would read as categorical bars)
  if (fRig > 0.01) {
    paintRigLabels(ctx, snapshot, palette, mid, viewport, fRig);
  }
  // at LOD1 the drift resolves into its initiatives: same-epic beads get a
  // shared label, and the few held morsels name "what's being worked on" — while
  // the LOD0 overview stays a calm, unlabelled age-drift.
  if (f1 > 0.01) {
    paintEpicGroups(ctx, snapshot, sim, palette, act, viewport, f1);
    paintHeldBeadLabels(ctx, snapshot, sim, palette, act, viewport, f1);
  }
  if (f2 > 0.01) {
    paintCaptions(ctx, snapshot, sim, palette, act, viewport, f2);
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

/** Per-rig stranded-work marker at the surface above the rig: a diamond glyph +
 *  count, in the warn colour (attention, but never the ledger's reserved maroon).
 *  Stranded WORK has no agent to be a fish, so it surfaces as this marker while
 *  its pellet stays sunk. Present at the working overview (rigLabelFade) so the
 *  alarm reads at a glance, gone only at the fully zoomed-out tank. */
function paintRigLabels(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  palette: ScenePalette,
  mid: LayerTransform,
  viewport: Viewport,
  alpha: number,
): void {
  ctx.font = `600 11px ${palette.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.globalAlpha = alpha;
  setLetterSpacing(ctx, '1px');
  for (const formation of snapshot.formations) {
    if (formation.key === CITY_KEY) continue;
    const pos = worldToScreen(mid, formation.anchorX, formation.anchorY);
    if (offscreen(pos, viewport, 140)) continue;
    ctx.fillStyle = rigLabelColor(formation.key, palette);
    // A rig with no open work reads as just its name; "· 0" is noise (and read
    // as odd on the neutral UNRIGGED stratum). The name still maps colour→rig.
    const name = formation.key.toUpperCase();
    const label = formation.openBeadTotal > 0 ? `${name} · ${formation.openBeadTotal}` : name;
    ctx.fillText(label, pos.x, pos.y + 26);
  }
  setLetterSpacing(ctx, '0px');
  ctx.globalAlpha = 1;
}

/** The rig's own hue as a legible label colour, so the operator reads a rig's
 * identity straight off its overview label — no zooming to a school to learn
 * which colour is which. Neutral strata (the mayor's city / unrigged) keep the
 * muted text colour. Shares the fish-flank chroma (RIG_CHROMA) so a label reads
 * as the same colour as its school. */
function rigLabelColor(key: string, palette: ScenePalette): string {
  const hue = rigHue(key);
  return hue === null ? palette.textMuted : withHueChroma(palette.textMuted, hue, RIG_CHROMA);
}

interface FishAnchor {
  x: number;
  y: number;
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
      drop: halfSpan * 0.7 + 16,
      tombstoned: fish.tombstoned,
      name: fish.name,
      meta: metaParts.join(' · '),
    });
  }
  return anchors;
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

/** longest held-bead title drawn in-scene before a middle-ellipsis; a floating
 * tag is a glance cue, not the full bead — the card carries the untruncated title. */
const HELD_TITLE_MAX = 30;

function clipTitle(title: string): string {
  if (title.length <= HELD_TITLE_MAX) return title;
  return `${title.slice(0, HELD_TITLE_MAX - 1).trimEnd()}…`;
}

/** A drifting bead's epic cluster while it accumulates on-screen extent. */
interface EpicCluster {
  sumX: number;
  minY: number;
  count: number;
  title: string;
}

/** Focus-only epic grouping: at LOD1 the age-drift resolves into initiatives —
 * same-epic drifting beads on screen get one shared label at the top of their
 * cluster, so "what work, grouped by epic" reads without moving any pellet (the
 * LOD0 overview stays a calm unlabelled drift). Label-only on purpose: the beads
 * are age-scattered, so a bounding hull would sprawl and overlap; the centred
 * label is the clean cue. A lone bead is not a group. */
function paintEpicGroups(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  palette: ScenePalette,
  act: LayerTransform,
  viewport: Viewport,
  alpha: number,
): void {
  const clusters = new Map<string, EpicCluster>();
  for (const pellet of snapshot.pellets) {
    if (pellet.state !== 'drifting' || pellet.epicId === undefined) continue;
    const kin = sim.pellets[pellet.beadId];
    if (kin === undefined) continue;
    const pos = worldToScreen(act, kin.x, kin.y);
    if (offscreen(pos, viewport, 40)) continue;
    const title = pellet.epicTitle ?? pellet.epicId;
    const c = clusters.get(pellet.epicId);
    if (c === undefined) {
      clusters.set(pellet.epicId, { sumX: pos.x, minY: pos.y, count: 1, title });
    } else {
      c.sumX += pos.x;
      c.minY = Math.min(c.minY, pos.y);
      c.count += 1;
    }
  }
  if (clusters.size === 0) return;
  ctx.font = `600 10px ${palette.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.textMuted;
  ctx.globalAlpha = alpha;
  for (const c of clusters.values()) {
    if (c.count < 2) continue;
    ctx.fillText(clipTitle(c.title), c.sumX / c.count, c.minY - 8);
  }
  ctx.globalAlpha = 1;
}

/** Labels each in-progress (held) bead with its short title — the answer to
 * "what work is being worked on" — paired with the holding agent's name, so a
 * zoomed operator reads the active work AND who owns it without a hover. Drifting
 * and blocked beads stay unlabelled in-scene (their title is a hover/click
 * detail); the raw bead id is never drawn as a floating tag. */
function paintHeldBeadLabels(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  sim: SimState,
  palette: ScenePalette,
  act: LayerTransform,
  viewport: Viewport,
  alpha: number,
): void {
  const holderName = new Map<string, string>();
  for (const fish of snapshot.fish) holderName.set(fish.id, fish.name);
  ctx.textAlign = 'left';
  ctx.globalAlpha = alpha;
  for (const pellet of snapshot.pellets) {
    if (pellet.state !== 'held' || pellet.title.length === 0) continue;
    const kin = sim.pellets[pellet.beadId];
    if (kin === undefined) continue;
    const pos = worldToScreen(act, kin.x, kin.y);
    if (offscreen(pos, viewport, 60)) continue;
    ctx.font = `600 10px ${palette.fontFamily}`;
    ctx.fillStyle = palette.text;
    ctx.fillText(clipTitle(pellet.title), pos.x + 9, pos.y - 6);
    const who = pellet.fishId !== undefined ? holderName.get(pellet.fishId) : undefined;
    if (who !== undefined && who.length > 0) {
      ctx.font = `10px ${palette.fontFamily}`;
      ctx.fillStyle = palette.textMuted;
      ctx.fillText(who, pos.x + 9, pos.y + 6);
    }
  }
  ctx.globalAlpha = 1;
}
