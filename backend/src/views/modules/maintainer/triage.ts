import type {
  ContributorStat,
  MaintainerTriage,
  TriageItem,
  TriageItemStatus,
  TriageTier,
  TriageTierSection,
} from 'gas-city-dashboard-shared';
import { execGhIssueList, execGhPrList, ExecError } from '../../../exec.js';
import type { ExecResult } from '../../../exec-core.js';
import { parseJsonArray } from '../../../lib/parse-json.js';
import { LOG_COMPONENT, errorMessage, logError } from '../../../logging.js';
import { classifyItem } from './classifier.js';
import { computeContributorStats } from './contributor.js';
import { buildClusters, inheritIssueFiles } from './blast-radius.js';
import { buildTopicClusters } from './topics.js';
import { parseTriageAssessment, sortScore } from './triage-assessment.js';

// Compose a MaintainerTriage envelope from raw `gh` output.
//
// gascity-dashboard-361: the ingest layer. This layer does NOT classify
// tiers, compute clusters, derive trust tiers, or generate weak ties —
// every TriageItem comes out with tier=null, cluster_id=null,
// blast_files=[], weak_ties=[], and ContributorStat with tier='regular'
// and rates=null. Downstream beads enrich the envelope in place:
//   - 7ts (priority-classifier) sets item.tier + item.is_marked
//   - gtr (blast-radius)        sets item.cluster_id + item.blast_files
//   - alh (contributor-stats)   replaces item.author with computed tiers/rates
//   - 98h (semantic-weak-ties)  sets item.weak_ties
//
// Until those run, every item lands in the `stability` tier as
// unclustered. The frontend renders that as one quiet pile under the
// REGRESSION + BREAKING and REGRESSION tier headings (which are empty
// at first), which is exactly the "haven't triaged yet" reading.

const ITEM_FETCH_LIMIT = 500;

interface GhAuthor {
  login?: string;
}

interface GhLabel {
  name?: string;
}

interface GhIssue {
  number: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  author: GhAuthor | null;
  labels?: GhLabel[];
  url: string;
}

interface GhPrFile {
  path?: string;
  additions?: number;
  deletions?: number;
}

interface GhPr {
  number: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  author: GhAuthor | null;
  labels?: GhLabel[];
  url: string;
  body?: string;
  additions?: number;
  deletions?: number;
  reviewDecision?: string;
  isDraft?: boolean;
  state?: string;
  files?: GhPrFile[];
}

/**
 * Seams for fetchTriage, mirroring the injected-fetchTriage pattern in
 * router.ts / worker.ts. Defaults are the real implementations; tests
 * override to drive the ingest and the (optional) contributor-stats
 * enrichment independently. Optional, so existing callers keep fetchTriage(repo).
 */
interface FetchTriageDeps {
  fetchIssues: (repo: string, limit: number) => Promise<ExecResult>;
  fetchPrs: (repo: string, limit: number) => Promise<ExecResult>;
  computeStats: (repo: string) => Promise<Map<string, ContributorStat>>;
}

