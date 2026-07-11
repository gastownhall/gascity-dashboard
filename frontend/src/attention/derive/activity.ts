import type { DeployList } from 'gas-city-dashboard-shared';
import type { TypedEventStreamEnvelope } from 'gas-city-dashboard-shared/gc-supervisor';
import { supervisorEventDetail, supervisorEventSignal } from '../../supervisor/eventSignals';
import type { AttentionItem } from '../compose';
import { domainAttention, domainWatch, type ReadFreshnessFacts } from './shared';

export interface ActivityAttentionFacts extends ReadFreshnessFacts {
  deploys?: DeployList;
  deploysError?: string;
  events?: readonly TypedEventStreamEnvelope[];
  eventsDegraded?: string;
  eventsError?: string;
  eventsPartial?: boolean;
}

export function deriveActivityAttention(
  facts: ActivityAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.deploysError !== undefined && facts.deploysError.length > 0) {
    items.push(
      domainAttention('activity', {
        id: 'activity:deploys-unavailable',
        title: 'Deploy data unavailable',
        summary: facts.deploysError,
        href: '/activity',
      }),
    );
  }
  if (facts.eventsDegraded !== undefined && facts.eventsDegraded.length > 0) {
    items.push(
      domainWatch('activity', {
        id: 'activity:events-degraded',
        title: 'Event stream degraded',
        summary: facts.eventsDegraded,
        href: '/activity',
      }),
    );
  }
  if (facts.eventsError !== undefined && facts.eventsError.length > 0) {
    items.push(
      domainWatch('activity', {
        id: 'activity:events-unavailable',
        title: 'Event history unavailable',
        summary: facts.eventsError,
        href: '/activity',
      }),
    );
  }
  if (facts.eventsPartial === true) {
    items.push(
      domainWatch('activity', {
        id: 'activity:events-partial',
        title: 'Event history incomplete',
        href: '/activity',
      }),
    );
  }
  appendActivityEventAttention(items, facts.events ?? []);

  const deploys = facts.deploys;
  if (deploys === undefined) return items;
  if (deploys.failed_marker) {
    items.push(
      domainAttention('activity', {
        id: 'activity:failed-marker',
        title: 'Deploy failed marker present',
        href: '/activity',
      }),
    );
  }
  for (const deploy of deploys.items) {
    if (deploy.status === 'failed') {
      items.push(
        domainAttention('activity', {
          id: `activity:deploy:${deploy.at}:failed`,
          title: 'Deploy failed',
          summary: deploy.detail,
          href: '/activity',
          updatedAt: deploy.at,
        }),
      );
    } else if (deploy.status === 'in-progress') {
      items.push(
        domainWatch('activity', {
          id: `activity:deploy:${deploy.at}:in-progress`,
          title: 'Deploy in progress',
          summary: deploy.detail,
          href: '/activity',
          updatedAt: deploy.at,
        }),
      );
    }
  }
  return items;
}

function appendActivityEventAttention(
  items: AttentionItem[],
  events: readonly TypedEventStreamEnvelope[],
): void {
  for (const event of events) {
    const signal = supervisorEventSignal(event);
    if (signal === 'event') continue;
    const builder = signal === 'attention' ? domainAttention : domainWatch;
    items.push(
      builder('activity', {
        id: `activity:event:${String(event.seq)}:${event.type}`,
        title: event.type,
        summary: supervisorEventDetail(event),
        href: activityEventHref(event),
        updatedAt: event.ts,
      }),
    );
  }
}

function activityEventHref(event: TypedEventStreamEnvelope): string {
  const params = new URLSearchParams({
    mode: 'events',
    type: event.type,
  });
  return `/activity?${params.toString()}`;
}
