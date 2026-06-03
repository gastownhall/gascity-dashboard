// Pure phase-classification rules for the runs collector
// (gascity-dashboard-0t6). Kept in their own module so the rules can be
// tested independently of the lane builder and the transport layer.
//
// All exports here are deterministic functions over RunIssue values;
// no IO, no global state. The companion test file pins the upstream
// classifier behavior so the React translation of RunMap inherits a
// consistent phase grammar.
//
// GcBead has no first-class `parent` field, so `RunIssue.parent` is
// populated by the adapter (in runs.ts) from metadata['gc.parent_bead_id']
// when present. When that metadata key is absent, parent keyword scans simply
// don't fire and classification falls back to title + description + metadata
// text scans.

import type {
  GcBead,
} from '../gc-beads.js';
import type {
  RunPhase as SharedRunPhase,
  RunStage,
} from '../snapshot/types.js';

export interface RunIssue {
  id: string;
  title: string;
  description?: string;
  status: string;
  issue_type: string;
  assignee?: string;
  updated_at: string;
  /** Populated from metadata['gc.parent_bead_id'] by the GcBead adapter. */
  parent?: string;
  // Mirrors GcBead.metadata after 6bv7 F11 (Record<string, string> per
  // OpenAPI). Propagating the narrowing through the internal pipeline so
  // consumers get the SSOT signal without redundant typeof guards.
  metadata?: Record<string, string>;
}

export interface PhaseMapping {
  phase: SharedRunPhase;
  label: string;
  reviewRound: number | null;
}

export function mapRunPhase(issues: RunIssue[]): PhaseMapping {
  if (
    issues.some(
      (i) => i.status === 'blocked' || textForIssue(i).includes('blocked'),
    )
  ) {
    return { phase: 'blocked', label: 'blocked', reviewRound: null };
  }

  if (issues.length > 0 && issues.every((i) => i.status === 'closed')) {
    return { phase: 'complete', label: 'complete', reviewRound: null };
  }

  if (
    containsAny(issues, [
      'approval',
      'approved',
      'gate',
      'human',
      'finalize-scope',
    ])
  ) {
    return { phase: 'approval', label: 'approval', reviewRound: null };
  }

  if (
    containsAny(issues, [
      'post-merge',
      'merge',
      'close',
      'report',
      'finalization',
      'finalize',
    ])
  ) {
    return {
      phase: 'finalization',
      label: 'finalization',
      reviewRound: null,
    };
  }

  const round = reviewRoundForIssues(issues);
  if (round !== null || containsAny(issues, ['review', 'reviewer', 'scorecard'])) {
    const resolved = round ?? fallbackReviewRound(issues);
    return {
      phase: 'review',
      label: `review round ${resolved}`,
      reviewRound: resolved,
    };
  }

  if (
    containsAny(issues, ['implementation', 'work', 'patch', 'code', 'fix', 'do-work'])
  ) {
    return {
      phase: 'implementation',
      label: 'implementation',
      reviewRound: null,
    };
  }

  if (containsAny(issues, ['intake', 'load-context', 'router', 'request'])) {
    return { phase: 'intake', label: 'intake', reviewRound: null };
  }

  return { phase: 'active', label: 'active', reviewRound: null };
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
  const rounds = issues
    .map(reviewRoundForIssue)
    .filter((r): r is number => r !== null);
  if (rounds.length === 0) return null;
  return Math.max(...rounds);
}

export function fallbackReviewRound(issues: RunIssue[]): number {
  const reviewIssueCount = issues.filter((i) =>
    textForIssue(i).includes('review'),
  ).length;
  return Math.max(reviewIssueCount, 1);
}

