import type {
  DeployList,
  DoltNomsTrend,
  MaintainerTriage,
  RunSummary,
  SourceStatus,
  SystemHealth,
  TriageItem,
} from 'gas-city-dashboard-shared';
import {
  selectAgentsNeedingYou,
  selectBlockedRuns,
  selectStrandedRuns,
  selectOperatorActionableUnread,
} from 'gas-city-dashboard-shared';
import { selectBeadsNeedingAttention, type BeadAttentionReason } from './beadsNeedingAttention';
import { elapsedSince, formatElapsed } from './elapsed';
import { runDetailHref } from '../supervisor/runHref';
import { agentNeedsYouReasonLabel } from './agentNeedsYou';
import type {
  AgentResponse,
  Bead,
  HealthOutputBody,
  Message,
  TypedEventStreamEnvelope,
} from 'gas-city-dashboard-shared/gc-supervisor';
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

export interface HealthAttentionFacts extends ReadFreshnessFacts {
  system?: SystemHealth;
  supervisor?: SupervisorHealthState;
  trend?: DoltNomsTrend;
  dashboardError?: string;
}

export interface RunsAttentionFacts extends ReadFreshnessFacts {
  /**
   * The bead-derived run summary (gascity-dashboard-2j8e.2). The Runs badge
   * counts genuinely-blocked runs from `summary.blockedLanes` — the same
   * selectBlockedRuns the /runs page reads, so the badge and the page count
   * cannot disagree. The formula feed is deliberately NOT a source here: it
   * surfaced phantom feed-only roots (gc-1920 codeprobe upstream_error) and
   * flapped 6<->13 on partial fan-outs.
   */
  summary?: RunSummary;
  error?: string;
}

export interface AgentsAttentionFacts extends ReadFreshnessFacts {
  items?: readonly AgentResponse[];
  pendingInteractions?: readonly AgentPendingInteraction[];
  partial?: boolean;
  error?: string;
  pendingError?: string;
}

export interface BeadsAttentionFacts extends ReadFreshnessFacts {
  items?: readonly Bead[];
  /**
   * The label marking a bead as a mayor-decision (DASHBOARD_DECISION_LABEL,
   * gascity-dashboard-bhvn). Carried in the facts so the registry derives the
   * decision skip from runtime config instead of a hardcoded literal. The live
   * producer (liveContributors) sets it from the operator config.
   */
  decisionLabel: string;
  /**
   * The mayor-decision queue: open beads carrying the `decisionLabel`
   * marker, fetched with the dedicated label+status filter
   * (specs/architecture/mayor-decision-ledger.md §6). Kept separate from the
   * general `items` list because that list is capped and can paginate the
   * decision beads out; the filtered query is always complete. Rendered as
   * their own attention identity, never re-triaged (ZFC).
   */
  decisions?: readonly Bead[];
  /**
   * The open-`gc:escalation` queue: the help-request / escalation beads
   * (gascity-dashboard-2j8e.3). Fetched with the dedicated label+status filter
   * because the general bead list drops `gc:`-labelled bookkeeping beads, so an
   * escalation would never reach the generic triage. The same dedicated-queue
   * shape as `decisions`.
   */
  escalations?: readonly Bead[];
  nowMs?: number;
  partial?: boolean;
  error?: string;
  /** Failure of the dedicated decision-queue fetch, independent of `error`. */
  decisionsError?: string;
  /** Failure of the dedicated escalation-queue fetch, independent of `error`. */
  escalationsError?: string;
}

export interface MailAttentionFacts extends ReadFreshnessFacts {
  items?: readonly Message[];
  nowMs?: number;
  partial?: boolean;
  error?: string;
}

export interface ActivityAttentionFacts extends ReadFreshnessFacts {
  deploys?: DeployList;
  deploysError?: string;
  events?: readonly TypedEventStreamEnvelope[];
  eventsDegraded?: string;
  eventsError?: string;
  eventsPartial?: boolean;
}

