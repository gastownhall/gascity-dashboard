import type { ConvoyView, DashboardBead } from 'gas-city-dashboard-shared';
import { projectConvoyView } from 'gas-city-dashboard-shared';
import { fetchSupervisorBead, listSupervisorBeads } from './beadReads';
import { normalizeBead, normalizeBeads } from './normalizeBead';

// Loader for the /convoy/:rootBead route (gascity-dashboard-caag, Shape A).
//
// It COMPOSES the generated supervisor client — the root bead plus a bounded
// city bead read — and derives the convoy's step graph client-side from the
// `parent` chain, exactly as the Beads board inverts `needs`. The dashboard's
// generated client exposes no convoy/{id} or beads/graph/{root} endpoint, so
// there is no supervisor progress count to prefer: `projectConvoyView` derives
// progress from the materialized children, and a graph.v2 root with no exposed
// children collapses to the honest "steps not exposed" state in the projection.
//
// Truncation is honest: a busy city's closed beads can exceed one bounded page,
// so `partial` trips when the supervisor's reported total outruns the bounded
// read and the route renders a partial notice rather than silently dropping
// steps.

// Convoy step beads are bookkeeping-typed and frequently closed, so the read
// must include both — unlike the board's default open/engineering view.
const CONVOY_FETCH_LIMIT = 1_000;

export interface ConvoyLoad {
  view: ConvoyView;
  partial: boolean;
  fetchedAt: string;
}

export async function loadConvoyView(rootBeadId: string): Promise<ConvoyLoad> {
  const fetchedAt = new Date().toISOString();
  const root = normalizeBead(await fetchSupervisorBead(rootBeadId));
  const list = await listSupervisorBeads({
    includeClosed: true,
    includeBookkeeping: true,
    limit: CONVOY_FETCH_LIMIT,
  });
  const beads = normalizeBeads(list.items);
  const children = descendantsOf(root.id, beads);
  // Truncation signal: the supervisor reported more beads than the bounded read
  // returned. This caller applies no post-fetch filtering (includeClosed +
  // includeBookkeeping), so upstream_fetched is the full wire page and the
  // comparison cleanly reflects a cut-off fetch window — a descendant could sit
  // past it, so the route shows a partial notice rather than implying coverage.
  const partial = list.upstream_total !== undefined && list.upstream_total > list.upstream_fetched;
  return {
    view: projectConvoyView(root, children, null),
    partial,
    fetchedAt,
  };
}

/**
 * Collect the transitive `parent`-chain descendants of `rootId` from the flat
 * bead list, excluding the root itself. Cycles cannot inflate the result — a
 * bead already visited is never re-queued.
 */
function descendantsOf(rootId: string, beads: readonly DashboardBead[]): DashboardBead[] {
  const childrenByParent = new Map<string, DashboardBead[]>();
  for (const bead of beads) {
    if (bead.parent === undefined || bead.parent === bead.id) continue;
    const siblings = childrenByParent.get(bead.parent);
    if (siblings === undefined) childrenByParent.set(bead.parent, [bead]);
    else siblings.push(bead);
  }

  const collected: DashboardBead[] = [];
  const seen = new Set<string>([rootId]);
  // BFS over a growing frontier. `for...of` yields each id as a plain `string`
  // (no `shift()`/index `string | undefined` to assert away) and the Array
  // iterator observes ids pushed mid-loop, so newly-found descendants are
  // visited in turn. `seen` makes the push idempotent, so a cycle terminates.
  const frontier: string[] = [rootId];
  for (const parentId of frontier) {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      collected.push(child);
      frontier.push(child.id);
    }
  }
  return collected;
}
