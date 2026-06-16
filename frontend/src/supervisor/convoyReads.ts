import type { ConvoyView, DashboardBead } from 'gas-city-dashboard-shared';
import { projectConvoyView } from 'gas-city-dashboard-shared';
import { fetchSupervisorBead, listSupervisorBeads } from './beadReads';
import { normalizeBead, normalizeBeads } from './normalizeBead';

// Loader for the /convoy/:rootBead route (gascity-dashboard-caag, Shape A).
//
// It COMPOSES the generated supervisor client — the root bead plus a bounded
// city bead read — and derives the convoy's step graph client-side from the
// `parent` chain, exactly as the Beads board inverts `needs`.
//
// Why the derived path, not the supervisor's convoy/{id} or beads/graph/{root}
// endpoints (both DO exist on the generated client — gascity-dashboard-y6v3):
// neither yields usable data for the graph.v2 workflow roots this route is
// reached with (linked only from a run's RootMeta, i.e. a run root bead).
// Verified against a live city:
//   * convoy/{id} is keyed by a convoy ENTITY id, not a root bead id — calling
//     it with a run root returns the workflow-snapshot case, which carries no
//     `progress` field (and the generated `ConvoyGetResponse` does not model
//     that case); a plain bead 404s "is not a convoy". Convoy progress is only
//     populated for non-workflow convoy entities the /convoy/:rootBead route
//     never addresses.
//   * beads/graph/{root} collapses graph.v2 snapshots to the root bead alone
//     (the same upstream hole tracked by gascity-dashboard-jl3c), so it returns
//     no step children the parent-chain scan does not — and it is slow.
// So there is no supervisor progress count to prefer: `projectConvoyView`
// derives progress from the materialized children, and a graph.v2 root with no
// exposed children collapses to the honest "steps not exposed" state. The
// authoritative graph.v2 step graph lives in the workflow snapshot
// (WorkflowSnapshotResponse) — wiring it here is the jl3c redesign, out of
// scope for this loader. Because the route composes only the already-allowed
// `beads` and `bead/{id}` reads, it works under DASHBOARD_READONLY=1 as-is.
//
// Truncation is honest: a busy city's closed beads can exceed one bounded page,
// so `partial` trips when the bounded read is incomplete (the supervisor flags
// it, returns a `next_cursor`, or its total outruns the page) and the route
// renders a partial notice rather than silently dropping steps.

// Convoy step beads are bookkeeping-typed and frequently closed, so the read
// must include both — unlike the board's default open/engineering view.
const CONVOY_FETCH_LIMIT = 1_000;

export interface ConvoyLoad {
  view: ConvoyView;
  partial: boolean;
}

export async function loadConvoyView(rootBeadId: string): Promise<ConvoyLoad> {
  const root = normalizeBead(await fetchSupervisorBead(rootBeadId));
  const list = await listSupervisorBeads({
    includeClosed: true,
    includeBookkeeping: true,
    limit: CONVOY_FETCH_LIMIT,
  });
  const beads = normalizeBeads(list.items);
  const children = descendantsOf(root.id, beads);
  return {
    view: projectConvoyView(root, children, null),
    // Conservative by design: a truncated city page cannot prove this convoy's
    // subtree is complete — a descendant could sit in the unfetched tail, and a
    // flat list gives no way to tell "all descendants fetched" from "some
    // missing". So we surface partial whenever the city page is incomplete. This
    // can over-warn (the convoy may in fact be whole), but never under-warns
    // (hiding missing steps). Tightening to a true subtree-scoped completeness
    // check needs a supervisor subtree query — tracked as a follow-up.
    partial: list.partial,
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
