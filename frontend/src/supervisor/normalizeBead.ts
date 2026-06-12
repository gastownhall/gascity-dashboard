import type { DashboardBead } from 'gas-city-dashboard-shared';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

// Narrow a supervisor wire `Bead` into the dashboard-owned `DashboardBead`
// projection at the frontend edge. Shared selectors operate on DashboardBead
// and never import the generated supervisor type; this is the single seam that
// drops it (gascity-dashboard-caag consolidated the per-reader copies that had
// drifted independently in entityLinks.ts and runSummary.ts).
//
// Optional wire fields are copied only when present so an absent field stays
// absent on the projection rather than becoming an explicit `undefined`.

export function normalizeBead(bead: Bead): DashboardBead {
  const normalized: DashboardBead = {
    id: bead.id,
    title: bead.title,
    status: bead.status,
    issue_type: bead.issue_type,
    priority: bead.priority ?? null,
    created_at: bead.created_at,
  };
  if (bead.description !== undefined) normalized.description = bead.description;
  if (bead.assignee !== undefined) normalized.assignee = bead.assignee;
  if (Array.isArray(bead.labels)) normalized.labels = bead.labels;
  if (bead.metadata !== undefined) normalized.metadata = bead.metadata;
  if (bead.ref !== undefined) normalized.ref = bead.ref;
  if (bead.parent !== undefined) normalized.parent = bead.parent;
  if (bead.from !== undefined) normalized.from = bead.from;
  if (bead.ephemeral !== undefined) normalized.ephemeral = bead.ephemeral;
  if (bead.needs !== undefined) normalized.needs = bead.needs;
  if (bead.dependencies !== undefined) normalized.dependencies = bead.dependencies;
  if (bead.updated_at !== undefined) normalized.updated_at = bead.updated_at;
  return normalized;
}

export function normalizeBeads(beads: readonly Bead[]): DashboardBead[] {
  return beads.map(normalizeBead);
}