export interface MaintainerAttentionFacts extends ReadFreshnessFacts {
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

const MAIL_UNREAD_STALE_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_PROCESS_STARTING_UPTIME_SEC = 30;
const DASHBOARD_PROCESS_RSS_HIGH_BYTES = 2_000_000_000;
const DASHBOARD_PROCESS_RSS_ELEVATED_BYTES = 1_000_000_000;
const DASHBOARD_PROCESS_HEAP_HIGH_BYTES = 1_000_000_000;
const DASHBOARD_PROCESS_HEAP_ELEVATED_BYTES = 512_000_000;

/**
 * The gc-native escalation marker (gascity-dashboard-2j8e.3). An open bead
 * carrying it has raised a help-request / escalation — abnormal blocking that
 * needs a human, unlike a bead in `blocked` status that is merely waiting on a
 * dependency. The same marker the prior `gc dashboard` escalations panel keyed
 * on. Exported so the dedicated fetch filter (liveContributors) resolves the
 * same marker — a rename touches one line.
 */
export const GC_ESCALATION_LABEL = 'gc:escalation';

/**
 * Flat metadata key for the mayor's one-sentence decision question (the spec's
 * `metadata.decision.decide`). Optional: absent on a minimally-authored
 * decision bead, present once the mayor writes the full payload (spec §7). When
 * present it becomes the row summary; when absent the title carries the ask.
 */
const DECISION_DECIDE_META_KEY = 'decision.decide';

/**
 * Flat metadata key for the decision's stable identity (the spec's
 * `metadata.decision.slug`). Two open marker beads sharing a slug are the SAME
 * decision (re-filed or mirrored) and must surface as one attention row.
 * Optional: a bead without it has no shared identity and is never deduped.
 */
const DECISION_SLUG_META_KEY = 'decision.slug';

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

function deriveRunsAttention(facts: RunsAttentionFacts | undefined): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(
      domainAttention('runs', {
        id: 'runs:unavailable',
        title: 'Run data unavailable',
        summary: facts.error,
        href: '/runs',
      }),
    );
    return items;
  }

  const summary = facts.summary;
  if (summary === undefined) return items;

  // dash-ygj + gascity-dashboard-2j8e.2: degraded runs reads land in the
  // `unavailable` tier, which BadgeSeverity excludes — so a partial fan-out and
  // any lane whose health could not be read surface as quiet, non-counting items
  // (never a badge number).
  // The formula feed is no longer a source (it produced the gc-1920 phantom roots
  // and flapped 6<->13), so #91's feed-derived emitters are gone; only the
  // summary-derived degraded reads survive.
  if (summary.lanesPartial === true) {
    items.push(
      domainUnavailable('runs', {
        id: 'runs:partial',
        title: 'Run list incomplete',
        href: '/runs',
      }),
    );
  }
  for (const lane of [...summary.lanes, ...summary.blockedLanes, ...summary.strandedLanes]) {
    if (lane.health.status === 'available') continue;
    items.push(
      domainUnavailable('runs', {
        id: `runs:${lane.id}:health-unavailable`,
        title: `${lane.title} health unavailable`,
        summary: lane.health.error,
        href: runDetailHref(lane.id, lane.scope),
      }),
    );
  }

  // gascity-dashboard-2j8e.2: the Runs badge counts GENUINELY-BLOCKED runs only
  // — exactly the selectBlockedRuns set the /runs page renders, so the badge
  // number and the page's Blocked count read one selector and cannot disagree.
  // A supervisor `partial` read is never counted (it lands in the unavailable
  // tier above), so the count no longer flaps on a partial fan-out.
  for (const run of selectBlockedRuns(summary.blockedLanes)) {
    items.push(
      domainAttention('runs', {
        id: `runs:${run.id}:blocked`,
        title: `${run.title} blocked`,
        summary: run.reason,
        href: runDetailHref(run.id, run.scope),
      }),
    );
  }

  // gascity-dashboard-pxvb: a stranded run (orphaned molecule that never
  // executed) is the state most needing an operator action — clean up or
  // re-dispatch — yet it emitted no attention item and rode the Active set as
  // false-alive work. Surface it as a counting attention item, the same
  // selectStrandedRuns set the /runs Stranded section renders, so the badge
  // number and the page count read one selector and cannot disagree.
  for (const run of selectStrandedRuns(summary.strandedLanes)) {
    items.push(
      domainAttention('runs', {
        id: `runs:${run.id}:stranded`,
        title: `${run.title} stranded`,
        summary: run.remedy,
        href: runDetailHref(run.id, run.scope),
      }),
    );
  }
  return items;
}

