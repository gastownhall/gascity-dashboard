import type {
  DeployList,
  DoltNomsTrend,
  MaintainerTriage,
  RunLane,
  RunSummary,
  SystemHealth,
  TriageItem,
} from 'gas-city-dashboard-shared';
import type {
  AgentResponse,
  Bead,
  FormulaFeedBody,
  HealthOutputBody,
  Message,
  MonitorFeedItemResponse,
  TypedEventStreamEnvelope,
} from '../generated/gc-supervisor-client/types.gen';
import type { AgentPendingInteraction } from '../supervisor/agentPending';
import { supervisorEventDetail, supervisorEventSignal } from '../supervisor/eventSignals';
import { maintainerResourceId } from '../views/modules/maintainer/attentionKeys';
import { isNeedsYou, NEEDS_YOU_VIEW_PARAM } from '../views/modules/maintainer/needsYou';
import {
  ATTENTION_DOMAINS,
  type AttentionContributor,
  type AttentionDomain,
  type AttentionItem,
} from './compose';

export type SupervisorHealthState =
  | { status: 'available'; data: HealthOutputBody }
  | { status: 'unavailable'; error: string };

export interface HealthAttentionFacts {
  system?: SystemHealth;
  supervisor?: SupervisorHealthState;
  trend?: DoltNomsTrend;
  dashboardError?: string;
}

export interface RunsAttentionFacts {
  feed?: FormulaFeedBody;
  summary?: RunSummary;
  error?: string;
}

export interface AgentsAttentionFacts {
  items?: readonly AgentResponse[];
  pendingInteractions?: readonly AgentPendingInteraction[];
  nowMs?: number;
  partial?: boolean;
  error?: string;
  pendingError?: string;
}

export interface BeadsAttentionFacts {
  items?: readonly Bead[];
  nowMs?: number;
  partial?: boolean;
  error?: string;
}

export interface MailAttentionFacts {
  items?: readonly Message[];
  operatorAlias: string;
  nowMs?: number;
  partial?: boolean;
  error?: string;
}

export interface ActivityAttentionFacts {
  deploys?: DeployList;
  deploysError?: string;
  events?: readonly TypedEventStreamEnvelope[];
  eventsDegraded?: string;
  eventsError?: string;
  eventsPartial?: boolean;
}

export interface MaintainerAttentionFacts {
  enabled?: boolean;
  triage?: MaintainerTriage;
  nowMs?: number;
  error?: string;
}

export interface AttentionContributorFacts {
  activity?: ActivityAttentionFacts;
  agents?: AgentsAttentionFacts;
  beads?: BeadsAttentionFacts;
  health?: HealthAttentionFacts;
  mail?: MailAttentionFacts;
  maintainer?: MaintainerAttentionFacts;
  runs?: RunsAttentionFacts;
}

const AGENT_IDLE_WATCH_MS = 4 * 60 * 60 * 1000;
const BEAD_UNCLAIMED_WATCH_MS = 24 * 60 * 60 * 1000;
const BEAD_STALE_ATTENTION_MS = 72 * 60 * 60 * 1000;
const MAIL_UNREAD_STALE_MS = 24 * 60 * 60 * 1000;

