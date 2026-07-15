// The click-selected detail card: dismissed on Escape or an outside click,
// per specs/plans/reef-aquarium.md's hit-test + cards contract. Deliberately
// flat (hairline border, no shadow, no radius) — DESIGN.md's carve-out for
// /reef keeps "the type stays the system's type" binding even inside the
// diorama.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FishEntity, PelletEntity } from '../contracts';
import { PELLET_STATE_WORD } from '../contracts';
import type { HitResult } from './hitTest';
import { placeNearCursor, type PlacementViewport } from './placeNearCursor';

export interface EntityCardProps {
  hit: NonNullable<HitResult>;
  /** css px, relative to the canvas container's own positioning context. */
  anchorX: number;
  anchorY: number;
  /** live css viewport, so the card flips off the right/bottom edge. */
  viewport: PlacementViewport;
  onDismiss: () => void;
}

const CARD_OFFSET_PX = 16;

export function EntityCard({ hit, anchorX, anchorY, viewport, onDismiss }: EntityCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el !== null) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [hit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current !== null && !cardRef.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onDismiss]);

  const label =
    hit.kind === 'fish'
      ? `${hit.entity.name.length > 0 ? hit.entity.name : 'agent'} details`
      : `bead ${hit.entity.beadId} details`;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={label}
      className="absolute z-10 max-w-xs border border-rule bg-surface px-4 py-3 text-body"
      style={placeNearCursor(anchorX, anchorY, size.w, size.h, viewport, CARD_OFFSET_PX)}
    >
      {hit.kind === 'fish' ? (
        <FishCardBody fish={hit.entity} />
      ) : (
        <PelletCardBody pellet={hit.entity} />
      )}
    </div>
  );
}

function FishCardBody({ fish }: { fish: FishEntity }) {
  return (
    <dl className="space-y-1">
      <dd className="text-title font-semibold text-fg">
        {fish.name.length > 0 ? fish.name : '(unnamed)'}
      </dd>
      <div className="flex gap-2 text-label uppercase tracking-wider text-fg-muted">
        <span>{fish.poseWord}</span>
        <span aria-hidden="true">·</span>
        <span>{fish.homeKey}</span>
      </div>
      {fish.bellyPct !== undefined && (
        <div className="tnum text-fg-muted">{fish.bellyPct}% context</div>
      )}
      {fish.taskBeadId !== undefined && <div className="text-fg-muted">bead {fish.taskBeadId}</div>}
      <Link to={fish.linkTo} className="inline-block text-accent focus-mark">
        open agent
      </Link>
    </dl>
  );
}

function PelletCardBody({ pellet }: { pellet: PelletEntity }) {
  const hasTitle = pellet.title.length > 0;
  return (
    <dl className="space-y-1">
      <dd className="text-title font-semibold text-fg">{hasTitle ? pellet.title : pellet.label}</dd>
      <div className="text-label uppercase tracking-wider text-fg-muted">
        {PELLET_STATE_WORD[pellet.state]}
      </div>
      {hasTitle && <div className="text-fg-muted">bead {pellet.beadId}</div>}
      <Link to={pellet.linkTo} className="inline-block text-accent focus-mark">
        open bead
      </Link>
    </dl>
  );
}
