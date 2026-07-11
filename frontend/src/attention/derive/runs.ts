import type { RunSummary } from 'gas-city-dashboard-shared';
import { selectBlockedRuns, selectStrandedRuns } from 'gas-city-dashboard-shared';
import { runDetailHref } from '../../supervisor/runHref';
import type { AttentionItem } from '../compose';
import { domainAttention, domainUnavailable, type ReadFreshnessFacts } from './shared';

export interface RunsAttentionFacts extends ReadFreshnessFacts {
  /**
   * The bead-derived run summary (gascity-dashboard-2j8e.2). The Runs badge
   * counts genuinely-blocked runs from `summary.blockedLanes` — the same
   * selectBlockedRuns the /runs page reads, so the badge and the page count
   * cannot disagree. The formula feed is deliberately NOT a source here: it
   * surfaced phantom feed-only roots (gc-1920 codeprobe upstream_error) and
   * flapped 6<->13 on partial fan-outs.
   */
  summary?: RunSummary;
  error?: string;
}

export function deriveRunsAttention(
  facts: RunsAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(
      domainAttention('runs', {
        id: 'runs:unavailable',
        title: 'Run data unavailable',
        summary: facts.error,
        href: '/runs',
      }),
    );
    return items;
  }

  const summary = facts.summary;
  if (summary === undefined) return items;

  // dash-ygj + gascity-dashboard-2j8e.2: degraded runs reads land in the
  // `unavailable` tier, which BadgeSeverity excludes — so a partial fan-out and
  // any lane whose health could not be read surface as quiet, non-counting items
  // (never a badge number).
  // The formula feed is no longer a source (it produced the gc-1920 phantom roots
  // and flapped 6<->13), so #91's feed-derived emitters are gone; only the
  // summary-derived degraded reads survive.
  if (summary.lanesPartial === true) {
    items.push(
      domainUnavailable('runs', {
        id: 'runs:partial',
        title: 'Run list incomplete',
        href: '/runs',
      }),
    );
  }
  for (const lane of [...summary.lanes, ...summary.blockedLanes, ...summary.strandedLanes]) {
    if (lane.health.status === 'available') continue;
    items.push(
      domainUnavailable('runs', {
        id: `runs:${lane.id}:health-unavailable`,
        title: `${lane.title} health unavailable`,
        summary: lane.health.error,
        href: runDetailHref(lane.id, lane.scope),
      }),
    );
  }

  // gascity-dashboard-2j8e.2: the Runs badge counts GENUINELY-BLOCKED runs only
  // — exactly the selectBlockedRuns set the /runs page renders, so the badge
  // number and the page's Blocked count read one selector and cannot disagree.
  // A supervisor `partial` read is never counted (it lands in the unavailable
  // tier above), so the count no longer flaps on a partial fan-out.
  for (const run of selectBlockedRuns(summary.blockedLanes)) {
    items.push(
      domainAttention('runs', {
        id: `runs:${run.id}:blocked`,
        title: `${run.title} blocked`,
        summary: run.reason,
        href: runDetailHref(run.id, run.scope),
      }),
    );
  }

  // gascity-dashboard-pxvb: a stranded run (orphaned molecule that never
  // executed) is the state most needing an operator action — clean up or
  // re-dispatch — yet it emitted no attention item and rode the Active set as
  // false-alive work. Surface it as a counting attention item, the same
  // selectStrandedRuns set the /runs Stranded section renders, so the badge
  // number and the page count read one selector and cannot disagree.
  for (const run of selectStrandedRuns(summary.strandedLanes)) {
    items.push(
      domainAttention('runs', {
        id: `runs:${run.id}:stranded`,
        title: `${run.title} stranded`,
        summary: run.remedy,
        href: runDetailHref(run.id, run.scope),
      }),
    );
  }
  return items;
}
