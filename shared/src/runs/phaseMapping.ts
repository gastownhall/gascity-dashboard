// Pure phase-classification rules for the runs collector
// (gascity-dashboard-0t6). Kept in their own module so the rules can be
// tested independently of the lane builder and the transport layer.
//
// All exports here are deterministic functions over RunIssue values;
// no IO, no global state. The companion test file pins the upstream
// classifier behavior so the React translation of RunMap inherits a
// consistent phase grammar.
//
// Phase is derived structurally — from the run's CURRENT step (gc.step_id)
// classified into a generic RunPhase (see structuredPhase / stepIdPhase). Only
// when no step carries a gc.step_id does it fall back to a tightened keyword
// scan scoped to step-identity signals (titles + gc.step_id), never the full
// description+metadata dump (see fallbackPhase). Parent keyword scans read
// DashboardBead.parent first and fall back to the older
// metadata['gc.parent_bead_id'] marker when present.

import type { DashboardBead } from '../dashboard-beads.js';
import type { RunPhase as SharedRunPhase, RunStage } from '../snapshot/types.js';
import {
  isBlockedStatus,
  isClosedStatus,
  isFailedStatus,
  isInFlightStatus,
  isOpenStatus,
  isResolvedStatus,
  isSkippedStatus,
} from './status.js';
import { refSegment } from './bead-fields.js';

export interface RunIssue {
  id: string;
  title: string;
  description?: string;
  status: string;
  issue_type: string;
  assignee?: string;
  updated_at: string;
  /** Populated from DashboardBead.parent or metadata['gc.parent_bead_id']. */
  parent?: string;
  /**
   * First-class graph.v2 run-snapshot refs (run-detail adapter only). They encode
   * the review-loop iteration and per-step retry attempt as `.iteration.N` /
   * `.attempt.N` segments — the canonical signal latestAttempt cohorts on. The
   * summary/dashboard adapter has no equivalent and leaves them undefined.
   */
  step_ref?: string;
  scope_ref?: string;
  metadata?: Record<string, string>;
}

export interface PhaseMapping {
  phase: SharedRunPhase;
  label: string;
  reviewRound: number | null;
}

export function mapRunPhase(issues: RunIssue[]): PhaseMapping {
  // Status-based branches first — these are authoritative and correct.
  if (issues.some((i) => isBlockedStatus(i.status) || textForIssue(i).includes('blocked'))) {
    return { phase: 'blocked', label: 'blocked', reviewRound: null };
  }

  // Resolved-with-failure intentionally reports lane phase 'complete': isResolvedStatus
  // covers failed/skipped, so an all-resolved run buckets here even when a step failed.
  // The detail ladder still surfaces that failure as a 'blocked' stage (formulaStageProgress),
  // so "no work remains" (lane) and the visible failure (ladder) coexist by design — the
  // M2-guarded choice. Don't narrow this to closed-only without a terminal-failure lane phase.
  if (issues.length > 0 && issues.every((i) => isResolvedStatus(i.status))) {
    return { phase: 'complete', label: 'complete', reviewRound: null };
  }

  // gascity-dashboard-q3p1: structured-first phase derivation. When the run has
  // step beads carrying gc.step_id, the run's phase is the phase of its CURRENT
  // step (the in_progress primary step, else the latest-advanced primary step) —
  // a real progress signal that tracks the run forward as steps advance. The old
  // keyword scan over title+description+metadata collapsed almost every formula
  // run to 'approval' because needles like 'gate' (order:gate-sweep, "ship gate")
  // and 'human' (the ubiquitous summary_for_human metadata key) matched incidental
  // text in some bead of the group. Step-id is a structural identifier, not free
  // text, so it does not suffer that false-positive class.
  const structured = structuredPhase(issues);
  if (structured !== null) {
    return structured;
  }

  // Fallback (no resolvable step identity): a tightened keyword scan scoped to
  // step-identity signals only (titles + gc.step_id), with the incidental-match
  // needles removed. Conservative — returns 'active' when genuinely ambiguous.
  return fallbackPhase(issues);
}

/**
 * gascity-dashboard-q3p1: derive the phase from the run's current step.
 *
 * The active step is the latest in-flight primary step; if none is in flight
 * (e.g. between steps) it is the furthest-ADVANCED primary step that carries a
 * gc.step_id (started or completed — never a merely materialized pending
 * shell). The step-id is classified into a generic RunPhase by stepIdPhase.
 * Returns null when no primary step carries a gc.step_id (no structured signal
 * to use).
 */
