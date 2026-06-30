import type {
  RunChangedFile,
  RunDiffComparison,
  RunDiffResponse,
  RunDiffRootPath,
  RunExecutionPath,
} from 'gas-city-dashboard-shared';
import {
  execRunGit,
  execRunGitDiffFrom,
  execRunGitNameStatusFrom,
  execRunGitNewFileDiff,
} from '../exec.js';
import { MAX_RUN_DIFF_BYTES } from '../exec-core.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../logging.js';
import {
  classifyRunDiffFile,
  isReviewableRunDiffPath,
  isSafeRelativeGitPath,
} from './run-diff-policy.js';

const MAX_UNTRACKED_PATCH_FILES = 50;
const MAX_UNTRACKED_FILE_DIFF_BYTES = 96 * 1024;

export async function readRunGitDiff(
  executionPath: RunExecutionPath,
  allowedRoots: readonly string[] = [],
): Promise<RunDiffResponse> {
  if (executionPath.kind === 'unavailable') {
    return emptyDiff('path_unknown', unavailableRoot('path_unknown'));
  }
  const cwd = executionPath.path;

  let rootPath: string;
  try {
    const result = await runGit(cwd, 'root', allowedRoots);
    rootPath = result.stdout.trim();
    if (rootPath.length === 0) return emptyDiff('not_git', unavailableRoot('not_git'));
  } catch (err) {
    logWarn(LOG_COMPONENT.runs, `run git root failed for ${cwd}: ${errorMessage(err)}`);
    return emptyDiff('not_git', unavailableRoot('not_git'));
  }

  try {
    const [statusResult, untrackedResult, comparison] = await Promise.all([
      runGit(cwd, 'status', allowedRoots),
      runGit(cwd, 'untracked', allowedRoots),
      resolveComparison(cwd, allowedRoots),
    ]);
    const status = statusResult.stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .filter(isReviewableStatusLine);
    const untrackedPaths = parseNulList(untrackedResult.stdout).filter(isReviewableRunDiffPath);
    const [trackedPatch, trackedChangedFiles] = await Promise.all([
      readTrackedPatch(cwd, comparison, allowedRoots),
      readTrackedChangedFiles(cwd, comparison, allowedRoots),
    ]);
    const trackedPatchBody = filterReviewablePatch(trackedPatch.stdout);
    const untrackedPatch = await readUntrackedPatch(
      cwd,
      untrackedPaths,
      trackedPatchBody.length,
      allowedRoots,
    );
    return {
      kind: 'ok',
      rootPath: { kind: 'known', path: rootPath },
      comparison,
      status,
      changedFiles: mergeChangedFiles([
        ...trackedChangedFiles,
        ...untrackedPaths.map(untrackedChangedFile),
      ]),
      patch: joinPatch([trackedPatchBody, untrackedPatch.stdout]),
      truncated:
        statusResult.truncated ||
        untrackedResult.truncated ||
        trackedPatch.truncated ||
        untrackedPatch.truncated,
    };
  } catch (err) {
    logWarn(LOG_COMPONENT.runs, `run git diff failed for ${cwd}: ${errorMessage(err)}`);
    return {
      kind: 'error',
      rootPath: { kind: 'known', path: rootPath },
      comparison: unavailableComparison('error'),
      status: [],
      changedFiles: [],
      patch: '',
      truncated: false,
      error: 'git diff failed',
    };
  }
}

function emptyDiff(
  kind: 'not_git' | 'path_unknown',
  rootPath: Extract<RunDiffRootPath, { kind: 'unavailable' }>,
): RunDiffResponse {
  return {
    kind,
    rootPath,
    comparison: unavailableComparison(rootPath.reason),
    status: [],
    changedFiles: [],
    patch: '',
    truncated: false,
  };
}

function unavailableRoot(
  reason: Extract<RunDiffRootPath, { kind: 'unavailable' }>['reason'],
): Extract<RunDiffRootPath, { kind: 'unavailable' }> {
  return { kind: 'unavailable', reason };
}

async function runGit(
  cwd: string,
  view: Parameters<typeof execRunGit>[1],
  allowedRoots: readonly string[],
): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
  const result = await execRunGit(cwd, view, allowedRoots);
  const cappedDiff = result.truncated && view === 'diff-head';
  if (result.exitCode !== 0 && !cappedDiff) {
    throw new Error(`git ${view} failed`);
  }
  return result;
}

async function resolveComparison(
  cwd: string,
  allowedRoots: readonly string[],
): Promise<RunDiffComparison> {
  const upstream = await execRunGit(cwd, 'upstream', allowedRoots);
  if (upstream.exitCode !== 0 || upstream.stdout.trim().length === 0) {
    return { kind: 'head', reason: 'no_upstream' };
  }
  const mergeBase = await execRunGit(cwd, 'merge-base-upstream', allowedRoots);
  const mergeBaseHash = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(mergeBaseHash)) {
    return { kind: 'head', reason: 'upstream_lookup_failed' };
  }
  return {
    kind: 'upstream',
    ref: upstream.stdout.trim(),
    mergeBase: mergeBaseHash,
  };
}

async function readTrackedPatch(
  cwd: string,
  comparison: RunDiffComparison,
  allowedRoots: readonly string[],
): Promise<{ stdout: string; truncated: boolean }> {
  if (comparison.kind === 'upstream') {
    const result = await execRunGitDiffFrom(cwd, comparison.mergeBase, allowedRoots);
    if (result.exitCode !== 0 && !result.truncated) {
      throw new Error('git diff from upstream merge base failed');
    }
    return result;
  }
  if (comparison.kind === 'head') {
    const result = await execRunGit(cwd, 'diff-head', allowedRoots);
    if (result.exitCode !== 0 && !result.truncated) {
      logWarn(
        LOG_COMPONENT.runs,
        `run git diff HEAD failed for ${cwd}: ${result.stderr || 'unknown error'}`,
      );
      return { stdout: '', truncated: false };
    }
    return result;
  }
  return { stdout: '', truncated: false };
}

