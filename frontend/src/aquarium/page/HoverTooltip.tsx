// A small, non-interactive tooltip that follows a throttled mousemove
// (specs/plans/reef-aquarium.md's hover contract: "small overlay tooltip
// div (not native title)"). Purely positional — no dismiss logic, no focus
// trap; it disappears the moment the hover target changes.

import type { FishEntity, PelletEntity } from '../contracts';
import type { HitResult } from './hitTest';

export interface HoverTooltipProps {
  hit: NonNullable<HitResult>;
  screenX: number;
  screenY: number;
}

const TOOLTIP_OFFSET_PX = 12;

export function HoverTooltip({ hit, screenX, screenY }: HoverTooltipProps) {
  return (
    <div
      role="status"
      aria-live="off"
      className="pointer-events-none absolute z-10 whitespace-nowrap border border-rule bg-surface px-2 py-1 text-label uppercase tracking-wider text-fg-muted"
      style={{ left: screenX + TOOLTIP_OFFSET_PX, top: screenY + TOOLTIP_OFFSET_PX }}
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
  return (
    <>
      {pellet.label} · {pellet.state}
    </>
  );
}