function deriveAgentsAttention(facts: AgentsAttentionFacts | undefined): readonly AttentionItem[] {
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

function deriveBeadsAttention(facts: BeadsAttentionFacts | undefined): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;
  // gascity-dashboard-m1gi: a failed bead READ is a data degradation, not
  // operator-actionable work, so it lands in the non-counting `unavailable`
  // tier (like agents:unavailable / runs:partial) — the item still renders so
  // the operator sees the source is down, but a 503 never inflates the nav
  // badge or spends the One-Mark maroon on a fetch that merely failed.
  if (facts.error !== undefined && facts.error.length > 0) {
    items.push(
      domainUnavailable('beads', {
        id: 'beads:unavailable',
        title: 'Bead data unavailable',
        summary: facts.error,
        href: '/beads',
      }),
    );
  }
  if (facts.partial === true) {
    items.push(
      domainWatch('beads', {
        id: 'beads:partial',
        title: 'Bead list incomplete',
        href: '/beads',
      }),
    );
  }
  if (facts.decisionsError !== undefined && facts.decisionsError.length > 0) {
    items.push(
      domainUnavailable('beads', {
        id: 'beads:decisions-unavailable',
        title: 'Decision queue unavailable',
        summary: facts.decisionsError,
        href: '/beads',
      }),
    );
  }
  if (facts.escalationsError !== undefined && facts.escalationsError.length > 0) {
    items.push(
      domainUnavailable('beads', {
        id: 'beads:escalations-unavailable',
        title: 'Escalation queue unavailable',
        summary: facts.escalationsError,
        href: '/beads',
      }),
    );
  }
  for (const decision of dedupeDecisionsBySlug(facts.decisions ?? [])) {
    items.push(mayorDecisionAttention(decision));
  }
  const nowMs = facts.nowMs ?? Date.now();
  // gascity-dashboard-2j8e.3: the Beads badge counts exactly the ready-unclaimed
  // + abnormally-blocked (escalated / help-requested) set — plain
  // dependency-blocked is excluded (bd `blocked` = "blocked by a dependency",
  // working-as-intended queuing). Ready-unclaimed comes from the general list;
  // escalations from the dedicated gc:escalation queue (the general list drops
  // gc:-labelled beads). Marker beads surface via the decision queue above, so
  // skip them in the general list (no double-surfacing). selectBeadsNeedingAttention
  // is the membership SSOT the /beads page also reads, so the nav badge count
  // and the page count cannot disagree.
  const generic = (facts.items ?? []).filter((bead) => !isMayorDecision(bead, facts.decisionLabel));
  for (const row of selectBeadsNeedingAttention(
    { beads: generic, escalations: facts.escalations ?? [] },
    nowMs,
  )) {
    const builder = row.severity === 'attention' ? domainAttention : domainWatch;
    items.push(
      builder('beads', {
        id: `beads:${row.beadId}:${row.reason}`,
        title: `${row.beadId} ${beadAttentionWord(row.reason)}`,
        summary: row.summary,
        href: beadHref(row.beadId),
        updatedAt: row.updatedAt,
      }),
    );
  }
  return items;
}

/** The glyph+word noun for a bead-attention reason (DESIGN.md §Status). */
function beadAttentionWord(reason: BeadAttentionReason): string {
  return reason === 'escalated' ? 'escalated' : 'unclaimed';
}

function beadHref(beadId: string): string {
  const search = new URLSearchParams();
  search.set('bead', beadId);
  return `/beads?${search.toString()}`;
}

/**
 * A bead carries the mayor-decision marker. Used to keep a marker bead that
 * also appears in the general list from double-surfacing as a generic bead
 * alert (the decision-queue fetch already restricts to open).
 */