export function textForIssue(issue: RunIssue): string {
  const metadataText = Object.entries(issue.metadata ?? {})
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

export function containsAny(issues: RunIssue[], needles: string[]): boolean {
  return issues.some((i) => {
    const text = textForIssue(i);
    return needles.some((n) => text.includes(n));
  });
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// ── GcBead adapter ─────────────────────────────────────────────────────────

/**
 * Adapt the supervisor wire shape to the phase classifier's input. GcBead now
 * carries a first-class `parent` field (6bv7 F15); the metadata fallback
 * survives because formula scaffolding still writes the older
 * `gc.parent_bead_id` key on synthetic beads.
 */
export function fromGcBead(bead: GcBead): RunIssue {
  const parent = bead.parent ?? stringValue(bead.metadata?.['gc.parent_bead_id']);
  const issue: RunIssue = {
    id: bead.id,
    title: bead.title,
    status: bead.status,
    issue_type: bead.issue_type,
    // 6bv7 F16: OpenAPI Bead exposes no updated_at / closed_at — created_at
    // is the only timestamp the supervisor emits, so the fallback chain
    // collapses to it.
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
    return formulaStageProgress(formulaStages, issues);
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
      key === 'review' && phase.reviewRound !== null
        ? `Review round ${phase.reviewRound}`
        : label,
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
        steps: [
          'design-review.prepare-review-items',
          'design-review.persona-review-fanout',
        ],
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
        steps: [
          'investigation-synthesis',
          'followup-evidence',
          'normalize-outcome',
        ],
      },
      {
        key: 'approval',
        label: 'Human approval',
        steps: [
          'approve-classification',
          'verify-classification-approval',
        ],
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
        steps: [
          'approve-fix-plan',
          'approve-test-hardening-plan',
          'verify-selected-plan-approval',
        ],
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

function formulaStageProgress(
  stages: Array<{ key: string; label: string; steps: string[] }>,
  issues: RunIssue[],
): RunStage[] {
  const primary = issues.filter(isPrimaryStepIssue);
  const activeStepId = latestStepId(
    primary.filter((i) => i.status === 'in_progress'),
  );
  const activeIndex = activeStepId
    ? stages.findIndex((s) => s.steps.includes(activeStepId))
    : firstOpenStageIndex(stages, primary);
  const furthestClosedIndex = furthestClosedStageIndex(stages, primary);

  const stageHasClosed = (stage: { steps: string[] }): boolean =>
    stage.steps.some((step) =>
      stepIssues(primary, step).some((i) => i.status === 'closed'),
    );

  return stages.map((stage, idx) => {
    let status: RunStage['status'];
    if (activeIndex >= 0) {
      status =
        idx < activeIndex ? 'complete' : idx === activeIndex ? 'active' : 'pending';
    } else if (stageHasClosed(stage) || idx < furthestClosedIndex) {
      status = 'complete';
    } else {
      status = 'pending';
    }
    return { key: stage.key, label: stage.label, status };
  });
}

function firstOpenStageIndex(
  stages: Array<{ steps: string[] }>,
  issues: RunIssue[],
): number {
  return stages.findIndex((s) =>
    s.steps.some((step) =>
      stepIssues(issues, step).some((i) => i.status !== 'closed'),
    ),
  );
}

function furthestClosedStageIndex(
  stages: Array<{ steps: string[] }>,
  issues: RunIssue[],
): number {
  let furthest = -1;
  stages.forEach((s, idx) => {
    if (
      s.steps.some((step) =>
        stepIssues(issues, step).some((i) => i.status === 'closed'),
      )
    ) {
      furthest = idx;
    }
  });
  return furthest;
}

export function latestStepId(issues: RunIssue[]): string | null {
  return (
    [...issues]
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .map((i) => stringValue(i.metadata?.['gc.step_id']))
      .find(Boolean) ?? null
  );
}

export function stepIssues(issues: RunIssue[], step: string): RunIssue[] {
  return issues.filter(
    (i) => stringValue(i.metadata?.['gc.step_id']) === step,
  );
}

export function isPrimaryStepIssue(issue: RunIssue): boolean {
  const kind = stringValue(issue.metadata?.['gc.kind']);
  return kind !== 'spec' && kind !== 'scope-check' && kind !== 'workflow-finalize';
}
