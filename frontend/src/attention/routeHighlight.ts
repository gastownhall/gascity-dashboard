import type { HTMLAttributes } from 'react';
import type {
  AttentionDomain,
  AttentionModel,
  AttentionSeverity,
} from './compose';

type AttentionAttributes<T extends HTMLElement> = HTMLAttributes<T> & {
  'data-attention-severity'?: AttentionSeverity;
};

export function resourceAttentionSeverity(
  model: AttentionModel,
  domain: AttentionDomain,
  resourceId: string,
): AttentionSeverity | null {
  const prefix = `${domain}:${resourceId}:`;
  const exact = `${domain}:${resourceId}`;
  let severity: AttentionSeverity | null = null;
  for (const item of model.byDomain[domain].items) {
    if (item.id !== exact && !item.id.startsWith(prefix)) continue;
    if (item.severity === 'attention') return 'attention';
    severity = 'watch';
  }
  return severity;
}

export function prefixedAttentionSeverity(
  model: AttentionModel,
  domain: AttentionDomain,
  itemIdPrefixes: readonly string[],
): AttentionSeverity | null {
  let severity: AttentionSeverity | null = null;
  for (const item of model.byDomain[domain].items) {
    if (!itemIdPrefixes.some((prefix) => item.id.startsWith(prefix))) continue;
    if (item.severity === 'attention') return 'attention';
    severity = 'watch';
  }
  return severity;
}

export function attentionRowProps(
  severity: AttentionSeverity | null,
): AttentionAttributes<HTMLTableRowElement> {
  if (severity === null) return {};
  return {
    'data-attention-severity': severity,
    className: attentionHighlightClass(severity),
  };
}

export function attentionListItemProps(
  severity: AttentionSeverity | null,
): AttentionAttributes<HTMLLIElement> {
  if (severity === null) return {};
  return {
    'data-attention-severity': severity,
    className: attentionHighlightClass(severity),
  };
}

export function attentionBlockProps(
  severity: AttentionSeverity | null,
): AttentionAttributes<HTMLDivElement> {
  if (severity === null) return {};
  return {
    'data-attention-severity': severity,
    className: attentionHighlightClass(severity),
  };
}

export function attentionSectionProps(
  severity: AttentionSeverity | null,
): AttentionAttributes<HTMLElement> {
  if (severity === null) return {};
  const toneClass = severity === 'attention'
    ? 'border-accent bg-accent/5'
    : 'border-warn bg-warn/5';
  return {
    'data-attention-severity': severity,
    className: `border-l-2 pl-4 -ml-4 py-1 ${toneClass}`,
  };
}

function attentionHighlightClass(severity: AttentionSeverity): string {
  return severity === 'attention'
    ? 'bg-accent/10 hover:bg-accent/15'
    : 'bg-warn/10 hover:bg-warn/15';
}
