import type { ConvoyView, DashboardBead } from 'gas-city-dashboard-shared';
import { projectConvoyView } from 'gas-city-dashboard-shared';
import { LOG_COMPONENT, logWarn } from '../lib/logging';
import { fetchBeadSubtreeIds, fetchSupervisorBead, listSupervisorBeads } from './beadReads';
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
//     no step children the parent-chain scan does not — and it is slow. So it is
//     not the projection source; it serves only as the authoritative subtree
//     walk that confirms completeness on the truncated-page path (jy3d, below).
// So there is no supervisor progress count to prefer: `projectConvoyView`
// derives progress from the materialized children, and a graph.v2 root with no
// exposed children collapses to the honest "steps not exposed" state. The
// authoritative graph.v2 step graph lives in the workflow snapshot
// (WorkflowSnapshotResponse) — wiring it here is the jl3c redesign, out of
// scope for this loader. The route composes only allowlisted reads — `beads`,
// `bead/{id}`, and the `beads/graph/{rootID}` completeness walk — so it works
// under DASHBOARD_READONLY=1 as-is.
//
// Truncation is honest AND subtree-scoped: a busy city's closed beads can
// exceed one bounded page, but a truncated city page only matters when it could
// be hiding a member of THIS convoy's subtree. So when the page read is
// incomplete (the supervisor flags it, returns a `next_cursor`, or its total
// outruns the page) the loader confirms the subtree against the authoritative
// graph walk before warning — see `deriveConvoyPartial` (gascity-dashboard-jy3d).

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
  const view = projectConvoyView(root, children, null);
  return {
    view,
    partial: await deriveConvoyPartial(view, children, list.partial),
  };
}

/**
 * Whether the convoy view is built from an incomplete subtree — the precise
 * signal behind the route's "Partial convoy" notice (gascity-dashboard-jy3d).
 *
 * A complete city page proves the subtree is whole, so it is never partial. A
 * truncated city page only matters when it could be hiding a member of THIS
 * convoy's subtree, so the broad `list.partial` is narrowed in two steps:
 *
 *  - A graph.v2 run root's steps live in the workflow snapshot, never as
 *    parent-linked beads in the city page (the gascity-dashboard-jl3c hole), so
 *    a truncated page provably cannot hide them — the collapse to
 *    `graph_v2_root_only` is structural, not truncation-induced.
 *  - Otherwise (materialized steps, or a leaf a truncated page might be hiding
 *    children behind) the authoritative graph walk reports the true descendant
 *    set; the convoy is partial only when that set holds an id the bounded page
 *    did not capture.
 *
 * The graph walk runs only on the truncated-page path, so the slower scoped read
 * is paid only in the large-city case it disambiguates. If it fails the loader
 * stays conservative (over-warn, never hide missing steps) and logs the
 * degradation rather than swallowing it.
 */
async function deriveConvoyPartial(
  view: ConvoyView,
  children: readonly DashboardBead[],
  cityPagePartial: boolean,
): Promise<boolean> {
  if (!cityPagePartial) return false;
  if (view.exposure.kind === 'collapsed' && view.exposure.reason === 'graph_v2_root_only') {
    return false;
  }
  try {
    const subtreeIds = await fetchBeadSubtreeIds(view.rootBeadId);
    const captured = new Set(children.map((child) => child.id));
    return subtreeIds.some((id) => !captured.has(id));
  } catch (err) {
    logWarn(
      LOG_COMPONENT.convoy,
      `subtree completeness check failed for ${view.rootBeadId}; staying conservative: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return true;
  }
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
