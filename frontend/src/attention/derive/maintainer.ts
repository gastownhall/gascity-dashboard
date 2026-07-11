import type { MaintainerTriage, TriageItem } from 'gas-city-dashboard-shared';
import { maintainerResourceId } from '../../views/modules/maintainer/attentionKeys';
import { isNeedsYou, NEEDS_YOU_VIEW_PARAM } from '../../views/modules/maintainer/needsYou';
import type { AttentionItem } from '../compose';
import { domainAttention, domainWatch, type ReadFreshnessFacts } from './shared';

export interface MaintainerAttentionFacts extends ReadFreshnessFacts {
  enabled?: boolean;
  triage?: MaintainerTriage;
  nowMs?: number;
  error?: string;
}

export function deriveMaintainerAttention(
  facts: MaintainerAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined || facts.enabled === false) return items;

  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(
      domainWatch('maintainer', {
        id: 'maintainer:triage-unavailable',
        title: 'Triage data unavailable',
        summary: facts.error,
        href: '/maintainer',
      }),
    );
  }

  const triage = facts.triage;
  if (triage === undefined) return items;

  const nowMs = facts.nowMs ?? Date.now();
  for (const item of maintainerTierItems(triage)) {
    const resourceId = maintainerResourceId(item);
    if (isNeedsYou(item, nowMs)) {
      items.push(
        domainAttention('maintainer', {
          id: `maintainer:${resourceId}:needs-you`,
          title: `${maintainerItemLabel(item)} needs you`,
          summary: item.title,
          href: `/maintainer?view=${encodeURIComponent(NEEDS_YOU_VIEW_PARAM)}`,
          updatedAt: item.updated_at,
        }),
      );
      continue;
    }
    if (item.triage_assessment === null && item.slung === null) {
      items.push(
        domainAttention('maintainer', {
          id: `maintainer:${resourceId}:needs-triage`,
          title: `${maintainerItemLabel(item)} needs triage`,
          summary: item.title,
          href: '/maintainer',
          updatedAt: item.updated_at,
        }),
      );
    }
  }

  for (const item of triage.slung_section ?? []) {
    const slung = item.slung;
    const resourceId = maintainerResourceId(item);
    if (slung !== null && slung.resolved_session_name === null) {
      items.push(
        domainAttention('maintainer', {
          id: `maintainer:${resourceId}:slung-unresolved`,
          title: `${maintainerItemLabel(item)} has no resolved agent`,
          summary: item.title,
          href: '/maintainer',
          updatedAt: slung.slung_at,
        }),
      );
    } else {
      items.push(
        domainWatch('maintainer', {
          id: `maintainer:${resourceId}:slung`,
          title: `${maintainerItemLabel(item)} is with an agent`,
          summary: item.title,
          href: '/maintainer',
          updatedAt: slung?.slung_at ?? item.updated_at,
        }),
      );
    }
  }

  return items;
}

function maintainerTierItems(triage: MaintainerTriage): TriageItem[] {
  const items: TriageItem[] = [];
  for (const tier of triage.tiers) {
    for (const cluster of tier.clusters) items.push(...cluster.items);
    items.push(...tier.unclustered);
  }
  return items;
}

function maintainerItemLabel(item: Pick<TriageItem, 'kind' | 'number'>): string {
  return `${item.kind === 'pr' ? 'PR' : 'Issue'} #${item.number}`;
}