export function createAttentionContributors(
  facts: AttentionContributorFacts = {},
): readonly AttentionContributor[] {
  return ATTENTION_DOMAINS.map((domain) => (
    contributorForDomain(domain, facts)
  ));
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

function healthContributor(facts: HealthAttentionFacts | undefined): AttentionContributor {
  return {
    id: 'health:derived',
    domain: 'health',
    getItems: () => deriveHealthAttention(facts),
  };
}

function runsContributor(facts: RunsAttentionFacts | undefined): AttentionContributor {
  return {
    id: 'runs:derived',
    domain: 'runs',
    getItems: () => deriveRunsAttention(facts),
  };
}

function agentsContributor(facts: AgentsAttentionFacts | undefined): AttentionContributor {
  return {
    id: 'agents:derived',
    domain: 'agents',
    getItems: () => deriveAgentsAttention(facts),
  };
}

function beadsContributor(facts: BeadsAttentionFacts | undefined): AttentionContributor {
  return {
    id: 'beads:derived',
    domain: 'beads',
    getItems: () => deriveBeadsAttention(facts),
  };
}

function mailContributor(facts: MailAttentionFacts | undefined): AttentionContributor {
  return {
    id: 'mail:derived',
    domain: 'mail',
    getItems: () => deriveMailAttention(facts),
  };
}

function activityContributor(facts: ActivityAttentionFacts | undefined): AttentionContributor {
  return {
    id: 'activity:derived',
    domain: 'activity',
    getItems: () => deriveActivityAttention(facts),
  };
}

function maintainerContributor(facts: MaintainerAttentionFacts | undefined): AttentionContributor {
  return {
    id: 'maintainer:derived',
    domain: 'maintainer',
    getItems: () => deriveMaintainerAttention(facts),
  };
}

function deriveRunsAttention(
  facts: RunsAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(domainAttention('runs', {
      id: 'runs:unavailable',
      title: 'Run data unavailable',
      summary: facts.error,
      href: '/runs',
    }));
  }

  const summary = facts.summary;
  const feed = facts.feed;
  if (feed !== undefined) {
    appendFormulaFeedAttention(items, feed);
  }
  if (summary === undefined) return items;
  if (summary.lanesPartial === true) {
    items.push(domainWatch('runs', {
      id: 'runs:partial',
      title: 'Run list incomplete',
      href: '/runs',
    }));
  }

  for (const lane of summary.lanes) {
    const item = attentionForRunLane(lane);
    if (item !== null) items.push(item);
  }
  return items;
}

function appendFormulaFeedAttention(
  items: AttentionItem[],
  feed: FormulaFeedBody,
): void {
  if (feed.partial) {
    const summary = feed.partial_errors?.join('; ');
    items.push(domainWatch('runs', {
      id: 'runs:feed-partial',
      title: 'Formula run feed incomplete',
      href: '/runs',
      ...(summary === undefined ? {} : { summary }),
    }));
  }
  for (const item of feed.items ?? []) {
    const attention = attentionForFormulaFeedItem(item);
    if (attention !== null) items.push(attention);
  }
}

function attentionForFormulaFeedItem(
  item: MonitorFeedItemResponse,
): AttentionItem | null {
  const status = item.status.toLowerCase();
  const href = runHref(item.id, item.scope_kind, item.scope_ref);
  if (isRunAttentionStatus(status)) {
    return domainAttention('runs', {
      id: `runs:${item.id}:${status}`,
      title: item.title,
      summary: item.status,
      href,
      updatedAt: item.started_at,
    });
  }
  if (item.run_detail_available === false || item.detail_available === false) {
    return domainWatch('runs', {
      id: `runs:${item.id}:detail-unavailable`,
      title: `${item.title} detail unavailable`,
      href,
      updatedAt: item.started_at,
    });
  }
  if (isRunWatchStatus(status)) {
    return domainWatch('runs', {
      id: `runs:${item.id}:${status}`,
      title: item.title,
      summary: item.status,
      href,
      updatedAt: item.started_at,
    });
  }
  return null;
}

function attentionForRunLane(lane: RunLane): AttentionItem | null {
  const href = lane.scope?.status === 'available'
    ? runHref(lane.id, lane.scope.kind, lane.scope.ref)
    : runHref(lane.id);
  if (lane.health.status !== 'available') {
    return domainWatch('runs', {
      id: `runs:${lane.id}:health-unavailable`,
      title: `${lane.title} health unavailable`,
      summary: lane.health.error,
      href,
    });
  }

  const health = lane.health.data;
  if (health.needsOperator || lane.phase === 'blocked') {
    return domainAttention('runs', {
      id: `runs:${lane.id}:needs-operator`,
      title: `${lane.title} needs operator`,
      href,
    });
  }
  if (health.phaseConfidence === 'known' && health.thrashingDetected) {
    return domainAttention('runs', {
      id: `runs:${lane.id}:thrashing`,
      title: `${lane.title} is thrashing`,
      href,
    });
  }
  if (health.phaseConfidence === 'inferred') {
    return domainWatch('runs', {
      id: `runs:${lane.id}:unverifiable`,
      title: `${lane.title} health unverifiable`,
      href,
    });
  }
  return null;
}

function runHref(runId: string, scopeKind?: string, scopeRef?: string): string {
  const path = `/runs/${encodeURIComponent(runId)}`;
  if (scopeKind === undefined || scopeRef === undefined) return path;
  const search = new URLSearchParams();
  search.set('scope_kind', scopeKind);
  search.set('scope_ref', scopeRef);
  return `${path}?${search.toString()}`;
}

