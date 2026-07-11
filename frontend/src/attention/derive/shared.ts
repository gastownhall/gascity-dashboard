import type { SourceStatus } from 'gas-city-dashboard-shared';
import type { AttentionDomain, AttentionItem } from '../compose';

/**
 * Read freshness threaded onto every domain's facts by the live contributor
 * layer (gascity-dashboard-5t0m, Freshness Spine): the SourceStatus and ISO
 * `fetchedAt` of the cache read the facts were assembled from. Folded per-domain
 * into AttentionDomainSummary (worst provenance + oldest fetchedAt) so the board
 * can answer "is each domain's data CURRENT?" — independent of whether it is
 * alarming. Every *AttentionFacts extends this so the signal is uniform.
 */
export interface ReadFreshnessFacts {
  provenance?: SourceStatus;
  fetchedAt?: string;
  /**
   * ISO instant after which this read is no longer current
   * (`fetchedAt + ATTENTION_READ_STALE_AFTER_MS`, gascity-dashboard-fchh). Set
   * only by polled cache-read domains; the event-driven runs source omits it so
   * it never age-flips. composeAttention folds the soonest `staleAt` per domain;
   * boardFreshness flips a domain to `stale` once `now >= staleAt`.
   */
  staleAt?: string;
}

export function domainAttention(
  domain: AttentionDomain,
  item: Omit<AttentionItem, 'domain' | 'severity' | 'current' | 'actionable'>,
): AttentionItem {
  return {
    domain,
    severity: 'attention',
    current: true,
    actionable: true,
    ...item,
  };
}

export function domainWatch(
  domain: AttentionDomain,
  item: Omit<AttentionItem, 'domain' | 'severity' | 'current' | 'actionable'>,
): AttentionItem {
  return {
    domain,
    severity: 'watch',
    current: true,
    actionable: false,
    ...item,
  };
}

/**
 * A data-unavailability item: a slice of a source could not be read. It reports
 * the degradation WITHOUT inflating or recoloring the domain's nav badge (see
 * AttentionSeverity).
 */
export function domainUnavailable(
  domain: AttentionDomain,
  item: Omit<AttentionItem, 'domain' | 'severity' | 'current' | 'actionable'>,
): AttentionItem {
  return {
    domain,
    severity: 'unavailable',
    current: true,
    actionable: false,
    ...item,
  };
}
