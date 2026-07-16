// The screen-reader channel for /reef: a visually-hidden list of every
// fish, independent of pixels or camera position. specs/plans/reef-aquarium.md
// "A11y" — the canvas is role="img" with a live summary label; this list is
// where a screen-reader operator actually finds and follows an individual
// agent.

import { Link } from 'react-router-dom';
import type { FishEntity } from '../contracts';

export interface SrFishListProps {
  fish: readonly FishEntity[];
}

export function SrFishList({ fish }: SrFishListProps) {
  return (
    <nav aria-label="fish">
      <ul>
        {fish.map((f) => (
          <li
            key={f.id}
            className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-16 focus-within:left-1/2 focus-within:z-30 focus-within:w-max focus-within:max-w-[calc(100%-2rem)] focus-within:-translate-x-1/2 focus-within:rounded-sm focus-within:border focus-within:border-rule focus-within:bg-surface focus-within:px-3 focus-within:py-2"
          >
            <Link
              to={f.linkTo}
              className="focus-mark block max-w-full truncate text-body text-fg hover:text-accent"
            >
              {f.homeKey} · {f.name.length > 0 ? f.name : '(unnamed)'} · {f.poseWord}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