function deriveAgentsAttention(
  facts: AgentsAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(domainAttention('agents', {
      id: 'agents:unavailable',
      title: 'Agent data unavailable',
      summary: facts.error,
      href: '/agents',
    }));
  }
  if (facts.partial === true) {
    items.push(domainWatch('agents', {
      id: 'agents:partial',
      title: 'Agent list incomplete',
      href: '/agents',
    }));
  }
  if (facts.pendingError !== undefined && facts.pendingError.length > 0) {
    items.push(domainWatch('agents', {
      id: 'agents:pending-unavailable',
      title: 'Agent pending state unavailable',
      summary: facts.pendingError,
      href: '/agents',
    }));
  }
  for (const interaction of facts.pendingInteractions ?? []) {
    items.push(domainAttention('agents', {
      id: `agents:${interaction.agentName}:pending:${interaction.pending.request_id}`,
      title: `${interaction.agentName} needs you`,
      summary: interaction.pending.prompt ?? interaction.pending.kind,
      href: `/agents/${encodeURIComponent(interaction.agentName)}`,
    }));
  }
  const nowMs = facts.nowMs ?? Date.now();
  for (const agent of facts.items ?? []) {
    const item = attentionForAgent(agent, nowMs);
    if (item !== null) items.push(item);
  }
  return items;
}

function attentionForAgent(agent: AgentResponse, nowMs: number): AttentionItem | null {
  const href = `/agents/${encodeURIComponent(agent.name)}`;
  const state = agent.state.toLowerCase();
  if (agent.running && agent.session === undefined) {
    return domainAttention('agents', {
      id: `agents:${agent.name}:no-session`,
      title: `${agent.name} has no live session`,
      href,
    });
  }
  if (isFailureState(state)) {
    return domainAttention('agents', {
      id: `agents:${agent.name}:failed`,
      title: `${agent.name} ${agent.state}`,
      href,
    });
  }
  if (state === 'detached') {
    return domainAttention('agents', {
      id: `agents:${agent.name}:detached`,
      title: `${agent.name} detached`,
      href,
    });
  }
  if (agent.suspended || state === 'asleep' || state === 'idle') {
    return domainWatch('agents', {
      id: `agents:${agent.name}:idle`,
      title: `${agent.name} idle`,
      href,
    });
  }
  if (!agent.available) {
    return domainWatch('agents', {
      id: `agents:${agent.name}:unavailable`,
      title: `${agent.name} unavailable`,
      href,
      ...(agent.unavailable_reason === undefined ? {} : { summary: agent.unavailable_reason }),
    });
  }
  const idleAgeMs = elapsedSince(agent.session?.last_activity, nowMs);
  if (agent.running && idleAgeMs !== null && idleAgeMs >= AGENT_IDLE_WATCH_MS) {
    return domainWatch('agents', {
      id: `agents:${agent.name}:stale-idle`,
      title: `${agent.name} idle`,
      summary: `last activity ${formatElapsed(idleAgeMs)} ago`,
      href,
    });
  }
  return null;
}

function deriveBeadsAttention(
  facts: BeadsAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(domainAttention('beads', {
      id: 'beads:unavailable',
      title: 'Bead data unavailable',
      summary: facts.error,
      href: '/beads',
    }));
  }
  if (facts.partial === true) {
    items.push(domainWatch('beads', {
      id: 'beads:partial',
      title: 'Bead list incomplete',
      href: '/beads',
    }));
  }
  const nowMs = facts.nowMs ?? Date.now();
  for (const bead of facts.items ?? []) {
    if (bead.status === 'blocked') {
      items.push(domainAttention('beads', {
        id: `beads:${bead.id}:blocked`,
        title: `${bead.id} blocked`,
        summary: bead.title,
        href: beadHref(bead.id),
      }));
      continue;
    }
    if (bead.status !== 'closed' && bead.priority !== null && bead.priority !== undefined && bead.priority <= 1) {
      items.push(domainAttention('beads', {
        id: `beads:${bead.id}:high-priority`,
        title: `${bead.id} high priority`,
        summary: bead.title,
        href: beadHref(bead.id),
      }));
    }
    const stale = attentionForStaleBead(bead, nowMs);
    if (stale !== null) items.push(stale);
  }
  return items;
}

