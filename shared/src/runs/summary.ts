import type {
  RunChange,
  RunCounts,
  RunLane,
  RunSummary,
  RunStage,
} from '../snapshot/types.js';
import { fromRootMetadataScope } from '../run-scope.js';
import { resolveRunFormulaIdentity } from './formula-name.js';
import {
  isPrimaryStepIssue,
  latestStepId,
  mapRunPhase,
  reviewRoundForIssues,
  stageProgress,
  stagesForFormula,
  stepIssues,
  stringValue,
  type RunIssue,
} from './phaseMapping.js';

export const MAX_VISIBLE_ACTIVE_LANES = 8;
export const RECENT_CHANGES_CAP = 12;
const ENGINEERING_TYPES = new Set([
  'feature',
  'bug',
  'task',
  'docs',
  'molecule',
]);

export interface RunFeedScope {
  scopeKind: 'city' | 'rig';
  scopeRef: string;
  rootStoreRef: string;
}

export type RunFeedScopeMap = ReadonlyMap<string, RunFeedScope>;

export function buildRunSummary(
  issues: RunIssue[],
  feedScopes: RunFeedScopeMap = new Map(),
  partial = false,
): RunSummary {
  const groups = new Map<string, RunIssue[]>();

  for (const issue of issues) {
    const rootId = runRootId(issue);
    const group = groups.get(rootId) ?? [];
    group.push(issue);
    groups.set(rootId, group);
  }

  const runGroups = Array.from(groups.entries()).filter(([rootId, groupIssues]) =>
    isGraphV2RunGroup(rootId, groupIssues),
  );
  const laneIssues = runGroups.flatMap(([, groupIssues]) => groupIssues);
  const sortedLanes = runGroups
    .map(([rootId, groupIssues]) => runLane(rootId, groupIssues, feedScopes))
    .sort(compareLanes);

  const activeLanes = sortedLanes.filter((lane) => lane.phase !== 'complete');
  const historicalLanes = sortedLanes.filter((lane) => lane.phase === 'complete');
  const visibleActive = activeLanes.slice(0, MAX_VISIBLE_ACTIVE_LANES);

  const summary: RunSummary = {
    totalActive: activeLanes.length,
    totalHistorical: historicalLanes.length,
    runCounts: runCounts(activeLanes, visibleActive.length),
    lanes: visibleActive,
    historicalLanes,
    recentChanges: recentChanges(laneIssues),
    census: runCensusUnavailable(),
  };
  return partial ? { ...summary, lanesPartial: true } : summary;
}

function isGraphV2RunGroup(rootId: string, issues: RunIssue[]): boolean {
  const root = issues.find((issue) => issue.id === rootId);
  return stringValue(root?.metadata?.['gc.formula_contract']) === 'graph.v2';
}

export function runCounts(lanes: RunLane[], visible: number): RunCounts {
  const counts: RunCounts = {
    total: lanes.length,
    visible,
    prReview: 0,
    designReview: 0,
    bugfix: 0,
    blocked: 0,
    other: 0,
  };

  for (const lane of lanes) {
    if (lane.phase === 'blocked' || (lane.statusCounts.blocked ?? 0) > 0) {
      counts.blocked += 1;
    }
    switch (runKind(lane.formula)) {
      case 'prReview':
        counts.prReview += 1;
        break;
      case 'designReview':
        counts.designReview += 1;
        break;
      case 'bugfix':
        counts.bugfix += 1;
        break;
      case 'other':
        counts.other += 1;
        break;
    }
  }

  return counts;
}

export function runKind(
  formula: RunLane['formula'],
): 'prReview' | 'designReview' | 'bugfix' | 'other' {
  const formulaName = runFormulaName(formula);
  if (formulaName === 'mol-adopt-pr-v2') return 'prReview';
  if (formulaName === 'mol-design-review-v2') return 'designReview';
  if (
    formulaName === 'mol-bug-report-flow-v2' ||
    formulaName === 'mol-bug-report-implementation-v2'
  ) {
    return 'bugfix';
  }
  return 'other';
}

export function runLane(
  rootId: string,
  issues: RunIssue[],
  feedScopes: RunFeedScopeMap,
): RunLane {
  const phase = mapRunPhase(issues);
  const updatedAt = latestUpdatedAt(issues);
  const formula = runFormula(rootId, issues);
  const formulaName = runFormulaName(formula);
  const stages = stageProgress(phase, formulaName, issues);
  const foundStageIndex = stages.findIndex((stage) => stage.status === 'active');
  const activeStage = foundStageIndex >= 0 ? stages[foundStageIndex] : undefined;

  const primaryInProgress = issues.filter(
    (issue) => isPrimaryStepIssue(issue) && issue.status === 'in_progress',
  );
  const activeStepId = latestStepId(primaryInProgress);
  const progress = runProgress(stages, foundStageIndex, activeStepId, issues);

  const formulaStages = stagesForFormula(formulaName);
  const formulaStageResolved =
    formulaStages.length > 0 &&
    progress.status === 'active_step' &&
    formulaStages.some((stage) => stage.steps.includes(progress.stepId));
  const scope = runScope(rootId, issues, feedScopes);

  return {
    id: rootId,
    title: displayTitle(rootId, issues),
    formula,
    scope,
    external: externalReference(issues),
    phase: phase.phase,
    phaseLabel: formula.status === 'known' ? (activeStage?.label ?? phase.label) : phase.label,
    statusCounts: statusCounts(issues),
    activeAssignees: activeAssignees(issues),
    updatedAt,
    stages,
    progress,
    formulaStageResolved,
    health: runHealthUnavailable(),
  };
}