function structuredPhase(issues: RunIssue[]): PhaseMapping | null {
  const primary = issues.filter(isPrimaryStepIssue);
  const inProgressStep = latestStepId(primary.filter((i) => isInFlightStatus(i.status)));
  // gascity-dashboard-uxvk: ZERO step progress — every gc.step_id carrier is
  // still open (none in flight, none closed). The furthest-stage pick below
  // runs over ALL carriers, open ones included, so a never-executed run (the
  // orphaned-molecule repro gc-odssky, all six step children open) would read
  // as whatever mid-run stage its step VOCABULARY ranks highest. With no
  // progress signal at all the run is at its start: intake, never a later
  // stage. Any non-open carrier (closed, blocked, unknown) disables the clamp
  // and falls through to the existing pinned derivation.
  if (inProgressStep === null) {
    const carriers = stepIdCarriers(primary);
    // isOpenStatus (not a raw === 'open') so a cased/padded wire spelling
    // ('Open', ' open ') still counts as zero progress — the supervisor wire is
    // not case/trim-guaranteed (status.ts), and a raw compare would let such an
    // orphan slip past the clamp into a live-looking phase (gascity-dashboard-uxvk).
    if (carriers.length > 0 && carriers.every((i) => isOpenStatus(i.status))) {
      return { phase: 'intake', label: 'intake', reviewRound: null };
    }
  }
  // gascity-dashboard (Major 3): when no step is in flight, the current step
  // is the FURTHEST-ADVANCED step by stage rank — a deterministic, order- and
  // timestamp-independent signal. The run-detail snapshot adapter sets every
  // bead updated_at='' (the snapshot carries no per-bead timestamp), so a
  // timestamp-based pick there is input-order-dependent and can drift from the
  // summary lane. Stage rank is derived from gc.step_id alone, so the summary
  // context (real timestamps) and the detail context (empty timestamps) resolve
  // the same run to the same phase.
  //
  // M2 audit (ga-wisp-x0tank): only ADVANCED steps — in flight or resolved
  // (closed/failed/skipped, exactly what hasAdvanced admits) — may rank here.
  // graph.v2 runs materialize their full DAG at pour time, so
  // pending shells for late steps (finalize, cleanup-worktree) exist from the
  // start; ranking them drove phase='finalization' while the run was
  // mid-review.
  const activeStepId = inProgressStep ?? furthestStageStepId(primary.filter(hasAdvanced));
  if (activeStepId !== null) {
    const phase = stepIdPhase(activeStepId);
    if (phase === 'review') {
      const resolved = reviewRoundForIssues(issues) ?? fallbackReviewRound(issues);
      return { phase: 'review', label: `review round ${resolved}`, reviewRound: resolved };
    }
    return { phase, label: phase, reviewRound: null };
  }

  // Structured signal exists (some primary step carries a gc.step_id) but no
  // step has advanced yet — a freshly poured run. Stay conservative instead of
  // falling through to the keyword scan, which would match late-stage words in
  // the materialized step titles/ids (e.g. 'approval' in pre-approval-ci).
  if (furthestStageStepId(primary) !== null) {
    return { phase: 'active', label: 'active', reviewRound: null };
  }
  return null;
}

// ── Step advancement ────────────────────────────────────────────────────────
//
// The raw bead-status vocabulary (in-flight / closed / resolved) lives in
// status.ts so presentationStatus and this derivation share one source of truth.
// The M2 audit found a divergent in_progress-only filter here that made
// structured phase detection unable to ever fire on the run-detail page's
// supervisor wire statuses; centralizing the predicates removes that drift class.

/** True when the step has actually advanced (started or resolved). */
function hasAdvanced(issue: RunIssue): boolean {
  return isInFlightStatus(issue.status) || isResolvedStatus(issue.status);
}

/**
 * Classify a single gc.step_id into a generic RunPhase. The step id is split on
 * its structural delimiters (`-`, `.`, `_`, `:`, `/`) into TOKENS and matched
 * WHOLE-TOKEN against per-stage keyword sets — never as raw substrings. Whole-
 * token matching is what stops a CI/leading step from being misbucketed onto a
 * late stage: `pre-approval-ci` is not approval, `dispatch-implementation` is
 * implementation (not finalization), `prepare-review-context` is review (not
 * approval/finalization).
 *
 * Precedence is latest-stage-first (approval > finalization > review >
 * implementation > intake), preserving the approval-before-finalization rule so
 * an approval gate that names its successor (`approve-merge`,
 * `verify-merge-approval`) resolves to approval, not finalization, while a pure
 * finalization step (`merge-and-finalize`) still resolves to finalization.
 *
 * The gate stages (approval, finalization) additionally reject the stage token
 * when ANY lead-up qualifier token (`pre`, `prepare`, `wait`, `await`,
 * `pending`, `before`, `for`, `to`) appears anywhere in the step-id tokens —
 * not only immediately before the stage token. Those are steps that LEAD UP TO
 * the gate, not the gate itself (`pre-approval-ci`, `wait-for-approval`,
 * `prepare-for-merge`). Implementation/review/intake do not apply the qualifier
 * rule: a real stage token there is a reliable signal regardless of qualifier.
 *
 * Returns 'active' when no token names a recognizable stage — deliberately
 * conservative, so an unknown step never invents a specific late phase.
 */
