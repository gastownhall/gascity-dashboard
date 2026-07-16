// Shared edge-aware placement for the /reef cursor-anchored overlays (the hover
// tooltip and the click card). Both sit down-and-right of the cursor by default;
// near the right/bottom edge that runs off-screen, so this flips the box to the
// other side of the cursor when the default side would overflow the viewport.

export interface PlacementViewport {
  cssWidth: number;
  cssHeight: number;
}

export interface Placement {
  left: number;
  top: number;
}

/**
 * Place a `boxWidth`×`boxHeight` overlay near the cursor at (`anchorX`,
 * `anchorY`), offset by `offset` px. The box sits to the lower-right of the
 * cursor unless that would cross the viewport's right/bottom edge, in which case
 * that axis flips to the opposite side of the cursor. The result is clamped to
 * `>= 0` so a box wider or taller than the viewport still starts on-screen at
 * the top-left rather than being pushed fully off it.
 */
export function placeNearCursor(
  anchorX: number,
  anchorY: number,
  boxWidth: number,
  boxHeight: number,
  viewport: PlacementViewport,
  offset: number,
): Placement {
  const overflowsRight = anchorX + offset + boxWidth > viewport.cssWidth;
  const overflowsBottom = anchorY + offset + boxHeight > viewport.cssHeight;
  const left = overflowsRight ? anchorX - offset - boxWidth : anchorX + offset;
  const top = overflowsBottom ? anchorY - offset - boxHeight : anchorY + offset;
  return { left: Math.max(0, left), top: Math.max(0, top) };
}