export function runRootId(issue: RunIssue): string {
  const sourceRoot = sourceRunRootId(issue);
  if (sourceRoot) return sourceRoot;

  const metadata = issue.metadata ?? {};
  const explicitRoot = stringValue(metadata['gc.root_bead_id']);
  if (explicitRoot) return explicitRoot;

  if (
    stringValue(metadata['gc.kind']) === 'run' ||
    issue.issue_type === 'molecule'
  ) {
    return issue.id;
  }

  const moleculeId = stringValue(metadata.molecule_id);
  if (moleculeId) return moleculeId;

  return issue.id;
}

function runScope(
  rootId: string,
  issues: RunIssue[],
  feedScopes: RunFeedScopeMap,
): RunLane['scope'] {
  const root = issues.find((issue) => issue.id === rootId);
  const ordered = root
    ? [root, ...issues.filter((issue) => issue !== root)]
    : issues;
  const rootStoreRef = metadataString(ordered, 'gc.root_store_ref');
  const metadataScope = fromRootMetadataScope({
    ...(root?.metadata ?? {}),
    ...(rootStoreRef ? { 'gc.root_store_ref': rootStoreRef } : {}),
    'gc.scope_ref':
      stringValue(root?.metadata?.['gc.scope_ref']) ||
      metadataString(ordered, 'gc.scope_ref'),
  });

  if (metadataScope !== null) {
    return {
      status: 'available',
      kind: metadataScope.scopeKind,
      ref: metadataScope.scopeRef,
      rootStoreRef: metadataScope.rootStoreRef,
    };
  }

  const feedScope = feedScopes.get(rootId);
  if (feedScope !== undefined) {
    return {
      status: 'available',
      kind: feedScope.scopeKind,
      ref: feedScope.scopeRef,
      rootStoreRef: rootStoreRef || feedScope.rootStoreRef,
    };
  }

  return {
    status: 'unavailable',
    error: 'run scope metadata unavailable',
  };
}

function sourceRunRootId(issue: RunIssue): string {
  return (
    stringValue(issue.metadata?.['pr_review.run_root_id']) ||
    stringValue(issue.metadata?.['pr_review.workflow_root_id']) ||
    stringValue(issue.metadata?.['bugflow.active_run_id']) ||
    stringValue(issue.metadata?.['bugflow.implementation_run_id']) ||
    stringValue(issue.metadata?.['bugflow.implementation_workflow_id']) ||
    stringValue(issue.metadata?.['design_review.run_root_id']) ||
    stringValue(issue.metadata?.['design_review.workflow_root_id'])
  );
}

function runFormula(
  rootId: string,
  issues: RunIssue[],
): RunLane['formula'] {
  const root = issues.find((issue) => issue.id === rootId);
  const resolved = resolveRunFormulaIdentity('lane', { root, issues });
  if (resolved.name !== null) return { status: 'known', name: resolved.name };

  return { status: 'unavailable', error: 'run formula unavailable' };
}

function runFormulaName(formula: RunLane['formula']): string | null {
  return formula.status === 'known' ? formula.name : null;
}

export function displayTitle(rootId: string, issues: RunIssue[]): string {
  const prTitle = metadataString(issues, 'pr_review.github_title');
  const prNumber = metadataString(issues, 'pr_review.pr_number');
  if (prTitle && prNumber) {
    return `PR #${prNumber}: ${prTitle}`;
  }

  const issueUrl = metadataString(issues, 'bugflow.github_issue_url');
  const issueNumber = metadataString(issues, 'bugflow.github_issue_number');
  if (issueUrl && issueNumber) {
    return `Issue #${issueNumber}: ${issues[0]?.title ?? rootId}`;
  }

  const root = issues.find((i) => i.id === rootId);
  return root?.title ?? issues[0]?.title ?? rootId;
}

export function statusCounts(issues: RunIssue[]): Record<string, number> {
  return issues.reduce<Record<string, number>>((counts, i) => {
    counts[i.status] = (counts[i.status] ?? 0) + 1;
    return counts;
  }, {});
}

