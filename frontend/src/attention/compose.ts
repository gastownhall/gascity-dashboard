export const ATTENTION_DOMAINS = [
  'agents',
  'beads',
  'runs',
  'mail',
  'activity',
  'health',
  'maintainer',
] as const;

export type AttentionSeverity = 'attention' | 'watch';
export type AttentionDomain = typeof ATTENTION_DOMAINS[number];

export interface AttentionItem {
  id: string;
  domain: AttentionDomain;
  severity: AttentionSeverity;
  title: string;
  href?: string;
  summary?: string;
  current?: boolean;
  actionable?: boolean;
  updatedAt?: string;
}

export interface AttentionContributor {
  id: string;
  domain: AttentionDomain;
  getItems(): readonly AttentionItem[];
}

export interface AttentionDomainSummary {
  domain: AttentionDomain;
  attention: number;
  watch: number;
  severity: AttentionSeverity | null;
  items: readonly AttentionItem[];
}

export interface AttentionOverflowGroup {
  domain: AttentionDomain;
  attention: number;
  watch: number;
  total: number;
}

export interface AttentionModel {
  items: readonly AttentionItem[];
  topItems: readonly AttentionItem[];
  overflowByDomain: readonly AttentionOverflowGroup[];
  byDomain: Record<AttentionDomain, AttentionDomainSummary>;
}

export interface ComposeAttentionOptions {
  topLimit?: number;
}

const DEFAULT_TOP_LIMIT = 5;

const DOMAIN_ORDER = new Map<AttentionDomain, number>(
  ATTENTION_DOMAINS.map((domain, index) => [domain, index]),
);

export function composeAttention(
  contributors: readonly AttentionContributor[],
  options: ComposeAttentionOptions = {},
): AttentionModel {
  const byDomain = emptyDomainSummaries();
  const indexedItems: Array<{ item: AttentionItem; index: number }> = [];
  let index = 0;

  for (const contributor of contributors) {
    for (const item of contributor.getItems()) {
      indexedItems.push({ item, index });
      const summary = byDomain[item.domain];
      const nextItems = [...summary.items, item];
      byDomain[item.domain] = {
        domain: item.domain,
        attention: summary.attention + (item.severity === 'attention' ? 1 : 0),
        watch: summary.watch + (item.severity === 'watch' ? 1 : 0),
        severity: highestSeverity(summary.severity, item.severity),
        items: nextItems,
      };
      index += 1;
    }
  }

  const items = indexedItems
    .sort((a, b) => compareAttentionItems(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
  const topLimit = options.topLimit ?? DEFAULT_TOP_LIMIT;
  const topItems = items.slice(0, topLimit);
  const overflowByDomain = groupOverflow(items.slice(topLimit));

  return { items, topItems, overflowByDomain, byDomain };
}

function emptyDomainSummaries(): Record<AttentionDomain, AttentionDomainSummary> {
  const summaries = {} as Record<AttentionDomain, AttentionDomainSummary>;
  for (const domain of ATTENTION_DOMAINS) {
    summaries[domain] = {
      domain,
      attention: 0,
      watch: 0,
      severity: null,
      items: [],
    };
  }
  return summaries;
}

function highestSeverity(
  current: AttentionSeverity | null,
  next: AttentionSeverity,
): AttentionSeverity {
  if (current === 'attention' || next === 'attention') return 'attention';
  return 'watch';
}

function compareAttentionItems(a: AttentionItem, b: AttentionItem): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    booleanRank(b.current ?? true) - booleanRank(a.current ?? true) ||
    booleanRank(b.actionable ?? false) - booleanRank(a.actionable ?? false) ||
    recencyRank(b.updatedAt) - recencyRank(a.updatedAt) ||
    domainRank(a.domain) - domainRank(b.domain)
  );
}

function severityRank(severity: AttentionSeverity): number {
  return severity === 'attention' ? 0 : 1;
}

function booleanRank(value: boolean): number {
  return value ? 1 : 0;
}

function recencyRank(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function domainRank(domain: AttentionDomain): number {
  return DOMAIN_ORDER.get(domain) ?? ATTENTION_DOMAINS.length;
}

function groupOverflow(items: readonly AttentionItem[]): AttentionOverflowGroup[] {
  const groups: AttentionOverflowGroup[] = [];
  for (const domain of ATTENTION_DOMAINS) {
    let attention = 0;
    let watch = 0;
    for (const item of items) {
      if (item.domain !== domain) continue;
      if (item.severity === 'attention') attention += 1;
      else watch += 1;
    }
    const total = attention + watch;
    if (total > 0) groups.push({ domain, attention, watch, total });
  }
  return groups;
}