export function stepIdPhase(stepId: string): SharedRunPhase {
  const tokens = tokenizeStepId(stepId);
  if (hasStageToken(tokens, APPROVAL_STAGE_TOKENS, { rejectWithLeadUpQualifier: true })) {
    return 'approval';
  }
  if (hasStageToken(tokens, FINALIZATION_STAGE_TOKENS, { rejectWithLeadUpQualifier: true })) {
    return 'finalization';
  }
  if (hasStageToken(tokens, REVIEW_STAGE_TOKENS)) return 'review';
  if (hasStageToken(tokens, IMPLEMENTATION_STAGE_TOKENS)) return 'implementation';
  if (hasStageToken(tokens, INTAKE_STAGE_TOKENS)) return 'intake';
  return 'active';
}

const STEP_ID_DELIMITERS = /[-._:/]+/;

function tokenizeStepId(stepId: string): string[] {
  return stepId.toLowerCase().split(STEP_ID_DELIMITERS).filter(Boolean);
}

// Qualifier tokens that mark a step as LEADING UP TO a gate rather than being
// the gate itself, wherever they appear in the step id: `pre-approval-ci`,
// `wait-for-approval`, `prepare-for-merge`, `before-merge`, `pending-approval`.
const LEAD_UP_QUALIFIER_TOKENS: ReadonlySet<string> = new Set([
  'pre',
  'prepare',
  'wait',
  'await',
  'pending',
  'before',
  'for',
  'to',
]);

function hasStageToken(
  tokens: readonly string[],
  stageTokens: ReadonlySet<string>,
  options: { rejectWithLeadUpQualifier?: boolean } = {},
): boolean {
  if (!tokens.some((token) => stageTokens.has(token))) return false;
  // Gate stages: a stage token is the gate only when no lead-up qualifier token
  // appears anywhere in the step id (a step that LEADS UP TO the gate is not it).
  if (options.rejectWithLeadUpQualifier) {
    return !tokens.some((token) => LEAD_UP_QUALIFIER_TOKENS.has(token));
  }
  return true;
}

// Whole-token stage vocabularies, matched against tokenized gc.step_id values.
// Drawn from the declared step ids in stagesForFormula plus the v1/wisp step
// names (do-work, load-context, …). Multi-word step ids contribute each of
// their tokens (e.g. `merge-and-finalize` → merge, finalize).
const APPROVAL_STAGE_TOKENS: ReadonlySet<string> = new Set([
  'approval',
  'approve',
  'approved',
  'gate',
]);
const FINALIZATION_STAGE_TOKENS: ReadonlySet<string> = new Set([
  'finalize',
  'finalization',
  'merge',
  'cleanup',
  'publish',
]);
const REVIEW_STAGE_TOKENS: ReadonlySet<string> = new Set([
  'review',
  'reviewer',
  'scorecard',
  'persona',
  'personas',
  'audit',
  'repro',
  'baseline',
  'investigation',
  'classify',
  'classification',
]);
const IMPLEMENTATION_STAGE_TOKENS: ReadonlySet<string> = new Set([
  'implement',
  'implementation',
  'patch',
  'fixes',
  'work',
  'design',
]);
const INTAKE_STAGE_TOKENS: ReadonlySet<string> = new Set([
  'intake',
  'bootstrap',
  'context',
  'router',
  'request',
  'preflight',
  'setup',
  'rebase',
]);

/**
 * Keyword fallback used only when no step carries a gc.step_id. Scans
 * step-identity signals (issue titles + any gc.step_id present) rather than the
 * full description+metadata dump, and drops the incidental-matching needles
 * ('gate', 'human', 'merge', 'close', 'report', 'work', 'fix', 'code') that
 * collapsed real runs onto late phases. Conservative: 'active' when ambiguous.
 *
 * ZFC boundary (audit-2026-06-28 #3): this is render-time UI presentation, not
 * AI-orchestration — the ZFC ban on hardcoded semantic classifiers carves out
 * UI/hot paths, and no model is in the loop at synchronous render. The keyword
 * scan is a last-resort DISPLAY hint, reached only after the structural,
 * gc.step_id-based `structuredPhase` returns null (legacy / pre-step-id runs);
 * it gates no action, fails safe to the neutral 'active' label when ambiguous,
 * and is already narrowed to step-identity text with the false-positive needles
 * removed. Kept (not deleted) so unstructured runs still show a best-effort
 * phase instead of always rendering 'active'.
 */
function fallbackPhase(issues: RunIssue[]): PhaseMapping {
  if (stepSignalContainsAny(issues, ['approval', 'approved', 'finalize-scope'])) {
    return { phase: 'approval', label: 'approval', reviewRound: null };
  }

  if (stepSignalContainsAny(issues, ['post-merge', 'finalization', 'finalize'])) {
    return { phase: 'finalization', label: 'finalization', reviewRound: null };
  }

  const round = reviewRoundForIssues(issues);
  if (round !== null || stepSignalContainsAny(issues, ['review', 'reviewer', 'scorecard'])) {
    const resolved = round ?? fallbackReviewRound(issues);
    return { phase: 'review', label: `review round ${resolved}`, reviewRound: resolved };
  }

  if (stepSignalContainsAny(issues, ['implementation', 'patch', 'do-work'])) {
    return { phase: 'implementation', label: 'implementation', reviewRound: null };
  }

  if (stepSignalContainsAny(issues, ['intake', 'load-context', 'router', 'request'])) {
    return { phase: 'intake', label: 'intake', reviewRound: null };
  }

  return { phase: 'active', label: 'active', reviewRound: null };
}

