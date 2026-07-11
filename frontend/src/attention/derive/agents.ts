import type { AgentResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import { selectAgentsNeedingYou } from 'gas-city-dashboard-shared';
import { agentNeedsYouReasonLabel } from '../agentNeedsYou';
import type { AgentPendingInteraction } from '../../supervisor/agentPending';
import type { AttentionItem } from '../compose';
import { domainAttention, domainUnavailable, type ReadFreshnessFacts } from './shared';

export interface AgentsAttentionFacts extends ReadFreshnessFacts {
  items?: readonly AgentResponse[];
  pendingInteractions?: readonly AgentPendingInteraction[];
  partial?: boolean;
  error?: string;
  pendingError?: string;
}

export function deriveAgentsAttention(
  facts: AgentsAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;

  // gascity-dashboard-2j8e.4: data-availability degradation lands in the
  // `unavailable` tier (BadgeSeverity excludes it), so a failed/partial read
  // surfaces the degradation WITHOUT inflating the needs-you badge number. A
  // whole-roster failure can't be projected into needs-you, so return with just
  // the degradation marker.
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(
      domainUnavailable('agents', {
        id: 'agents:unavailable',
        title: 'Agent data unavailable',
        summary: facts.error,
        href: '/agents',
      }),
    );
    return items;
  }
  if (facts.partial === true) {
    items.push(
      domainUnavailable('agents', {
        id: 'agents:partial',
        title: 'Agent list incomplete',
        href: '/agents',
      }),
    );
  }
  if (facts.pendingError !== undefined && facts.pendingError.length > 0) {
    items.push(
      domainUnavailable('agents', {
        id: 'agents:pending-unavailable',
        title: 'Agent pending state unavailable',
        summary: facts.pendingError,
        href: '/agents',
      }),
    );
  }

  // The Agents badge counts agents that NEED THE OPERATOR — exactly the
  // selectAgentsNeedingYou set the /agents page renders, so the badge number and
  // the page's "Needs you" count read one selector and cannot disagree.
  // Actively-running, idle, asleep, and suspended agents are ambient roster
  // state, never a badge number.
  const pendingSignals = (facts.pendingInteractions ?? []).map((interaction) => ({
    agentName: interaction.agentName,
    ...(interaction.pending.prompt === undefined ? {} : { prompt: interaction.pending.prompt }),
  }));
  for (const need of selectAgentsNeedingYou(facts.items ?? [], pendingSignals)) {
    items.push(
      domainAttention('agents', {
        id: `agents:${need.name}:needs-you`,
        title: `${need.name} ${agentNeedsYouReasonLabel(need.reason)}`,
        summary: need.detail,
        href: `/agents/${encodeURIComponent(need.name)}`,
      }),
    );
  }
  return items;
}