async function readTrackedChangedFiles(
  cwd: string,
  comparison: RunDiffComparison,
  allowedRoots: readonly string[],
): Promise<RunChangedFile[]> {
  const result =
    comparison.kind === 'upstream'
      ? await execRunGitNameStatusFrom(cwd, comparison.mergeBase, allowedRoots)
      : comparison.kind === 'head'
        ? await execRunGit(cwd, 'name-status-head', allowedRoots)
        : null;
  if (result === null) return [];
  if (result.exitCode !== 0) {
    logWarn(
      LOG_COMPONENT.runs,
      `run git name-status failed for ${cwd}: ${result.stderr || 'unknown error'}`,
    );
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter(isReviewableNameStatusLine)
    .map(parseNameStatusLine)
    .filter(isChangedFile)
    .filter((file) => isReviewableRunDiffPath(file.path));
}

async function readUntrackedPatch(
  cwd: string,
  paths: string[],
  usedBytes: number,
  allowedRoots: readonly string[],
): Promise<{ stdout: string; truncated: boolean }> {
  const orderedPaths = [...paths]
    .filter(isSafeRelativeGitPath)
    .sort(compareUntrackedPaths)
    .slice(0, MAX_UNTRACKED_PATCH_FILES);
  let remaining = Math.max(0, MAX_RUN_DIFF_BYTES - usedBytes);
  let truncated = paths.length > MAX_UNTRACKED_PATCH_FILES || usedBytes > MAX_RUN_DIFF_BYTES;
  const parts: string[] = [];
  for (const filePath of orderedPaths) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const result = await execRunGitNewFileDiff(
      cwd,
      filePath,
      allowedRoots,
      Math.max(1, Math.min(remaining, MAX_UNTRACKED_FILE_DIFF_BYTES)),
    );
    if (![0, 1].includes(result.exitCode) && !result.truncated) {
      logWarn(
        LOG_COMPONENT.runs,
        `run untracked diff failed for ${cwd}/${filePath}: ${result.stderr || 'unknown error'}`,
      );
      continue;
    }
    if (result.stdout.length > remaining) {
      parts.push(result.stdout.slice(0, remaining));
      truncated = true;
      break;
    }
    parts.push(result.stdout);
    remaining -= result.stdout.length;
    truncated = truncated || result.truncated;
    if (result.truncated) break;
  }
  return { stdout: joinPatch(parts), truncated };
}

function parseNulList(raw: string): string[] {
  return raw.split('\0').filter((part) => part.length > 0);
}

function joinPatch(parts: string[]): string {
  return parts
    .map((part) => part.trimEnd())
    .filter((part) => part.length > 0)
    .join('\n\n');
}

function unavailableComparison(
  reason: Extract<RunDiffComparison, { kind: 'unavailable' }>['reason'],
): RunDiffComparison {
  return { kind: 'unavailable', reason };
}

function parseNameStatusLine(line: string): RunChangedFile | null {
  const parts = line.split('\t').filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  const rawStatus = parts[0] ?? '';
  const filePath = parts.at(-1) ?? '';
  const status = rawStatus.startsWith('R')
    ? 'R'
    : rawStatus.startsWith('C')
      ? 'C'
      : rawStatus.slice(0, 1);
  if (status.length === 0 || filePath.length === 0) return null;
  return {
    path: filePath,
    status,
    kind: classifyRunDiffFile(filePath),
  };
}

function untrackedChangedFile(filePath: string): RunChangedFile {
  return {
    path: filePath,
    status: '??',
    kind: classifyRunDiffFile(filePath),
  };
}

function mergeChangedFiles(files: RunChangedFile[]): RunChangedFile[] {
  const byPath = new Map<string, RunChangedFile>();
  for (const file of files) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function compareUntrackedPaths(a: string, b: string): number {
  const priority = untrackedPatchPriority(a) - untrackedPatchPriority(b);
  return priority === 0 ? a.localeCompare(b) : priority;
}

function untrackedPatchPriority(filePath: string): number {
  const kind = classifyRunDiffFile(filePath);
  if (kind === 'docs') return 0;
  if (kind === 'code' || kind === 'test' || kind === 'config') return 1;
  return 2;
}

function isReviewableStatusLine(line: string): boolean {
  const payload = line.slice(3).trim();
  if (payload.length === 0) return true;
  return payload.split(' -> ').every((filePath) => isReviewableRunDiffPath(filePath));
}

function isReviewableNameStatusLine(line: string): boolean {
  const parts = line.split('\t').filter((part) => part.length > 0);
  if (parts.length < 2) return true;
  return parts.slice(1).every((filePath) => isReviewableRunDiffPath(filePath));
}

function filterReviewablePatch(patch: string): string {
  if (patch.trim().length === 0) return '';
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return joinPatch(blocks.filter(isReviewablePatchBlock));
}

function isReviewablePatchBlock(block: string): boolean {
  const header = block.split('\n', 1)[0] ?? '';
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);
  if (!match) return true;
  return isReviewableRunDiffPath(match[1] ?? '') && isReviewableRunDiffPath(match[2] ?? '');
}

function isChangedFile(value: RunChangedFile | null): value is RunChangedFile {
  return value !== null;
}
