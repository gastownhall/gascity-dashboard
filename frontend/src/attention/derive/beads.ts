import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { selectBeadsNeedingAttention, type BeadAttentionReason } from '../beadsNeedingAttention';
import type { AttentionItem } from '../compose';
import { domainAttention, domainUnavailable, domainWatch, type ReadFreshnessFacts } from './shared';

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

export function deriveBeadsAttention(
  facts: BeadsAttentionFacts | undefined,
): readonly AttentionItem[] {
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