/**
 * Step-identity text for fallback scanning: the issue title plus any gc.step_id.
 * Excludes description and the metadata dump so incidental words (e.g. a
 * summary_for_human value, a "ship gate" mention) never drive the phase.
 */
function stepSignalText(issue: RunIssue): string {
  const stepId = stepIdOf(issue);
  return [issue.title, stepId].filter(Boolean).join(' ').toLowerCase();
}

function stepSignalContainsAny(issues: RunIssue[], needles: string[]): boolean {
  return issues.some((i) => {
    const text = stepSignalText(i);
    return needles.some((n) => text.includes(n));
  });
}

/**
 * Returns the per-issue review round when one is encoded in metadata.
 * Three supported shapes (matching demo-dash):
 *   1. key like `*iteration.N` or `*attempt.N` → N (from key).
 *   2. key like `*iteration` or `*attempt` with numeric value → value.
 *   3. value matching `*iteration.N` or `*attempt.N` → N (from value).
 */
export function reviewRoundForIssue(issue: RunIssue): number | null {
  const metadata = issue.metadata ?? {};

  // Capture group 1 in both ROUND_IN_KEY and ROUND_IN_VALUE is the digit
  // sequence. noUncheckedIndexedAccess makes match[1] type as
  // `string | undefined`, so each branch checks `!== undefined` before
  // numeric coercion.
  for (const [key, value] of Object.entries(metadata)) {
    const keyMatch = key.match(ROUND_IN_KEY);
    if (keyMatch && keyMatch[1] !== undefined) {
      return Number(keyMatch[1]);
    }

    if (ROUND_KEY_NO_DIGITS.test(key)) {
      const attempt = parsePositiveInteger(value);
      if (attempt !== null) {
        return attempt;
      }
    }

    const valueMatch = String(value).match(ROUND_IN_VALUE);
    if (valueMatch && valueMatch[1] !== undefined) {
      return Number(valueMatch[1]);
    }
  }

  return null;
}

const ROUND_IN_KEY = /(?:^|\.)(?:iteration|attempt)\.(\d+)$/;
const ROUND_IN_VALUE = /(?:^|\.)(?:iteration|attempt)\.(\d+)$/;
const ROUND_KEY_NO_DIGITS = /(?:^|\.)(?:iteration|attempt)$/;

export function reviewRoundForIssues(issues: RunIssue[]): number | null {
  const rounds = issues.map(reviewRoundForIssue).filter((r): r is number => r !== null);
  if (rounds.length === 0) return null;
  return Math.max(...rounds);
}

export function fallbackReviewRound(issues: RunIssue[]): number {
  const reviewIssueCount = issues.filter((i) => textForIssue(i).includes('review')).length;
  return Math.max(reviewIssueCount, 1);
}

