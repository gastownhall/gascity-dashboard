import type { RunChangedFileKind } from 'gas-city-dashboard-shared';

const CONTROL_PLANE_PATH_PREFIXES = ['.beads', '.gc'] as const;

export const RUN_REVIEWABLE_PATHS = [
  '--',
  ':/',
  ':(exclude,top).beads',
  ':(exclude,top).beads/**',
  ':(exclude,top).gc',
  ':(exclude,top).gc/**',
] as const;

export function isReviewableRunDiffPath(filePath: string): boolean {
  const normalized = normalizeGitDiffPath(filePath);
  return CONTROL_PLANE_PATH_PREFIXES.every(
    (prefix) => normalized !== prefix && !normalized.startsWith(`${prefix}/`),
  );
}

export function normalizeGitDiffPath(filePath: string): string {
  return filePath.replace(/^"?[ab]\//, '').replace(/"$/, '');
}

// Defense-in-depth guard for paths handed to a `git diff` shell-out in the
// untracked-patch pass. Git only ever emits repo-relative paths, so in normal
// operation every path passes; the guard fails closed if a compromised or
// malformed git output ever yields an absolute path, a `..` escape, or an
// embedded NUL — none of which a legitimate relative in-repo path carries.
export function isSafeRelativeGitPath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.startsWith('/') &&
    !filePath.includes('\0') &&
    !filePath.split('/').includes('..')
  );
}

export function classifyRunDiffFile(filePath: string): RunChangedFileKind {
  const lower = normalizeGitDiffPath(filePath).toLowerCase();
  if (
    lower.endsWith('.test.ts') ||
    lower.endsWith('.test.tsx') ||
    lower.endsWith('.spec.ts') ||
    lower.endsWith('.spec.tsx') ||
    lower.includes('/test/') ||
    lower.includes('/tests/')
  ) {
    return 'test';
  }
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.includes('/docs/')) {
    return 'docs';
  }
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.toml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.config.ts') ||
    lower.endsWith('.config.js') ||
    lower === 'package.json' ||
    lower.endsWith('/package.json')
  ) {
    return 'config';
  }
  if (/\.(ts|tsx|js|jsx|go|rs|py|rb|java|kt|swift|c|cc|cpp|h|hpp|css|scss|html)$/.test(lower)) {
    return 'code';
  }
  return 'other';
}
