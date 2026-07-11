import type { Message } from 'gas-city-dashboard-shared/gc-supervisor';
import { selectOperatorActionableUnread } from 'gas-city-dashboard-shared';
import { elapsedSince, formatElapsed } from '../elapsed';
import type { AttentionItem } from '../compose';
import { domainAttention, domainUnavailable, domainWatch, type ReadFreshnessFacts } from './shared';

export interface MailAttentionFacts extends ReadFreshnessFacts {
  items?: readonly Message[];
  nowMs?: number;
  partial?: boolean;
  error?: string;
}

const MAIL_UNREAD_STALE_MS = 24 * 60 * 60 * 1000;

export function deriveMailAttention(
  facts: MailAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  // gascity-dashboard-m1gi: a failed mail READ is a degradation, not actionable
  // mail, so it rides the non-counting `unavailable` tier (see beads above) —
  // visible, but a 503 never inflates the Mail badge.
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(
      domainUnavailable('mail', {
        id: 'mail:unavailable',
        title: 'Mail data unavailable',
        summary: facts.error,
        href: '/mail',
      }),
    );
  }
  if (facts.partial === true) {
    items.push(
      domainWatch('mail', {
        id: 'mail:partial',
        title: 'Mail list incomplete',
        href: '/mail',
      }),
    );
  }
  const nowMs = facts.nowMs ?? Date.now();
  // gascity-dashboard-2j8e.5: the Mail badge counts the operator's needs-you
  // mail — unread, minus the pool-worker firehose (the ~93 inflation) — via the
  // SAME selectOperatorActionableUnread the Mail page reads over the operator
  // inbox, so the badge and the page agree on one selector (mirrors the Runs
  // selectBlockedRuns). Every kept message is addressed to the operator (the
  // fetch reads the operator inbox), so each surfaces as an attention item.
  for (const message of selectOperatorActionableUnread(facts.items ?? [])) {
    const staleAgeMs = elapsedSince(message.created_at, nowMs);
    const stale = staleAgeMs !== null && staleAgeMs >= MAIL_UNREAD_STALE_MS;
    items.push(
      domainAttention('mail', {
        id: `mail:${message.id}:${stale ? 'unread-stale' : 'unread'}`,
        title: message.subject,
        summary: stale
          ? `from ${message.from}, unread for ${formatElapsed(staleAgeMs)}`
          : `from ${message.from}`,
        href: mailHref(message.id),
        updatedAt: message.created_at,
      }),
    );
  }
  return items;
}

function mailHref(messageId: string): string {
  const search = new URLSearchParams();
  search.set('message', messageId);
  return `/mail?${search.toString()}`;
}