function isMayorDecision(bead: Bead, decisionLabel: string): boolean {
  return (bead.labels ?? []).includes(decisionLabel);
}

/**
 * Collapse the decision queue onto distinct decision identities
 * (`metadata['decision.slug']`). Among beads sharing a non-empty slug only the
 * most recently moved bead surfaces; on a timestamp tie the lowest bead id
 * wins. Mechanical duplicate detection with explicit deterministic tiebreakers
 * (the sanctioned ZFC exception), not a semantic judgment — bodies are never
 * read. Beads without a slug pass through untouched, in queue order.
 */
function dedupeDecisionsBySlug(decisions: readonly Bead[]): readonly Bead[] {
  const winners = new Map<string, Bead>();
  for (const bead of decisions) {
    const slug = decisionSlug(bead);
    if (slug === null) continue;
    const held = winners.get(slug);
    if (held === undefined || displacesHeldDecision(bead, held)) winners.set(slug, bead);
  }
  return decisions.filter((bead) => {
    const slug = decisionSlug(bead);
    return slug === null || winners.get(slug) === bead;
  });
}

function decisionSlug(bead: Bead): string | null {
  const slug = bead.metadata?.[DECISION_SLUG_META_KEY]?.trim();
  return slug === undefined || slug.length === 0 ? null : slug;
}

function displacesHeldDecision(candidate: Bead, held: Bead): boolean {
  const candidateMs = decisionMovementMs(candidate);
  const heldMs = decisionMovementMs(held);
  if (candidateMs !== heldMs) return candidateMs > heldMs;
  return candidate.id < held.id;
}