export async function fetchTriage(
  repo: string,
  deps: FetchTriageDeps = {
    fetchIssues: execGhIssueList,
    fetchPrs: execGhPrList,
    computeStats: computeContributorStats,
  },
): Promise<MaintainerTriage> {
  // The two open-list gh calls (361 ingest) are the primary, cheap, and
  // always-valid payload. Contributor stats (alh) are OPTIONAL enrichment
  // on top — authors without a computed stat keep defaultContributor by
  // design. computeContributorStats throws hard on a 2MB-cap truncation or
  // any gh non-zero exit, so it runs on its own footing (loadContributorStats)
  // and degrades to an empty Map rather than rejecting the whole refresh
  // (gascity-dashboard-wplw). All three still run concurrently.
  const [issuesRaw, prsRaw, contributorStats] = await Promise.all([
    deps.fetchIssues(repo, ITEM_FETCH_LIMIT),
    deps.fetchPrs(repo, ITEM_FETCH_LIMIT),
    loadContributorStats(repo, deps.computeStats),
  ]);

  if (issuesRaw.truncated) {
    throw new ExecError(
      'gh issue list output exceeded 100KB cap — narrow the fetch fields or raise the limit',
      'spawn',
    );
  }
  if (prsRaw.truncated) {
    throw new ExecError(
      'gh pr list output exceeded 100KB cap — narrow the fetch fields or raise the limit',
      'spawn',
    );
  }
  if (issuesRaw.exitCode !== 0) {
    throw new ExecError(
      `gh issue list exited ${issuesRaw.exitCode}: ${issuesRaw.stderr.slice(0, 256)}`,
      'spawn',
    );
  }
  if (prsRaw.exitCode !== 0) {
    throw new ExecError(
      `gh pr list exited ${prsRaw.exitCode}: ${prsRaw.stderr.slice(0, 256)}`,
      'spawn',
    );
  }

  const issues = parseJsonArray<GhIssue>(issuesRaw.stdout, 'gh issue list');
  const prs = parseJsonArray<GhPr>(prsRaw.stdout, 'gh pr list');

  const issueItems = issues.map(mapIssue);
  const prItems = prs.map(mapPr);

  // Splice the computed ContributorStat onto each item's author. Authors
  // we couldn't find stats for (deleted accounts, ghosts) keep the
  // defaultContributor fallback.
  for (const item of [...issueItems, ...prItems]) {
    const stat = contributorStats.get(item.author.login);
    if (stat !== undefined) item.author = stat;
  }

  // Blast-radius enrichment (gascity-dashboard-gtr). PRs already carry
  // blast_files from `gh pr list --json files`; issues with linked
  // open PRs in this envelope inherit those files so the issue joins
  // the same cluster as its fix-candidate.
  inheritIssueFiles([...issueItems, ...prItems]);

  // Reverse map: every issue gets the PR numbers that fix it (derived
  // from each PR's already-populated linked_numbers, which mapPr filled
  // in by parsing the PR body for closing verbs).
  const prsByFixedIssue = new Map<number, number[]>();
  for (const pr of prItems) {
    for (const issueNum of pr.linked_numbers) {
      const existing = prsByFixedIssue.get(issueNum);
      if (existing) existing.push(pr.number);
      else prsByFixedIssue.set(issueNum, [pr.number]);
    }
  }
  for (const issue of issueItems) {
    const linkedPrs = prsByFixedIssue.get(issue.number);
    if (linkedPrs && linkedPrs.length > 0) {
      issue.linked_numbers = linkedPrs;
    }
  }

  return composeEnvelope(repo, [...issueItems, ...prItems]);
}

/**
 * Run the optional contributor-stats enrichment on its own footing so a
 * failure (2MB-cap truncation, gh non-zero exit, network) degrades to an
 * empty Map and the cheap open-issue / open-PR ingest still renders —
 * authors just keep defaultContributor (gascity-dashboard-wplw). The failure
 * is logged loudly (Don't Swallow Errors), not swallowed silently: it's a
 * real degradation the operator should see, just not a page-blackout.
 */
async function loadContributorStats(
  repo: string,
  computeStats: (repo: string) => Promise<Map<string, ContributorStat>>,
): Promise<Map<string, ContributorStat>> {
  try {
    return await computeStats(repo);
  } catch (err: unknown) {
    logError(
      LOG_COMPONENT.maintainer,
      `contributor-stats enrichment failed for ${repo}, continuing with defaultContributor: ${errorMessage(err)}`,
    );
    return new Map<string, ContributorStat>();
  }
}

function mapIssue(it: GhIssue): TriageItem {
  return {
    kind: 'issue',
    number: it.number,
    title: it.title,
    status: 'open',
    author: defaultContributor(it.author?.login ?? 'unknown'),
    created_at: it.createdAt,
    updated_at: it.updatedAt,
    labels: extractLabels(it.labels),
    tier: null,
    triage_score: null,
    triage_assessment: null,
    slung: null,
    cluster_id: null,
    blast_files: [],
    lines_changed: null,
    weak_ties: [],
    linked_numbers: [],
    html_url: it.url,
    is_marked: false,
    // Conservative default; overwritten by computeHasInFlightPr in
    // composeEnvelope once the linked_numbers reverse-map is populated.
    has_in_flight_pr: false,
  };
}

// Matches GitHub's set of issue-closing verbs in PR bodies. Word-boundary
// anchored on both sides so "prefix" / "suffix" cases don't false-match.
// "Fix(es)? #N" alone is treated as closing per GitHub's own parser; we
// match the same lexicon. See GitHub Docs > "Linking a pull request to an
// issue".
const CLOSING_REF_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

