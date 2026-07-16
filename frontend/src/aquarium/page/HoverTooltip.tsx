// A small, non-interactive tooltip that follows a throttled mousemove
// (specs/plans/reef-aquarium.md's hover contract: "small overlay tooltip
// div (not native title)"). Purely positional — no dismiss logic, no focus
// trap; it disappears the moment the hover target changes.

import { useLayoutEffect, useRef, useState } from 'react';
import type { FishEntity, PelletEntity } from '../contracts';
import { PELLET_STATE_WORD } from '../contracts';
import type { HitResult } from './hitTest';
import { placeNearCursor, type PlacementViewport } from './placeNearCursor';

export interface HoverTooltipProps {
  hit: NonNullable<HitResult>;
  screenX: number;
  screenY: number;
  /** live css viewport, so a long tooltip flips off the right/bottom edge. */
  viewport: PlacementViewport;
}

const TOOLTIP_OFFSET_PX = 12;

export function HoverTooltip({ hit, screenX, screenY, viewport }: HoverTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el !== null) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [hit]);
  const { left, top } = placeNearCursor(
    screenX,
    screenY,
    size.w,
    size.h,
    viewport,
    TOOLTIP_OFFSET_PX,
  );
  return (
    <div
      ref={ref}
      role="status"
      aria-live="off"
      className="pointer-events-none absolute z-10 max-w-xs border border-rule bg-surface px-2 py-1 text-label uppercase tracking-wider text-fg-muted"
      style={{ left, top }}
    >
      {hit.kind === 'fish' ? (
        <FishSummary fish={hit.entity} />
      ) : (
        <PelletSummary pellet={hit.entity} />
      )}
    </div>
  );
}

function FishSummary({ fish }: { fish: FishEntity }) {
  const name = fish.name.length > 0 ? fish.name : '(unnamed)';
  return (
    <>
      {name} · {fish.poseWord}
    </>
  );
}

function PelletSummary({ pellet }: { pellet: PelletEntity }) {
  const name = pellet.title.length > 0 ? pellet.title : pellet.label;
  return (
    <>
      {name} · {PELLET_STATE_WORD[pellet.state]} · {pellet.rigKey}
    </>
  );
}