function attentionForStaleBead(bead: Bead, nowMs: number): AttentionItem | null {
  if (bead.status === 'closed') return null;
  const ageMs = elapsedSince(bead.created_at, nowMs);
  if (ageMs === null) return null;
  const hasAssignee = bead.assignee !== undefined && bead.assignee.trim().length > 0;

  if (!hasAssignee && ageMs >= BEAD_STALE_ATTENTION_MS) {
    return domainAttention('beads', {
      id: `beads:${bead.id}:stale-unclaimed`,
      title: `${bead.id} unclaimed`,
      summary: `${bead.title} opened ${formatElapsed(ageMs)} ago`,
      href: beadHref(bead.id),
      updatedAt: bead.created_at,
    });
  }
  if (!hasAssignee && ageMs >= BEAD_UNCLAIMED_WATCH_MS) {
    return domainWatch('beads', {
      id: `beads:${bead.id}:ready-unclaimed`,
      title: `${bead.id} still unclaimed`,
      summary: `${bead.title} opened ${formatElapsed(ageMs)} ago`,
      href: beadHref(bead.id),
      updatedAt: bead.created_at,
    });
  }
  if (hasAssignee && ageMs >= BEAD_STALE_ATTENTION_MS) {
    return domainAttention('beads', {
      id: `beads:${bead.id}:stale-assigned`,
      title: `${bead.id} assigned without movement`,
      summary: `${bead.title} assigned to ${bead.assignee} for ${formatElapsed(ageMs)}`,
      href: beadHref(bead.id),
      updatedAt: bead.created_at,
    });
  }
  return null;
}

function beadHref(beadId: string): string {
  const search = new URLSearchParams();
  search.set('bead', beadId);
  return `/beads?${search.toString()}`;
}

function deriveMailAttention(
  facts: MailAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(domainAttention('mail', {
      id: 'mail:unavailable',
      title: 'Mail data unavailable',
      summary: facts.error,
      href: '/mail',
    }));
  }
  if (facts.partial === true) {
    items.push(domainWatch('mail', {
      id: 'mail:partial',
      title: 'Mail list incomplete',
      href: '/mail',
    }));
  }
  const nowMs = facts.nowMs ?? Date.now();
  for (const message of facts.items ?? []) {
    if (message.read) continue;
    const addressedToOperator = addressMatches(message.to, facts.operatorAlias);
    const builder = addressedToOperator ? domainAttention : domainWatch;
    const staleAgeMs = elapsedSince(message.created_at, nowMs);
    const stale = staleAgeMs !== null && staleAgeMs >= MAIL_UNREAD_STALE_MS;
    items.push(builder('mail', {
      id: `mail:${message.id}:${stale ? 'unread-stale' : 'unread'}`,
      title: message.subject,
      summary: stale
        ? `from ${message.from}, unread for ${formatElapsed(staleAgeMs)}`
        : `from ${message.from}`,
      href: mailHref(message.id),
      updatedAt: message.created_at,
    }));
  }
  return items;
}

function mailHref(messageId: string): string {
  const search = new URLSearchParams();
  search.set('message', messageId);
  return `/mail?${search.toString()}`;
}