function extractLinkedIssueNumbers(body: string | undefined): number[] {
  if (!body) return [];
  const seen = new Set<number>();
  for (const m of body.matchAll(CLOSING_REF_RE)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) seen.add(n);
  }
  return Array.from(seen);
}

function mapPr(pr: GhPr): TriageItem {
  const adds = pr.additions ?? 0;
  const dels = pr.deletions ?? 0;
  return {
    kind: 'pr',
    number: pr.number,
    title: pr.title,
    status: derivePrStatus(pr),
    author: defaultContributor(pr.author?.login ?? 'unknown'),
    created_at: pr.createdAt,
    updated_at: pr.updatedAt,
    labels: extractLabels(pr.labels),
    tier: null,
    triage_score: null,
    triage_assessment: null,
    slung: null,
    cluster_id: null,
    blast_files: extractFiles(pr.files),
    lines_changed: adds + dels,
    weak_ties: [],
    linked_numbers: extractLinkedIssueNumbers(pr.body),
    html_url: pr.url,
    is_marked: false,
    // PR items never carry the issue-anchored needs-PR signal. See
    // computeHasInFlightPr for the field semantics.
    has_in_flight_pr: false,
  };
}

function extractLabels(labels: GhLabel[] | undefined): string[] {
  if (!labels) return [];
  return labels
    .map((l) => l.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

function extractFiles(files: GhPrFile[] | undefined): string[] {
  if (!files) return [];
  return files.map((f) => f.path).filter((p): p is string => typeof p === 'string' && p.length > 0);
}

function derivePrStatus(pr: GhPr): TriageItemStatus {
  if (pr.isDraft === true) return 'draft';
  const decision = pr.reviewDecision;
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'CHANGES_REQUESTED') return 'changes_requested';
  if (decision === 'REVIEW_REQUIRED') return 'needs_review';
  return 'open';
}

function defaultContributor(login: string): ContributorStat {
  return {
    login,
    tier: 'regular',
    issues_accepted: null,
    issues_opened: null,
    prs_merged: null,
    prs_opened: null,
    computed_at: null,
  };
}

/**
 * Walk every TriageItem in an envelope (unclustered + clustered, across
 * all tiers) into a flat array. Shared by the serve-time overlay
 * (gascity-dashboard-9qs, sibling router.ts) and the worker
 * slung-state purge (gascity-dashboard-4jy, sibling worker.ts) so
 * both walk the envelope by the same rule. Mutations to the returned
 * items mutate the envelope in place — both call sites depend on that.
 */
export function collectItems(envelope: MaintainerTriage): TriageItem[] {
  const out: TriageItem[] = [];
  for (const tier of envelope.tiers) {
    for (const item of tier.unclustered) out.push(item);
    for (const cluster of tier.clusters) {
      for (const item of cluster.items) out.push(item);
    }
  }
  return out;
}

/**
 * Per-item "is there an in-flight PR claiming to fix this?" signal
 * (gascity-dashboard-omv). Mutates each item's `has_in_flight_pr` in
 * place; sets true on issue items whose `linked_numbers` reference at
 * least one PR in the same envelope with status != 'merged' /
 * != 'closed'. PR items always get `false` (the signal is
 * issue-anchored — a PR doesn't need its own PR).
 *
 * This is the inverse of the bs2 issueNumbersWithInFlightPr set used
 * by selectOneMark, materialised as a typed boolean on every item so
 * downstream consumers (the frontend "needs PR" indicator and the
 * "Needs PR only" filter) read one source of truth instead of
 * recomputing from linked_numbers + the items[] map.
 *
 * The predicate walks PR items directly (reading PR.linked_numbers,
 * which mapPr populates from the PR body), so this function has no
 * data dependency on the issue→PR reverse map that fetchTriage builds
 * afterward. composeEnvelope still invokes this after fetchTriage
 * returns the fully-assembled item list, for parity with bs2.
 *
 * Idempotent: safe to re-run; each call overwrites the field on every
 * item in the input.
 */
export function issueNumbersWithInFlightPr(items: ReadonlyArray<TriageItem>): ReadonlySet<number> {
  const issuesWithInFlightPr = new Set<number>();
  for (const item of items) {
    if (item.kind !== 'pr') continue;
    if (item.status === 'merged' || item.status === 'closed') continue;
    for (const linkedNum of item.linked_numbers) {
      issuesWithInFlightPr.add(linkedNum);
    }
  }
  return issuesWithInFlightPr;
}

export function computeHasInFlightPr(items: TriageItem[]): void {
  const issuesWithInFlightPr = issueNumbersWithInFlightPr(items);
  for (const item of items) {
    if (item.kind === 'issue') {
      item.has_in_flight_pr = issuesWithInFlightPr.has(item.number);
    } else {
      // PRs themselves never carry the signal.
      item.has_in_flight_pr = false;
    }
  }
}

/**
 * One Mark Rule enforcement: at most ONE maroon ● on the entire page.
 * Picks the single highest-scoring mark candidate via sortScore and
 * clears the rest.
 *
 * Semantics (gascity-dashboard-bs2): the mark is an operator-action
 * signal, not a problem-anchor. The only meaningful operator move on
 * a triage row is slinging a triage/draft agent. If an open PR already
 * exists for an issue, the PR IS the action queue — marking the issue
 * would invite the operator to sling a duplicate. So:
 *
 *   1. Any issue with at least one in-flight PR (status not 'merged'
 *      / not 'closed') in this envelope claiming to close it via
 *      `linked_numbers` is excluded from the candidate set. The mark
 *      stays on the PR (or falls to the next non-blocked candidate
 *      if the PR is not the top scorer).
 *   2. The legacy parent-transfer from PR → parent issue only fires
 *      when the parent issue has NO in-flight PR (i.e. the winning PR
 *      is merged / closed, so the eye should fall back to the still-open
 *      problem). An issue with an in-flight PR never receives the mark,
 *      regardless of which item won — this is the direction-correct
 *      forward-defense against an isMarkCandidate that marks issues
 *      directly (gascity-dashboard-443).
 *
 * Extracted from composeEnvelope so the GET overlay (gascity-dashboard-9qs)
 * can re-run the winnow after splicing slung-state onto items at serve
 * time.
 *
 * The winner is resolved purely (selectMarkWinner — no mutation), then a
 * single pass sets is_marked = (item is the winner) on every item. The
 * decision and the assignment are no longer split across provisional-set
 * then multiple clearing passes (audit-2026-06-28 #5). Immutability note:
 * this still writes is_marked in place rather than returning new objects,
 * because the item references are shared — collectItems() hands back the
 * very objects held inside the rendered envelope tiers, and applySlungOverlay
 * is by contract an in-place envelope mutator; returning fresh objects here
 * would orphan the envelope's references and drop the maroon ● at render.
 *
 * Callers must have already populated tier + triage_score on every item
 * AND set the provisional is_marked from classifyItem / isMarkCandidate.
 */
export function selectOneMark(items: TriageItem[]): void {
  const winner = selectMarkWinner(items);
  for (const item of items) {
    item.is_marked = item === winner;
  }
}

/**
 * Pure winner resolution for the One Mark Rule — reads provisional is_marked
 * + scores and returns the single item that should carry the maroon ● (or
 * null when nothing qualifies). No mutation, so the decision is testable and
 * the assignment lives in exactly one place (selectOneMark).
 */
function selectMarkWinner(items: TriageItem[]): TriageItem | null {
  // (1) Candidate set: provisionally-marked items, minus any issue whose
  // in-flight PR is in view — the eye should land on the action (the PR),
  // not the problem.
  const issueNumbersWithInFlightPrSet = issueNumbersWithInFlightPr(items);
  const isCandidate = (item: TriageItem): boolean =>
    item.is_marked && !(item.kind === 'issue' && issueNumbersWithInFlightPrSet.has(item.number));

  // (2) Top scorer among the survivors. Uses sortScore so a vetted item wins
  // the mark over an unvetted item with a higher heuristic score (vetted is
  // the stronger signal).
  let topMark: TriageItem | null = null;
  for (const item of items) {
    if (!isCandidate(item)) continue;
    if (topMark === null || sortScore(item) > sortScore(topMark)) {
      topMark = item;
    }
  }
  if (topMark === null) return null;

  // (3) Legacy parent-transfer (PR → parent issue): when the winning mark
  // is a PR, the mark belongs on the parent issue ONLY when there is no
  // in-flight PR for that issue — i.e. the PR that won is no longer an
  // open action item (merged / closed), so the eye should fall back to
  // the still-open problem.
  //
  // gascity-dashboard-443: the guard is keyed on the candidate in-flight
  // set, NOT on `parent.is_marked`. The previous `parent.is_marked` check
  // was structurally wrong in two ways:
  //   - It was unconditionally dead: the winnow cleared is_marked on every
  //     non-topMark item, so the parent was always unmarked at this point.
  //   - It points the wrong direction for the forward-defense case the
  //     block claims to handle. If isMarkCandidate is ever extended to
  //     mark issues directly, a parent issue that was the top scorer would
  //     arrive with is_marked=true and WRONGLY trigger a transfer from a
  //     winning in-flight PR to its parent issue — re-introducing the exact
  //     bs2 regression (the mark must stay on the action item, the PR).
  //
  // Keying on `issueNumbersWithInFlightPr` makes the intent explicit and
  // direction-correct: an issue with an in-flight PR NEVER receives the
  // mark (bs2), regardless of which item is the top scorer. The transfer
  // fires only for a parent with no in-flight PR (its linking PR is the
  // merged / closed topMark) and which is not itself the top scorer.
  if (topMark.kind === 'pr' && topMark.linked_numbers.length > 0) {
    for (const linkedNum of topMark.linked_numbers) {
      const parent = items.find((i) => i.kind === 'issue' && i.number === linkedNum);
      if (
        parent !== undefined &&
        parent !== topMark &&
        !issueNumbersWithInFlightPrSet.has(parent.number)
      ) {
        return parent;
      }
    }
  }
  return topMark;
}

function composeEnvelope(repo: string, items: TriageItem[]): MaintainerTriage {
  const issuesOpen = items.filter((i) => i.kind === 'issue').length;
  const prsOpen = items.filter((i) => i.kind === 'pr').length;

  // Apply the priority classifier (gascity-dashboard-7ts) in place:
  // every item gets its tier, triage_score, and a provisional is_marked.
  // Then overlay the agent-vetted triage_assessment (are) — when the
  // triage skill agent has labeled an item with the full triage/* set,
  // its vetted_score takes precedence over the heuristic for sort + render.
  for (const item of items) {
    const { tier, is_marked, triage_score } = classifyItem(item);
    item.tier = tier;
    item.is_marked = is_marked;
    item.triage_score = triage_score;
    item.triage_assessment = parseTriageAssessment(item.labels);
  }

  // gascity-dashboard-omv: per-item "needs PR" signal. Walks PR
  // linked_numbers to mark each issue with whether at least one
  // in-flight PR claims to fix it. Independent of selectOneMark; both
  // derive from the same in-flight predicate but produce different
  // downstream signals.
  computeHasInFlightPr(items);

  selectOneMark(items);

  const byTier = new Map<TriageTier, TriageItem[]>([
    ['regression_breaking', []],
    ['regression', []],
    ['stability', []],
  ]);
  for (const item of items) {
    if (item.tier === null) continue;
    byTier.get(item.tier)?.push(item);
  }
  for (const list of byTier.values()) {
    list.sort((a, b) => sortScore(b) - sortScore(a));
  }

  // Two-pass clustering within each tier:
  //   1. buildClusters (gascity-dashboard-gtr): file-overlap, authoritative
  //      signal — items sharing real file paths cluster first.
  //   2. buildTopicClusters (gascity-dashboard-98h): topic-keyword,
  //      semantic-ish — picks up the unclustered residue by matching
  //      repo-specific subsystem names in titles. Each item ends up in
  //      at most one cluster across the two passes.
  const tiers: TriageTierSection[] = (
    ['regression_breaking', 'regression', 'stability'] as const
  ).map((tier) => {
    const tierItems = byTier.get(tier) ?? [];
    const fileResult = buildClusters(tierItems);
    const topicResult = buildTopicClusters(fileResult.unclustered);
    return {
      tier,
      clusters: [...fileResult.clusters, ...topicResult.clusters],
      unclustered: topicResult.unclustered,
    };
  });

  // computed_at marks the snapshot moment. Set once a classifier (or
  // any future enrichment pass) has run. Until enrichment beads gtr,
  // alh, 98h all land, this just means tiers + scores are populated.
  return {
    computed_at: new Date().toISOString(),
    repo,
    tiers,
    totals: { issues_open: issuesOpen, prs_open: prsOpen },
  };
}