export function textForIssue(issue: RunIssue): string {
  // gascity-dashboard-9w3k: skip `gc.var.*` keys. v1 / wisp runs carry operator
  // free-text template inputs there (e.g. gc.var.prompt = "review the blocked PR
  // and merge it") which would otherwise feed phase needles ('review', 'blocked',
  // 'merge', 'approval', ...) and mis-bucket the run's phase. These are inputs,
  // not structural progress signals, so they are excluded from classification.
  // graph.v2 roots derive phase from gc.step_id / status, not gc.var.*, so this
  // does not affect graph.v2 classification.
  const metadataText = Object.entries(issue.metadata ?? {})
    .filter(([key]) => !key.startsWith('gc.var.'))
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(' ');

  return [
    issue.title,
    issue.description,
    issue.status,
    issue.issue_type,
    issue.assignee,
    issue.parent,
    metadataText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// ── DashboardBead adapter ─────────────────────────────────────────────────────────

/**
 * Adapt the dashboard bead projection to the phase classifier's input. The
 * metadata fallback survives because formula scaffolding can still write the
 * older `gc.parent_bead_id` key on synthetic beads.
 */
export function fromDashboardBead(bead: DashboardBead): RunIssue {
  const parent = bead.parent ?? stringValue(bead.metadata?.['gc.parent_bead_id']);
  const issue: RunIssue = {
    id: bead.id,
    title: bead.title,
    status: bead.status,
    issue_type: bead.issue_type,
    updated_at: bead.updated_at ?? bead.created_at,
  };
  if (bead.description !== undefined) issue.description = bead.description;
  if (bead.assignee !== undefined) issue.assignee = bead.assignee;
  if (parent) issue.parent = parent;
  if (bead.metadata !== undefined) issue.metadata = bead.metadata;
  return issue;
}

// ── Stage progression ──────────────────────────────────────────────────────

const runStages = [
  ['intake', 'Intake'],
  ['implementation', 'Implementation'],
  ['review', 'Review'],
  ['approval', 'Approval'],
  ['finalization', 'Finalization'],
] as const;

export function stageProgress(
  phase: PhaseMapping,
  formula: string | null,
  issues: RunIssue[],
): RunStage[] {
  const formulaStages = stagesForFormula(formula);
  if (formulaStages.length > 0) {
    return formulaStageProgress(formulaStages, issues, phase.phase === 'complete');
  }

  if (phase.phase === 'blocked') {
    return [{ key: 'blocked', label: 'Blocked', status: 'blocked' }];
  }

  if (phase.phase === 'complete') {
    return runStages.map(([key, label]) => ({
      key,
      label,
      status: 'complete' as const,
    }));
  }

  const activeIndex = runStages.findIndex(([key]) => key === phase.phase);

  if (activeIndex < 0) {
    return runStages.map(([key, label]) => ({
      key,
      label,
      status: (key === 'implementation' ? 'active' : 'pending') as RunStage['status'],
    }));
  }

  return runStages.map(([key, label], idx) => ({
    key,
    label:
      key === 'review' && phase.reviewRound !== null ? `Review round ${phase.reviewRound}` : label,
    status: (idx < activeIndex
      ? 'complete'
      : idx === activeIndex
        ? 'active'
        : 'pending') as RunStage['status'],
  }));
}

export function stagesForFormula(
  formula: string | null,
): Array<{ key: string; label: string; steps: string[] }> {
  if (formula === 'mol-adopt-pr-v2') {
    return [
      { key: 'preflight', label: 'Preflight', steps: ['preflight'] },
      { key: 'rebase', label: 'Worktree / rebase', steps: ['rebase-check'] },
      {
        key: 'review',
        label: 'Review loop',
        steps: [
          'review-loop',
          'review-pipeline.review-claude',
          'review-pipeline.review-codex',
          'review-pipeline.review-gemini',
          'review-pipeline.synthesize',
          'review-pipeline.quality-scorecard',
          'apply-fixes',
        ],
      },
      {
        key: 'ci',
        label: 'Pre-approval CI',
        steps: ['pre-approval-ci', 'repair-ci-failures'],
      },
      { key: 'approval', label: 'Human approval', steps: ['human-approval'] },
      { key: 'finalize', label: 'Merge-ready', steps: ['finalize'] },
      { key: 'cleanup', label: 'Cleanup', steps: ['cleanup-worktree'] },
    ];
  }

  if (formula === 'mol-design-review-v2') {
    return [
      { key: 'setup', label: 'Setup', steps: ['design-review.setup'] },
      {
        key: 'personas',
        label: 'Personas',
        steps: [
          'design-review.persona-gen-claude',
          'design-review.persona-gen-codex',
          'design-review.persona-gen-gemini',
          'design-review.persona-synthesis',
        ],
      },
      {
        key: 'fanout',
        label: 'Persona fanout',
        steps: ['design-review.prepare-review-items', 'design-review.persona-review-fanout'],
      },
      {
        key: 'synthesis',
        label: 'Synthesis',
        steps: ['design-review.global-synthesis'],
      },
      {
        key: 'apply',
        label: 'Apply findings',
        steps: ['design-review.apply-design-changes'],
      },
      { key: 'finalize', label: 'Finalize', steps: ['finalize'] },
    ];
  }

  if (formula === 'mol-bug-report-flow-v2') {
    return [
      {
        key: 'intake',
        label: 'Intake',
        steps: ['bootstrap-run', 'refresh-intake'],
      },
      {
        key: 'repro',
        label: 'Reproduction',
        steps: ['historical-baseline', 'reported-build-repro', 'main-repro'],
      },
      {
        key: 'audit',
        label: 'Audit',
        steps: ['code-path-audit', 'coverage-audit', 'related-refs-audit'],
      },
      {
        key: 'classify',
        label: 'Classify',
        steps: ['investigation-synthesis', 'followup-evidence', 'normalize-outcome'],
      },
      {
        key: 'approval',
        label: 'Human approval',
        steps: ['approve-classification', 'verify-classification-approval'],
      },
      { key: 'publish', label: 'Publish', steps: ['publish-classification'] },
      {
        key: 'dispatch',
        label: 'Dispatch fix',
        steps: ['dispatch-implementation'],
      },
    ];
  }

  if (formula === 'mol-bug-report-implementation-v2') {
    return [
      {
        key: 'plan',
        label: 'Plan approval',
        steps: ['approve-fix-plan', 'approve-test-hardening-plan', 'verify-selected-plan-approval'],
      },
      {
        key: 'design',
        label: 'Design review',
        steps: ['prepare-design-review-doc', 'design-review'],
      },
      {
        key: 'implement',
        label: 'Implement',
        steps: ['implement-change', 'prepare-review-context'],
      },
      {
        key: 'review',
        label: 'Code review',
        steps: ['code-review-loop', 'apply-code-fixes'],
      },
      {
        key: 'pr',
        label: 'Open PR',
        steps: ['approve-pr-open', 'verify-pr-open-approval', 'open-or-update-pr'],
      },
      { key: 'ci', label: 'CI', steps: ['wait-for-ci'] },
      {
        key: 'merge',
        label: 'Merge',
        steps: ['approve-merge', 'verify-merge-approval', 'merge-and-finalize'],
      },
    ];
  }

  return [];
}

// ── Stage completion vs resolution ──────────────────────────────────────────
//
// The formula ladder needs a STRICTER predicate than isResolvedStatus. Resolved
// folds in failed and skipped — correct for "no work remains", wrong for "this
// stage passed". A failed or skipped step must not advance the ladder as if its
// stage completed, or it reintroduces the M2 overstatement class (the failed
// stage rendering complete while a later materialized pending shell renders
// active). These per-step helpers split successful completion from failure and
// skip, reading the raw status AND the gc.outcome a closed bd step carries
// (closed + gc.outcome=fail / skipped), so the bd summary lane and the
// supervisor-wire run-detail page classify a failed stage the same way.

function stepOutcome(issue: RunIssue): string {
  return stringValue(issue.metadata?.['gc.outcome']).toLowerCase();
}

/** A step that ran but FAILED: raw 'failed', or a closed step whose gc.outcome is a failure. */
function isFailedStep(issue: RunIssue): boolean {
  const outcome = stepOutcome(issue);
  if (outcome === 'fail' || outcome === 'failed') return true;
  return isFailedStatus(issue.status);
}

/** A step that was SKIPPED and never ran: raw 'skipped', or a closed step whose gc.outcome is skipped. */
function isSkippedStep(issue: RunIssue): boolean {
  if (stepOutcome(issue) === 'skipped') return true;
  return isSkippedStatus(issue.status);
}

/** A step that completed SUCCESSFULLY: closed/completed/done, and neither failed nor skipped. */
function isSucceededStep(issue: RunIssue): boolean {
  return isClosedStatus(issue.status) && !isFailedStep(issue) && !isSkippedStep(issue);
}

/** The richest canonical ref for a run bead: the first-class step_ref, else its
 *  gc.step_ref metadata mirror, else the (possibly attempt-suffixed) gc.step_id. */
function stepRefOf(issue: RunIssue): string {
  return (
    stringValue(issue.step_ref) ||
    stringValue(issue.metadata?.['gc.step_ref']) ||
    stringValue(issue.metadata?.['gc.step_id'])
  );
}

/** The scope ref for a run bead (carries the review-loop `.iteration.N`). */
function scopeRefOf(issue: RunIssue): string {
  return stringValue(issue.scope_ref) || stringValue(issue.metadata?.['gc.scope_ref']);
}

/**
 * The canonical step id for a run bead. Step identity is the gc.step_id metadata
 * mirror when present (the summary/dashboard projection always carries it). The
 * run-detail snapshot adapter, however, preserves first-class step_ref/scope_ref
 * for rows the supervisor emits WITHOUT that gc.* mirror (see
 * formula-run.fromRunSnapshotBead); for those, derive the step id by stripping
 * the enclosing `scope_ref + "."` prefix off step_ref — exactly the identity the
 * mirror would have held (scope `…review-loop.iteration.8` + step
 * `…iteration.8.apply-fixes.attempt.1` → `apply-fixes.attempt.1`). Without a
 * resolvable mirror or scoped ref there is no step identity, so return ''. Every
 * step-identity reader (latestStepId, furthestStageStepId, byMostRecentThenStage,
 * stepIssues, the fallback step-signal scan) routes through here so first-class-
 * only run-detail rows classify the same as their mirrored summary-lane twins.
 */
function stepIdOf(issue: RunIssue): string {
  const mirrored = stringValue(issue.metadata?.['gc.step_id']);
  if (mirrored) return mirrored;
  const ref = stepRefOf(issue);
  const scope = scopeRefOf(issue);
  if (ref && scope) {
    const prefix = `${scope}.`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
  }
  return '';
}

/**
 * A step's [iteration, attempt] cohort rank. The per-step retry attempt is the
 * `.attempt.N` segment of the step ref — NOT gc.attempt, which graph.v2 sets to
 * the enclosing review-loop ITERATION (identical across every step and attempt of
 * that iteration; captured from a live mol-adopt-pr-v2 run, where the in-flight
 * apply-fixes work bead carries gc.step_id `apply-fixes.attempt.1` and gc.attempt
 * `6` == `…review-loop.iteration.6`). Un-suffixed beads (single-attempt steps and
 * the base-id retry/scope-check latches) rank attempt 0.
 */
function attemptRank(issue: RunIssue): readonly [number, number] {
  const ref = stepRefOf(issue);
  const iteration = refSegment(ref, 'iteration') ?? refSegment(scopeRefOf(issue), 'iteration') ?? 0;
  const attempt = refSegment(ref, 'attempt') ?? 0;
  return [iteration, attempt];
}

function rankIsBefore(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

/**
 * Narrow one step's beads to its LATEST attempt. A retried step materializes a
 * fresh work bead per attempt, distinguished by the `.attempt.N` suffix of its
 * gc.step_id / gc.step_ref (apply-fixes.attempt.1 failed, then
 * apply-fixes.attempt.2 passed). Stage success and failure must read only the
 * latest attempt, or an older failed attempt keeps the stage blocked after the
 * retry has passed. Cohorts rank by [iteration, attempt] (see attemptRank), so a
 * later loop pass and a later in-pass retry both win; the base-id retry/scope
 * latches rank attempt 0 and a real attempt bead supersedes them.
 */
function latestAttempt(stepBeads: RunIssue[]): RunIssue[] {
  if (stepBeads.length <= 1) return stepBeads;
  const ranked = stepBeads.map((bead) => ({ bead, rank: attemptRank(bead) }));
  const max = ranked.reduce((hi, candidate) =>
    rankIsBefore(hi.rank, candidate.rank) ? candidate : hi,
  );
  return ranked
    .filter((r) => r.rank[0] === max.rank[0] && r.rank[1] === max.rank[1])
    .map((r) => r.bead);
}

function formulaStageProgress(
  stages: Array<{ key: string; label: string; steps: string[] }>,
  issues: RunIssue[],
  runComplete: boolean,
): RunStage[] {
  const primary = issues.filter(isPrimaryStepIssue);
  const activeStepId = latestStepId(primary.filter((i) => isInFlightStatus(i.status)));

  // Per stage, the beads that decide its state: each of its steps narrowed to
  // that step's LATEST attempt (latestAttempt), so an older failed attempt of a
  // retried step cannot mask a later successful retry.
  const summaries = stages.map((stage) => {
    const steps = stage.steps.flatMap((step) => latestAttempt(stepIssues(primary, step)));
    return {
      // Succeeded: at least one step passed and EVERY materialized step resolved
      // as a success or a skip — a still-pending or in-flight required sibling
      // (review-pipeline.synthesize / apply-fixes while the reviewers completed)
      // or a failed step keeps the multi-step stage from completing, while a
      // conditional skip alongside a real success (repair-ci-failures skipped
      // after pre-approval-ci passed) still completes it.
      succeeded:
        steps.some(isSucceededStep) &&
        steps.every((step) => isSucceededStep(step) || isSkippedStep(step)),
      failed: steps.some(isFailedStep),
      // Advanced = real forward progress: a success, a failure, or a step in
      // flight. A fully skipped, all-pending, or unmaterialized stage has NOT
      // advanced, so a later "bypassed" stage cannot claim the run moved past it.
      advanced:
        steps.some(isSucceededStep) ||
        steps.some(isFailedStep) ||
        steps.some((step) => isInFlightStatus(step.status)),
      // Bypassed = every materialized step skipped, or the stage never
      // materialized (empty). While the run is in flight such a stage is behind
      // the run ONLY once a later stage has advanced; a bypassed TAIL with
      // nothing advanced after it stays the current/parked stage. Once the whole
      // run has resolved (runComplete) that exception lifts — a skipped tail is
      // final, not parked (see stageComplete).
      bypassed: steps.length === 0 || steps.every(isSkippedStep),
    };
  });

  const laterStageAdvanced = (idx: number): boolean =>
    summaries.slice(idx + 1).some((s) => s.advanced);
  // A stage is behind the run when it succeeded outright, or it was bypassed and
  // either the run has already advanced into a later stage OR the whole run has
  // resolved. The runComplete arm fixes the bypassed-TAIL case: when mapRunPhase
  // buckets an all-resolved run as complete, a skipped or unmaterialized tail
  // must render complete, not park as the current 'active' stage — there is no
  // work left to be current. A failed stage is neither succeeded nor bypassed,
  // so it still surfaces as the current/blocked point even in a resolved run; the
  // failure is never swallowed into a green complete.
  const stageComplete = (idx: number): boolean => {
    const s = summaries[idx]!;
    return s.succeeded || (s.bypassed && (laterStageAdvanced(idx) || runComplete));
  };

  // The current stage is the in-flight step's stage; with nothing in flight it is
  // the FIRST stage the run has not moved past. That keeps a failed stage as the
  // current problem point and holds a bypassed TAIL as current while the run is
  // in flight, yet advances over a bypassed MIDDLE stage that a later succeeded
  // stage proves the run passed (and over a bypassed tail once the run resolves).
  const inFlightIndex = activeStepId
    ? stages.findIndex((s) => s.steps.includes(baseStepId(activeStepId)))
    : -1;
  const currentIndex =
    inFlightIndex >= 0 ? inFlightIndex : summaries.findIndex((_s, idx) => !stageComplete(idx));

  return stages.map((stage, idx) => {
    let status: RunStage['status'];
    if (currentIndex < 0 || idx < currentIndex) {
      status = 'complete';
    } else if (idx === currentIndex) {
      // A failed current stage with nothing in flight renders blocked — the real
      // failure point — rather than a misleading 'active'.
      status = inFlightIndex < 0 && summaries[idx]!.failed ? 'blocked' : 'active';
    } else {
      status = 'pending';
    }
    return { key: stage.key, label: stage.label, status };
  });
}

export function latestStepId(issues: RunIssue[]): string | null {
  return (
    [...issues]
      .sort(byMostRecentThenStage)
      .map((i) => stepIdOf(i))
      .find(Boolean) ?? null
  );
}

/**
 * gascity-dashboard (Major 3): the deterministic current-step pick for the
 * "no step in_progress" fallback. Among the steps that carry a gc.step_id,
 * select the one whose stage is furthest along the ladder (approval >
 * finalization > review > implementation > intake > active). This depends only
 * on gc.step_id — never on updated_at — so it is stable regardless of input
 * order and identical whether the beads come from the summary projection (real
 * timestamps) or the run-detail snapshot adapter (updated_at=''). Ties on stage
 * rank break on the step id string for total determinism.
 */
function furthestStageStepId(issues: RunIssue[]): string | null {
  const stepIds = issues.map((i) => stepIdOf(i)).filter((id): id is string => id.length > 0);
  if (stepIds.length === 0) return null;
  return [...stepIds].sort((a, b) => {
    const rankDelta = stageRank(stepIdPhase(b)) - stageRank(stepIdPhase(a));
    if (rankDelta !== 0) return rankDelta;
    return a < b ? -1 : a > b ? 1 : 0;
  })[0]!;
}

// Lifecycle rank (higher = further along the run lifecycle), used ONLY to pick
// the furthest-reached stage among steps (furthestStageStepId, and the latest-
// step stage tiebreak in byMostRecentThenStage). The lifecycle order is
// intake → implementation → review → approval → finalization, so finalization
// is the FURTHEST stage. 'active' is the conservative floor.
//
// NOTE: this is deliberately decoupled from the CURRENT-phase precedence in
// stepIdPhase, which checks approval BEFORE finalization so an approval gate
// that names its successor (`approve-merge`) resolves to approval. That
// precedence is encoded in the if-order of stepIdPhase, not here — the two
// concerns must not be conflated (a closed approval + closed finalization run
// has its furthest stage = finalization, while a single `approve-merge` step
// is classified as the approval phase).
const LIFECYCLE_RANK: Record<SharedRunPhase, number> = {
  active: 0,
  intake: 1,
  implementation: 2,
  review: 3,
  approval: 4,
  finalization: 5,
  blocked: 6,
  complete: 7,
};

function stageRank(phase: SharedRunPhase): number {
  return LIFECYCLE_RANK[phase];
}

/**
 * Deterministic step ordering: most-recently-updated first, then furthest stage,
 * then step id. Date.parse('') is NaN, so when the run-detail snapshot adapter
 * leaves every updated_at empty the timestamp comparison collapses to 0 and the
 * stage / step-id tiebreakers make the pick deterministic instead of leaving it
 * to the engine's NaN-comparator behavior (input-order-dependent).
 */
function byMostRecentThenStage(a: RunIssue, b: RunIssue): number {
  const timeDelta = parseTimestamp(b.updated_at) - parseTimestamp(a.updated_at);
  if (timeDelta !== 0) return timeDelta;
  const aStep = stepIdOf(a);
  const bStep = stepIdOf(b);
  const rankDelta = stageRank(stepIdPhase(bStep)) - stageRank(stepIdPhase(aStep));
  if (rankDelta !== 0) return rankDelta;
  return aStep < bStep ? -1 : aStep > bStep ? 1 : 0;
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const ATTEMPT_SUFFIX = /\.attempt\.\d+$/;

/**
 * A step id with any trailing `.attempt.N` retry suffix removed
 * (apply-fixes.attempt.1 → apply-fixes). graph.v2 materializes a retried step's
 * work bead under a suffixed gc.step_id, while stagesForFormula and the
 * retry/scope-check latches use the base id, so cohorting must compare base ids.
 */
export function baseStepId(stepId: string): string {
  return stepId.replace(ATTEMPT_SUFFIX, '');
}

export function stepIssues(issues: RunIssue[], step: string): RunIssue[] {
  const base = baseStepId(step);
  return issues.filter((i) => baseStepId(stepIdOf(i)) === base);
}

export function isPrimaryStepIssue(issue: RunIssue): boolean {
  const kind = stringValue(issue.metadata?.['gc.kind']);
  // Both finalize spellings demote to the hidden run-finalize construct in
  // constructKindFor (node-shape.ts); keep the exclusion set aligned.
  return (
    kind !== 'spec' &&
    kind !== 'scope-check' &&
    kind !== 'workflow-finalize' &&
    kind !== 'run-finalize'
  );
}

/**
 * The run's structured step graph: primary step issues carrying a non-empty
 * gc.step_id. This is the SINGLE definition of the carrier set behind the
 * "zero step progress" fact (gascity-dashboard-uxvk) — the intake phase clamp
 * and isStrandedRun must judge the same issues or a stranded lane could stop
 * reading as intake (and vice versa).
 */
export function stepIdCarriers(issues: readonly RunIssue[]): RunIssue[] {
  return issues.filter(
    (issue) => isPrimaryStepIssue(issue) && stringValue(issue.metadata?.['gc.step_id']) !== '',
  );
}
