import {
  ATTENTION_DOMAINS,
  type AttentionContributor,
  type AttentionDomain,
  type AttentionItem,
} from './compose';
import { deriveActivityAttention, type ActivityAttentionFacts } from './derive/activity';
import { deriveAgentsAttention, type AgentsAttentionFacts } from './derive/agents';
import {
  deriveBeadsAttention,
  GC_ESCALATION_LABEL,
  type BeadsAttentionFacts,
} from './derive/beads';
import {
  deriveHealthAttention,
  type HealthAttentionFacts,
  type SupervisorHealthState,
} from './derive/health';
import { deriveMaintainerAttention, type MaintainerAttentionFacts } from './derive/maintainer';
import { deriveMailAttention, type MailAttentionFacts } from './derive/mail';
import { deriveRunsAttention, type RunsAttentionFacts } from './derive/runs';
import type { ReadFreshnessFacts } from './derive/shared';

export type {
  ActivityAttentionFacts,
  AgentsAttentionFacts,
  BeadsAttentionFacts,
  HealthAttentionFacts,
  MailAttentionFacts,
  MaintainerAttentionFacts,
  ReadFreshnessFacts,
  RunsAttentionFacts,
  SupervisorHealthState,
};
export { GC_ESCALATION_LABEL };

export interface AttentionContributorFacts {
  activity?: ActivityAttentionFacts;
  agents?: AgentsAttentionFacts;
  beads?: BeadsAttentionFacts;
  health?: HealthAttentionFacts;
  mail?: MailAttentionFacts;
  maintainer?: MaintainerAttentionFacts;
  runs?: RunsAttentionFacts;
}

export function createAttentionContributors(
  facts: AttentionContributorFacts = {},
): readonly AttentionContributor[] {
  return ATTENTION_DOMAINS.map((domain) => contributorForDomain(domain, facts));
}

function contributorForDomain(
  domain: AttentionDomain,
  facts: AttentionContributorFacts,
): AttentionContributor {
  switch (domain) {
    case 'activity':
      return activityContributor(facts.activity);
    case 'agents':
      return agentsContributor(facts.agents);
    case 'beads':
      return beadsContributor(facts.beads);
    case 'health':
      return healthContributor(facts.health);
    case 'mail':
      return mailContributor(facts.mail);
    case 'runs':
      return runsContributor(facts.runs);
    case 'maintainer':
      return maintainerContributor(facts.maintainer);
  }
}

/**
 * Attach a contributor's read freshness from its facts (gascity-dashboard-5t0m).
 * composeAttention folds `provenance`/`fetchedAt` per-domain into the summary so
 * a calm domain still reports its read age. exactOptionalPropertyTypes: include
 * each key only when defined.
 */
function withFreshness(
  base: { id: string; domain: AttentionDomain; getItems: () => readonly AttentionItem[] },
  facts: ReadFreshnessFacts | undefined,
): AttentionContributor {
  return {
    ...base,
    ...(facts?.provenance !== undefined && { provenance: facts.provenance }),
    ...(facts?.fetchedAt !== undefined && { fetchedAt: facts.fetchedAt }),
    ...(facts?.staleAt !== undefined && { staleAt: facts.staleAt }),
  };
}

function healthContributor(facts: HealthAttentionFacts | undefined): AttentionContributor {
  return withFreshness(
    { id: 'health:derived', domain: 'health', getItems: () => deriveHealthAttention(facts) },
    facts,
  );
}

function runsContributor(facts: RunsAttentionFacts | undefined): AttentionContributor {
  return withFreshness(
    { id: 'runs:derived', domain: 'runs', getItems: () => deriveRunsAttention(facts) },
    facts,
  );
}

function agentsContributor(facts: AgentsAttentionFacts | undefined): AttentionContributor {
  return withFreshness(
    { id: 'agents:derived', domain: 'agents', getItems: () => deriveAgentsAttention(facts) },
    facts,
  );
}

function beadsContributor(facts: BeadsAttentionFacts | undefined): AttentionContributor {
  return withFreshness(
    { id: 'beads:derived', domain: 'beads', getItems: () => deriveBeadsAttention(facts) },
    facts,
  );
}

function mailContributor(facts: MailAttentionFacts | undefined): AttentionContributor {
  return withFreshness(
    { id: 'mail:derived', domain: 'mail', getItems: () => deriveMailAttention(facts) },
    facts,
  );
}

function activityContributor(facts: ActivityAttentionFacts | undefined): AttentionContributor {
  return withFreshness(
    { id: 'activity:derived', domain: 'activity', getItems: () => deriveActivityAttention(facts) },
    facts,
  );
}

function maintainerContributor(facts: MaintainerAttentionFacts | undefined): AttentionContributor {
  return withFreshness(
    {
      id: 'maintainer:derived',
      domain: 'maintainer',
      getItems: () => deriveMaintainerAttention(facts),
    },
    facts,
  );
}
