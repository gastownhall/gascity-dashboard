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
    <nav aria-label="fish" className="sr-only">
      <ul>
        {fish.map((f) => (
          <li key={f.id}>
            <Link to={f.linkTo}>
              {f.homeKey} · {f.name.length > 0 ? f.name : '(unnamed)'} · {f.poseWord}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