export function activeAssignees(issues: RunIssue[]): string[] {
  return Array.from(
    new Set(
      issues
        .filter((i) => i.status !== 'closed')
        .map((i) => i.assignee?.trim())
        .filter((a): a is string => Boolean(a)),
    ),
  ).sort();
}

export function latestUpdatedAt(issues: RunIssue[]): RunLane['updatedAt'] {
  const at = issues
    .map((i) => i.updated_at)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  return at === undefined
    ? { status: 'unavailable', error: 'run update time unavailable' }
    : { status: 'available', at };
}

export function recentChanges(issues: RunIssue[]): RunChange[] {
  return [...issues]
    .filter((i) => i.updated_at)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, RECENT_CHANGES_CAP)
    .map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      updatedAt: i.updated_at,
    }));
}

export function compareLanes(a: RunLane, b: RunLane): number {
  const aTime = a.updatedAt.status === 'available' ? Date.parse(a.updatedAt.at) : 0;
  const bTime = b.updatedAt.status === 'available' ? Date.parse(b.updatedAt.at) : 0;
  return bTime - aTime || a.id.localeCompare(b.id);
}

export function externalReference(issues: RunIssue[]): RunLane['external'] {
  const label = externalLabel(issues);
  const url = externalUrl(issues);
  if (label !== null && url !== null) {
    return { status: 'available', label, url };
  }
  if (label !== null) {
    return { status: 'label_only', label };
  }
  return { status: 'unavailable', error: 'external reference unavailable' };
}

export function externalUrl(issues: RunIssue[]): string | null {
  const raw =
    metadataString(issues, 'pr_review.pr_url') ||
    metadataString(issues, 'bugflow.github_issue_url');
  return raw && /^https?:\/\//i.test(raw) ? raw : null;
}

export function externalLabel(issues: RunIssue[]): string | null {
  const prNumber = metadataString(issues, 'pr_review.pr_number');
  if (prNumber) return `PR #${prNumber}`;
  const issueNumber = metadataString(issues, 'bugflow.github_issue_number');
  if (issueNumber) return `Issue #${issueNumber}`;
  return (
    metadataString(issues, 'pr_review.external_ref') ||
    metadataString(issues, 'bugflow.external_ref') ||
    null
  );
}

export function metadataString(issues: RunIssue[], key: string): string {
  return (
    issues.map((i) => stringValue(i.metadata?.[key])).find(Boolean) ?? ''
  );
}

export function emptyRunSummary(): RunSummary {
  return {
    totalActive: 0,
    totalHistorical: 0,
    runCounts: {
      total: 0,
      visible: 0,
      prReview: 0,
      designReview: 0,
      bugfix: 0,
      blocked: 0,
      other: 0,
    },
    lanes: [],
    historicalLanes: [],
    recentChanges: [],
    census: runCensusUnavailable(),
  };
}

export function runCensusUnavailable(): RunSummary['census'] {
  return {
    status: 'unavailable',
    error: 'run health has not been derived',
  };
}

export function runHealthUnavailable(): RunLane['health'] {
  return {
    status: 'unavailable',
    error: 'run health has not been derived',
  };
}

export function runBeadFilter(bead: { issue_type: string; labels?: string[]; metadata?: Record<string, string> }): boolean {
  if (Array.isArray(bead.labels) && bead.labels.some((l) => l.startsWith('gc:'))) {
    return false;
  }
  if (ENGINEERING_TYPES.has(bead.issue_type)) {
    return true;
  }
  if (stringValue(bead.metadata?.['gc.kind']) === 'run') {
    return true;
  }
  return false;
}

export function runProgress(
  stages: RunStage[],
  activeStageIndex: number,
  activeStepId: string | null,
  issues: RunIssue[],
): RunLane['progress'] {
  const stage = runStagePosition(stages, activeStageIndex);
  if (activeStepId !== null) {
    return {
      status: 'active_step',
      stepId: activeStepId,
      stage,
      attempt: runStepAttempt(issues, activeStepId),
    };
  }

  if (stage.status === 'available') {
    return {
      status: 'stage_only',
      stage,
      error: 'active run step unavailable',
    };
  }

  return { status: 'unavailable', error: 'run progress unavailable' };
}

export function runStagePosition(
  stages: RunStage[],
  activeStageIndex: number,
): Extract<RunLane['progress'], { status: 'active_step' }>['stage'] {
  const stage = stages[activeStageIndex];
  return stage === undefined
    ? { status: 'unavailable', error: 'active run stage unavailable' }
    : {
      status: 'available',
      index: activeStageIndex,
      key: stage.key,
      label: stage.label,
    };
}

export function runStepAttempt(
  issues: RunIssue[],
  stepId: string,
): Extract<RunLane['progress'], { status: 'active_step' }>['attempt'] {
  const value = reviewRoundForIssues(stepIssues(issues, stepId));
  return value === null
    ? { status: 'unavailable', error: 'run step attempt unavailable' }
    : { status: 'available', value };
}
