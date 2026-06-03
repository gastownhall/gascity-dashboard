import type { TriageItem } from 'gas-city-dashboard-shared';

export function maintainerResourceId(
  item: Pick<TriageItem, 'kind' | 'number'>,
): string {
  return `${item.kind}-${item.number}`;
}