/** Movement timestamp for recency ranking; an unparsable timestamp sorts oldest. */
function decisionMovementMs(bead: Bead): number {
  const ms = Date.parse(bead.updated_at ?? bead.created_at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Project one mayor-decision bead into its home-view attention identity
 * (spec §6). Mechanical: title + bead-linked-view href, with the decision
 * question as the summary when the mayor has written it. severity=attention
 * via domainAttention — a curated human-authored ask, never a failure. The
 * `:mayor-decision` id namespace keeps its identity distinct from generic
 * bead alerts and self-clears when the bead closes (the queue stops returning
 * it).
 */
function mayorDecisionAttention(bead: Bead): AttentionItem {
  const decide = bead.metadata?.[DECISION_DECIDE_META_KEY];
  return domainAttention('beads', {
    id: `beads:${bead.id}:mayor-decision`,
    title: bead.title,
    href: beadHref(bead.id),
    updatedAt: bead.updated_at ?? bead.created_at,
    ...(decide !== undefined && decide.trim().length > 0 ? { summary: decide } : {}),
  });
}

function deriveMailAttention(facts: MailAttentionFacts | undefined): readonly AttentionItem[] {
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

function deriveActivityAttention(
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

function deriveHealthAttention(facts: HealthAttentionFacts | undefined): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;

  if (facts.dashboardError !== undefined && facts.dashboardError.length > 0) {
    items.push(
      healthAttention({
        id: 'health:dashboard-health-unavailable',
        title: 'Dashboard health unavailable',
        summary: facts.dashboardError,
      }),
    );
  }

  if (facts.supervisor !== undefined) {
    appendSupervisorAttention(items, facts.supervisor);
  }
  if (facts.system !== undefined) {
    appendDashboardProcessAttention(items, facts.system);
    appendHostAttention(items, facts.system);
  }
  if (facts.trend !== undefined && !facts.trend.available) {
    items.push(
      healthWatch({
        id: 'health:dolt-noms-unavailable',
        title: 'Dolt-noms trend unavailable',
        summary: facts.trend.reason,
      }),
    );
  }

  return items;
}

function deriveMaintainerAttention(
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

function appendSupervisorAttention(
  items: AttentionItem[],
  supervisor: SupervisorHealthState,
): void {
  if (supervisor.status === 'unavailable') {
    items.push(
      healthAttention({
        id: 'health:supervisor-unreachable',
        title: 'Supervisor unreachable',
        summary: supervisor.error,
      }),
    );
    return;
  }

  const data = supervisor.data;
  if (data.status !== 'ok') {
    items.push(
      healthAttention({
        id: 'health:supervisor-not-ok',
        title: `Supervisor ${data.status}`,
      }),
    );
  }
  if (data.city === undefined) {
    items.push(
      healthWatch({
        id: 'health:supervisor-city-missing',
        title: 'Supervisor city missing',
        summary: 'city was absent from generated supervisor health',
      }),
    );
  }
  if (data.version === undefined) {
    items.push(
      healthWatch({
        id: 'health:supervisor-version-missing',
        title: 'Supervisor version missing',
        summary: 'version was absent from generated supervisor health',
      }),
    );
  }
}

function appendDashboardProcessAttention(items: AttentionItem[], health: SystemHealth): void {
  const admin = health.admin;
  if (admin.uptime_sec < DASHBOARD_PROCESS_STARTING_UPTIME_SEC) {
    items.push(
      healthAttention({
        id: 'health:dashboard-process-starting',
        title: 'Dashboard process just restarted',
        summary: `${admin.uptime_sec}s uptime`,
      }),
    );
  }

  if (admin.rss_bytes >= DASHBOARD_PROCESS_RSS_HIGH_BYTES) {
    items.push(
      healthAttention({
        id: 'health:dashboard-process-rss-high',
        title: 'Dashboard RSS high',
        summary: formatBytes(admin.rss_bytes),
      }),
    );
  } else if (admin.rss_bytes >= DASHBOARD_PROCESS_RSS_ELEVATED_BYTES) {
    items.push(
      healthWatch({
        id: 'health:dashboard-process-rss-elevated',
        title: 'Dashboard RSS elevated',
        summary: formatBytes(admin.rss_bytes),
      }),
    );
  }

  if (admin.heap_used_bytes >= DASHBOARD_PROCESS_HEAP_HIGH_BYTES) {
    items.push(
      healthAttention({
        id: 'health:dashboard-process-heap-high',
        title: 'Dashboard heap high',
        summary: formatBytes(admin.heap_used_bytes),
      }),
    );
  } else if (admin.heap_used_bytes >= DASHBOARD_PROCESS_HEAP_ELEVATED_BYTES) {
    items.push(
      healthWatch({
        id: 'health:dashboard-process-heap-elevated',
        title: 'Dashboard heap elevated',
        summary: formatBytes(admin.heap_used_bytes),
      }),
    );
  }
}

function appendHostAttention(items: AttentionItem[], health: SystemHealth): void {
  const memoryRatio = safeRatio(health.host.free_mem_bytes, health.host.total_mem_bytes);
  if (memoryRatio !== null && memoryRatio < 0.05) {
    items.push(
      healthAttention({
        id: 'health:memory-critical',
        title: 'Host memory critical',
        summary: `${Math.round(memoryRatio * 100)}% free`,
      }),
    );
  } else if (memoryRatio !== null && memoryRatio < 0.1) {
    items.push(
      healthWatch({
        id: 'health:memory-low',
        title: 'Host memory low',
        summary: `${Math.round(memoryRatio * 100)}% free`,
      }),
    );
  }

  const loadRatio = safeRatio(health.host.load_avg_1, health.host.cpu_count);
  if (loadRatio !== null && loadRatio > 1.5) {
    items.push(
      healthAttention({
        id: 'health:load-high',
        title: 'Host load high',
        summary: `${health.host.load_avg_1.toFixed(2)} load across ${health.host.cpu_count} CPUs`,
      }),
    );
  } else if (loadRatio !== null && loadRatio > 1) {
    items.push(
      healthWatch({
        id: 'health:load-elevated',
        title: 'Host load elevated',
        summary: `${health.host.load_avg_1.toFixed(2)} load across ${health.host.cpu_count} CPUs`,
      }),
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
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

/**
 * A data-unavailability item: a slice of a source could not be read. It reports
 * the degradation WITHOUT inflating or recoloring the domain's nav badge (see
 * AttentionSeverity).
 */
function domainUnavailable(
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