function deriveActivityAttention(
  facts: ActivityAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.deploysError !== undefined && facts.deploysError.length > 0) {
    items.push(domainAttention('activity', {
      id: 'activity:deploys-unavailable',
      title: 'Deploy data unavailable',
      summary: facts.deploysError,
      href: '/activity',
    }));
  }
  if (facts.eventsDegraded !== undefined && facts.eventsDegraded.length > 0) {
    items.push(domainWatch('activity', {
      id: 'activity:events-degraded',
      title: 'Event stream degraded',
      summary: facts.eventsDegraded,
      href: '/activity',
    }));
  }
  if (facts.eventsError !== undefined && facts.eventsError.length > 0) {
    items.push(domainWatch('activity', {
      id: 'activity:events-unavailable',
      title: 'Event history unavailable',
      summary: facts.eventsError,
      href: '/activity',
    }));
  }
  if (facts.eventsPartial === true) {
    items.push(domainWatch('activity', {
      id: 'activity:events-partial',
      title: 'Event history incomplete',
      href: '/activity',
    }));
  }
  appendActivityEventAttention(items, facts.events ?? []);

  const deploys = facts.deploys;
  if (deploys === undefined) return items;
  if (deploys.failed_marker) {
    items.push(domainAttention('activity', {
      id: 'activity:failed-marker',
      title: 'Deploy failed marker present',
      href: '/activity',
    }));
  }
  for (const deploy of deploys.items) {
    if (deploy.status === 'failed') {
      items.push(domainAttention('activity', {
        id: `activity:deploy:${deploy.at}:failed`,
        title: 'Deploy failed',
        summary: deploy.detail,
        href: '/activity',
        updatedAt: deploy.at,
      }));
    } else if (deploy.status === 'in-progress') {
      items.push(domainWatch('activity', {
        id: `activity:deploy:${deploy.at}:in-progress`,
        title: 'Deploy in progress',
        summary: deploy.detail,
        href: '/activity',
        updatedAt: deploy.at,
      }));
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
    items.push(builder('activity', {
      id: `activity:event:${String(event.seq)}:${event.type}`,
      title: event.type,
      summary: supervisorEventDetail(event),
      href: activityEventHref(event),
      updatedAt: event.ts,
    }));
  }
}

function activityEventHref(event: TypedEventStreamEnvelope): string {
  const params = new URLSearchParams({
    mode: 'events',
    type: event.type,
  });
  return `/activity?${params.toString()}`;
}

function deriveHealthAttention(
  facts: HealthAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;

  if (facts.dashboardError !== undefined && facts.dashboardError.length > 0) {
    items.push(healthAttention({
      id: 'health:dashboard-health-unavailable',
      title: 'Dashboard health unavailable',
      summary: facts.dashboardError,
    }));
  }

  if (facts.supervisor !== undefined) {
    appendSupervisorAttention(items, facts.supervisor);
  }
  if (facts.system !== undefined) {
    appendHostAttention(items, facts.system);
  }
  if (facts.trend !== undefined && !facts.trend.available) {
    items.push(healthWatch({
      id: 'health:dolt-noms-unavailable',
      title: 'Dolt-noms trend unavailable',
      summary: facts.trend.reason,
    }));
  }

  return items;
}

