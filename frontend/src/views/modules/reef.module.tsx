// The reef aquarium (specs/plans/reef-aquarium.md). A core view like health/
// activity, but with two differences: `nav: null` (it is reached by direct
// link, not the header row — the aquarium is a diorama the operator chooses
// to look at, not a work surface with a badge) and `fullBleed: true` (it owns
// the whole viewport under the header rather than Layout's padded column).

import { lazy } from 'react';
import type { FrontendViewDescriptor } from '../types.js';

export const reefView: FrontendViewDescriptor = {
  id: 'reef',
  kind: 'core',
  path: '/reef',
  nav: null,
  fullBleed: true,
  element: lazy(() =>
    import('../../aquarium/AquariumPage').then((m) => ({ default: m.AquariumPage })),
  ),
};
