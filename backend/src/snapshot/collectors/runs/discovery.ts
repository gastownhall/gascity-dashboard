import type { GcBead } from 'gas-city-dashboard-shared';

import type { GcClient } from '../../../gc-client.js';
import { fromFeedScope, fromRootMetadataScope, fromStoreRef } from '../../../lib/run-scope.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../../../logging.js';
import { RECENT_RUN_FETCH_LIMIT } from './constants.js';
import type { RunFeedScope, RunFeedScopeMap } from './types.js';

interface LoadedRunBeads {
  beads: GcBead[];
  /**
   * Authoritative per-root supervisor query scope harvested from /formulas/feed.
   */
  feedScopes: RunFeedScopeMap;
  /**
   * True when one or more per-source recent-run queries were skipped.
   */
  partial: boolean;
}

export async function loadRunBeads(
  gc: GcClient,
  limit: number,
): Promise<LoadedRunBeads> {
  // The city-molecule query has static city-scoped params and no dependency on
  // feed discovery, so it rides the first parallel wave alongside the city
  // listBeads and the feed fetch — never serialized behind them (wbe9). Only
  // the per-rig queries depend on the discovered rig set, so they form a second
  // wave once rig names are known.
  const moleculeFetch = settledRecentFetch(gc, {
    label: 'city molecule list',
    params: { limit: RECENT_RUN_FETCH_LIMIT, type: 'molecule', all: true },
  });
  const [active, feedDiscovery] = await Promise.all([
    gc.listBeads(undefined, { limit }),
    discoverFromFeed(gc),
  ]);
  const rigNames = unionRigNames(runRigNames(active.items), feedDiscovery.rigNames);

  const rigFetches = rigNames.map((rig) =>
    settledRecentFetch(gc, {
      label: `rig '${rig}'`,
      params: { limit: RECENT_RUN_FETCH_LIMIT, type: 'task', rig, all: true },
    }),
  );

  const settled = await Promise.all([moleculeFetch, ...rigFetches]);

  const recentItems: GcBead[] = [];
  let partial = false;
  for (const outcome of settled) {
    if (outcome.ok) {
      recentItems.push(...outcome.items);
      continue;
    }
    partial = true;
    logWarn(
      LOG_COMPONENT.snapshot,
      `recent-run fetch failed for ${outcome.label}: ${errorMessage(outcome.error)}; skipping (runs snapshot degraded to partial)`,
    );
  }

  return {
    beads: uniqueBeads([...active.items, ...recentItems]),
    feedScopes: feedDiscovery.scopes,
    partial,
  };
}

type RecentFetchOutcome =
  | { ok: true; items: GcBead[] }
  | { ok: false; label: string; error: unknown };

async function settledRecentFetch(
  gc: GcClient,
  source: { label: string; params: Parameters<GcClient['listBeads']>[1] },
): Promise<RecentFetchOutcome> {
  try {
    return { ok: true, items: (await gc.listBeads(undefined, source.params)).items };
  } catch (error) {
    return { ok: false, label: source.label, error };
  }
}

interface FeedDiscovery {
  rigNames: string[];
  scopes: RunFeedScopeMap;
}

/**
 * Discover rigs hosting active formula runs and harvest per-run supervisor
 * query scope. Feed failure is a logged soft fallback so city/listBeads
 * collection can still produce a runs snapshot.
 */
export async function discoverFromFeed(gc: GcClient): Promise<FeedDiscovery> {
  try {
    const runs = await gc.listFormulaRuns({
      scopeKind: 'city',
      scopeRef: gc.cityName,
    });
    const rigNames = new Set<string>();
    const scopes = new Map<string, RunFeedScope>();
    for (const run of runs.items ?? []) {
      if (run.type !== 'formula') continue;
      const storeRef = run.root_store_ref ?? null;
      const storeScope = fromStoreRef(storeRef);
      if (storeScope?.scopeKind === 'rig') {
        rigNames.add(storeScope.scopeRef);
      }
      const rootId = run.root_bead_id ?? run.workflow_id ?? null;
      const scope = fromFeedScope(run);
      if (rootId !== null && scope !== null) {
        scopes.set(rootId, {
          scopeKind: scope.scopeKind,
          scopeRef: scope.scopeRef,
          rootStoreRef: scope.rootStoreRef,
        });
      }
    }
    return { rigNames: [...rigNames], scopes };
  } catch (err) {
    logWarn(
      LOG_COMPONENT.snapshot,
      `feed-based rig discovery failed: ${errorMessage(err)}; falling back to listBeads-only discovery`,
    );
    return { rigNames: [], scopes: new Map() };
  }
}

export function unionRigNames(a: readonly string[], b: readonly string[]): string[] {
  const all = new Set<string>();
  for (const name of a) all.add(name);
  for (const name of b) all.add(name);
  return [...all];
}

export function runRigNames(beads: readonly GcBead[]): string[] {
  const names = new Set<string>();
  for (const bead of beads) {
    const storeScope = fromStoreRef(bead.metadata?.['gc.root_store_ref']);
    if (storeScope?.scopeKind === 'rig') {
      names.add(storeScope.scopeRef);
      continue;
    }

    const metadataScope = fromRootMetadataScope(bead.metadata);
    if (metadataScope?.scopeKind === 'rig') {
      names.add(metadataScope.scopeRef);
    }
  }
  return Array.from(names).sort();
}

export function uniqueBeads(beads: readonly GcBead[]): GcBead[] {
  const byId = new Map<string, GcBead>();
  for (const bead of beads) {
    if (!byId.has(bead.id)) byId.set(bead.id, bead);
  }
  return Array.from(byId.values());
}