function deriveMaintainerAttention(
  facts: MaintainerAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined || facts.enabled === false) return items;

  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(domainWatch('maintainer', {
      id: 'maintainer:triage-unavailable',
      title: 'Triage data unavailable',
      summary: facts.error,
      href: '/maintainer',
    }));
  }

  const triage = facts.triage;
  if (triage === undefined) return items;

  const nowMs = facts.nowMs ?? Date.now();
  for (const item of maintainerTierItems(triage)) {
    const resourceId = maintainerResourceId(item);
    if (isNeedsYou(item, nowMs)) {
      items.push(domainAttention('maintainer', {
        id: `maintainer:${resourceId}:needs-you`,
        title: `${maintainerItemLabel(item)} needs you`,
        summary: item.title,
        href: `/maintainer?view=${encodeURIComponent(NEEDS_YOU_VIEW_PARAM)}`,
        updatedAt: item.updated_at,
      }));
      continue;
    }
    if (item.triage_assessment === null && item.slung === null) {
      items.push(domainAttention('maintainer', {
        id: `maintainer:${resourceId}:needs-triage`,
        title: `${maintainerItemLabel(item)} needs triage`,
        summary: item.title,
        href: '/maintainer',
        updatedAt: item.updated_at,
      }));
    }
  }

  for (const item of triage.slung_section ?? []) {
    const slung = item.slung;
    const resourceId = maintainerResourceId(item);
    if (slung !== null && slung.resolved_session_name === null) {
      items.push(domainAttention('maintainer', {
        id: `maintainer:${resourceId}:slung-unresolved`,
        title: `${maintainerItemLabel(item)} has no resolved agent`,
        summary: item.title,
        href: '/maintainer',
        updatedAt: slung.slung_at,
      }));
    } else {
      items.push(domainWatch('maintainer', {
        id: `maintainer:${resourceId}:slung`,
        title: `${maintainerItemLabel(item)} is with an agent`,
        summary: item.title,
        href: '/maintainer',
        updatedAt: slung?.slung_at ?? item.updated_at,
      }));
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

function appendSupervisorAttention(
  items: AttentionItem[],
  supervisor: SupervisorHealthState,
): void {
  if (supervisor.status === 'unavailable') {
    items.push(healthAttention({
      id: 'health:supervisor-unreachable',
      title: 'Supervisor unreachable',
      summary: supervisor.error,
    }));
    return;
  }

  const data = supervisor.data;
  if (data.status !== 'ok') {
    items.push(healthAttention({
      id: 'health:supervisor-not-ok',
      title: `Supervisor ${data.status}`,
    }));
  }
  if (data.city === undefined) {
    items.push(healthWatch({
      id: 'health:supervisor-city-missing',
      title: 'Supervisor city missing',
      summary: 'city was absent from generated supervisor health',
    }));
  }
  if (data.version === undefined) {
    items.push(healthWatch({
      id: 'health:supervisor-version-missing',
      title: 'Supervisor version missing',
      summary: 'version was absent from generated supervisor health',
    }));
  }
}

function appendHostAttention(items: AttentionItem[], health: SystemHealth): void {
  const memoryRatio = safeRatio(health.host.free_mem_bytes, health.host.total_mem_bytes);
  if (memoryRatio !== null && memoryRatio < 0.05) {
    items.push(healthAttention({
      id: 'health:memory-critical',
      title: 'Host memory critical',
      summary: `${Math.round(memoryRatio * 100)}% free`,
    }));
  } else if (memoryRatio !== null && memoryRatio < 0.10) {
    items.push(healthWatch({
      id: 'health:memory-low',
      title: 'Host memory low',
      summary: `${Math.round(memoryRatio * 100)}% free`,
    }));
  }

  const loadRatio = safeRatio(health.host.load_avg_1, health.host.cpu_count);
  if (loadRatio !== null && loadRatio > 1.5) {
    items.push(healthAttention({
      id: 'health:load-high',
      title: 'Host load high',
      summary: `${health.host.load_avg_1.toFixed(2)} load across ${health.host.cpu_count} CPUs`,
    }));
  } else if (loadRatio !== null && loadRatio > 1) {
    items.push(healthWatch({
      id: 'health:load-elevated',
      title: 'Host load elevated',
      summary: `${health.host.load_avg_1.toFixed(2)} load across ${health.host.cpu_count} CPUs`,
    }));
  }
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function elapsedSince(rawTimestamp: string | undefined, nowMs: number): number | null {
  if (rawTimestamp === undefined || rawTimestamp.length === 0) return null;
  const timestampMs = Date.parse(rawTimestamp);
  if (!Number.isFinite(timestampMs)) return null;
  const ageMs = nowMs - timestampMs;
  return ageMs >= 0 ? ageMs : null;
}

function formatElapsed(ageMs: number): string {
  const hours = Math.max(1, Math.round(ageMs / (60 * 60 * 1000)));
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function isFailureState(state: string): boolean {
  return state === 'failed' || state === 'errored' || state === 'stuck' || state === 'crashed';
}

function isRunAttentionStatus(status: string): boolean {
  return status === 'failed' ||
    status === 'error' ||
    status === 'errored' ||
    status === 'blocked' ||
    status === 'waiting' ||
    status === 'needs_operator' ||
    status === 'needs-operator';
}

function isRunWatchStatus(status: string): boolean {
  return status === 'partial' ||
    status === 'unknown' ||
    status === 'inferred' ||
    status === 'stale';
}

function addressMatches(raw: string, alias: string): boolean {
  const normalizedAlias = alias.trim().toLowerCase();
  if (normalizedAlias.length === 0) return false;
  return raw
    .split(/[,\s;]+/)
    .some((part) => part.trim().toLowerCase() === normalizedAlias);
}

function healthAttention(
  item: Omit<AttentionItem, 'domain' | 'severity' | 'href' | 'current' | 'actionable'>,
): AttentionItem {
  return {
    domain: 'health',
    severity: 'attention',
    href: '/health',
    current: true,
    actionable: true,
    ...item,
  };
}

function domainAttention(
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

function domainWatch(
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

function healthWatch(
  item: Omit<AttentionItem, 'domain' | 'severity' | 'href' | 'current' | 'actionable'>,
): AttentionItem {
  return {
    domain: 'health',
    severity: 'watch',
    href: '/health',
    current: true,
    actionable: false,
    ...item,
  };
}
